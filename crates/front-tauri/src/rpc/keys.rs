//! The pod's key store — and with it, the interface source (PLAN §9.2).
//!
//! Binding a source is writing two ordinary secrets: `OPENAI_API_KEY` and
//! `OPENAI_BASE_URL`. There is no separate provider API on the agent, and adding
//! one would be the wrong shape — a source *is* credentials plus an endpoint.
//!
//! Caveat the UI must state: the agent reads both from process env today, not
//! from this store (`runtime.rs:426-440`), so a write here needs a pod restart
//! until that is fixed upstream (PLAN §12.1). The fix is small — resolve through
//! `key_store::lookup()`, which already prefers stored over env — and the turn
//! path re-reads per turn, so afterwards the next turn just picks it up.

use std::sync::Arc;

use front_core::KeyEntry;

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

pub const API_KEY: &str = "OPENAI_API_KEY";
pub const BASE_URL: &str = "OPENAI_BASE_URL";

#[tauri::command]
pub async fn list_keys(state: State<'_>) -> Result<Vec<KeyEntry>, String> {
    state
        .conn(None)?
        .list_keys()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_key(name: String, value: String, state: State<'_>) -> Result<(), String> {
    state
        .conn(None)?
        .save_key(&name, &value)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_key(name: String, state: State<'_>) -> Result<(), String> {
    state
        .conn(None)?
        .delete_key(&name)
        .await
        .map_err(|e| e.to_string())
}

/// Bind an interface source in one call, so a half-written pair can't leave the
/// pod pointed at one provider with another's key.
///
/// `base_url` is optional because OpenAI proper needs no override — the agent's
/// client defaults there.
#[tauri::command]
pub async fn bind_interface_source(
    api_key: String,
    base_url: Option<String>,
    state: State<'_>,
) -> Result<(), String> {
    let conn = state.conn(None)?;
    match base_url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(base) => conn
            .save_key(BASE_URL, base)
            .await
            .map_err(|e| e.to_string())?,
        // Clearing is the honest way to select OpenAI proper: leaving a previous
        // provider's base URL behind would silently keep routing there.
        None => {
            if let Err(e) = conn.delete_key(BASE_URL).await {
                log::info!("no {BASE_URL} to clear: {e}");
            }
        }
    }
    conn.save_key(API_KEY, api_key.trim())
        .await
        .map_err(|e| e.to_string())
}
