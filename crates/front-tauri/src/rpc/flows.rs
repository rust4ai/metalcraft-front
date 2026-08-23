//! Automations — the pod's flows, and the agents they run as (PLAN §10.7).
//!
//! Named `flows` to match the pod's wire vocabulary, which these commands are a
//! thin skin over; the renderer's surface is called **Automations**, because what
//! a person arms is a standing instruction rather than a graph. See
//! `~/ai/metalcraft-agent/docs/FLOWS_AS_AGENTS_PLAN.md` §2.1.

use std::sync::Arc;

use front_core::{AgentInstance, Flow, FlowBinding, FlowRun, FlowRunSummary};

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// Every flow on the pod, including the disabled ones — a pack ships its flows
/// off, so those are the majority and the ones worth arming.
#[tauri::command]
pub async fn list_flows(state: State<'_>) -> Result<Vec<Flow>, String> {
    state
        .conn(None)?
        .list_flows()
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

/// Arm a schedule. **This is what creates the agent**: the pod mints a persistent
/// instance for the flow, or attaches to `instance_id` when given one.
///
/// A refusal here is the containment rule talking — it names the persona and the
/// roster it is missing from — so the error string goes to the user unedited.
#[tauri::command]
pub async fn arm_schedule(
    flow_id: String,
    schedule_id: String,
    instance_id: Option<String>,
    state: State<'_>,
) -> Result<AgentInstance, String> {
    state
        .conn(None)?
        .arm_schedule(&flow_id, &schedule_id, instance_id.as_deref())
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

/// Stop running a schedule on a timer. The agent and its memory are kept.
#[tauri::command]
pub async fn disarm_schedule(
    flow_id: String,
    schedule_id: String,
    state: State<'_>,
) -> Result<(), String> {
    state
        .conn(None)?
        .disarm_schedule(&flow_id, &schedule_id)
        .await
        .map_err(|e| e.to_string())
}
