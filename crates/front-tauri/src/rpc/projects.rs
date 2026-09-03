//! Goals — what the pod is working towards on its own.
//!
//! A thin skin over the pod's `/goals`, like every other module here. The one
//! thing worth saying is why this surface exists at all: **a goal can only be
//! created from a client.** There is no chat command and no agent tool that
//! mints one, because committing a pod to days of unattended work is a decision
//! a person takes deliberately, on a screen built for it — and that is also what
//! stops a goal from being able to create goals.
//!
//! So this is not a convenience wrapper over something you could do another way.
//! Without it the feature does not exist.

use std::sync::Arc;

use front_core::{Project, ProjectDetail, ProjectJournal, ProjectList, ProjectUpdate, NewProject};

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// Every goal, with how far each has got and how many may run at once.
#[tauri::command]
pub async fn list_projects(state: State<'_>) -> Result<ProjectList, String> {
    state
        .conn(None)?
        .list_projects()
        .await
        .map_err(|e| e.to_string())
}

/// One goal, with its scratchpad.
#[tauri::command]
pub async fn get_project(project_id: String, state: State<'_>) -> Result<ProjectDetail, String> {
    state
        .conn(None)?
        .get_project(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// Set a goal, and mint the agent that will pursue it.
#[tauri::command]
pub async fn create_project(new: NewProject, state: State<'_>) -> Result<Project, String> {
    state
        .conn(None)?
        .create_project(&new)
        .await
        .map_err(|e| e.to_string())
}

/// Pause, resume, retarget — or answer the question it stopped on.
#[tauri::command]
pub async fn update_project(
    project_id: String,
    update: ProjectUpdate,
    state: State<'_>,
) -> Result<Project, String> {
    state
        .conn(None)?
        .update_project(&project_id, &update)
        .await
        .map_err(|e| e.to_string())
}

/// Forget a goal. Its agent stays, holding what it learned along the way.
#[tauri::command]
pub async fn delete_project(project_id: String, state: State<'_>) -> Result<(), String> {
    state
        .conn(None)?
        .delete_project(&project_id)
        .await
        .map_err(|e| e.to_string())
}

/// The journal — one line per tick, which is what a person actually reads.
#[tauri::command]
pub async fn project_journal(
    project_id: String,
    limit: Option<u32>,
    state: State<'_>,
) -> Result<ProjectJournal, String> {
    state
        .conn(None)?
        .project_journal(&project_id, limit.unwrap_or(50))
        .await
        .map_err(|e| e.to_string())
}

/// Rewrite the scratchpad by hand.
#[tauri::command]
pub async fn put_project_scratchpad(
    project_id: String,
    markdown: String,
    state: State<'_>,
) -> Result<ProjectDetail, String> {
    state
        .conn(None)?
        .put_project_scratchpad(&project_id, &markdown)
        .await
        .map_err(|e| e.to_string())
}

/// Run now, rather than at the next heartbeat.
///
/// The third lever, and the one that makes the other two feel like controls
/// rather than settings: without it, retargeting a project means waiting fifteen
/// minutes to find out whether it understood you.
#[tauri::command]
pub async fn tick_project(project_id: String, state: State<'_>) -> Result<Project, String> {
    state
        .conn(None)?
        .tick_project(&project_id)
        .await
        .map_err(|e| e.to_string())
}
