//! Pod-wide preferences — currently the timezone, which is the one that decides
//! *when* things happen.
//!
//! A cron schedule that names no zone is read in the pod's. Before the pod had
//! one, that fallback was the pod's own clock — UTC in the cluster — so an 08:00
//! automation armed by anything that did not think about timezones arrived in
//! the middle of the night. The zone list comes from the pod rather than from
//! this machine, so a picker cannot offer a name the pod would refuse.

use std::sync::Arc;

use front_core::{PodSettings, TimezoneRegion};

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

#[tauri::command]
pub async fn pod_settings(state: State<'_>) -> Result<PodSettings, String> {
    state
        .conn(None)?
        .pod_settings()
        .await
        .map_err(|e| e.to_string())
}

/// Replace them. The pod refuses a timezone it cannot resolve, and its refusal
/// is the message worth showing.
#[tauri::command]
pub async fn save_pod_settings(
    settings: PodSettings,
    state: State<'_>,
) -> Result<PodSettings, String> {
    state
        .conn(None)?
        .set_pod_settings(&settings)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn timezones(state: State<'_>) -> Result<Vec<TimezoneRegion>, String> {
    state
        .conn(None)?
        .timezones()
        .await
        .map_err(|e| e.to_string())
}
