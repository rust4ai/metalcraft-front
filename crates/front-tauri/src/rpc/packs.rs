//! Agent packs and the registries they come from (PLAN §9.4).
//!
//! Every call goes to the pod, which holds the origin allowlist and the
//! credential. The desktop's job is to make the pod's answers legible — including
//! the unhappy ones: a host that refused this pod's token, or a pack a
//! verified-only pod will decline, are both things to say *before* someone
//! presses install.

use std::sync::Arc;

use front_core::{
    AgentPackPreview, InstalledAgentPack, PackUpdateReport, Registries, RegistryConnection,
    SearchHit,
};

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// The hosts this pod will fetch from, returned so a UI can say what it accepts
/// before someone pastes a link and gets refused.
#[tauri::command]
pub async fn list_registries(state: State<'_>) -> Result<Registries, String> {
    state
        .conn(None)?
        .registries()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn registry_status(name: String, state: State<'_>) -> Result<RegistryConnection, String> {
    state
        .conn(None)?
        .registry_status(&name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn registry_connect(
    name: String,
    state: State<'_>,
) -> Result<RegistryConnection, String> {
    state
        .conn(None)?
        .registry_connect(&name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn registry_disconnect(
    name: String,
    state: State<'_>,
) -> Result<RegistryConnection, String> {
    state
        .conn(None)?
        .registry_disconnect(&name)
        .await
        .map_err(|e| e.to_string())
}

/// Browse or search. An empty query is the catalogue, not an error — it is the
/// landing view.
#[tauri::command]
pub async fn registry_search(
    name: String,
    query: Option<String>,
    state: State<'_>,
) -> Result<Vec<SearchHit>, String> {
    state
        .conn(None)?
        .registry_search(&name, query.as_deref(), 50)
        .await
        .map_err(|e| e.to_string())
}

/// The pack's own manifest: what it provides, and what it needs to work.
#[tauri::command]
pub async fn registry_manifest(
    name: String,
    id: String,
    state: State<'_>,
) -> Result<serde_json::Value, String> {
    state
        .conn(None)?
        .registry_manifest(&name, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_installed_packs(state: State<'_>) -> Result<Vec<InstalledAgentPack>, String> {
    state
        .conn(None)?
        .list_agent_packs()
        .await
        .map_err(|e| e.to_string())
}

/// Update an installed pack to the version a registry now serves.
///
/// A separate command from `install_pack` because the pod treats them as separate
/// operations: install replaces the files, update then reconciles the agents made
/// from the pack against them. The report names every agent that changed, which is
/// the whole point — those changes are otherwise silent.
#[tauri::command]
pub async fn update_pack(
    id: String,
    reference: String,
    allow_unverified: Option<bool>,
    state: State<'_>,
) -> Result<PackUpdateReport, String> {
    state
        .conn(None)?
        .update_agent_pack(&id, &reference, allow_unverified.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

/// What the pod reads in the archive it would install — the two facts a registry
/// manifest cannot supply: missing credentials, and preset collisions.
#[tauri::command]
pub async fn inspect_pack(
    reference: String,
    allow_unverified: Option<bool>,
    state: State<'_>,
) -> Result<AgentPackPreview, String> {
    state
        .conn(None)?
        .inspect_agent_pack(&reference, allow_unverified.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

/// Install by qualified reference. `allow_unverified` is a deliberate override of
/// a pod's own policy, so it is passed explicitly rather than defaulted on.
#[tauri::command]
pub async fn install_pack(
    reference: String,
    allow_unverified: Option<bool>,
    state: State<'_>,
) -> Result<serde_json::Value, String> {
    state
        .conn(None)?
        .install_agent_pack(&reference, allow_unverified.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}
