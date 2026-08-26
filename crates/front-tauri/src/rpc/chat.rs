//! Chats and the live event bridge (PLAN §8).
//!
//! Frames are emitted to the webview verbatim on `session://{chat_id}`, so the
//! renderer's transcript reducer consumes exactly what the pod produced. Two
//! entry points, one bridge: `send_turn` drives a turn, `watch_chat` attaches to
//! the pod's broadcast channel without owning one — which is what lets a fleet
//! view watch every active chat at once, and what lets a phone watch the same
//! turn as the desktop.

use std::sync::Arc;

use front_core::{
    ChatCompacted, ChatContext, ChatDetail, ChatSummary, NewChat, PodSession, PodSessionDetail,
    ScheduledTask,
};
use tauri::Emitter;

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

#[tauri::command]
pub async fn list_chats(state: State<'_>) -> Result<Vec<ChatSummary>, String> {
    state
        .conn(None)?
        .list_chats()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_chat(
    instance_id: Option<String>,
    agent_preset: Option<String>,
    name: Option<String>,
    state: State<'_>,
) -> Result<ChatDetail, String> {
    let new = NewChat {
        instance_id,
        agent_preset,
        name,
        ..Default::default()
    };
    state
        .conn(None)?
        .create_chat(&new)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_chat(id: String, state: State<'_>) -> Result<ChatDetail, String> {
    state
        .conn(None)?
        .get_chat(&id)
        .await
        .map_err(|e| e.to_string())
}

/// Run a turn. Returns as soon as the stream is attached; frames arrive as events.
/// What this conversation's context costs — backs `/tokens` and the headroom
/// readout.
#[tauri::command]
pub async fn chat_context(chat_id: String, state: State<'_>) -> Result<ChatContext, String> {
    state
        .conn(None)?
        .chat_context(&chat_id)
        .await
        .map_err(|e| e.to_string())
}

/// Force a compaction — `/compact`. Slower than most commands: the pod pays for a
/// summarization call and holds the chat busy while it runs.
#[tauri::command]
pub async fn compact_chat(chat_id: String, state: State<'_>) -> Result<ChatCompacted, String> {
    state
        .conn(None)?
        .compact_chat(&chat_id)
        .await
        .map_err(|e| e.to_string())
}

/// Drop the conversation, keep the chat — `/clear`.
#[tauri::command]
pub async fn clear_chat(chat_id: String, state: State<'_>) -> Result<ChatContext, String> {
    state
        .conn(None)?
        .clear_chat(&chat_id)
        .await
        .map_err(|e| e.to_string())
}

/// What this chat is still going to do on its own — the follow-ups the agent
/// armed with `schedule_followup`.
///
/// `Ok(None)` means the pod is too old to be asked, which the UI must render as
/// silence rather than as "nothing scheduled": claiming a chat has no pending
/// work when we never got to ask would be the same lie the countdown exists to
/// prevent.
#[tauri::command]
pub async fn scheduled_followups(
    chat_id: String,
    state: State<'_>,
) -> Result<Option<Vec<ScheduledTask>>, String> {
    state
        .conn(None)?
        .followups_for_chat(&chat_id)
        .await
        .map_err(|e| e.to_string())
}

/// Stop the turn this chat is running — the stop button.
///
/// Resolves when the pod has taken the request, which is *not* when the agent
/// has stopped: the turn ends at the executor's next step boundary and says so
/// with `done{status:"interrupted"}` on `session://{chat_id}`, the same frame
/// that ends any other turn. So the composer is unlocked by the stream, not by
/// this call, and one client pressing stop is visible on every device watching.
///
/// `None` means the pod has no interrupt endpoint, which is every pod older than
/// it: the caller must say so rather than report a stop that never happened.
/// `Some(false)` means the turn had already finished — a race, not a failure.
#[tauri::command]
pub async fn interrupt_turn(chat_id: String, state: State<'_>) -> Result<Option<bool>, String> {
    state
        .conn(None)?
        .interrupt_chat(&chat_id)
        .await
        .map_err(|e| e.to_string())
}

/// Call off a pending follow-up. The pod refuses one that already fired.
#[tauri::command]
pub async fn cancel_followup(id: String, state: State<'_>) -> Result<(), String> {
    state
        .conn(None)?
        .cancel_scheduled_task(&id)
        .await
        .map_err(|e| e.to_string())
}

/// The pod's record of one run — everything it wrote while the agent worked.
///
/// Named `pod_*` because this app already has a `list_diagnostics`, and that one
/// is the core's error log: what *this* side failed to do. These read the pod's
/// account of what the agent did. Merging them would put two different questions
/// behind one word.
///
/// `None` = a pod too old to have the endpoint. Not "it has never run anything".
#[tauri::command]
pub async fn pod_diagnostics(state: State<'_>) -> Result<Option<Vec<PodSession>>, String> {
    state
        .conn(None)?
        .diagnostics_sessions()
        .await
        .map_err(|e| e.to_string())
}

/// One run in full: its configuration, each turn's messages, each prompt as sent.
#[tauri::command]
pub async fn pod_diagnostics_session(
    id: String,
    state: State<'_>,
) -> Result<Option<PodSessionDetail>, String> {
    state
        .conn(None)?
        .diagnostics_session(&id)
        .await
        .map_err(|e| e.to_string())
}

/// The run's OTLP trace — the timings. `None` covers both "no such run" and "that
/// run predates tracing"; either way there is no timeline to draw.
#[tauri::command]
pub async fn pod_diagnostics_trace(
    id: String,
    state: State<'_>,
) -> Result<Option<serde_json::Value>, String> {
    state
        .conn(None)?
        .diagnostics_trace(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_turn(
    chat_id: String,
    message: String,
    app: tauri::AppHandle,
    state: State<'_>,
) -> Result<(), String> {
    let conn = state.conn(None)?;
    let rx = conn.turn(&chat_id, &message);
    pump(app, chat_id, rx);
    Ok(())
}

/// Attach to a chat's broadcast stream without driving it.
#[tauri::command]
pub async fn watch_chat(
    chat_id: String,
    app: tauri::AppHandle,
    state: State<'_>,
) -> Result<(), String> {
    let conn = state.conn(None)?;
    let rx = conn.subscribe(&chat_id);
    pump(app, chat_id, rx);
    Ok(())
}

fn pump(
    app: tauri::AppHandle,
    chat_id: String,
    mut rx: tokio::sync::mpsc::Receiver<front_core::ChatEvent>,
) {
    tokio::spawn(async move {
        let channel = format!("session://{chat_id}");
        while let Some(ev) = rx.recv().await {
            if let Err(e) = app.emit(&channel, &ev) {
                log::warn!("dropping frame for {chat_id}: {e}");
                return;
            }
        }
    });
}
