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

use front_core::{Goal, GoalDetail, GoalJournal, GoalList, GoalUpdate, NewGoal};

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// Every goal, with how far each has got and how many may run at once.
#[tauri::command]
pub async fn list_goals(state: State<'_>) -> Result<GoalList, String> {
    state
        .conn(None)?
        .list_goals()
        .await
        .map_err(|e| e.to_string())
}

/// One goal, with its scratchpad.
#[tauri::command]
pub async fn get_goal(goal_id: String, state: State<'_>) -> Result<GoalDetail, String> {
    state
        .conn(None)?
        .get_goal(&goal_id)
        .await
        .map_err(|e| e.to_string())
}

/// Set a goal, and mint the agent that will pursue it.
#[tauri::command]
pub async fn create_goal(new: NewGoal, state: State<'_>) -> Result<Goal, String> {
    state
        .conn(None)?
        .create_goal(&new)
        .await
        .map_err(|e| e.to_string())
}

/// Pause, resume, retarget — or answer the question it stopped on.
#[tauri::command]
pub async fn update_goal(
    goal_id: String,
    update: GoalUpdate,
    state: State<'_>,
) -> Result<Goal, String> {
    state
        .conn(None)?
        .update_goal(&goal_id, &update)
        .await
        .map_err(|e| e.to_string())
}

/// Forget a goal. Its agent stays, holding what it learned along the way.
#[tauri::command]
pub async fn delete_goal(goal_id: String, state: State<'_>) -> Result<(), String> {
    state
        .conn(None)?
        .delete_goal(&goal_id)
        .await
        .map_err(|e| e.to_string())
}

/// The journal — one line per tick, which is what a person actually reads.
#[tauri::command]
pub async fn goal_journal(
    goal_id: String,
    limit: Option<u32>,
    state: State<'_>,
) -> Result<GoalJournal, String> {
    state
        .conn(None)?
        .goal_journal(&goal_id, limit.unwrap_or(50))
        .await
        .map_err(|e| e.to_string())
}

/// Rewrite the scratchpad by hand.
#[tauri::command]
pub async fn put_goal_scratchpad(
    goal_id: String,
    markdown: String,
    state: State<'_>,
) -> Result<GoalDetail, String> {
    state
        .conn(None)?
        .put_goal_scratchpad(&goal_id, &markdown)
        .await
        .map_err(|e| e.to_string())
}
