//! The fleet: agent instances and the presets they are spawned from (PLAN §10.1).

use std::sync::Arc;

use front_core::{AgentInstance, AgentPresetSummary};

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
