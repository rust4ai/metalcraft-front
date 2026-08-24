//! Octaweave — the *life* workspace an agent shares with you (PLAN §9.3).
//!
//! **One button, no paste.** The desktop already holds a Metalcraft ID PAT
//! (`mck_…`) in the OS keychain, and Octaweave now accepts one as a first-class
//! credential (`auth/extract.rs` tries `mck_` before `owk_`, per
//! `ECOSYSTEM_PIVOT_PLAN.md` §3). So the app can do for the user exactly what it
//! was asking the user to do by hand: pick a workspace and mint a key.
//!
//! ```text
//! GET  /api/v1/workspaces      ← mck_   which workspaces is this person in?
//! POST /api/v1/w/{ws}/keys     ← mck_   mint an owk_ key pinned to one of them
//! GET  /api/v1/whoami          ← owk_   prove the minted key before storing it
//! ```
//!
//! **The pod is deliberately given the narrow key, not the PAT.** Both would
//! work — the pack sends whatever is in `OCTAWEAVE_API_KEY` as a bearer token —
//! and that is precisely why the choice has to be made on purpose. An `mck_`
//! token names a *person* and reaches every workspace they have, plus every
//! other Metalcraft subapp; an `owk_` key names one workspace and can never
//! reach sideways (`authz::require` checks `pinned_workspace` before any
//! lookup). Minting through the PAT and storing the result gets the one-click
//! flow *and* the smaller blast radius, so there is no trade to make.
//!
//! Minting is allowed because `keys::create` refuses only `principal.is_api_key()`
//! — a key may never mint another key, which is why an `owk_` could not
//! bootstrap this and a person's token can.
//!
//! The one thing the app cannot do for the user is the link itself: a `mck_`
//! token resolves only if a `user_identities` row exists on Octaweave's side,
//! written by `GET /link/metalcraft`. No row, no access, however valid the
//! token — which is also what makes unlinking instant. That is the browser trip
//! in [`link_url`], and it is a click, not a copy.

use serde::{Deserialize, Serialize};

use crate::http;

/// Octaweave origin. `OCTAWEAVE_URL` overrides for local testing.
pub fn octaweave_base() -> String {
    std::env::var("OCTAWEAVE_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://octaweave.com".to_string())
}

/// The key store name the `octaweave` integration pack reads
/// (`pack.json: requires_env`). Not a choice — the pack will not work under any
/// other name.
pub const KEY_NAME: &str = "OCTAWEAVE_API_KEY";

/// The integration pack's registry slug.
pub const PACK_SLUG: &str = "octaweave";

/// The name the minted key carries in Octaweave's Keys page.
///
/// Fixed rather than timestamped so reconnecting *replaces* its predecessor
/// instead of leaving a drift of live keys nobody can tell apart.
pub const KEY_LABEL: &str = "Metalcraft agent";

/// What the minted key may do — every module the pack's 32 tools touch, and
/// nothing else.
///
/// Named modules rather than the coarse `write`, which by Octaweave's own
/// definition covers actions invented after the key was minted. The cost is
/// honest: a module added to Octaweave later fails with a scope error until
/// this list grows, which is a better failure than a credential that silently
/// widens.
///
/// `blog:publish` is in the list. Putting something on the open internet is a
/// different act from editing a draft, and it is gated where this app gates
/// consequence — arming and approval in the conversation (PLAN §12) — rather
/// than by withholding a scope and surfacing it as a 403 mid-sentence.
pub const AGENT_SCOPES: &[&str] = &[
    "notes:write",
    "board:write",
    "drive:write",
    "calendar:write",
    "blog:write",
    "blog:publish",
    "studio:write",
    "search:read",
];

/// Where a person links their Metalcraft account to Octaweave.
///
/// Not a name this app chose: `SUBAPP_STANDARD.md` §2 fixes the path, and
/// Octaweave's own account page derives its Connect button from it. Signed out,
/// it bounces through Octaweave's sign-in and resumes — so this single URL works
/// for someone who has never opened Octaweave before.
pub fn link_url() -> String {
    format!("{}/link/metalcraft", octaweave_base())
}

/// Why a call made with the Metalcraft PAT did not go through.
///
/// [`Self::NotLinked`] is split out because it is the only failure a browser trip
/// fixes, and the UI does something completely different with it.
#[derive(Debug)]
pub enum HubError {
    /// Octaweave has no link row for this Metalcraft account — yet.
    NotLinked,
    Failed(anyhow::Error),
}

impl std::fmt::Display for HubError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotLinked => write!(f, "this Metalcraft account is not linked to Octaweave yet"),
            Self::Failed(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for HubError {}

impl From<anyhow::Error> for HubError {
    fn from(e: anyhow::Error) -> Self {
        Self::Failed(e)
    }
}

/// One workspace the signed-in person can reach, as `GET /api/v1/workspaces`
/// lists them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    #[serde(default)]
    pub org_slug: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub name: String,
    /// `admin`, `editor`, `viewer` — minting a key needs `admin`, so the picker
    /// can say why a workspace is not offered rather than failing at the mint.
    #[serde(default)]
    pub role: String,
}

impl Workspace {
    /// Only an admin may mint a key (`keys::create` → `require(…, Role::Admin)`).
    pub fn can_mint(&self) -> bool {
        self.role == "admin"
    }
}

#[derive(Deserialize)]
struct WorkspaceList {
    #[serde(default)]
    items: Vec<Workspace>,
}

/// Every workspace this person can reach, newest-org-first as Octaweave orders
/// them.
///
/// Doubles as the link check: a 401 here is the unlinked case, and it is the
/// cheapest way to ask.
pub async fn workspaces(pat: &str) -> Result<Vec<Workspace>, HubError> {
    let resp = http()
        .get(format!("{}/api/v1/workspaces", octaweave_base()))
        .bearer_auth(pat)
        .send()
        .await
        .map_err(|e| HubError::Failed(anyhow::anyhow!("could not reach Octaweave: {e}")))?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(HubError::NotLinked);
    }
    if !status.is_success() {
        return Err(HubError::Failed(anyhow::anyhow!(
            "Octaweave returned {status}"
        )));
    }
    Ok(resp
        .json::<WorkspaceList>()
        .await
        .map_err(|e| HubError::Failed(e.into()))?
        .items)
}

/// A key as `POST /w/{ws}/keys` returns it. `token` exists here and nowhere else
/// — Octaweave stores only its hash.
#[derive(Debug, Clone, Deserialize)]
pub struct MintedKey {
    pub id: String,
    pub token: String,
    #[serde(default)]
    pub scopes: Vec<String>,
}

/// Mint an `owk_` key pinned to one workspace, using the person's Metalcraft PAT
/// as the authority.
pub async fn mint_key(pat: &str, workspace: &str) -> anyhow::Result<MintedKey> {
    let resp = http()
        .post(format!("{}/api/v1/w/{workspace}/keys", octaweave_base()))
        .bearer_auth(pat)
        .json(&serde_json::json!({ "name": KEY_LABEL, "scopes": AGENT_SCOPES }))
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("could not reach Octaweave: {e}"))?;
    let status = resp.status();
    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::NOT_FOUND {
        anyhow::bail!("you need admin on that workspace to create a key for it");
    }
    if !status.is_success() {
        // The body carries Octaweave's own message (an unknown scope names
        // itself), which beats repeating a bare status code at the user.
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Octaweave refused to create the key ({status}) {body}");
    }
    Ok(resp.json().await?)
}

/// A key in the workspace's Keys page, trimmed to what reconnecting needs.
#[derive(Debug, Clone, Deserialize)]
pub struct KeySummary {
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// `active`, `expired`, or `revoked`.
    #[serde(default)]
    pub status: String,
}

#[derive(Deserialize)]
struct KeyList {
    #[serde(default)]
    items: Vec<KeySummary>,
}

pub async fn list_keys(pat: &str, workspace: &str) -> anyhow::Result<Vec<KeySummary>> {
    let resp = http()
        .get(format!("{}/api/v1/w/{workspace}/keys", octaweave_base()))
        .bearer_auth(pat)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("could not reach Octaweave: {e}"))?;
    if !resp.status().is_success() {
        anyhow::bail!("Octaweave returned {}", resp.status());
    }
    Ok(resp.json::<KeyList>().await?.items)
}

pub async fn revoke_key(pat: &str, workspace: &str, id: &str) -> anyhow::Result<()> {
    let resp = http()
        .delete(format!(
            "{}/api/v1/w/{workspace}/keys/{id}",
            octaweave_base()
        ))
        .bearer_auth(pat)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("could not reach Octaweave: {e}"))?;
    // A key that is already gone is the state we wanted.
    if resp.status().is_success() || resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(());
    }
    anyhow::bail!("Octaweave returned {}", resp.status());
}

/// Revoke every key this app previously minted here, so reconnecting replaces
/// rather than accumulates.
///
/// Best-effort by design: it runs before a mint that is about to succeed, and
/// failing to tidy up an old key is not a reason to refuse the user a working
/// one. What it cannot leave behind is a *silent* pile — [`KEY_LABEL`] is fixed,
/// so anything it misses is visibly one of ours in Octaweave's own UI.
pub async fn revoke_ours(pat: &str, workspace: &str) -> usize {
    let Ok(keys) = list_keys(pat, workspace).await else {
        return 0;
    };
    let mut n = 0;
    for key in keys
        .iter()
        .filter(|k| k.name == KEY_LABEL && k.status == "active")
    {
        if revoke_key(pat, workspace, &key.id).await.is_ok() {
            n += 1;
        }
    }
    n
}

/// What `GET /api/v1/whoami` says about a key.
///
/// The shape is Octaweave's, not one that would be convenient here. Two fields
/// are nullable for a reason worth keeping in the types: `scopes` is a *count*
/// and is null for anything unrestricted, and `workspace_id` is null for
/// anything that is not a pinned API key — a hub token reaches everywhere its
/// human does, so it has no single workspace to report.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WhoAmI {
    #[serde(default)]
    pub actor: Actor,
    #[serde(default)]
    pub scopes: Option<usize>,
    #[serde(default)]
    pub is_admin: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Actor {
    /// `user`, `api_key`, or `hub_token`.
    #[serde(default, rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

/// Prove a key works, and learn which workspace it is pinned to.
///
/// Called on the freshly minted key before it is written to the pod. Minting
/// succeeding is not quite the same claim as the key *authenticating*, and this
/// is the cheap way to close the gap — a key that cannot identify itself is not
/// worth storing in a pod and discovering mid-conversation.
pub async fn whoami(token: &str) -> anyhow::Result<WhoAmI> {
    let resp = http()
        .get(format!("{}/api/v1/whoami", octaweave_base()))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("could not reach Octaweave: {e}"))?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        anyhow::bail!("Octaweave rejected that key — it may be revoked, or copied incompletely");
    }
    if !resp.status().is_success() {
        anyhow::bail!("Octaweave returned {}", resp.status());
    }
    Ok(resp.json().await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The scopes must be ones Octaweave's `validate_scopes` accepts, or every
    /// mint 400s at runtime with nothing here to catch it.
    #[test]
    fn every_requested_scope_is_a_known_module_and_action() {
        const MODULES: &[&str] = &[
            "notes", "blog", "board", "drive", "calendar", "search", "studio", "*",
        ];
        const ACTIONS: &[&str] = &["read", "write", "publish"];
        for scope in AGENT_SCOPES {
            let (module, action) = scope
                .split_once(':')
                .unwrap_or_else(|| panic!("{scope} is a coarse grant, not a module scope"));
            assert!(MODULES.contains(&module), "unknown module in {scope}");
            assert!(ACTIONS.contains(&action), "unknown action in {scope}");
        }
    }

    /// The coarse grant covers actions invented after the key was minted. Reaching
    /// for it would be a quiet widening, so it is a test rather than a comment.
    #[test]
    fn the_blunt_write_grant_is_not_among_them() {
        assert!(!AGENT_SCOPES.contains(&"write"));
        assert!(!AGENT_SCOPES.contains(&"*:write"));
    }

    /// `/link/metalcraft` is the hub's convention, not ours — renaming it here
    /// silently breaks the Connect button on Octaweave's own account page.
    #[test]
    fn the_link_url_is_the_conventional_one() {
        assert!(link_url().ends_with("/link/metalcraft"));
    }

    /// `whoami` for a hub token reports a null workspace and a null scope count.
    /// Deserializing that as `String`/`Vec` is exactly the bug this shape fixes.
    #[test]
    fn whoami_survives_the_nulls_a_hub_token_produces() {
        let who: WhoAmI = serde_json::from_str(
            r#"{"user":{"id":"u1"},
                "actor":{"type":"hub_token","label":null,"workspace_id":null},
                "scopes":null,"is_admin":false}"#,
        )
        .unwrap();
        assert_eq!(who.actor.kind, "hub_token");
        assert_eq!(who.actor.workspace_id, None);
        assert_eq!(who.scopes, None);
    }

    /// And for a minted key it reports a *count*, not a list.
    #[test]
    fn whoami_reads_the_scope_count_a_key_reports() {
        let who: WhoAmI = serde_json::from_str(
            r#"{"user":{"id":"u1"},
                "actor":{"type":"api_key","label":"Metalcraft agent","workspace_id":"ws_1"},
                "scopes":8,"is_admin":false}"#,
        )
        .unwrap();
        assert_eq!(who.actor.workspace_id.as_deref(), Some("ws_1"));
        assert_eq!(who.scopes, Some(8));
    }

    #[test]
    fn only_an_admin_can_mint_in_a_workspace() {
        let admin = Workspace {
            role: "admin".into(),
            ..Default::default()
        };
        let editor = Workspace {
            role: "editor".into(),
            ..Default::default()
        };
        assert!(admin.can_mint());
        assert!(!editor.can_mint());
    }
}
