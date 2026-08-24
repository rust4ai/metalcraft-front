//! Listing and connecting pods (PLAN §7).

use std::sync::{Arc, RwLock};
use std::time::Duration;

use front_cloud::{Credits, IdClient, Pod, SessionStore, spawn_token_refresher};
use front_core::{AgentInfo, PodConnection};

use crate::state::{AppState, ConnectedPod};

type State<'a> = tauri::State<'a, Arc<AppState>>;

fn pat() -> Result<String, String> {
    SessionStore::pat().ok_or_else(|| "not signed in to Metalcraft".to_string())
}

#[tauri::command]
pub async fn list_pods(state: State<'_>) -> Result<Vec<Pod>, String> {
    state.plane().pods(&pat()?).await.map_err(|e| e.to_string())
}

/// Connect straight to a pod by URL and key, with no hub in the loop.
///
/// The hub path (`connect_pod`) resolves a slug, mints an audience-scoped token
/// and keeps it fresh. None of that applies to a pod somebody runs themselves:
/// it authenticates with a static `WORKSHOP_API_KEY`, it has no slug anywhere but
/// here, and there is nothing to refresh. `AppState`'s map was built for exactly
/// this — its own doc calls "a manually-keyed agent" a peer entry — so a direct
/// pod is a normal member of the fleet once connected, not a second mode.
///
/// **No readiness polling.** `connect_pod` waits ten intervals because a
/// scheduled pod may still be starting and the user can do nothing but wait. A
/// pod you typed the address of is either answering or it is not, and a
/// two-minute spinner would hide the typo.
///
/// The key crosses renderer → core, which is the safe direction: it is entered
/// here and never sent back (the same shape as the interface-source step).
#[tauri::command]
pub async fn connect_pod_url(
    url: String,
    key: String,
    state: State<'_>,
) -> Result<AgentInfo, String> {
    let conn = PodConnection::new(url.trim(), key.trim()).map_err(|e| e.to_string())?;
    let info = conn.info().await.map_err(|e| e.to_string())?;
    // The host is the slug: stable, unique per pod, and recognisable in a title
    // bar. Unlike the hub's slug this is user-supplied — fine as *identity*,
    // since the user typed it, but it is not a claim the pod made about itself.
    let slug = url
        .trim()
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("pod")
        .to_string();
    state.insert(ConnectedPod {
        slug,
        url: url.trim().trim_end_matches('/').to_string(),
        conn,
        // A static key does not expire, so there is nothing to refresh.
        refresher: None,
    });
    Ok(info)
}

/// A pod that was just (re)started — waking from suspend, or freshly scheduled —
/// needs time before its HTTP API answers; until a healthy backend exists the
/// ingress returns 503 immediately. Poll patiently rather than reporting a
/// failure the user can do nothing about.
const READY_ATTEMPTS: u32 = 10;
const READY_INTERVAL: Duration = Duration::from_secs(15);

/// Connect: resolve the pod, mint an audience-scoped token, wait for it to answer,
/// then keep the token fresh for as long as it stays connected.
#[tauri::command]
pub async fn connect_pod(pod_id: String, state: State<'_>) -> Result<AgentInfo, String> {
    let pat = pat()?;
    let plane = state.plane();
    let pod = plane
        .resolve(&pat, &pod_id)
        .await
        .map_err(|e| e.to_string())?;
    let (token, ttl) = plane
        .mint(&pat, &pod.slug)
        .await
        .map_err(|e| e.to_string())?;

    let cell: front_core::SharedToken = Arc::new(RwLock::new(token));
    let conn =
        PodConnection::with_shared_token(&pod.url, cell.clone()).map_err(|e| e.to_string())?;

    let mut last = String::new();
    for attempt in 0..READY_ATTEMPTS {
        match conn.info().await {
            Ok(info) => {
                let refresher = spawn_token_refresher(
                    plane.base().to_string(),
                    pod.slug.clone(),
                    cell.clone(),
                    ttl,
                );
                state.insert(ConnectedPod {
                    slug: pod.slug.clone(),
                    url: pod.url.clone(),
                    conn,
                    refresher: Some(refresher),
                });
                return Ok(info);
            }
            Err(e) => {
                last = e.to_string();
                log::info!(
                    "pod not ready yet (attempt {}/{READY_ATTEMPTS}): {last}",
                    attempt + 1
                );
                if attempt + 1 < READY_ATTEMPTS {
                    tokio::time::sleep(READY_INTERVAL).await;
                }
            }
        }
    }
    Err(format!(
        "pod did not become ready in time (it may still be starting) — try again: {last}"
    ))
}

#[tauri::command]
pub async fn agent_info(state: State<'_>) -> Result<AgentInfo, String> {
    state.conn(None)?.info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn active_pod(state: State<'_>) -> Result<Option<crate::state::ActivePod>, String> {
    Ok(state.active_pod())
}

/// The account's credit balance, for the status bar.
///
/// `Ok(None)` means this deployment does not report credits — the bar then shows
/// nothing rather than a zero, because "0 credits" and "we don't know" look
/// identical on a readout and mean opposite things.
#[tauri::command]
pub async fn account_credits() -> Result<Option<Credits>, String> {
    IdClient::default()
        .credits(&pat()?)
        .await
        .map_err(|e| e.to_string())
}
