//! Metalcraft ID device login.
//!
//! Browser-based by design: the app never sees a password, and the PAT it ends up
//! with is the same one every other Metalcraft client uses. `start` returns a
//! verify URL to open (and to show as copyable text, because a failed
//! `open`/`xdg-open` must not dead-end the flow); `poll` runs until the user
//! approves in the browser.

use serde::{Deserialize, Serialize};

use crate::{http, id_base};

/// What `POST /auth/device/start` hands back.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceLogin {
    pub device_code: String,
    #[serde(default)]
    pub user_code: Option<String>,
    pub verify_url: String,
    #[serde(default)]
    pub interval_secs: Option<u64>,
    #[serde(default)]
    pub expires_at: Option<String>,
}

/// The result of one poll. `Pending` is the common case — the user is still in
/// the browser — and must not be treated as an error.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LoginStatus {
    Pending,
    Expired,
    SignedIn {
        token: String,
        email: String,
        #[serde(default)]
        premium: bool,
    },
    #[serde(other)]
    Unknown,
}

pub struct IdClient {
    base: String,
}

impl Default for IdClient {
    fn default() -> Self {
        Self::new(id_base())
    }
}

impl IdClient {
    pub fn new(base: impl Into<String>) -> Self {
        Self { base: base.into() }
    }

    pub async fn start(&self) -> anyhow::Result<DeviceLogin> {
        let resp = http()
            .post(format!("{}/auth/device/start", self.base))
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("could not reach metalcraft-id: {e}"))?;
        if !resp.status().is_success() {
            anyhow::bail!("metalcraft-id returned {}", resp.status());
        }
        Ok(resp.json().await?)
    }

    /// Poll once. On success this resolves the account's email too, so the caller
    /// can persist a session that shows who is signed in without a second call.
    pub async fn poll(&self, device_code: &str) -> anyhow::Result<LoginStatus> {
        let resp = http()
            .post(format!("{}/auth/device/poll", self.base))
            .json(&serde_json::json!({ "device_code": device_code }))
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("could not reach metalcraft-id: {e}"))?;
        let body: serde_json::Value = resp.json().await?;
        if body.get("status").and_then(|v| v.as_str()) != Some("signed_in") {
            return Ok(serde_json::from_value(body).unwrap_or(LoginStatus::Unknown));
        }
        let token = body
            .get("token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("metalcraft-id returned no token"))?
            .to_string();
        let me = self.me(&token).await?;
        Ok(LoginStatus::SignedIn {
            token,
            email: me
                .get("email")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            premium: me.get("premium").and_then(|v| v.as_bool()).unwrap_or(false),
        })
    }

    pub async fn me(&self, pat: &str) -> anyhow::Result<serde_json::Value> {
        Ok(http()
            .get(format!("{}/me", self.base))
            .bearer_auth(pat)
            .send()
            .await?
            .json()
            .await?)
    }
}

/// Open a URL in the user's browser. Best-effort — the UI always shows the URL as
/// copyable text too, so a failure here is a nuisance rather than a dead end.
pub fn open_in_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = std::process::Command::new("xdg-open").arg(url).spawn();
    if let Err(e) = spawned {
        log::warn!("failed to open browser for {url}: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_and_expired_decode_without_a_token() {
        assert!(matches!(
            serde_json::from_str::<LoginStatus>(r#"{"status":"pending"}"#).unwrap(),
            LoginStatus::Pending
        ));
        assert!(matches!(
            serde_json::from_str::<LoginStatus>(r#"{"status":"expired"}"#).unwrap(),
            LoginStatus::Expired
        ));
    }

    #[test]
    fn an_unknown_status_from_a_newer_hub_is_not_an_error() {
        let s: LoginStatus = serde_json::from_str(r#"{"status":"rate_limited"}"#).unwrap();
        assert!(matches!(s, LoginStatus::Unknown));
    }
}
