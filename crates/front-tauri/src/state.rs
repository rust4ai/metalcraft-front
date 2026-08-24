//! App state: which pods are connected, and the tokens that keep them connected.
//!
//! The map is the whole reason this is not a single `Option<Connection>` like
//! metalcraft-workshop's: an account has one pod today, but self-hosted pods and
//! a manually-keyed agent are entries in the same map, and "many pods" then costs
//! a switcher rather than a rewrite (PLAN §7).
//!
//! Nothing here is exposed to the webview. The renderer addresses a pod by slug;
//! the Bearer never leaves this process.

use std::collections::HashMap;

use front_cloud::ControlPlane;
use front_core::PodConnection;
use parking_lot::Mutex;
use serde::Serialize;

use crate::diag::DiagLog;

/// What the renderer is allowed to know about the connection: a name and a URL,
/// never the Bearer.
#[derive(Debug, Clone, Serialize)]
pub struct ActivePod {
    pub slug: String,
    pub url: String,
}

pub struct ConnectedPod {
    pub slug: String,
    pub url: String,
    pub conn: PodConnection,
    pub refresher: Option<tokio::task::JoinHandle<()>>,
}

impl Drop for ConnectedPod {
    fn drop(&mut self) {
        if let Some(h) = self.refresher.take() {
            h.abort();
        }
    }
}

#[derive(Default)]
pub struct AppState {
    pods: Mutex<HashMap<String, ConnectedPod>>,
    /// The pod the UI is currently looking at. With one pod per account this is
    /// simply "the one"; it exists so the renderer never has to pass a slug it
    /// does not care about.
    active: Mutex<Option<String>>,
    /// What commands swallowed rather than returned. Lives here, next to the
    /// connection, because the degradations worth recording are the ones that
    /// happen when the connection is the thing misbehaving.
    diag: DiagLog,
}

impl AppState {
    /// Where a command reports something it decided not to fail over.
    pub fn diag(&self) -> &DiagLog {
        &self.diag
    }

    pub fn plane(&self) -> ControlPlane {
        ControlPlane::default()
    }

    pub fn insert(&self, pod: ConnectedPod) {
        let slug = pod.slug.clone();
        self.pods.lock().insert(slug.clone(), pod);
        *self.active.lock() = Some(slug);
    }

    /// The connection for a slug, or the active pod when none is given.
    pub fn conn(&self, slug: Option<&str>) -> Result<PodConnection, String> {
        let pods = self.pods.lock();
        let key = match slug {
            Some(s) => s.to_string(),
            None => self.active.lock().clone().ok_or("no pod connected")?,
        };
        pods.get(&key)
            .map(|p| p.conn.clone())
            .ok_or_else(|| format!("pod '{key}' is not connected"))
    }

    pub fn active_slug(&self) -> Option<String> {
        self.active.lock().clone()
    }

    /// Slug + public URL of the connected pod, for the title bar. The URL is the
    /// control plane's, not user-supplied, so it is safe to show as identity.
    pub fn active_pod(&self) -> Option<ActivePod> {
        let slug = self.active_slug()?;
        let pods = self.pods.lock();
        let pod = pods.get(&slug)?;
        Some(ActivePod {
            slug: pod.slug.clone(),
            url: pod.url.clone(),
        })
    }

    pub fn disconnect(&self, slug: &str) {
        self.pods.lock().remove(slug);
        let mut active = self.active.lock();
        if active.as_deref() == Some(slug) {
            *active = None;
        }
    }
}
