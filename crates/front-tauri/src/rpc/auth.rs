//! Sign in with Metalcraft ID (PLAN §9.1).

use front_cloud::{IdClient, LoginStatus, Session, SessionStore, id};

#[tauri::command]
pub async fn login_start() -> Result<serde_json::Value, String> {
    let login = IdClient::default()
        .start()
        .await
        .map_err(|e| e.to_string())?;
    // Best-effort: the UI also renders the URL as copyable text, so a browser
    // that refuses to open is a nuisance rather than a dead end.
    id::open_in_browser(&login.verify_url);
    serde_json::to_value(login).map_err(|e| e.to_string())
}

/// Poll once. `pending` is the normal case while the user is still in the
/// browser — the caller keeps calling until this returns `signed_in`.
#[tauri::command]
pub async fn login_poll(device_code: String) -> Result<serde_json::Value, String> {
    let status = IdClient::default()
        .poll(&device_code)
        .await
        .map_err(|e| e.to_string())?;
    if let LoginStatus::SignedIn {
        token,
        email,
        premium,
    } = &status
    {
        SessionStore::save(
            &Session {
                email: email.clone(),
                premium: *premium,
            },
            token,
        )
        .map_err(|e| format!("could not save the session: {e}"))?;
        return Ok(
            serde_json::json!({ "status": "signed_in", "email": email, "premium": premium }),
        );
    }
    serde_json::to_value(status).map_err(|e| e.to_string())
}

/// Who is signed in, for the launch path. Reads the non-secret half only, so it
/// does not prompt for keychain access before the user has asked for anything.
#[tauri::command]
pub async fn session() -> Result<Option<Session>, String> {
    Ok(SessionStore::load())
}

#[tauri::command]
pub async fn logout(
    state: tauri::State<'_, std::sync::Arc<crate::state::AppState>>,
) -> Result<(), String> {
    if let Some(slug) = state.active_slug() {
        state.disconnect(&slug);
    }
    SessionStore::clear();
    Ok(())
}
