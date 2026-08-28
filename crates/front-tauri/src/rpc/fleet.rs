//! The fleet: agent instances and the presets they are spawned from (PLAN §10.1).

use std::sync::Arc;

use front_core::{
    AgentInstance, AgentPresetSummary, ChatSummary, InstanceMemory, RosterPersona, ScheduledFlow,
};

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

#[tauri::command]
pub async fn list_instances(state: State<'_>) -> Result<Vec<AgentInstance>, String> {
    state
        .conn(None)?
        .list_instances()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_presets(state: State<'_>) -> Result<Vec<AgentPresetSummary>, String> {
    state
        .conn(None)?
        .list_presets()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_instance(
    preset: String,
    name: Option<String>,
    state: State<'_>,
) -> Result<AgentInstance, String> {
    state
        .conn(None)?
        .create_instance(&preset, name.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_instance(id: String, state: State<'_>) -> Result<(), String> {
    state
        .conn(None)?
        .delete_instance(&id)
        .await
        .map_err(|e| e.to_string())
}

/// Rename an agent (PLAN §10.1) — the one field of an instance a user owns.
///
/// A label, not a lifetime: the pod no longer marks a renamed agent persistent.
/// The instance comes back whole because the patch also touches `last_active_at`.
#[tauri::command]
pub async fn rename_instance(
    id: String,
    name: String,
    state: State<'_>,
) -> Result<AgentInstance, String> {
    state
        .conn(None)?
        .rename_instance(&id, &name)
        .await
        .map_err(|e| e.to_string())
}

/// Switch an instance's persona (PLAN §10.2 — the rail's persona switcher).
#[tauri::command]
pub async fn set_instance_persona(
    id: String,
    persona: String,
    state: State<'_>,
) -> Result<AgentInstance, String> {
    state
        .conn(None)?
        .set_instance_persona(&id, &persona)
        .await
        .map_err(|e| e.to_string())
}

/// The roster an instance may be switched within — the preset's personas, with
/// the ones this pod cannot resolve marked rather than omitted.
#[tauri::command]
pub async fn list_preset_personas(
    preset: String,
    state: State<'_>,
) -> Result<Vec<RosterPersona>, String> {
    state
        .conn(None)?
        .preset_personas(&preset)
        .await
        .map_err(|e| e.to_string())
}

/// The conversations this one agent has had, asked of the agent.
#[tauri::command]
pub async fn instance_conversations(
    id: String,
    state: State<'_>,
) -> Result<Vec<ChatSummary>, String> {
    state
        .conn(None)?
        .instance_conversations(&id)
        .await
        .map_err(|e| e.to_string())
}

/// What this agent does on its own — the schedules pointing at it.
#[tauri::command]
pub async fn instance_flows(id: String, state: State<'_>) -> Result<Vec<ScheduledFlow>, String> {
    state
        .conn(None)?
        .instance_flows(&id)
        .await
        .map_err(|e| e.to_string())
}

/// What one agent knows.
#[tauri::command]
pub async fn instance_memory(id: String, state: State<'_>) -> Result<InstanceMemory, String> {
    state
        .conn(None)?
        .instance_memory(&id, MEMORY_SAMPLE_LIMIT)
        .await
        .map_err(|e| e.to_string())
}

/// Enough to show what an agent has picked up without turning the rail into a
/// memory browser; the pod clamps to 500 regardless.
const MEMORY_SAMPLE_LIMIT: u32 = 50;
