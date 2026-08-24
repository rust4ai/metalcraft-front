//! An Octaweave that can be told to refuse, so the connect flow's failures can
//! be *arranged* rather than waited for.
//!
//! Sibling to [`crate::stub_pod`], and here for a sharper reason. The pod stub
//! covers reading a status; this one covers **minting and revoking a
//! credential**, where the interesting failures are the ones that leave
//! something live behind:
//!
//! - a key is minted, fails `whoami`, and the revoke that should clean it up
//!   *also* fails — a working credential in someone's workspace that no part of
//!   this app holds, and nothing on screen would ever mention it
//! - a disconnect that drops the pod's copy while the revoke never happens
//!
//! Neither is reachable against the real Octaweave without deliberately
//! breaking an account, which is why both were shipped unverified.
//!
//! [`octaweave_base`] already reads `OCTAWEAVE_URL`, so pointing the client here
//! needs no seam of our own — the override the client documents for local
//! testing is the one this uses.
//!
//! ```sh
//! MC_STUB_OCTAWEAVE=1997 cargo run -p front-tauri --features dev-rpc --bin dev_core
//! OCTAWEAVE_URL=http://127.0.0.1:1997 ./run.sh     # the app, against the fake
//!
//! # the next revoke fails, so a bad mint cannot be cleaned up
//! curl -sX POST localhost:1997/__harness/route \
//!   -d '{"method":"DELETE","path":"/api/v1/w/ws_1/keys/key_1","status":500}'
//! ```
//!
//! Same two gates as everything else in here: the `dev-rpc` feature, and
//! `MC_STUB_OCTAWEAVE=<port>`. It binds to 127.0.0.1 and hands `owk_` tokens to
//! anyone who asks, which is fine for a fake and would be a catastrophe for
//! anything else.
//!
//! [`octaweave_base`]: front_cloud::octaweave_base

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::extract::{Request, State as AxumState};
use axum::response::IntoResponse;
use axum::routing::{any, get, post};
use axum::{Json, Router};
use parking_lot::Mutex;
use serde_json::{Value, json};

use crate::stub_pod::{Harness, Rule, Seen};

/// The account this fake belongs to: which workspaces it has, and whether it has
/// been linked at all.
///
/// `linked: false` is not a rule about one endpoint — it is the state where
/// `/workspaces` answers 401 and the app is supposed to open a browser, which is
/// the first fork in the whole connect flow.
pub struct Account {
    pub linked: Mutex<bool>,
    pub workspaces: Mutex<Vec<Value>>,
    /// Keys that currently exist, per workspace, as `{ws}` → list.
    pub keys: Mutex<Vec<(String, Value)>>,
    minted: AtomicUsize,
}

impl Default for Account {
    fn default() -> Self {
        Self {
            linked: Mutex::new(true),
            // One admin workspace: the case that connects without a picker, so a
            // test that is not about picking says nothing about it.
            workspaces: Mutex::new(vec![json!({
                "id": "ws_1", "org_slug": "acme", "slug": "main",
                "name": "My workspace", "role": "admin"
            })]),
            keys: Mutex::new(Vec::new()),
            minted: AtomicUsize::new(0),
        }
    }
}

pub struct StubOctaweave {
    /// Programmed overrides, shared with the pod stub's matcher — the rules
    /// mean the same thing here, so they are the same type.
    pub harness: Arc<Harness>,
    pub account: Arc<Account>,
}

impl Account {
    /// Back to a linked account with one workspace and no keys.
    ///
    /// The mint counter goes with it, which is the whole point: a test that
    /// programs `/w/ws_1/keys/key_1` to fail needs the *next* minted key to be
    /// `key_1`. Leaving the counter running makes the id depend on how many
    /// tests ran first, and a rule that silently stops matching turns into a
    /// test that passes for the wrong reason.
    pub fn reset(&self) {
        let fresh = Account::default();
        *self.linked.lock() = *fresh.linked.lock();
        *self.workspaces.lock() = fresh.workspaces.lock().clone();
        self.keys.lock().clear();
        self.minted.store(0, Ordering::Relaxed);
    }
}

/// The Rust-facing half of the control surface, mirroring the HTTP one. Unused
/// by the binaries, which only serve it — these are for tests that drive a fake
/// directly, and a harness narrower than its users is no harness.
#[allow(dead_code)]
impl StubOctaweave {
    /// Keys Octaweave still holds for a workspace. The assertion that matters
    /// after a disconnect: an empty list means nothing was left live.
    pub fn live_keys(&self, workspace: &str) -> Vec<Value> {
        self.account
            .keys
            .lock()
            .iter()
            .filter(|(ws, k)| ws == workspace && k["status"] == "active")
            .map(|(_, k)| k.clone())
            .collect()
    }

    pub fn seen(&self) -> Vec<Seen> {
        self.harness.seen()
    }

    pub fn program(&self, rule: Rule) {
        self.harness.program(rule);
    }
}

/// Start the fake if `MC_STUB_OCTAWEAVE` names a port.
pub fn spawn() {
    let Ok(port) = std::env::var("MC_STUB_OCTAWEAVE") else {
        return;
    };
    if port.trim().is_empty() {
        return;
    }
    let Ok(port) = port.trim().parse::<u16>() else {
        log::warn!("MC_STUB_OCTAWEAVE is not a port number; not starting the fake");
        return;
    };
    tokio::spawn(async move {
        match start(port).await {
            Ok((addr, _)) => {
                log::warn!("fake Octaweave on http://{addr} — set OCTAWEAVE_URL to it; dev only");
                std::future::pending::<()>().await;
            }
            Err(e) => log::warn!("fake Octaweave could not bind {port}: {e}"),
        }
    });
}

/// Bind, serve, and hand back where it landed and the handle to program it.
/// Port 0 gives an ephemeral port, which is what a test wants.
pub async fn start(port: u16) -> std::io::Result<(std::net::SocketAddr, Arc<StubOctaweave>)> {
    let stub = Arc::new(StubOctaweave {
        harness: Arc::new(Harness::default()),
        account: Arc::new(Account::default()),
    });
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    let addr = listener.local_addr()?;
    let router = Router::new()
        .route("/__harness/route", post(add_route))
        .route("/__harness/reset", post(reset))
        .route("/__harness/requests", get(requests))
        .fallback(any(serve))
        .with_state(stub.clone());
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Ok((addr, stub))
}

async fn add_route(
    AxumState(s): AxumState<Arc<StubOctaweave>>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    match serde_json::from_slice::<Rule>(&body) {
        Ok(rule) => {
            s.harness.program(rule);
            (axum::http::StatusCode::OK, Json(json!({ "ok": true })))
        }
        Err(e) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("not a rule: {e}") })),
        ),
    }
}

/// Back to a linked account with one workspace and no keys — and, critically, no
/// programmed rules. One call between cases.
async fn reset(AxumState(s): AxumState<Arc<StubOctaweave>>) -> impl IntoResponse {
    s.harness.reset();
    s.account.reset();
    Json(json!({ "ok": true }))
}

async fn requests(AxumState(s): AxumState<Arc<StubOctaweave>>) -> impl IntoResponse {
    Json(json!(s.harness.seen()))
}

/// The account behaves normally unless a rule says otherwise, and the rule is
/// checked first — so "this key cannot be revoked" is one line in a test rather
/// than a second fake.
async fn serve(AxumState(s): AxumState<Arc<StubOctaweave>>, req: Request) -> impl IntoResponse {
    let method = req.method().as_str().to_string();
    let path = req.uri().path().to_string();
    s.harness.record(Seen {
        method: method.clone(),
        path: path.clone(),
        authorized: req
            .headers()
            .contains_key(axum::http::header::AUTHORIZATION),
    });

    if let Some(rule) = s.harness.take(&method, &path) {
        let status =
            axum::http::StatusCode::from_u16(rule.status).unwrap_or(axum::http::StatusCode::OK);
        let body = rule.body.unwrap_or_else(|| {
            if status.is_success() {
                Value::Null
            } else {
                json!({ "error": format!("fake Octaweave was told to answer {status}") })
            }
        });
        return (status, Json(body));
    }

    account_answer(&s, &method, &path)
}

fn account_answer(
    s: &StubOctaweave,
    method: &str,
    path: &str,
) -> (axum::http::StatusCode, Json<Value>) {
    let ok = axum::http::StatusCode::OK;
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();

    match (method, parts.as_slice()) {
        // The link check. A 401 here is the whole `needs_link` fork, so it is
        // account state rather than something a test has to remember to program.
        ("GET", ["api", "v1", "workspaces"]) => {
            if !*s.account.linked.lock() {
                return (
                    axum::http::StatusCode::UNAUTHORIZED,
                    Json(json!({ "error": "not linked" })),
                );
            }
            (ok, Json(json!({ "items": *s.account.workspaces.lock() })))
        }

        ("GET", ["api", "v1", "w", ws, "keys"]) => {
            let items: Vec<Value> = s
                .account
                .keys
                .lock()
                .iter()
                .filter(|(w, _)| w == ws)
                .map(|(_, k)| k.clone())
                .collect();
            (ok, Json(json!({ "items": items })))
        }

        ("POST", ["api", "v1", "w", ws, "keys"]) => {
            // Real tokens in shape if not in provenance: the app checks the
            // prefix nowhere, but a fake that answers `"token"` teaches nothing
            // about what a real one looks like in a log.
            let n = s.account.minted.fetch_add(1, Ordering::Relaxed) + 1;
            let id = format!("key_{n}");
            let token = format!("owk_stub_{n}");
            s.account.keys.lock().push((
                ws.to_string(),
                json!({ "id": id, "name": front_cloud::octaweave::KEY_LABEL, "status": "active" }),
            ));
            (
                ok,
                Json(json!({
                    "id": id,
                    "token": token,
                    "scopes": front_cloud::octaweave::AGENT_SCOPES,
                })),
            )
        }

        ("DELETE", ["api", "v1", "w", ws, "keys", id]) => {
            let mut keys = s.account.keys.lock();
            match keys.iter_mut().find(|(w, k)| w == ws && k["id"] == *id) {
                Some((_, k)) => {
                    k["status"] = json!("revoked");
                    (ok, Json(json!({ "ok": true })))
                }
                // Already gone is the state we wanted, and the client agrees.
                None => (
                    axum::http::StatusCode::NOT_FOUND,
                    Json(json!({ "error": "no such key" })),
                ),
            }
        }

        // Proving a minted key. Any `owk_` this fake issued is real to it.
        ("GET", ["api", "v1", "whoami"]) => (
            ok,
            Json(json!({ "workspace_id": "ws_1", "scopes": Value::Null })),
        ),

        _ => (
            axum::http::StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("fake Octaweave has no answer for {method} {path}") })),
        ),
    }
}
