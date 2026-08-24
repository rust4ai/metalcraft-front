//! A pod that answers whatever you tell it to, so failures can be *arranged*
//! rather than waited for.
//!
//! `dev_rpc.rs` made the app drivable: a browser or a `curl` can call every
//! command the renderer can. It did not make the app *testable*, because every
//! interesting question is about what happens when something goes wrong — and
//! the only way to see a pod refuse to list its integrations was to find a pod
//! that happened to be broken.
//!
//! That gap is not academic. `octaweave_status` degrades a pod that will not
//! answer into an empty integration list, which the settings card renders as
//! "the pack is not installed" — the bug that started all of this. Verifying the
//! fix meant reproducing a specific server failure, and there was no way to ask
//! for one.
//!
//! So: a pod whose every answer is programmable. It speaks the endpoints
//! `PodConnection` calls, seeded with defaults good enough to connect to, and a
//! control surface under `/__harness/` that overrides any of them — with a
//! status, a body, and optionally a number of times before it reverts.
//!
//! ```sh
//! MC_STUB_POD=1998 cargo run -p front-tauri --features dev-rpc --bin stub_pod
//!
//! # the next call to /integrations fails, once
//! curl -sX POST localhost:1998/__harness/route \
//!   -d '{"path":"/api/v1/integrations","status":503,"times":1}'
//!
//! # and what did the app actually ask for?
//! curl -s localhost:1998/__harness/requests
//! ```
//!
//! **Two gates, like the bridge it sits beside.** The `dev-rpc` Cargo feature
//! keeps it out of release builds, and `MC_STUB_POD=<port>` decides whether a
//! build that has the feature listens. It binds to 127.0.0.1. It is a fake pod
//! that trusts every Bearer it is shown, which is fine for a fake and would not
//! be fine for anything else.

use std::collections::VecDeque;
use std::sync::Arc;

use axum::extract::{Request, State as AxumState};
use axum::response::IntoResponse;
use axum::routing::{any, get, post};
use axum::{Json, Router};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// What `POST /integrations/install` claims to have installed. The real pod
/// takes a slug in the body; a fake with one pack does not need to read it.
const PACK_ID: &str = "octaweave";

/// One programmed answer.
///
/// `path` is matched exactly against the full request path (`/api/v1/keys`),
/// because a prefix match would make "fail /keys" also fail `/keys/OPENAI_API_KEY`
/// — a rule that quietly does more than it says is worse than no rule.
#[derive(Debug, Clone, Deserialize)]
pub struct Rule {
    pub path: String,
    /// `GET`, `POST`, `DELETE`. Omitted means any method.
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default = "ok_status")]
    pub status: u16,
    /// The body to answer with. Omitted with a failing status means the pod's
    /// usual error shape, which is what the app parses.
    #[serde(default)]
    pub body: Option<Value>,
    /// How many times before this rule retires. Omitted means forever — the
    /// difference between "this endpoint is broken" and "this one call fails",
    /// and a retry loop tells them apart.
    #[serde(default)]
    pub times: Option<usize>,
}

fn ok_status() -> u16 {
    200
}

/// The Rust-facing half of the control surface. Unused by the binaries, which
/// only serve the HTTP one — these exist for the tests that program a stub
/// directly, and a harness whose API is narrower than its users is no harness.
#[allow(dead_code)]
impl Rule {
    /// The common case by far: this path, this status, forever.
    pub fn fail(path: &str, status: u16) -> Self {
        Self {
            path: path.into(),
            method: None,
            status,
            body: None,
            times: None,
        }
    }

    /// This path answers this body, forever.
    pub fn answer(path: &str, body: Value) -> Self {
        Self {
            path: path.into(),
            method: None,
            status: 200,
            body: Some(body),
            times: None,
        }
    }

    /// Retire after `n` uses — "this call fails", not "this endpoint is broken".
    pub fn times(mut self, n: usize) -> Self {
        self.times = Some(n);
        self
    }
}

/// What was asked for, in order. The other half of a test: not just what the app
/// did with an answer, but whether it asked at all — a cached or skipped call is
/// invisible from the response side.
#[derive(Debug, Clone, Serialize)]
pub struct Seen {
    pub method: String,
    pub path: String,
    pub authorized: bool,
}

#[derive(Default)]
pub struct Harness {
    rules: Mutex<Vec<Rule>>,
    seen: Mutex<VecDeque<Seen>>,
    /// The pod's key store, for real.
    ///
    /// A fixed `GET /keys` would make `key_present` a thing the test asserted
    /// into existence; holding what was written means a flow that stores a key
    /// and then reads the status is checking its own work. Names only — the
    /// value is a credential and a fake has no reason to keep one.
    keys: Mutex<Vec<String>>,
    /// Integration slugs that have been installed through `/integrations/install`.
    installed: Mutex<Vec<String>>,
}

/// Cap the request log so a long-running stub cannot grow without bound.
const SEEN_CAP: usize = 500;

impl Harness {
    /// Program an answer from Rust, the way `POST /__harness/route` does over
    /// HTTP. The two paths exist for the same reason `Transport` has two
    /// implementations: a test should drive the thing the operator drives.
    pub fn program(&self, rule: Rule) {
        self.rules.lock().push(rule);
    }

    /// What has been asked for, oldest first.
    #[allow(dead_code)]
    pub fn seen(&self) -> Vec<Seen> {
        self.seen.lock().iter().cloned().collect()
    }

    /// Back to unprogrammed, an empty request log, and an empty pod.
    pub fn reset(&self) {
        self.rules.lock().clear();
        self.seen.lock().clear();
        self.keys.lock().clear();
        self.installed.lock().clear();
    }

    /// Key names the stub currently holds. For tests that assert a credential
    /// really landed, rather than that the call returned.
    #[allow(dead_code)]
    pub fn keys(&self) -> Vec<String> {
        self.keys.lock().clone()
    }

    /// Newest matching rule wins, so a later `POST /__harness/route` overrides an
    /// earlier one without needing a reset between steps.
    ///
    /// `pub(crate)` because the fake Octaweave reuses this matcher rather than
    /// growing a second one — a rule means the same thing whichever service it
    /// is aimed at, and two implementations would drift.
    pub(crate) fn take(&self, method: &str, path: &str) -> Option<Rule> {
        let mut rules = self.rules.lock();
        let at = rules
            .iter()
            .rposition(|r| r.path == path && r.method.as_deref().is_none_or(|m| m == method))?;
        let rule = rules[at].clone();
        match rules[at].times {
            Some(n) if n <= 1 => {
                rules.remove(at);
            }
            Some(ref mut n) => *n -= 1,
            None => {}
        }
        Some(rule)
    }

    pub(crate) fn record(&self, seen: Seen) {
        let mut log = self.seen.lock();
        log.push_back(seen);
        while log.len() > SEEN_CAP {
            log.pop_front();
        }
    }
}

/// The answers a pod gives when nothing has been programmed: empty, healthy, and
/// enough to connect to. Deliberately the *boring* pod — a test says out loud
/// what it needs to be different, and anything it does not say is not the point
/// of that test.
fn default_answer(h: &Harness, method: &str, path: &str) -> Option<Value> {
    // The stateful half first: writing a key and then reading the key store has
    // to agree with itself, or every test built on it proves nothing.
    if let Some(name) = path.strip_prefix("/api/v1/keys/") {
        match method {
            "PUT" => {
                let mut keys = h.keys.lock();
                if !keys.iter().any(|k| k == name) {
                    keys.push(name.to_string());
                }
                return Some(Value::Null);
            }
            "DELETE" => {
                h.keys.lock().retain(|k| k != name);
                return Some(Value::Null);
            }
            _ => return None,
        }
    }
    if (method, path) == ("POST", "/api/v1/integrations/install") {
        h.installed.lock().push(PACK_ID.to_string());
        return Some(json!({ "id": PACK_ID, "enabled": true, "api_tools": 32 }));
    }
    if (method, path) == ("GET", "/api/v1/keys") {
        return Some(json!(
            h.keys
                .lock()
                .iter()
                .map(|name| json!({ "name": name, "masked": "…1234" }))
                .collect::<Vec<_>>()
        ));
    }
    if (method, path) == ("GET", "/api/v1/integrations") {
        return Some(json!(
            h.installed
                .lock()
                .iter()
                .map(|id| json!({
                    "id": id, "name": id, "version": "1.0.0",
                    "enabled": true, "api_tools": 32
                }))
                .collect::<Vec<_>>()
        ));
    }

    let body = match (method, path) {
        ("GET", "/api/v1/info") => json!({ "name": "stub-pod", "version": "0.31.0" }),
        ("GET", "/api/v1/inference") => {
            json!({ "ready": true, "credential": "environment", "gateway": true })
        }
        ("GET", "/api/v1/agents/instances") => json!({ "instances": [] }),
        ("GET", "/api/v1/agent-presets") => json!({ "presets": [] }),
        ("GET", "/api/v1/agent-packs") => json!({ "agent_packs": [] }),
        ("GET", "/api/v1/agent-packs/registries") => json!({ "registries": [] }),
        ("GET", "/api/v1/chats") => json!([]),
        ("GET", "/api/v1/flows") => json!({ "flows": [] }),
        ("GET", "/api/v1/flow-runs") => json!([]),
        _ => return None,
    };
    Some(body)
}

/// Start the stub if `MC_STUB_POD` names a port. Never returns an error, for the
/// same reason the bridge does not: a dev tool must not stop anything starting.
pub fn spawn() {
    // An empty value reads as off, not as a malformed port: callers that set the
    // variable conditionally (`run_dev.sh`) would otherwise get a warning about
    // a stub they deliberately did not ask for.
    let Ok(port) = std::env::var("MC_STUB_POD") else {
        return;
    };
    if port.trim().is_empty() {
        return;
    }
    let Ok(port) = port.trim().parse::<u16>() else {
        log::warn!("MC_STUB_POD is not a port number; not starting the stub pod");
        return;
    };
    tokio::spawn(async move {
        match start(port).await {
            Ok((addr, _)) => {
                log::warn!("stub pod on http://{addr} — a fake pod, dev only");
                std::future::pending::<()>().await;
            }
            Err(e) => log::warn!("stub pod could not bind {port}: {e}"),
        }
    });
}

/// Bind, serve, and hand back where it landed and the handle to program it.
///
/// Port 0 gives an ephemeral port, which is what lets a test start one per case
/// with no port bookkeeping and no chance of two runs colliding.
pub async fn start(port: u16) -> std::io::Result<(std::net::SocketAddr, Arc<Harness>)> {
    let harness = Arc::new(Harness::default());
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    let addr = listener.local_addr()?;
    let router = Router::new()
        .route("/__harness/route", post(add_route))
        .route("/__harness/reset", post(reset))
        .route("/__harness/requests", get(requests))
        .fallback(any(serve))
        .with_state(harness.clone());
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Ok((addr, harness))
}

async fn add_route(
    AxumState(h): AxumState<Arc<Harness>>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    match serde_json::from_slice::<Rule>(&body) {
        Ok(rule) => {
            log::info!(
                "stub pod: {} {} -> {}{}",
                rule.method.as_deref().unwrap_or("ANY"),
                rule.path,
                rule.status,
                rule.times.map(|n| format!(" ({n}x)")).unwrap_or_default(),
            );
            h.program(rule);
            (axum::http::StatusCode::OK, Json(json!({ "ok": true })))
        }
        Err(e) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("not a rule: {e}") })),
        ),
    }
}

/// Back to the boring pod, and an empty request log. One call between test cases
/// rather than one per rule they happened to add.
async fn reset(AxumState(h): AxumState<Arc<Harness>>) -> impl IntoResponse {
    h.reset();
    Json(json!({ "ok": true }))
}

async fn requests(AxumState(h): AxumState<Arc<Harness>>) -> impl IntoResponse {
    Json(json!(h.seen.lock().iter().cloned().collect::<Vec<_>>()))
}

/// Everything that is not the control surface: a programmed rule if one matches,
/// then the default table, then 404 in the pod's own error shape.
async fn serve(AxumState(h): AxumState<Arc<Harness>>, req: Request) -> impl IntoResponse {
    let method = req.method().as_str().to_string();
    let path = req.uri().path().to_string();
    h.record(Seen {
        method: method.clone(),
        path: path.clone(),
        authorized: req
            .headers()
            .contains_key(axum::http::header::AUTHORIZATION),
    });

    if let Some(rule) = h.take(&method, &path) {
        let status =
            axum::http::StatusCode::from_u16(rule.status).unwrap_or(axum::http::StatusCode::OK);
        let body = rule.body.unwrap_or_else(|| {
            if status.is_success() {
                Value::Null
            } else {
                // The shape the pod actually errors with, so the app's own
                // parsing is exercised rather than bypassed.
                json!({ "error": format!("stub pod was told to answer {status}") })
            }
        });
        return (status, Json(body));
    }

    match default_answer(&h, &method, &path) {
        Some(body) => (axum::http::StatusCode::OK, Json(body)),
        None => (
            axum::http::StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("stub pod has no answer for {method} {path}") })),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_counted_rule_retires_and_the_pod_goes_back_to_healthy() {
        // The distinction a retry loop depends on: "this call fails" is not
        // "this endpoint is broken", and a harness that cannot say the first
        // cannot test recovery at all.
        let h = Harness::default();
        h.rules.lock().push(Rule {
            path: "/api/v1/integrations".into(),
            method: None,
            status: 503,
            body: None,
            times: Some(2),
        });

        assert_eq!(
            h.take("GET", "/api/v1/integrations").map(|r| r.status),
            Some(503)
        );
        assert_eq!(
            h.take("GET", "/api/v1/integrations").map(|r| r.status),
            Some(503)
        );
        assert!(h.take("GET", "/api/v1/integrations").is_none());
    }

    #[test]
    fn a_rule_does_not_leak_onto_the_paths_below_it() {
        // "fail /keys" must not also fail "/keys/OPENAI_API_KEY" — a rule that
        // quietly does more than it says makes every test built on it a lie.
        let h = Harness::default();
        h.rules.lock().push(Rule {
            path: "/api/v1/keys".into(),
            method: None,
            status: 500,
            body: None,
            times: None,
        });
        assert!(h.take("GET", "/api/v1/keys").is_some());
        assert!(h.take("DELETE", "/api/v1/keys/OPENAI_API_KEY").is_none());
    }

    #[test]
    fn the_newest_rule_wins_so_steps_do_not_need_a_reset_between_them() {
        let h = Harness::default();
        for status in [503, 200] {
            h.rules.lock().push(Rule {
                path: "/api/v1/integrations".into(),
                method: None,
                status,
                body: None,
                times: None,
            });
        }
        assert_eq!(
            h.take("GET", "/api/v1/integrations").map(|r| r.status),
            Some(200)
        );
    }

    #[test]
    fn a_method_bound_rule_leaves_the_other_verbs_alone() {
        let h = Harness::default();
        h.rules.lock().push(Rule {
            path: "/api/v1/integrations".into(),
            method: Some("POST".into()),
            status: 500,
            body: None,
            times: None,
        });
        assert!(h.take("GET", "/api/v1/integrations").is_none());
        assert!(h.take("POST", "/api/v1/integrations").is_some());
    }

    /// The default table is what makes a test say only what it means. If a bare
    /// stub could not be connected to, every case would carry setup noise.
    #[test]
    fn the_unprogrammed_pod_is_a_healthy_empty_one() {
        let h = Harness::default();
        assert!(default_answer(&h, "GET", "/api/v1/info").is_some());
        assert_eq!(
            default_answer(&h, "GET", "/api/v1/integrations"),
            Some(json!([]))
        );
        assert!(default_answer(&h, "GET", "/api/v1/nope").is_none());
    }

    /// The key store is the pod's, not the test's: what was written is what
    /// comes back, so a flow that stores a key and then reads its own status is
    /// checking something real.
    #[test]
    fn the_key_store_remembers_what_was_written_to_it() {
        let h = Harness::default();
        default_answer(&h, "PUT", "/api/v1/keys/OCTAWEAVE_API_KEY");
        assert_eq!(h.keys(), ["OCTAWEAVE_API_KEY"]);

        let listed = default_answer(&h, "GET", "/api/v1/keys").unwrap();
        assert_eq!(listed[0]["name"], "OCTAWEAVE_API_KEY");

        default_answer(&h, "DELETE", "/api/v1/keys/OCTAWEAVE_API_KEY");
        assert!(h.keys().is_empty());
    }
}
