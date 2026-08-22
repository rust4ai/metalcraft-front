//! `front-cloud` — the three hosted services metalcraft-front talks to before it
//! ever reaches a pod.
//!
//! In metalcraft-workshop this logic lived inline in the Tauri `main.rs`. It is a
//! crate here for two reasons: the web build (PLAN §11 P11) needs the same flows
//! behind a different transport, and the token refresher is much easier to test
//! when it is not entangled with app state.
//!
//! Auth is **OIDC/PAT only — no static pod key**. A pod call is authorised by a
//! short-lived, audience-scoped (`pod:{slug}`) connection token minted from the
//! control plane by whoever owns the pod.

pub mod control_plane;
pub mod id;
pub mod session;

pub use control_plane::{ControlPlane, Pod, Usage, spawn_token_refresher};
pub use id::{DeviceLogin, IdClient, LoginStatus};
pub use session::{Session, SessionStore};

/// Metalcraft ID origin. `METALCRAFT_ID_URL` overrides for local testing.
pub fn id_base() -> String {
    env_or("METALCRAFT_ID_URL", "https://id.metalcraftai.com")
}

/// k3s control-plane origin. `METALCRAFT_PODS_URL` overrides for local testing.
pub fn control_plane_base() -> String {
    env_or("METALCRAFT_PODS_URL", "https://pods.metalcraftai.com")
}

fn env_or(key: &str, fallback: &str) -> String {
    std::env::var(key)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

/// A client for the hub and control plane with bounded timeouts.
///
/// Without these an unresponsive endpoint makes `send().await` block forever,
/// which the user experiences as a frozen Connect button with no error. Bounded
/// connect + overall timeouts turn that into a fast, visible failure. Note this
/// is the *control plane* client — pod streaming deliberately has no total
/// timeout (see `front_core::pod`).
pub(crate) fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #[test]
    fn defaults_are_the_hosted_services() {
        assert_eq!(super::id_base(), "https://id.metalcraftai.com");
        assert_eq!(super::control_plane_base(), "https://pods.metalcraftai.com");
    }
}
