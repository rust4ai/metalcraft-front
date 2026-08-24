//! The library — every artifact installed on the pod, and the pages that read
//! one (PLAN §10, the Book beside Settings and the error log).
//!
//! Read-only by construction. Nothing in this module writes to the pod, because
//! the surface it feeds is a browser: the question is "what is on here, and what
//! is it made of", and the answer is a graph you walk — a preset names personas,
//! a persona names skills and integrations, an integration names api tools.
//!
//! The one call that carries weight is [`pod_snapshot`]. Personas and skills
//! have no list route on the pod (only `/personas/{slug}`), so the snapshot is
//! not an optimisation — it is the only way to know those artifacts exist at
//! all. Everything else here is a detail fetch made *after* the user clicked
//! something the snapshot listed.

use std::sync::Arc;

use front_core::{
    FlowTemplateSummary, Integration, IntegrationDetail, PersonaDetail, PodSnapshot, PresetDetail,
    SkillDetail,
};

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// Everything installed, in one call. `null` when the pod is too old to have
/// `/snapshot` — the view says so rather than showing an empty library, because
/// "this pod cannot tell me" and "this pod holds nothing" are different screens.
#[tauri::command]
pub async fn pod_snapshot(state: State<'_>) -> Result<Option<PodSnapshot>, String> {
    state
        .conn(None)?
        .snapshot()
        .await
        .map_err(|e| e.to_string())
}

/// A preset with both halves: what its file declares, and which of the personas
/// it names this pod could actually resolve.
#[tauri::command]
pub async fn preset_detail(slug: String, state: State<'_>) -> Result<PresetDetail, String> {
    state
        .conn(None)?
        .preset_detail(&slug)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn persona_detail(slug: String, state: State<'_>) -> Result<PersonaDetail, String> {
    state
        .conn(None)?
        .persona(&slug)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn skill_detail(slug: String, state: State<'_>) -> Result<SkillDetail, String> {
    state
        .conn(None)?
        .skill(&slug)
        .await
        .map_err(|e| e.to_string())
}

/// One HTTP tool's config, verbatim. The shape is the pod's, and the show page
/// renders it as the request it is rather than as a typed object this app would
/// have to keep in step with every new body mapping.
#[tauri::command]
pub async fn api_tool_detail(name: String, state: State<'_>) -> Result<serde_json::Value, String> {
    state
        .conn(None)?
        .api_tool(&name)
        .await
        .map_err(|e| e.to_string())
}

/// The integration packs on this pod. Already fetched inside the Octaweave and
/// buildr.space cards to answer one question each; exposed here because the
/// library's question is the general one.
#[tauri::command]
pub async fn list_integrations(state: State<'_>) -> Result<Vec<Integration>, String> {
    state
        .conn(None)?
        .list_integrations()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn integration_detail(id: String, state: State<'_>) -> Result<IntegrationDetail, String> {
    state
        .conn(None)?
        .integration(&id)
        .await
        .map_err(|e| e.to_string())
}

/// An installed agent pack's own manifest.
#[tauri::command]
pub async fn agent_pack_detail(id: String, state: State<'_>) -> Result<serde_json::Value, String> {
    state
        .conn(None)?
        .agent_pack(&id)
        .await
        .map_err(|e| e.to_string())
}

/// Automations a pack shipped but nobody has installed as a flow yet. Distinct
/// from `list_flows`, which is what this pod actually runs.
#[tauri::command]
pub async fn list_flow_templates(state: State<'_>) -> Result<Vec<FlowTemplateSummary>, String> {
    state
        .conn(None)?
        .flow_templates()
        .await
        .map_err(|e| e.to_string())
}

/// One template with its graph. Untyped for the same reason as the api tool
/// above: the document is someone else's, and this app only shows it.
#[tauri::command]
pub async fn flow_template_detail(
    slug: String,
    state: State<'_>,
) -> Result<serde_json::Value, String> {
    state
        .conn(None)?
        .flow_template(&slug)
        .await
        .map_err(|e| e.to_string())
}
