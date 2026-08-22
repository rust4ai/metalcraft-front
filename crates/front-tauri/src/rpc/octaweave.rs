//! Octaweave connection (PLAN §9.3, P7).
//!
//! The whole point of doing this in the core rather than the renderer is that
//! the `owk_live_…` key never enters the webview. `connect` takes a key, proves
//! it works, writes it into the pod's key store, installs the integration pack
//! and hands back a confirmation. The renderer sees a workspace and a scope
//! list; it never sees the credential.

use std::sync::Arc;

use front_cloud::octaweave::{self, KEY_NAME, PACK_SLUG};
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

/// What `connect` reports back. Deliberately carries no key.
#[derive(Debug, Clone, Serialize)]
pub struct OctaweaveConnection {
    pub workspace_id: String,
    pub label: String,
    pub scopes: Vec<String>,
    pub is_admin: bool,
    pub status: OctaweaveStatus,
    /// Set when the key was stored but the pack could not be installed — the
    /// halfway state is real and worth naming rather than reporting success.
    pub pack_error: Option<String>,
}

/// One click: verify → store → install → confirm.
///
/// The order matters. The key is proven against Octaweave *before* it is written
/// anywhere, so a mistyped or revoked key fails here rather than sitting in a
/// pod's key store waiting to fail mid-conversation.
///
/// A failed pack install does not fail the call. The key is already stored and
/// that is worth keeping — reporting failure would invite the user to redo a
/// step that succeeded, and the pack can be installed on its own afterwards.
#[tauri::command]
pub async fn octaweave_connect(
    token: String,
    state: State<'_>,
) -> Result<OctaweaveConnection, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("paste the Octaweave key first".into());
    }
    let who = octaweave::whoami(&token).await.map_err(|e| e.to_string())?;

    let conn = state.conn(None)?;
    conn.save_key(KEY_NAME, &token)
        .await
        .map_err(|e| format!("the key is valid, but the pod would not store it: {e}"))?;

    let pack_error = match conn.install_integration(PACK_SLUG).await {
        Ok(_) => None,
        Err(e) => Some(e.to_string()),
    };

    Ok(OctaweaveConnection {
        workspace_id: who.actor.workspace_id,
        label: who.actor.label,
        scopes: who.scopes,
        is_admin: who.is_admin,
        status: octaweave_status(state).await?,
        pack_error,
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

/// Forget the key. Leaves the pack installed: its tools are inert without a key,
/// and reinstalling a pack to reconnect would be a surprising amount of work for
/// what the user asked ("disconnect", not "uninstall").
#[tauri::command]
pub async fn octaweave_disconnect(state: State<'_>) -> Result<OctaweaveStatus, String> {
    state
        .conn(None)?
        .delete_key(KEY_NAME)
        .await
        .map_err(|e| e.to_string())?;
    octaweave_status(state).await
}

/// Open Octaweave's key page in the browser.
///
/// The hand-off is structural, not a missing feature: an `owk_` key cannot mint
/// another and key creation refuses key-auth, so creating one is necessarily a
/// signed-in human in a browser. We pass our callback URL so Octaweave *can*
/// return the key directly once it supports doing so; until then the user copies
/// it back, and `octaweave_connect` takes it either way.
#[tauri::command]
pub fn octaweave_open_keys() -> String {
    let url = format!(
        "{}/settings/keys?redirect_uri=metalcraft-front%3A%2F%2Foctaweave%2Fcallback",
        front_cloud::octaweave_base()
    );
    front_cloud::id::open_in_browser(&url);
    url
}
