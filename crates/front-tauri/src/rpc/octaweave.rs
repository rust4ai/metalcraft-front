//! Octaweave connection (PLAN §9.3, P7) — one button.
//!
//! Connecting used to ask the user to open a browser, find the Keys page, create
//! a key and paste it back. Every one of those steps still happens; none of them
//! is the user's to do any more. The core holds a Metalcraft PAT, Octaweave
//! accepts one (`ECOSYSTEM_PIVOT_PLAN.md` §3), and so the app lists the person's
//! workspaces and mints the key itself.
//!
//! [`octaweave_connect`] is therefore *resumable rather than interactive*: it
//! returns what it needs instead of blocking on it. Not linked yet → `needs_link`
//! and a URL. More than one workspace → `choose_workspace` and the list. Both
//! resolve by calling it again, which is why it can be polled while the user is
//! away in the browser without re-opening the browser under them.
//!
//! The credential still never reaches the webview: the minted key goes from
//! Octaweave into the pod's key store inside this process, and what comes back
//! is a workspace and a scope list.

use std::sync::Arc;

use front_cloud::SessionStore;
use front_cloud::octaweave::{self, KEY_NAME, PACK_SLUG, Workspace};
use front_core::Integration;
use serde::Serialize;

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// Where the connection stands, as the settings card renders it.
#[derive(Debug, Clone, Default, Serialize)]
pub struct OctaweaveStatus {
    /// The pod holds a key under `OCTAWEAVE_API_KEY`.
    pub key_present: bool,
    /// The `octaweave` integration pack is installed.
    pub pack_installed: bool,
    /// Installed but switched off — the tools exist and will not fire.
    pub pack_enabled: bool,
    pub pack_version: Option<String>,
    /// Tools the pack contributes, when installed.
    pub api_tools: usize,
}

/// Read-only: what the pod already has. Never touches Octaweave itself, because
/// the key lives on the pod and the desktop has no copy to verify with.
#[tauri::command]
pub async fn octaweave_status(state: State<'_>) -> Result<OctaweaveStatus, String> {
    let conn = state.conn(None)?;
    let (keys, integrations) = tokio::join!(conn.list_keys(), conn.list_integrations());
    let keys = keys.map_err(|e| e.to_string())?;
    // A pod that cannot list integrations is a connection problem, not an
    // "Octaweave is not installed" answer — but the card is cosmetic, so it
    // degrades to "not installed" rather than failing the whole settings page.
    let integrations: Vec<Integration> = integrations.unwrap_or_default();
    let pack = integrations.into_iter().find(|i| i.id == PACK_SLUG);

    Ok(OctaweaveStatus {
        key_present: keys.iter().any(|k| k.name == KEY_NAME),
        pack_installed: pack.is_some(),
        pack_enabled: pack.as_ref().is_some_and(|p| p.enabled),
        api_tools: pack.as_ref().map(|p| p.api_tools).unwrap_or(0),
        pack_version: pack.map(|p| p.version),
    })
}

/// What a finished connection looks like. Deliberately carries no key.
#[derive(Debug, Clone, Serialize)]
pub struct OctaweaveConnection {
    pub workspace_id: String,
    /// The workspace's own name, which is what the user recognises — not the
    /// key's label, which is a name this app chose.
    pub label: String,
    /// Where the workspace lives, so the card can offer to open it.
    pub url: String,
    pub scopes: Vec<String>,
    pub status: OctaweaveStatus,
    /// Set when the key was stored but the pack could not be installed — the
    /// halfway state is real and worth naming rather than reporting success.
    pub pack_error: Option<String>,
    /// How many keys this app had minted here before, now revoked. Shown so a
    /// reconnect does not look like it quietly left the old key working.
    pub replaced: usize,
}

/// One step of connecting: either it is done, or here is the one thing missing.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectOutcome {
    /// Octaweave has never seen this Metalcraft account. [`octaweave_link`] opens
    /// the browser; calling connect again once the user is back finishes the job.
    NeedsLink { url: String },
    /// Several workspaces, and picking one is a judgement this app should not
    /// make for someone. Calling connect again with an id settles it.
    ChooseWorkspace { workspaces: Vec<Workspace> },
    Connected {
        connection: Box<OctaweaveConnection>,
    },
}

/// Open the browser at Octaweave's link page, and return the URL.
///
/// Split from [`octaweave_connect`] precisely so connect can be *polled* while
/// the user is over in the browser — a connect that opened a tab every time it
/// was called would spray tabs across the poll interval.
#[tauri::command]
pub fn octaweave_link() -> String {
    let url = octaweave::link_url();
    front_cloud::id::open_in_browser(&url);
    url
}

/// Connect, or say what is missing.
///
/// The order is load-bearing. The pod connection is checked *before* anything is
/// minted: a key created and then not storable is a live credential nobody holds,
/// and Octaweave would have no idea it was born orphaned. Verification comes
/// after minting and before storing, for the same reason it always did — a key
/// that cannot identify itself should fail here, not mid-conversation.
#[tauri::command]
pub async fn octaweave_connect(
    workspace: Option<String>,
    state: State<'_>,
) -> Result<ConnectOutcome, String> {
    // Nothing below is worth doing if the result has nowhere to land.
    let conn = state.conn(None)?;

    let pat = SessionStore::pat()
        .ok_or("sign in to Metalcraft first — the connection is made with your account")?;

    let all = match octaweave::workspaces(&pat).await {
        Ok(list) => list,
        Err(octaweave::HubError::NotLinked) => {
            return Ok(ConnectOutcome::NeedsLink {
                url: octaweave::link_url(),
            });
        }
        Err(e) => return Err(e.to_string()),
    };

    // Editors and viewers are filtered out here rather than at the mint, so the
    // picker never offers a workspace that would fail on the next click.
    let mintable: Vec<Workspace> = all.iter().filter(|w| w.can_mint()).cloned().collect();
    let chosen = match (&workspace, mintable.len()) {
        (Some(id), _) => mintable
            .iter()
            .find(|w| &w.id == id || &w.slug == id)
            .cloned()
            .ok_or("that workspace is not one you administer")?,
        (None, 1) => mintable[0].clone(),
        (None, 0) if all.is_empty() => {
            return Err("that Octaweave account has no workspaces yet — make one first".into());
        }
        (None, 0) => {
            return Err(
                "you are a member of Octaweave workspaces but administer none, \
                        and creating a key needs admin"
                    .into(),
            );
        }
        (None, _) => {
            return Ok(ConnectOutcome::ChooseWorkspace {
                workspaces: mintable,
            });
        }
    };

    // Best effort, and before the mint: reconnecting should replace this app's
    // key rather than pile another live one beside it.
    let replaced = octaweave::revoke_ours(&pat, &chosen.id).await;

    let minted = octaweave::mint_key(&pat, &chosen.id)
        .await
        .map_err(|e| e.to_string())?;

    if let Err(e) = octaweave::whoami(&minted.token).await {
        // The key exists on Octaweave and is about to be unreachable from here,
        // so take it back out rather than leaving a live one behind.
        let _ = octaweave::revoke_key(&pat, &chosen.id, &minted.id).await;
        return Err(format!(
            "Octaweave issued a key that will not authenticate: {e}"
        ));
    }

    conn.save_key(KEY_NAME, &minted.token)
        .await
        .map_err(|e| format!("the key was created, but the pod would not store it: {e}"))?;

    // A failed pack install does not fail the call. The key is stored and that is
    // worth keeping — reporting failure would invite the user to redo a step that
    // succeeded, and the pack can be installed on its own afterwards.
    let pack_error = match conn.install_integration(PACK_SLUG).await {
        Ok(_) => None,
        Err(e) => Some(e.to_string()),
    };

    Ok(ConnectOutcome::Connected {
        connection: Box::new(OctaweaveConnection {
            workspace_id: chosen.id,
            label: chosen.name,
            url: format!(
                "{}/{}/{}",
                front_cloud::octaweave_base(),
                chosen.org_slug,
                chosen.slug
            ),
            scopes: minted.scopes,
            status: octaweave_status(state).await?,
            pack_error,
            replaced,
        }),
    })
}

/// Install (or repair) just the integration pack, for the case where the key is
/// already in place and only the pack is missing.
#[tauri::command]
pub async fn octaweave_install_pack(state: State<'_>) -> Result<OctaweaveStatus, String> {
    state
        .conn(None)?
        .install_integration(PACK_SLUG)
        .await
        .map_err(|e| e.to_string())?;
    octaweave_status(state).await
}

/// Forget the key — and revoke it, when we still know where it lives.
///
/// Deleting it from the pod alone would leave a working credential on Octaweave
/// that nothing holds and nothing shows, which is not what "disconnect" means to
/// anyone pressing it. Revocation is best-effort and second: a pod that dropped
/// the key is disconnected whether or not Octaweave was reachable to hear about
/// it, and the keys are visible in Octaweave's own UI either way.
///
/// The pack stays installed. Its tools are inert without a key, and reinstalling
/// one to reconnect would be a surprising amount of work for what was asked.
#[tauri::command]
pub async fn octaweave_disconnect(
    workspace: Option<String>,
    state: State<'_>,
) -> Result<OctaweaveStatus, String> {
    state
        .conn(None)?
        .delete_key(KEY_NAME)
        .await
        .map_err(|e| e.to_string())?;

    if let (Some(ws), Some(pat)) = (workspace, SessionStore::pat()) {
        octaweave::revoke_ours(&pat, &ws).await;
    }

    octaweave_status(state).await
}
