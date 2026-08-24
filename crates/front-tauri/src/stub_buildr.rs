//! A buildr.space that can be told to refuse, so the connect flow's failures can
//! be *arranged* rather than waited for.
//!
//! Sibling to [`crate::stub_octaweave`], and here for the same sharp reason: this
//! flow **mints and revokes a credential**, and the interesting failures are the
//! ones that leave something live behind —
//!
//! - a key is minted, fails `whoami`, and the revoke meant to clean it up *also*
//!   fails: a working credential in someone's account that no part of this app
//!   holds, and nothing on screen would ever mention it
//! - a disconnect that drops the pod's copy while the revoke never happens
//!
//! Neither is reachable against the real buildr.space without deliberately
//! breaking an account.
//!
//! It has one thing the Octaweave fake does not: it reads the bearer. The
//! connect calls `whoami` twice with two *different* credentials — the person's
//! `mck_` to find out whether the account is linked, then the `bsk_` it just
//! minted to prove it — and a fake that answered both the same way could not
//! tell a revoked key from a live one, which is the assertion half these tests
//! turn on.
//!
//! [`buildr_base`] already reads `BUILDR_URL`, so pointing the client here needs
//! no seam of our own.
//!
//! ```sh
//! MC_STUB_BUILDR=1996 cargo run -p front-tauri --features dev-rpc --bin dev_core
//! BUILDR_URL=http://127.0.0.1:1996 ./run.sh      # the app, against the fake
//!
//! # the next revoke fails, so a bad mint cannot be cleaned up
//! curl -sX POST localhost:1996/__harness/route \
//!   -d '{"method":"DELETE","path":"/api/v1/account/tokens/key_1","status":500}'
//! ```
//!
//! Same two gates as everything else in here: the `dev-rpc` feature, and
//! `MC_STUB_BUILDR=<port>`. It binds to 127.0.0.1 and hands `bsk_` tokens to
//! anyone who asks, which is fine for a fake and would be a catastrophe for
//! anything else.
//!
//! [`buildr_base`]: front_cloud::buildr_base

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::extract::{Request, State as AxumState};
use axum::response::IntoResponse;
use axum::routing::{any, get, post};
use axum::{Json, Router};
use parking_lot::Mutex;
use serde_json::{Value, json};

use crate::stub_pod::{Harness, Rule, Seen};

/// Which of buildr.space's two link refusals an unlinked account is given.
///
/// Two, not one, and they are different states rather than rewordings
/// (`hub_token::resolve` there). Both are fixed by the same browser trip, so
/// the app has to read both as the fork — which is exactly what it did not do.
///
/// [`Self::NeverLinked`] is set only from tests, like the rest of the Rust-side
/// harness — the binaries serve this fake, they do not arrange it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[allow(dead_code)]
pub enum Unlinked {
    /// buildr.space has no link row for this account, and says so with the
    /// `not_linked` code beside it.
    NeverLinked,
    /// The hub answered `link_active: false`, so buildr.space deleted its own
    /// row and refuses with different prose — and, on the deployment, with no
    /// code at all (its `ApiError` carries only a message).
    ///
    /// The default, because it is the commoner state by far and the one nobody
    /// designed for: the hub reports a *missing* `linked_apps` row exactly as
    /// it reports a revoked one (`metalcraft-id: controllers/verify.rs`), so an
    /// account connecting for the very first time lands here, not on
    /// [`Self::NeverLinked`].
    #[default]
    DisconnectedAtHub,
}

/// The account this fake belongs to, and whether it has been linked at all.
///
/// `linked: false` is not a rule about one endpoint — it is the state where
/// `whoami` answers 401 and the app is supposed to open a browser, which is the
/// first fork in the whole flow. [`Unlinked`] picks which refusal it does that
/// with.
pub struct Account {
    pub linked: Mutex<bool>,
    /// How an unlinked account is refused. Ignored while `linked`.
    pub unlinked_as: Mutex<Unlinked>,
    pub sub: Mutex<String>,
    pub email: Mutex<String>,
    /// Keys that currently exist, live or revoked.
    pub keys: Mutex<Vec<Value>>,
    minted: AtomicUsize,
}

impl Default for Account {
    fn default() -> Self {
        Self {
            linked: Mutex::new(true),
            unlinked_as: Mutex::new(Unlinked::default()),
            sub: Mutex::new("usr_1".into()),
            email: Mutex::new("dev@example.com".into()),
            keys: Mutex::new(Vec::new()),
            minted: AtomicUsize::new(0),
        }
    }
}

impl Account {
    /// Back to a linked account with no keys.
    ///
    /// The mint counter goes with it, which is the whole point: a test that
    /// programs `/account/tokens/key_1` to fail needs the *next* minted key to
    /// be `key_1`. Leaving the counter running makes the id depend on how many
    /// tests ran first, and a rule that silently stops matching turns into a
    /// test that passes for the wrong reason.
    pub fn reset(&self) {
        let fresh = Account::default();
        *self.linked.lock() = *fresh.linked.lock();
        *self.unlinked_as.lock() = *fresh.unlinked_as.lock();
        *self.sub.lock() = fresh.sub.lock().clone();
        *self.email.lock() = fresh.email.lock().clone();
        self.keys.lock().clear();
        self.minted.store(0, Ordering::Relaxed);
    }
}

pub struct StubBuildr {
    /// Programmed overrides, shared with the pod stub's matcher — the rules mean
    /// the same thing here, so they are the same type.
    pub harness: Arc<Harness>,
    pub account: Arc<Account>,
}

/// The Rust-facing half of the control surface, mirroring the HTTP one. Unused
/// by the binaries, which only serve it — these are for tests that drive a fake
/// directly, and a harness narrower than its users is no harness.
#[allow(dead_code)]
impl StubBuildr {
    /// Keys buildr.space still holds. The assertion that matters after a
    /// disconnect: an empty list means nothing was left live.
    pub fn live_keys(&self) -> Vec<Value> {
        self.account
            .keys
            .lock()
            .iter()
            .filter(|k| k["status"] == "active")
            .cloned()
            .collect()
    }

    pub fn seen(&self) -> Vec<Seen> {
        self.harness.seen()
    }

    pub fn program(&self, rule: Rule) {
        self.harness.program(rule);
    }

    /// Revoke every key, the way someone would from buildr.space's own Keys
    /// page — behind the app's back, with the pod still holding the string.
    ///
    /// This is the state the health check exists for and the one the app cannot
    /// reach through its own API: `disconnect` revokes *and* clears the pod, so
    /// it can never leave the two disagreeing.
    pub fn revoke_everything(&self) {
        for k in self.account.keys.lock().iter_mut() {
            k["status"] = json!("revoked");
        }
    }

    /// Give every live key an expiry, RFC3339 — a date this fake would never
    /// invent on its own, because the app always mints without one.
    pub fn expire_keys_at(&self, at: &str) {
        for k in self.account.keys.lock().iter_mut() {
            if k["status"] == "active" {
                k["expires_at"] = json!(at);
            }
        }
    }
}

/// Start the fake if `MC_STUB_BUILDR` names a port.
pub fn spawn() {
    let Ok(port) = std::env::var("MC_STUB_BUILDR") else {
        return;
    };
    if port.trim().is_empty() {
        return;
    }
    let Ok(port) = port.trim().parse::<u16>() else {
        log::warn!("MC_STUB_BUILDR is not a port number; not starting the fake");
        return;
    };
    tokio::spawn(async move {
        match start(port).await {
            Ok((addr, _)) => {
                log::warn!("fake buildr.space on http://{addr} — set BUILDR_URL to it; dev only");
                std::future::pending::<()>().await;
            }
            Err(e) => log::warn!("fake buildr.space could not bind {port}: {e}"),
        }
    });
}

/// Bind, serve, and hand back where it landed and the handle to program it.
/// Port 0 gives an ephemeral port, which is what a test wants.
pub async fn start(port: u16) -> std::io::Result<(std::net::SocketAddr, Arc<StubBuildr>)> {
    let stub = Arc::new(StubBuildr {
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
    AxumState(s): AxumState<Arc<StubBuildr>>,
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

/// Back to a linked account with no keys — and, critically, no programmed rules.
/// One call between cases.
async fn reset(AxumState(s): AxumState<Arc<StubBuildr>>) -> impl IntoResponse {
    s.harness.reset();
    s.account.reset();
    Json(json!({ "ok": true }))
}

async fn requests(AxumState(s): AxumState<Arc<StubBuildr>>) -> impl IntoResponse {
    Json(json!(s.harness.seen()))
}

/// The account behaves normally unless a rule says otherwise, and the rule is
/// checked first — so "this key cannot be revoked" is one line in a test rather
/// than a second fake.
async fn serve(AxumState(s): AxumState<Arc<StubBuildr>>, req: Request) -> impl IntoResponse {
    let method = req.method().as_str().to_string();
    let path = req.uri().path().to_string();
    let bearer = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.trim().to_string());
    s.harness.record(Seen {
        method: method.clone(),
        path: path.clone(),
        authorized: bearer.is_some(),
    });

    if let Some(rule) = s.harness.take(&method, &path) {
        let status =
            axum::http::StatusCode::from_u16(rule.status).unwrap_or(axum::http::StatusCode::OK);
        let body = rule.body.unwrap_or_else(|| {
            if status.is_success() {
                Value::Null
            } else {
                json!({ "error": format!("fake buildr.space was told to answer {status}") })
            }
        });
        return (status, Json(body));
    }

    account_answer(&s, &method, &path, bearer.as_deref())
}

/// Whether a bearer resolves, and to what. The real thing has three credentials;
/// this fake needs the two the app presents.
enum Caller {
    /// An `mck_` for a linked account — the person.
    Person,
    /// A `bsk_` this fake minted and has not revoked.
    Key,
    /// A token that resolves to nothing. `link` is `Some` when a browser trip
    /// is what fixes it, and names which refusal says so.
    Nobody { link: Option<Unlinked> },
}

fn caller(s: &StubBuildr, bearer: Option<&str>) -> Caller {
    match bearer {
        Some(t) if t.starts_with("mck_") => {
            if *s.account.linked.lock() {
                Caller::Person
            } else {
                Caller::Nobody {
                    link: Some(*s.account.unlinked_as.lock()),
                }
            }
        }
        Some(t) if t.starts_with("bsk_") => {
            let live = s
                .account
                .keys
                .lock()
                .iter()
                .any(|k| k["token"] == *t && k["status"] == "active");
            if live {
                Caller::Key
            } else {
                Caller::Nobody { link: None }
            }
        }
        _ => Caller::Nobody { link: None },
    }
}

/// All three refusals verbatim from buildr.space's `hub_token::resolve` — the
/// two the app must read as a browser trip, and the one it must not.
fn unauthorized(link: Option<Unlinked>) -> (axum::http::StatusCode, Json<Value>) {
    let body = match link {
        Some(Unlinked::NeverLinked) => json!({
            "error": "that Metalcraft account is not linked to a buildr.space account — visit /link/metalcraft",
            "code": "not_linked",
        }),
        // No `code`: the deployment's `ApiError` has no such field, so this one
        // can only be recognised by its prose. That is the whole trap.
        Some(Unlinked::DisconnectedAtHub) => json!({
            "error": "this Metalcraft account is no longer connected to buildr.space",
        }),
        None => json!({ "error": "invalid bearer token" }),
    };
    (axum::http::StatusCode::UNAUTHORIZED, Json(body))
}

fn account_answer(
    s: &StubBuildr,
    method: &str,
    path: &str,
    bearer: Option<&str>,
) -> (axum::http::StatusCode, Json<Value>) {
    let ok = axum::http::StatusCode::OK;
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    let who = caller(s, bearer);

    match (method, parts.as_slice()) {
        // The link check *and* the proof of a minted key, which is why it
        // answers for both credentials and refuses for neither by accident.
        ("GET", ["api", "v1", "whoami"]) => match who {
            Caller::Nobody { link } => unauthorized(link),
            Caller::Person | Caller::Key => (
                ok,
                Json(json!({
                    "sub": *s.account.sub.lock(),
                    "email": *s.account.email.lock(),
                    "scopes": ["read", "write"],
                    "is_admin": false,
                })),
            ),
        },

        // Key management is the person's, never a key's — the rule that made
        // this whole flow impossible until buildr.space told the two apart.
        ("GET", ["api", "v1", "account", "tokens"]) => match who {
            Caller::Person => {
                let items: Vec<Value> = s
                    .account
                    .keys
                    .lock()
                    .iter()
                    .filter(|k| k["status"] == "active")
                    .map(|k| {
                        json!({
                            "id": k["id"],
                            "name": k["name"],
                            "prefix": k["prefix"],
                            // Listed even once it is in the past: "revoked" and
                            // "expired" are different answers, and a listing
                            // that dropped the second would collapse them.
                            "expires_at": k["expires_at"],
                        })
                    })
                    .collect();
                (ok, Json(json!(items)))
            }
            Caller::Key => (
                axum::http::StatusCode::FORBIDDEN,
                Json(json!({ "error": "an API key may not mint another" })),
            ),
            Caller::Nobody { link } => unauthorized(link),
        },

        ("POST", ["api", "v1", "account", "tokens"]) => match who {
            Caller::Person => {
                // Real tokens in shape if not in provenance: a fake that answers
                // `"token"` teaches nothing about what a real one looks like in
                // a log.
                let n = s.account.minted.fetch_add(1, Ordering::Relaxed) + 1;
                let id = format!("key_{n}");
                let token = format!("bsk_stub_{n}");
                s.account.keys.lock().push(json!({
                    "id": id,
                    "name": front_cloud::buildr::KEY_LABEL,
                    "prefix": format!("bsk_stub_{n}"),
                    "token": token,
                    "status": "active",
                    // The app asks for `ttl_days: 0`, and this fake honours it
                    // rather than inventing a date the real one would not.
                    "expires_at": Value::Null,
                }));
                (
                    ok,
                    Json(json!({
                        "id": id,
                        "token": token,
                        "prefix": format!("bsk_stub_{n}"),
                        "scopes": ["read", "write"],
                        "expires_at": Value::Null,
                    })),
                )
            }
            Caller::Key => (
                axum::http::StatusCode::FORBIDDEN,
                Json(json!({ "error": "an API key may not mint another" })),
            ),
            Caller::Nobody { link } => unauthorized(link),
        },

        ("DELETE", ["api", "v1", "account", "tokens", id]) => match who {
            Caller::Person => {
                let mut keys = s.account.keys.lock();
                match keys
                    .iter_mut()
                    .find(|k| k["id"] == *id && k["status"] == "active")
                {
                    Some(k) => {
                        k["status"] = json!("revoked");
                        (ok, Json(json!({ "ok": true })))
                    }
                    // Already gone is the state we wanted, and the client agrees.
                    None => (
                        axum::http::StatusCode::NOT_FOUND,
                        Json(json!({ "error": "no such API key" })),
                    ),
                }
            }
            Caller::Key => (
                axum::http::StatusCode::FORBIDDEN,
                Json(json!({ "error": "an API key may not mint another" })),
            ),
            Caller::Nobody { link } => unauthorized(link),
        },

        _ => (
            axum::http::StatusCode::NOT_FOUND,
            Json(
                json!({ "error": format!("fake buildr.space has no answer for {method} {path}") }),
            ),
        ),
    }
}
