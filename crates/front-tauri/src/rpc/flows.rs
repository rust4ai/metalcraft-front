//! Automations — the pod's flows, and the agents they run as (PLAN §10.7).
//!
//! Named `flows` to match the pod's wire vocabulary, which these commands are a
//! thin skin over; the renderer's surface is called **Automations**, because what
//! a person arms is a standing instruction rather than a graph. See
//! `~/ai/metalcraft-agent/docs/FLOWS_AS_AGENTS_PLAN.md` §2.1.

use std::sync::Arc;

use front_core::{Flow, FlowBinding, FlowRun, FlowRunSummary, ScheduleSpec, ScheduledFlow};

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// Every flow on the pod — the *work*, including the unscheduled ones. A pack
/// installs its flows scheduling nothing, so those are the majority and the ones
/// worth arming.
#[tauri::command]
pub async fn list_flows(state: State<'_>) -> Result<Vec<Flow>, String> {
    state
        .conn(None)?
        .list_flows()
        .await
        .map_err(|e| e.to_string())
}

/// One run, with its step trace and a snapshot of the graph it ran against.
///
/// The snapshot is the point: a run that paused yesterday must be read against
/// the flow as it was, not as it has since been edited.
#[tauri::command]
pub async fn get_flow_run(run_id: String, state: State<'_>) -> Result<serde_json::Value, String> {
    state
        .conn(None)?
        .get_flow_run(&run_id)
        .await
        .map_err(|e| e.to_string())
}

/// One flow with its graph — what `list_flows` deliberately leaves out.
///
/// `serde_json::Value` all the way through: the shape belongs to the
/// `metalcraft-flows` crate, and a narrower type here would drop the vendor node
/// data (`slack:send_message`) the spec requires be round-tripped verbatim.
#[tauri::command]
pub async fn get_flow(flow_id: String, state: State<'_>) -> Result<serde_json::Value, String> {
    state
        .conn(None)?
        .get_flow(&flow_id)
        .await
        .map_err(|e| e.to_string())
}

/// Check a graph without saving it — the editor's live feedback.
///
/// An invalid graph is a successful call reporting `valid: false`; only a
/// transport or pod failure is an `Err`. Collapsing the two would make "your
/// graph is wrong" indistinguishable from "the pod is unreachable".
#[tauri::command]
pub async fn validate_flow(
    flow: serde_json::Value,
    state: State<'_>,
) -> Result<serde_json::Value, String> {
    state
        .conn(None)?
        .validate_flow(&flow)
        .await
        .map_err(|e| e.to_string())
}

/// Everything the pod will do on its own — *when* each flow runs, and as which
/// agent. Joined to [`list_flows`] by `flow_id`.
#[tauri::command]
pub async fn list_scheduled_flows(state: State<'_>) -> Result<Vec<ScheduledFlow>, String> {
    state
        .conn(None)?
        .list_scheduled_flows()
        .await
        .map_err(|e| e.to_string())
}

/// Persisted flow runs. The pod only persists a run that paused, so this is
/// mostly "what is waiting on a human" — the reason the surface exists.
#[tauri::command]
pub async fn list_flow_runs(state: State<'_>) -> Result<Vec<FlowRun>, String> {
    state
        .conn(None)?
        .list_flow_runs()
        .await
        .map_err(|e| e.to_string())
}

/// What arming this flow would permit: personas, reachable domains, credentials
/// (including the missing ones), and which tools mutate.
#[tauri::command]
pub async fn flow_binding(flow_id: String, state: State<'_>) -> Result<FlowBinding, String> {
    state
        .conn(None)?
        .flow_binding(&flow_id)
        .await
        .map_err(|e| e.to_string())
}

/// Schedule a flow. **This is what creates the agent**: the pod mints a persistent
/// instance for the flow, or attaches to `instance_id` when given one, and returns
/// the schedule with that agent on it.
///
/// A refusal here is the containment rule talking — it names the persona and the
/// roster it is missing from — so the error string goes to the user unedited.
#[tauri::command]
pub async fn arm_schedule(
    flow_id: String,
    schedule: ScheduleSpec,
    instance_id: Option<String>,
    state: State<'_>,
) -> Result<ScheduledFlow, String> {
    state
        .conn(None)?
        .arm_schedule(&flow_id, &schedule, instance_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// Change a schedule, or pause/resume it.
///
/// Pausing keeps the schedule and its agent: "not now" and "never again" are
/// different answers, and only one of them should need re-arming later.
#[tauri::command]
pub async fn update_schedule(
    scheduled_id: String,
    schedule: Option<ScheduleSpec>,
    enabled: Option<bool>,
    state: State<'_>,
) -> Result<ScheduledFlow, String> {
    state
        .conn(None)?
        .update_schedule(&scheduled_id, schedule.as_ref(), enabled)
        .await
        .map_err(|e| e.to_string())
}

/// Run a flow now, as the agent its schedule armed.
///
/// Synchronous on the pod: this resolves when the flow finishes, which for a
/// multi-node flow is not instant. The reward is `chat_id` — the conversation it
/// just wrote, which the caller can open to read what happened.
#[tauri::command]
pub async fn run_flow(
    flow_id: String,
    instance_id: Option<String>,
    state: State<'_>,
) -> Result<FlowRunSummary, String> {
    state
        .conn(None)?
        .run_flow(&flow_id, instance_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// Take the decision a paused run is waiting on.
///
/// The run picks up in the conversation it paused in — which for an approval
/// three days old is the difference between a coherent continuation and asking
/// an agent to act on something it no longer remembers.
#[tauri::command]
pub async fn resume_flow_run(
    run_id: String,
    handle: String,
    state: State<'_>,
) -> Result<FlowRunSummary, String> {
    state
        .conn(None)?
        .resume_flow_run(&run_id, &handle)
        .await
        .map_err(|e| e.to_string())
}

/// Stop running a schedule on a timer. The agent and its memory are kept, and so
/// is the flow — which can still be run by hand.
#[tauri::command]
pub async fn disarm_schedule(scheduled_id: String, state: State<'_>) -> Result<(), String> {
    state
        .conn(None)?
        .disarm_schedule(&scheduled_id)
        .await
        .map_err(|e| e.to_string())
}
