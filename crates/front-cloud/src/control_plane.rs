//! The k3s control plane: which pods an account owns, and the tokens that let a
//! client talk to one.
//!
//! The minting endpoint is a general per-pod, per-owner primitive — any
//! Metalcraft ID-authenticated client that owns the pod can mint. It is not
//! specific to any one app and has nothing to do with the Metalcraft Gateway.

use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::{http, session::SessionStore};

/// One agent pod. Today an account has exactly one; the client is written for
/// many so growing is a UI change rather than a re-architecture (PLAN §7).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pod {
    pub id: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

pub struct ControlPlane {
    base: String,
}

impl Default for ControlPlane {
    fn default() -> Self {
        Self::new(crate::control_plane_base())
    }
}

impl ControlPlane {
    pub fn new(base: impl Into<String>) -> Self {
        Self { base: base.into() }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    /// The signed-in account's pods. Ownership-scoped by the control plane, which
    /// is what makes the returned `url` authoritative — it is never user-supplied,
    /// so the Bearer we later send cannot be aimed at an attacker's host.
    pub async fn pods(&self, pat: &str) -> anyhow::Result<Vec<Pod>> {
        let resp = http()
            .get(format!("{}/api/pods", self.base))
            .bearer_auth(pat)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("could not reach the control plane: {e}"))?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            anyhow::bail!("session expired — sign in to Metalcraft again");
        }
        if !resp.status().is_success() {
            anyhow::bail!("control plane returned {}", resp.status());
        }
        let pods: Vec<Pod> = resp.json().await?;
        Ok(pods)
    }

    /// Ask for a pod. Idempotent on the control plane's side — an existing pod is
    /// re-affirmed rather than duplicated — so this is safe to press twice.
    ///
    /// Kept even though upgrading now provisions on its own: that path runs from
    /// a Stripe webhook and can lose a race with an impatient user, the hub's
    /// retries can run out, and somebody whose pod was deleted has no upgrade
    /// left to trigger. A funnel whose last step can only be reached by paying
    /// again is not a funnel.
    ///
    /// A 402 is the honest "this account has no premium", and is passed through
    /// as its own message rather than a status code, because it is the one
    /// failure here with a fix the user can act on.
    pub async fn provision(&self, pat: &str) -> anyhow::Result<Pod> {
        let resp = http()
            .post(format!("{}/api/pods", self.base))
            .bearer_auth(pat)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("could not reach the control plane: {e}"))?;
        if resp.status() == reqwest::StatusCode::PAYMENT_REQUIRED {
            anyhow::bail!("a premium membership is required to provision a pod");
        }
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            anyhow::bail!("session expired — sign in to Metalcraft again");
        }
        if !resp.status().is_success() {
            anyhow::bail!("control plane returned {}", resp.status());
        }
        Ok(resp.json().await?)
    }

    pub async fn resolve(&self, pat: &str, pod_id: &str) -> anyhow::Result<Pod> {
        let pod = self
            .pods(pat)
            .await?
            .into_iter()
            .find(|p| p.id == pod_id || p.slug == pod_id)
            .ok_or_else(|| anyhow::anyhow!("pod not found"))?;
        if pod.slug.is_empty() || pod.url.is_empty() {
            anyhow::bail!("control plane returned no slug/url for {pod_id}");
        }
        Ok(pod)
    }

    /// Mint a fresh audience-scoped (`pod:{slug}`) connection token.
    /// Returns `(token, ttl_secs)`.
    pub async fn mint(&self, pat: &str, slug: &str) -> anyhow::Result<(String, u64)> {
        let resp = http()
            .post(format!("{}/api/pods/{slug}/connection/mint", self.base))
            .bearer_auth(pat)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("could not reach the control plane: {e}"))?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            anyhow::bail!("session expired — sign in to Metalcraft again");
        }
        if !resp.status().is_success() {
            anyhow::bail!("could not mint connection token ({})", resp.status());
        }
        let body: serde_json::Value = resp.json().await?;
        let token = body
            .get("connection_token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("connection token missing"))?
            .to_string();
        let ttl = body
            .get("expires_in")
            .and_then(|v| v.as_u64())
            .unwrap_or(3600);
        Ok((token, ttl))
    }
}

/// How long before expiry to re-mint, and the floor on the sleep. A five-minute
/// overlap means a valid token is always in the cell, even if the mint is slow.
const REFRESH_LEAD: u64 = 300;
const MIN_SLEEP: u64 = 60;

pub fn refresh_sleep_secs(ttl: u64) -> u64 {
    ttl.saturating_sub(REFRESH_LEAD).max(MIN_SLEEP)
}

/// Keep a pod's connection token fresh underneath a live connection.
///
/// Stops on sign-out or a control-plane refusal; the next pod call then 401s and
/// the UI offers a reconnect, which is the honest outcome — silently retrying a
/// revoked session forever would just hide it.
pub fn spawn_token_refresher(
    base: String,
    slug: String,
    cell: Arc<RwLock<String>>,
    mut ttl: u64,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let plane = ControlPlane::new(base);
        loop {
            tokio::time::sleep(Duration::from_secs(refresh_sleep_secs(ttl))).await;
            let Some(pat) = SessionStore::pat() else {
                log::info!("token refresher for {slug}: signed out, stopping");
                return;
            };
            match plane.mint(&pat, &slug).await {
                Ok((token, new_ttl)) => {
                    *cell.write().unwrap_or_else(|e| e.into_inner()) = token;
                    ttl = new_ttl;
                    log::info!("refreshed connection token for {slug}");
                }
                Err(e) => {
                    log::warn!("token refresh failed for {slug}: {e}; stopping");
                    return;
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_lands_five_minutes_before_expiry() {
        assert_eq!(refresh_sleep_secs(3600), 3300);
    }

    #[test]
    fn a_short_ttl_still_sleeps_rather_than_spinning() {
        // A 60s token would otherwise compute a zero sleep and mint in a hot loop.
        assert_eq!(refresh_sleep_secs(60), MIN_SLEEP);
        assert_eq!(refresh_sleep_secs(0), MIN_SLEEP);
    }

    #[test]
    fn pods_decode_with_fields_this_client_does_not_know() {
        let pods: Vec<Pod> = serde_json::from_str(
            r#"[{"id":"p1","slug":"amy","url":"https://amy.metalcraftai.com","future_field":1}]"#,
        )
        .unwrap();
        assert_eq!(pods[0].slug, "amy");
    }
}
