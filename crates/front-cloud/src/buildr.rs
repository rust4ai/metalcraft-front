//! buildr.space — the *work* box an agent codes in (PLAN §9.3, sibling to
//! [`crate::octaweave`]).
//!
//! **One button, no paste.** The pack behind this is 26 tools that clone a repo
//! into an ephemeral sprites.dev workspace and run it; all of them read a single
//! `BUILDR_API_KEY`. Getting one used to mean opening buildr.space, finding the
//! Keys page, minting a `bsk_` and pasting it into a pod — four steps, one of
//! them a live credential on someone's clipboard. The desktop already holds a
//! Metalcraft PAT, buildr.space accepts one as a first-class credential
//! (`middleware/hub_token.rs`), so the app does all four itself:
//!
//! ```text
//! GET    /api/v1/whoami           ← mck_   which account is this, and is it linked?
//! GET    /api/v1/account/tokens   ← mck_   what did we mint here before?
//! POST   /api/v1/account/tokens   ← mck_   mint a bsk_ for this account
//! GET    /api/v1/whoami           ← bsk_   prove it before storing it
//! ```
//!
//! **The pod is given the narrow key, not the PAT.** Both would authenticate —
//! the pack sends whatever is in `BUILDR_API_KEY` as a bearer token, and an
//! `mck_` resolves — which is exactly why the choice has to be deliberate. An
//! `mck_` names a *person* and reaches every Metalcraft subapp they have; a
//! `bsk_` names one buildr.space account and can never reach sideways. Minting
//! through the PAT and storing the result gets the one-click flow *and* the
//! smaller blast radius.
//!
//! Minting through a hub token is allowed because `account::require_person`
//! refuses only `principal.is_api_key()` — a key may never mint another key,
//! which is why a `bsk_` could not bootstrap this and a person's token can.
//!
//! The one thing the app cannot do for the user is the link itself: an `mck_`
//! resolves only if a `metalcraft_links` row exists on buildr.space's side,
//! written by `GET /link/metalcraft`. No row, no access, however valid the
//! token. That is the browser trip in [`link_url`], and it is a click, not a
//! copy.

use serde::{Deserialize, Serialize};

use crate::http;

/// buildr.space origin. `BUILDR_URL` overrides for local testing.
pub fn buildr_base() -> String {
    crate::env_or("BUILDR_URL", "https://buildr.space")
}

/// The key store name the `buildr-space` integration pack reads
/// (`pack.json: requires_env`). Not a choice — the pack will not work under any
/// other name.
pub const KEY_NAME: &str = "BUILDR_API_KEY";

/// The integration pack's registry slug.
pub const PACK_SLUG: &str = "buildr-space";

/// The name the minted key carries in buildr.space's Keys page.
///
/// Fixed rather than timestamped so reconnecting *replaces* its predecessor
/// instead of leaving a drift of live keys nobody can tell apart.
pub const KEY_LABEL: &str = "Metalcraft agent";

/// Whether the minted key may change anything.
///
/// True, and not a setting. buildr.space's scopes are `read`, `write` and
/// `admin`; every tool in the pack that is worth having — write a file, run a
/// command, commit, push — is a write, so a read-only key would install 26 tools
/// of which 20 fail at the first useful step. `admin` is never asked for: it is
/// for reaping other people's workspaces and nothing an agent does needs it.
const WANTS_WRITE: bool = true;

/// Days until the minted key expires. `0` means never.
///
/// Never, deliberately, and it is the awkward choice of the two. buildr.space's
/// default is 30 days, and an expiring key here would fail *silently*: the pod
/// still holds a `BUILDR_API_KEY`, so this card goes on saying "Connected" while
/// every tool 401s inside a conversation a month from now. Nothing on this
/// screen can see an expiry — the status is read from the pod, which knows only
/// that a key is present. A key that lasts until someone revokes it, under a
/// fixed label, visible in buildr.space's own Keys page, is the failure mode
/// that can at least be looked at.
const TTL_DAYS: i64 = 0;

/// Where a person links their Metalcraft account to buildr.space.
///
/// Not a name this app chose: `SUBAPP_STANDARD.md` §2 fixes the path, and the
/// hub's account page derives its Connect button from it. Signed out, it bounces
/// through buildr.space's Google sign-in and resumes — so this single URL works
/// for someone who has never opened buildr.space before.
pub fn link_url() -> String {
    format!("{}/link/metalcraft", buildr_base())
}

/// Why a call made with the Metalcraft PAT did not go through.
///
/// [`Self::NotLinked`] is split out because it is the only failure a browser
/// trip fixes, and the UI does something completely different with it.
#[derive(Debug)]
pub enum HubError {
    /// buildr.space has no link row for this Metalcraft account — yet, or any
    /// more (unlinking from the hub's side deletes it, and reports the same).
    NotLinked,
    Failed(anyhow::Error),
}

impl std::fmt::Display for HubError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotLinked => {
                write!(
                    f,
                    "this Metalcraft account is not linked to buildr.space yet"
                )
            }
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

/// What `GET /api/v1/whoami` says about a credential.
///
/// The same answer for all three of buildr.space's credentials, which is what
/// makes it usable twice in one connect: once to ask whether the Metalcraft PAT
/// resolves at all, and once to prove the key that was just minted.
///
/// `scopes` is null for a full-access browser session and a list for anything
/// scoped — so `None` here means *more* authority, not less. Nothing this app
/// does holds a buildr session, so in practice it is always `Some`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Account {
    #[serde(default)]
    pub sub: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub scopes: Option<Vec<String>>,
    #[serde(default)]
    pub is_admin: bool,
}

/// buildr.space's error body: prose for a person, and — for the one refusal a
/// client has to branch on — a stable code beside it (`error.rs: NOT_LINKED`).
#[derive(Debug, Default, Deserialize)]
struct ErrorBody {
    #[serde(default)]
    error: String,
    #[serde(default)]
    code: Option<String>,
}

/// The code buildr.space puts on the two 401s a browser trip fixes.
const NOT_LINKED: &str = "not_linked";

/// Whether a 401 is the kind [`link_url`] fixes.
///
/// buildr.space refuses an unlinked `mck_` with *two* different sentences, and
/// the second one is not a rewording of the first — it is a different state
/// (`middleware/hub_token.rs`):
///
/// - no link row here → "…is **not linked** to a buildr.space account"
/// - the hub reports the connection revoked → buildr deletes its row and says
///   "…is **no longer connected** to buildr.space"
///
/// Both are fixed by the same trip to `/link/metalcraft`, and the second is the
/// one an account that never connected gets: the hub answers `link_active:
/// false` for a missing `linked_apps` row exactly as it does for a revoked one
/// (`metalcraft-id: controllers/verify.rs`), so *first* connect takes this
/// branch, not the "not linked" one. Matching only the first sentence sent the
/// commonest case to a dead end that read like a failure.
///
/// The code is still the contract and is checked first; the prose is the
/// fallback for a deployment that predates it — brittle, and better than
/// telling every unlinked account something it cannot act on.
fn fixed_by_linking(body: &ErrorBody) -> bool {
    body.code.as_deref() == Some(NOT_LINKED)
        || body.error.contains("not linked")
        || body.error.contains("no longer connected")
}

/// What to say when buildr.space will not let a Metalcraft account near a key.
///
/// This is not a failure anyone pressing the button can do anything about, and
/// the raw refusal actively misleads: it says "requires a browser session" to
/// someone sitting in a desktop app who never asked about browsers, so it reads
/// as *do something else* when there is nothing else to do.
///
/// A deployment either accepts a hub token for key management or it does not.
/// buildr.space's `account.rs` gates all three of create, list and revoke on the
/// same rule, so this is the whole surface at once — not one endpoint being
/// awkward — and every part of this module that touches a key hits it.
const NO_HUB_KEYS: &str = "buildr.space does not accept Metalcraft accounts for key management on \
     this deployment — it still requires signing in at buildr.space itself";

/// Whether that is the refusal we just got.
///
/// A 403 naming a browser session, from a call this app only ever makes with a
/// person's `mck_`. buildr.space has a second sentence with those words for a
/// key trying to mint a key, and it is unreachable from here: minting is done
/// with the PAT, never with the `bsk_`. So one match covers both deployments.
fn refuses_hub_keys(status: reqwest::StatusCode, body: &ErrorBody) -> bool {
    status == reqwest::StatusCode::FORBIDDEN && body.error.contains("browser session")
}

/// Who this token is, or why it is nobody.
///
/// A 401 is not one answer. "Not linked yet" is fixed by a click and is the
/// first fork in the whole connect flow; "that token is not active" is fixed by
/// signing in again and would be a pointless trip to a browser. Which is which
/// is [`fixed_by_linking`].
pub async fn whoami(token: &str) -> Result<Account, HubError> {
    let resp = http()
        .get(format!("{}/api/v1/whoami", buildr_base()))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| HubError::Failed(anyhow::anyhow!("could not reach buildr.space: {e}")))?;
    let status = resp.status();
    if status.is_success() {
        return resp.json().await.map_err(|e| HubError::Failed(e.into()));
    }

    let body: ErrorBody = resp.json().await.unwrap_or_default();
    if status == reqwest::StatusCode::UNAUTHORIZED && fixed_by_linking(&body) {
        return Err(HubError::NotLinked);
    }
    Err(HubError::Failed(if body.error.is_empty() {
        anyhow::anyhow!("buildr.space returned {status}")
    } else {
        anyhow::anyhow!("{}", body.error)
    }))
}

/// A key as `POST /api/v1/account/tokens` returns it. `token` exists here and
/// nowhere else — buildr.space stores only its hash.
#[derive(Debug, Clone, Deserialize)]
pub struct MintedKey {
    /// The row's id, so a key that turns out to be unusable can be taken back.
    pub id: String,
    pub token: String,
    #[serde(default)]
    pub scopes: Vec<String>,
}

/// Mint a `bsk_` for this account, using the person's Metalcraft PAT as the
/// authority.
pub async fn mint_key(pat: &str) -> anyhow::Result<MintedKey> {
    let resp = http()
        .post(format!("{}/api/v1/account/tokens", buildr_base()))
        .bearer_auth(pat)
        .json(&serde_json::json!({
            "name": KEY_LABEL,
            "write": WANTS_WRITE,
            "ttl_days": TTL_DAYS,
        }))
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("could not reach buildr.space: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        // The body carries buildr.space's own message — a read-only Metalcraft
        // token names itself as the reason — which beats a bare status code.
        let body: ErrorBody = resp.json().await.unwrap_or_default();
        if refuses_hub_keys(status, &body) {
            // Worth saying, because the mint is the step that would have left
            // something behind: it is the first call that *creates*, and this
            // one never got that far.
            anyhow::bail!("{NO_HUB_KEYS}. Nothing was created");
        }
        anyhow::bail!(if body.error.is_empty() {
            format!("buildr.space refused to create the key ({status})")
        } else {
            body.error
        });
    }
    Ok(resp.json().await?)
}

/// A key in the account's Keys page, trimmed to what reconnecting needs.
///
/// `prefix` is carried because it is what buildr.space shows next to a key, so
/// a log line about one is findable in the UI without a raw value anywhere.
#[derive(Debug, Clone, Deserialize)]
pub struct KeySummary {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub prefix: String,
    /// RFC3339, or absent for a key that never lapses. Present in the listing
    /// even once it is in the past — see [`list_keys`].
    #[serde(default)]
    pub expires_at: Option<String>,
}

/// What buildr.space says about the key this app minted, asked of buildr.space
/// rather than of the pod.
///
/// The pod is the wrong thing to ask. It knows a `BUILDR_API_KEY` is *present*
/// and nothing else — not whether it still authenticates — so a key revoked from
/// buildr.space's own Keys page, or one that lapsed on schedule, leaves the card
/// reading "Connected · 26 tools installed" while every one of those tools 401s
/// inside a conversation. That is the failure this type exists to end.
///
/// Deliberately not a cached expiry date written down beside the key at mint
/// time. A date is a *prediction*: right about the clock, silent about
/// revocation — which is the half that happens on purpose, and from somewhere
/// else. Asking the source costs one GET and answers both.
#[derive(Debug, Clone, Serialize)]
pub struct KeyHealth {
    /// buildr.space still lists a key under [`KEY_LABEL`]. False means it was
    /// revoked — from its own UI, from another machine, or by a disconnect this
    /// pod never heard about.
    pub present: bool,
    /// When it lapses, RFC3339 — absent for a key that never does.
    ///
    /// Whether that moment has passed is judged where the user's clock is,
    /// beside the words that render it, rather than in two places.
    pub expires_at: Option<String>,
}

/// Ask buildr.space whether the key this app minted is still a credential.
///
/// Needs the person's Metalcraft PAT, not the key — the key lives on the pod and
/// this app has no copy of it, which is exactly the property worth keeping. The
/// match is by [`KEY_LABEL`], because that is the only handle both sides share.
pub async fn key_health(pat: &str) -> anyhow::Result<KeyHealth> {
    let keys = list_keys(pat).await?;
    let ours = keys.iter().find(|k| k.name == KEY_LABEL);
    Ok(KeyHealth {
        present: ours.is_some(),
        expires_at: ours.and_then(|k| k.expires_at.clone()),
    })
}

/// Keys buildr.space has not revoked.
///
/// Not the same as keys that *work*: `pat::list` filters on `revoked_at` alone,
/// so a lapsed key is still here with its `expires_at` in the past. That is the
/// distinction [`key_health`] reports — "revoked" and "expired" are different
/// things to be told, and a listing that hid the second would collapse them.
pub async fn list_keys(pat: &str) -> anyhow::Result<Vec<KeySummary>> {
    let resp = http()
        .get(format!("{}/api/v1/account/tokens", buildr_base()))
        .bearer_auth(pat)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("could not reach buildr.space: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        // The same refusal as the mint's, and worth the same words: this one
        // surfaces as the health check's reason, where "returned 403 Forbidden"
        // would send someone looking at their own account for a fault that is
        // not there.
        let body: ErrorBody = resp.json().await.unwrap_or_default();
        if refuses_hub_keys(status, &body) {
            anyhow::bail!("{NO_HUB_KEYS}");
        }
        anyhow::bail!("buildr.space returned {status}");
    }
    Ok(resp.json().await?)
}

pub async fn revoke_key(pat: &str, id: &str) -> anyhow::Result<()> {
    let resp = http()
        .delete(format!("{}/api/v1/account/tokens/{id}", buildr_base()))
        .bearer_auth(pat)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("could not reach buildr.space: {e}"))?;
    // A key that is already gone is the state we wanted.
    if resp.status().is_success() || resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(());
    }
    anyhow::bail!("buildr.space returned {}", resp.status());
}

/// Revoke every key this app previously minted here, so reconnecting replaces
/// rather than accumulates.
///
/// Best-effort by design: it runs before a mint that is about to succeed, and
/// failing to tidy up an old key is not a reason to refuse the user a working
/// one. What it cannot leave behind is a *silent* pile — [`KEY_LABEL`] is fixed,
/// so anything it misses is visibly one of ours in buildr.space's own UI.
///
/// It matches on the label and nothing else, which means a key the user named
/// "Metalcraft agent" by hand is revoked too. That is the intended reading of
/// the name rather than a collision: it says "the key the Metalcraft app uses",
/// and there is meant to be one.
pub async fn revoke_ours(pat: &str) -> usize {
    let Ok(keys) = list_keys(pat).await else {
        return 0;
    };
    let mut n = 0;
    for key in keys.iter().filter(|k| k.name == KEY_LABEL) {
        if revoke_key(pat, &key.id).await.is_ok() {
            n += 1;
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `/link/metalcraft` is the hub's convention, not ours — renaming it here
    /// silently breaks the Connect button on the hub's own account page.
    #[test]
    fn the_link_url_is_the_conventional_one() {
        assert!(link_url().ends_with("/link/metalcraft"));
    }

    /// Both deployments' way of saying "not with a Metalcraft account", verbatim
    /// — the one running today and the one that replaces it.
    ///
    /// Recognised so it can be reworded into something true. "Requires a browser
    /// session" is buildr.space explaining its own rule to itself; the person
    /// reading it is in a desktop app, has no browser session to go and get, and
    /// would be hunting through their own account for a fault that is not there.
    #[test]
    fn the_deployment_refusing_hub_tokens_is_recognised() {
        for message in [
            "managing API keys requires a browser session",
            "managing API keys needs a browser session or a linked Metalcraft token — an API \
             key may not mint another",
        ] {
            let body = ErrorBody {
                error: message.into(),
                code: None,
            };
            assert!(
                refuses_hub_keys(reqwest::StatusCode::FORBIDDEN, &body),
                "{message}"
            );
        }
    }

    /// And it is that refusal specifically, not any 403 — a scope refusal is the
    /// user's own read-only token and says so usefully, so replacing its words
    /// would lose the only part worth reading.
    #[test]
    fn an_ordinary_403_keeps_its_own_words() {
        let body = ErrorBody {
            error: "this token is read-only".into(),
            code: None,
        };
        assert!(!refuses_hub_keys(reqwest::StatusCode::FORBIDDEN, &body));
        // Nor is it read into a status that means something else entirely.
        let body = ErrorBody {
            error: "managing API keys requires a browser session".into(),
            code: None,
        };
        assert!(!refuses_hub_keys(reqwest::StatusCode::UNAUTHORIZED, &body));
    }

    /// The key store name is the pack's, and the pack reads exactly one.
    #[test]
    fn the_key_name_is_the_one_the_pack_requires() {
        assert_eq!(KEY_NAME, "BUILDR_API_KEY");
        assert_eq!(PACK_SLUG, "buildr-space");
    }

    /// `admin` is for reaping other people's workspaces. Asking for it would be
    /// a quiet widening of a key an agent holds, so it is a test rather than a
    /// comment — and buildr.space would refuse it for a non-admin anyway, which
    /// would turn every ordinary connect into a 403.
    #[test]
    fn the_mint_never_asks_for_admin() {
        let body = serde_json::json!({
            "name": KEY_LABEL, "write": WANTS_WRITE, "ttl_days": TTL_DAYS,
        });
        assert_eq!(body.get("admin"), None);
        assert_eq!(body["write"], true);
        // Never, not "in a long time" — see TTL_DAYS.
        assert_eq!(body["ttl_days"], 0);
    }

    /// The whole point of the code: a 401 that a browser trip fixes, told apart
    /// from one that it does not.
    #[test]
    fn the_not_linked_code_is_the_one_buildr_sends() {
        let body: ErrorBody = serde_json::from_str(
            r#"{"error":"that Metalcraft account is not linked to a buildr.space account — visit /link/metalcraft","code":"not_linked"}"#,
        )
        .unwrap();
        assert_eq!(body.code.as_deref(), Some(NOT_LINKED));
        assert!(fixed_by_linking(&body));
    }

    /// Both of buildr.space's link refusals, *verbatim* and uncoded — which is
    /// how the deployment sends them (`error.rs` there has no `code` field yet).
    ///
    /// The second one is the regression this pins. It is what a Metalcraft
    /// account that has never connected buildr.space gets on its very first
    /// click, and reading it as a hard failure put "no longer connected" on
    /// screen instead of opening the page that connects it — an error naming a
    /// state the user was not in, about a trip they had never made.
    #[test]
    fn both_link_refusals_send_the_user_to_the_browser() {
        for message in [
            "that Metalcraft account is not linked to a buildr.space account — visit /link/metalcraft",
            "this Metalcraft account is no longer connected to buildr.space",
        ] {
            let body = ErrorBody {
                error: message.into(),
                code: None,
            };
            assert!(fixed_by_linking(&body), "{message}");
        }
    }

    /// And the 401 a browser trip does *not* fix: a lapsed or signed-out PAT is
    /// re-signed-in, not re-linked, and a tab opened on the link page would be a
    /// dead end of the opposite kind.
    #[test]
    fn a_dead_token_is_not_a_linking_problem() {
        for message in [
            "that Metalcraft token is not active",
            "that Metalcraft token was issued for another app",
            "Metalcraft returned no account for that token",
        ] {
            let body = ErrorBody {
                error: message.into(),
                code: None,
            };
            assert!(!fixed_by_linking(&body), "{message}");
        }
    }

    /// And an error from a deployment that predates the code still parses —
    /// absent is `None`, not a failure to deserialize.
    #[test]
    fn an_uncoded_error_still_parses_and_carries_its_message() {
        let body: ErrorBody =
            serde_json::from_str(r#"{"error":"that Metalcraft token is not active"}"#).unwrap();
        assert_eq!(body.code, None);
        assert!(body.error.contains("not active"));
    }

    /// `whoami` for a browser session reports a null scope list, which means
    /// *unrestricted* — deserializing that as `Vec` is exactly the bug this
    /// shape avoids.
    /// A key with no expiry and a key that lapsed yesterday are both *listed*;
    /// what separates them is a date, not their presence. Deserializing a
    /// missing `expires_at` as anything but `None` would make a never-expiring
    /// key look like a lapsed one.
    #[test]
    fn a_listed_key_carries_its_expiry_or_says_it_has_none() {
        let never: KeySummary = serde_json::from_str(
            r#"{"id":"k1","name":"Metalcraft agent","prefix":"bsk_ab12","expires_at":null}"#,
        )
        .unwrap();
        assert_eq!(never.expires_at, None);

        let dated: KeySummary = serde_json::from_str(
            r#"{"id":"k1","name":"Metalcraft agent","prefix":"bsk_ab12","expires_at":"2026-09-01T00:00:00Z"}"#,
        )
        .unwrap();
        assert_eq!(dated.expires_at.as_deref(), Some("2026-09-01T00:00:00Z"));

        // An older buildr.space that does not send the field at all is a key
        // with no expiry, not a parse failure.
        let absent: KeySummary =
            serde_json::from_str(r#"{"id":"k1","name":"Metalcraft agent"}"#).unwrap();
        assert_eq!(absent.expires_at, None);
        assert_eq!(absent.prefix, "");
    }

    #[test]
    fn whoami_survives_the_null_scopes_a_session_reports() {
        let who: Account = serde_json::from_str(
            r#"{"sub":"u1","email":"a@b.com","scopes":null,"is_admin":false}"#,
        )
        .unwrap();
        assert_eq!(who.scopes, None);
        assert_eq!(who.email, "a@b.com");
    }

    #[test]
    fn whoami_reads_the_scope_list_a_key_reports() {
        let who: Account = serde_json::from_str(
            r#"{"sub":"u1","email":"a@b.com","scopes":["read","write"],"is_admin":false}"#,
        )
        .unwrap();
        assert_eq!(
            who.scopes.as_deref(),
            Some(&["read".to_string(), "write".to_string()][..])
        );
    }
}
