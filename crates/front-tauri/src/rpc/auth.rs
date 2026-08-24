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

/// Re-read the account from Metalcraft ID and update the cached session.
///
/// [`session`] returns a snapshot written at sign-in, so a plan that changed since
/// — an upgrade, a lapse — stayed invisible until the next login. That matters
/// because `premium` is what decides whether a pod's turns can bill the gateway,
/// and deciding it from a stale `false` is how this app tells a paying user their
/// working pod cannot think.
///
/// Best-effort by design: on any failure the caller keeps the cached session
/// rather than being logged out by a flaky network. The keychain read costs no
/// prompt: `SessionStore` reads the PAT once per process and the re-save below
/// skips the keychain entirely when the token has not changed, which on this
/// path is always.
#[tauri::command]
pub async fn refresh_session() -> Result<Option<Session>, String> {
    let Some(cached) = SessionStore::load() else {
        return Ok(None);
    };
    let Some(pat) = SessionStore::pat() else {
        return Ok(Some(cached));
    };
    let me = match IdClient::default().me(&pat).await {
        Ok(me) => me,
        Err(e) => {
            log::info!("keeping the cached session: {e}");
            return Ok(Some(cached));
        }
    };
    let fresh = Session {
        email: me
            .get("email")
            .and_then(|v| v.as_str())
            .unwrap_or(&cached.email)
            .to_string(),
        premium: me
            .get("premium")
            .and_then(|v| v.as_bool())
            .unwrap_or(cached.premium),
    };
    if let Err(e) = SessionStore::save(&fresh, &pat) {
        // The value is still good for this run; only the cache write failed.
        log::warn!("could not persist the refreshed session: {e}");
    }
    Ok(Some(fresh))
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
