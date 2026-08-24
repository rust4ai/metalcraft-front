//! The Metalcraft Gateway — WhatsApp and SMS (PLAN §10.6).
//!
//! What this connects is not the desktop but the *agent*: a verified number
//! reaches the pod from a phone, and the pod answers back on the same channel.
//! So all four commands are pod calls, and none of them holds an account
//! credential. The iOS app talks to gateway.metalcraftai.com directly with the
//! account PAT — correct there, because the phone is registering *itself* for
//! push in the same breath — but a desktop that did the same could show a
//! registered number while the pod it is looking at receives nothing, which is
//! the one wrong answer this surface can give.
//!
//! The pod owns the connection (`metalcraft-agent/src/metalcraft_gateway.rs`):
//! the channel, its webhook secret and the inbound wiring all live there, and
//! the gateway's own web UI proxies to it for exactly that reason.
//!
//! Nothing secret crosses into the webview. Registering returns a verification
//! code, which is an instruction to the user rather than a secret, and the
//! integration's signing secret is dropped at the `front-core` shape.

use std::sync::Arc;

use front_core::{GatewayConnected, GatewayRegistration, GatewayStatus};

use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// Registration, verification and connection in one read.
///
/// `None` means the pod predates the endpoint — distinct from "not connected",
/// and the card says so rather than offering a button that would 404.
#[tauri::command]
pub async fn gateway_status(state: State<'_>) -> Result<Option<GatewayStatus>, String> {
    state
        .conn(None)?
        .gateway_status()
        .await
        .map_err(|e| e.to_string())
}

/// Register a personal number. Returns the code to text back from it.
///
/// Re-registering replaces the number that was there; there is no separate
/// change-number call because the gateway upserts on the account.
#[tauri::command]
pub async fn gateway_register(
    phone_number: String,
    state: State<'_>,
) -> Result<GatewayRegistration, String> {
    state
        .conn(None)?
        .gateway_register(&phone_number)
        .await
        .map_err(|e| e.to_string())
}

/// Wire the channel up. Idempotent, so it is also the fix for a stale webhook
/// after the pod moves.
#[tauri::command]
pub async fn gateway_connect(state: State<'_>) -> Result<GatewayConnected, String> {
    state
        .conn(None)?
        .gateway_connect()
        .await
        .map_err(|e| e.to_string())
}

/// Stop receiving. Local to the pod — the number stays registered at the
/// gateway, so reconnecting does not ask for a second verification.
#[tauri::command]
pub async fn gateway_disconnect(state: State<'_>) -> Result<(), String> {
    state
        .conn(None)?
        .gateway_disconnect()
        .await
        .map_err(|e| e.to_string())
}

/// Give the number back — unregister at the gateway *and* disconnect here.
///
/// `false` means the pod predates the endpoint. There is nothing to fall back
/// to: doing this from the desktop without the pod would mean holding the
/// account PAT, which is the thing this surface exists not to do.
#[tauri::command]
pub async fn gateway_unregister(state: State<'_>) -> Result<bool, String> {
    state
        .conn(None)?
        .gateway_unregister()
        .await
        .map_err(|e| e.to_string())
}
