//! Chats and the live event bridge (PLAN §8).
//!
//! Frames are emitted to the webview verbatim on `session://{chat_id}`, so the
//! renderer's transcript reducer consumes exactly what the pod produced. Two
//! entry points, one bridge: `send_turn` drives a turn, `watch_chat` attaches to
//! the pod's broadcast channel without owning one — which is what lets a fleet
//! view watch every active chat at once, and what lets a phone watch the same
//! turn as the desktop.

use std::sync::Arc;

use front_core::{ChatDetail, ChatSummary, NewChat};
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
