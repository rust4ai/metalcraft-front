//! Factory reset — erasing a pod back to the state it was provisioned in.
//!
//! Its own module rather than a third function in `pods.rs`, because it is the
//! only command in this app that destroys something no one can get back, and
//! that is worth being able to find.
//!
//! What it is *for* is testing: onboarding makes claims about an empty pod —
//! no agents, no source bound, nothing installed — and none of them can be
//! checked twice on the same pod without this. The pod does the erasing; this
//! layer only carries the scope across and hands back the pod's own account of
//! what it removed.
//!
//! The confirmation phrase is not a parameter here. It lives in `front-core`,
//! next to the request that carries it, so that the renderer cannot supply
//! it — the UI's job is to make a person type the words, and the transport's
//! job is not to invent a second way past the same gate.

use std::sync::Arc;

use front_core::{ResetReport, ResetScope};

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// Wipe the connected pod and restart it.
///
/// `Ok(None)` means the pod is older than the endpoint (agent < 0.35.0). The
/// desktop has no fallback for it and should not pretend otherwise: erasing a
/// pod from out here would mean deleting its chats, instances, flows, packs and
/// keys one endpoint at a time, and still leaving the process running on the
/// in-memory copies of all of it.
///
/// A transport error *after* the pod has answered is expected — the pod exits a
/// beat later, by design. That is why the report is returned whole rather than
/// followed by a confirming read: this is the last thing the old pod ever says.
#[tauri::command]
pub async fn factory_reset(
    state: State<'_>,
    scope: ResetScope,
) -> Result<Option<ResetReport>, String> {
    let report = state
        .conn(None)?
        .factory_reset(scope)
        .await
        .map_err(|e| e.to_string())?;

    match &report {
        Some(r) if r.is_clean() => {
            log::warn!(
                "factory reset ({:?}): removed {} entries from {}",
                r.scope,
                r.removed.len(),
                r.data_dir
            );
        }
        // Worth a louder line than the pod's own: the pod is about to exit and
        // take its log with it, and this is the case where someone will later
        // want to know why a "fresh" pod was not fresh.
        Some(r) => {
            log::error!(
                "factory reset ({:?}) left {} entries behind: {:?}",
                r.scope,
                r.failed.len(),
                r.failed
            );
        }
        None => log::warn!("factory reset: pod is too old for /factory-reset"),
    }

    Ok(report)
}
