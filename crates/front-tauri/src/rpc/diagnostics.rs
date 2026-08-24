//! The error log's core half (see [`crate::diag`]).
//!
//! Read-only over process state, so unlike every other module here these two
//! never touch a pod and cannot fail — which is the point. A log you can only
//! read when the connection is healthy is a log you cannot read when you need
//! it.

use std::sync::Arc;

use crate::diag::Diagnostic;
use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// Everything the core swallowed this session, newest first.
#[tauri::command]
pub fn list_diagnostics(state: State<'_>) -> Vec<Diagnostic> {
    state.diag().entries()
}

/// Empty the log.
///
/// Only the core's half: the renderer's own entries live in the renderer, and
/// clearing is one action across both from the user's side.
#[tauri::command]
pub fn clear_diagnostics(state: State<'_>) {
    state.diag().clear();
}
