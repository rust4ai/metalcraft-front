//! The pod's key store — and with it, the interface source (PLAN §9.2).
//!
//! Binding a source is writing two ordinary secrets: `OPENAI_API_KEY` and
//! `OPENAI_BASE_URL`. There is no separate provider API on the agent, and adding
//! one would be the wrong shape — a source *is* credentials plus an endpoint.
//!
//! Two things the UI has to get right about this store, both of which it once
//! got wrong:
//!
//! 1. **A write takes effect on the next turn, not on restart.** The agent
//!    resolves both names through `key_store::lookup_present` — store first, env
//!    second — and rebuilds its client per turn.
//! 2. **An empty store does not mean the pod cannot think.** Provisioning injects
//!    the credential as container env, which this endpoint never lists. Ask
//!    `inference_status` instead; it is the pod's own answer.

use std::sync::Arc;

use front_core::{InferenceStatus, KeyEntry, RecommendedKey};

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

/// What the installed packs want, as opposed to what is stored.
#[tauri::command]
pub async fn recommended_keys(state: State<'_>) -> Result<Vec<RecommendedKey>, String> {
    state
        .conn(None)?
        .recommended_keys()
        .await
        .map_err(|e| e.to_string())
}

/// Whether the pod can actually run a turn. `None` means the pod is older than the
/// endpoint and cannot say — the caller falls back to what the account knows.
#[tauri::command]
pub async fn inference_status(state: State<'_>) -> Result<Option<InferenceStatus>, String> {
    state
        .conn(None)?
        .inference_status()
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
