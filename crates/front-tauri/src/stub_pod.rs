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
use axum::http::StatusCode;
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
    /// How many matching calls go past *before* this rule starts firing.
    ///
    /// For a flow that hits one endpoint more than once with different meanings:
    /// the buildr.space connect asks `whoami` twice — once to see whether the
    /// account is linked, then again to prove the key it just minted — and only
    /// the second one is interesting to break. Without this, programming that
    /// path fails the link check instead and the test never reaches the case it
    /// was written for.
    #[serde(default)]
    pub after: Option<usize>,
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
            after: None,
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
            after: None,
        }
    }

    /// Answer with this body — for a *failure* that carries one, where the body
    /// is the thing under test. buildr.space puts a machine-readable code beside
    /// its 401s, and which of the two 401s it is decides whether the app opens a
    /// browser or reports an error.
    pub fn body(mut self, body: Value) -> Self {
        self.body = Some(body);
        self
    }

    /// Retire after `n` uses — "this call fails", not "this endpoint is broken".
    pub fn times(mut self, n: usize) -> Self {
        self.times = Some(n);
        self
    }

    /// Let `n` matching calls through untouched first. See [`Rule::after`].
    pub fn after(mut self, n: usize) -> Self {
        self.after = Some(n);
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
    /// The gateway connection, as this pod would report it.
    ///
    /// Stateful for the same reason the key store is: registering a number and
    /// then reading the status has to agree with itself. The one transition a
    /// fake cannot perform is *verification* — that happens when a human texts a
    /// code from a real phone — so it stays false here and a test that needs the
    /// verified pod programs the status route, which is what the harness is for.
    gateway: Mutex<GatewayState>,
}

/// The stub's gateway state. Mirrors `metalcraft-agent`'s `GatewayStatus`, minus
/// the fields a fake has no way to have an opinion about.
#[derive(Debug, Clone, Default)]
struct GatewayState {
    registered: bool,
    verified: bool,
    connected: bool,
    number: Option<String>,
}

/// The number this fake gateway hands out, and the code it asks for.
const STUB_GATEWAY_NUMBER: &str = "+15550199";
const STUB_VERIFY_CODE: &str = "424242";

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
        *self.gateway.lock() = GatewayState::default();
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
        // Armed but not yet firing: count this call off and let the stub answer
        // it normally.
        if let Some(n) = rules[at].after.as_mut()
            && *n > 0
        {
            *n -= 1;
            return None;
        }
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
///
/// Carries a status as well as a body because one default answer is a *refusal*:
/// the pod 409s a gateway connect until the number is verified, and a fake that
/// could only ever say 200 or 404 would leave the one gate on this surface
/// untestable.
///
/// The library is the documented exception to "empty" — see [`library_answer`]
/// for why a read-only surface cannot start with nothing in it.
fn default_answer(h: &Harness, method: &str, path: &str) -> Option<(StatusCode, Value)> {
    // The stateful half first: writing a key and then reading the key store has
    // to agree with itself, or every test built on it proves nothing.
    if let Some(name) = path.strip_prefix("/api/v1/keys/") {
        match method {
            "PUT" => {
                let mut keys = h.keys.lock();
                if !keys.iter().any(|k| k == name) {
                    keys.push(name.to_string());
                }
                return Some((StatusCode::OK, Value::Null));
            }
            "DELETE" => {
                h.keys.lock().retain(|k| k != name);
                return Some((StatusCode::OK, Value::Null));
            }
            _ => return None,
        }
    }
    if (method, path) == ("POST", "/api/v1/integrations/install") {
        h.installed.lock().push(PACK_ID.to_string());
        return Some((
            StatusCode::OK,
            json!({ "id": PACK_ID, "enabled": true, "api_tools": 32 }),
        ));
    }
    if path.starts_with("/api/v1/gateway/metalcraft/") {
        let mut gw = h.gateway.lock();
        return match (
            method,
            path.trim_start_matches("/api/v1/gateway/metalcraft/"),
        ) {
            ("GET", "status") => Some((
                StatusCode::OK,
                json!({
                    "configured": true,
                    "registered": gw.registered,
                    "verified": gw.verified,
                    "connected": gw.connected,
                    "streaming": gw.connected,
                    "active_number": gw.registered.then(|| STUB_GATEWAY_NUMBER.to_string()),
                    "channel": gw.registered.then(|| "whatsapp".to_string()),
                    "has_public_url": true,
                    "webhook_stale": false,
                    "error": Value::Null,
                }),
            )),
            ("POST", "register") => {
                gw.registered = true;
                gw.verified = false;
                gw.number = Some("+15550100".into());
                Some((
                    StatusCode::OK,
                    json!({
                        "personal_number": gw.number,
                        "active_number": STUB_GATEWAY_NUMBER,
                        "channel": "whatsapp",
                        "verified": false,
                        "verify_code": STUB_VERIFY_CODE,
                    }),
                ))
            }
            // The real pod 409s here until the number is verified, and that
            // refusal is the whole reason the button is gated — so the fake
            // refuses too rather than being politely permissive.
            ("POST", "connect") if !gw.verified => Some((
                StatusCode::CONFLICT,
                json!({ "error": "Register and verify your phone number before connecting" }),
            )),
            ("POST", "connect") => {
                gw.connected = true;
                Some((
                    StatusCode::OK,
                    json!({
                        "connected": true,
                        "active_number": STUB_GATEWAY_NUMBER,
                        "integration_id": "int_stub",
                        "channel": "whatsapp",
                    }),
                ))
            }
            ("POST", "disconnect") => {
                gw.connected = false;
                Some((StatusCode::OK, json!({ "connected": false })))
            }
            // Unregister takes the registration with it — that is the whole
            // difference from disconnect, and a fake that forgot it would let a
            // test "leave" and still be registered.
            ("POST", "unregister") => {
                *gw = GatewayState::default();
                Some((StatusCode::OK, json!({ "unregistered": true })))
            }
            _ => None,
        };
    }
    if (method, path) == ("GET", "/api/v1/keys") {
        return Some((
            StatusCode::OK,
            json!(
                h.keys
                    .lock()
                    .iter()
                    .map(|name| json!({ "name": name, "masked": "…1234" }))
                    .collect::<Vec<_>>()
            ),
        ));
    }
    if (method, path) == ("GET", "/api/v1/integrations") {
        return Some((
            StatusCode::OK,
            json!(
                h.installed
                    .lock()
                    .iter()
                    .map(|id| json!({
                        "id": id, "name": id, "version": "1.0.0",
                        "enabled": true, "api_tools": 32
                    }))
                    .collect::<Vec<_>>()
            ),
        ));
    }

    // The registry browser's routes live under `/agent-packs/` too, and they are
    // the pod's own rather than the library's — so they are answered here,
    // before the library gets a chance to read the id as a pack name.
    if path.starts_with("/api/v1/agent-packs/registries") {
        return (method == "GET").then(|| (StatusCode::OK, json!({ "registries": [] })));
    }
    // One integration's contents, for the library's show page. Derived from what
    // has been installed, like the list beside it: an id nobody installed is a
    // 404 here exactly as it would be on a real pod.
    if let Some(id) = path.strip_prefix("/api/v1/integrations/")
        && method == "GET"
        && h.installed.lock().iter().any(|i| i == id)
    {
        return Some((
            StatusCode::OK,
            json!({
                "id": id, "name": id, "description": "Notes, board, drive and calendar.",
                "version": "1.0.0", "enabled": true,
                "personas": [], "skills": [],
                "api_tools": ["octaweave_create_note", "octaweave_list_notes"],
                "flow_templates": [], "requires_env": ["OCTAWEAVE_API_KEY"],
            }),
        ));
    }
    if let Some(answer) = library_answer(method, path) {
        return Some(answer);
    }

    let body = match (method, path) {
        ("GET", "/api/v1/info") => json!({ "name": "stub-pod", "version": "0.31.0" }),
        ("GET", "/api/v1/inference") => {
            json!({ "ready": true, "credential": "environment", "gateway": true })
        }
        ("GET", "/api/v1/agents/instances") => json!({ "instances": [] }),
        ("GET", "/api/v1/chats") => json!([]),
        ("GET", "/api/v1/flows") => json!({ "flows": [] }),
        ("GET", "/api/v1/flow-runs") => json!([]),
        _ => return None,
    };
    Some((StatusCode::OK, body))
}

/// The library's half of the fake pod — and the one place this stub is not
/// empty by default.
///
/// The exception is deliberate and narrow. Every other surface can be filled in
/// through the app: spawn an agent and the fleet has one, save a key and the key
/// store has one, install a pack and `/integrations` answers. **The library is
/// read-only** — nothing in this app writes a persona or a skill — so a stub
/// that started empty would leave the whole surface undrivable, with no show
/// page reachable and no sub-link to follow.
///
/// So it holds one small graph rather than a scatter of rows, because what the
/// library renders is the *edges*: a pack provides a preset, the preset names
/// personas and skills, a persona grants an integration, the integration
/// provides the api tools. One of the preset's personas (`amy-sommelier`) is
/// deliberately absent from the pod, so the roster's `installed: false` branch
/// is on screen by default instead of waiting for a broken pod to turn up.
///
/// `/integrations` is *not* seeded here — it stays derived from what has been
/// installed. That leaves the default pod in a state worth being able to look
/// at: a preset asking for an integration this pod does not have, which
/// `POST /integrations/install` then resolves.
fn library_answer(method: &str, path: &str) -> Option<(StatusCode, Value)> {
    if method != "GET" {
        return None;
    }

    // Detail routes first: `/agent-presets/amy` must not be answered by the
    // list arm for `/agent-presets`.
    if let Some(slug) = path.strip_prefix("/api/v1/agent-presets/") {
        return preset_detail(slug).map(|b| (StatusCode::OK, b));
    }
    if let Some(slug) = path.strip_prefix("/api/v1/personas/") {
        return persona_detail(slug).map(|b| (StatusCode::OK, b));
    }
    if let Some(slug) = path.strip_prefix("/api/v1/skills/") {
        return skill_detail(slug).map(|b| (StatusCode::OK, b));
    }
    if let Some(name) = path.strip_prefix("/api/v1/api-tools/") {
        return api_tool_detail(name).map(|b| (StatusCode::OK, b));
    }
    if let Some(slug) = path.strip_prefix("/api/v1/flow-templates/") {
        return (slug == "weekly-menu").then(|| {
            (
                StatusCode::OK,
                json!({
                    "slug": "weekly-menu",
                    "name": "Plan next week's menu",
                    "pack_id": AGENT_PACK,
                    "flow": {
                        "id": "weekly-menu",
                        "nodes": [
                            { "id": "read-pantry", "type": "tool", "tool": "octaweave_list_notes" },
                            { "id": "draft", "type": "prompt", "persona": "amy-host" },
                            { "id": "save", "type": "tool", "tool": "octaweave_create_note" },
                        ],
                    },
                }),
            )
        });
    }
    if let Some(id) = path.strip_prefix("/api/v1/agent-packs/") {
        // `/agent-packs/registries…` belongs to the registry browser, not here.
        if id == AGENT_PACK {
            return Some((StatusCode::OK, agent_pack_manifest()));
        }
        return None;
    }

    let body = match path {
        "/api/v1/snapshot" => json!({
            "agent_presets": preset_summaries(),
            "personas": persona_summaries(),
            "skills": skill_summaries(),
            "api_tools": api_tool_summaries(),
            "agent_instances": [],
            "flows": [],
            "sessions": [],
            "keys": [],
            "default_agent_preset": "default",
            "layout": { "data_dir": "/data" },
        }),
        "/api/v1/agent-presets" => json!({ "presets": preset_summaries() }),
        "/api/v1/api-tools" => api_tool_summaries(),
        "/api/v1/flow-templates" => json!([
            { "slug": "weekly-menu", "name": "Plan next week's menu", "pack_id": AGENT_PACK },
        ]),
        "/api/v1/agent-packs" => json!({ "agent_packs": [agent_pack_manifest()] }),
        _ => return None,
    };
    Some((StatusCode::OK, body))
}

/// The seeded pack. Everything below that carries a `pack_id` carries this one,
/// so the library's "provided by" links all land somewhere real.
const AGENT_PACK: &str = "amy_kitchen";

fn agent_pack_manifest() -> Value {
    json!({
        "id": AGENT_PACK,
        "name": "Amy's Kitchen",
        "version": "1.2.0",
        "description": "A cook who remembers every flavour you have ever liked.",
        "presets": ["amy"],
        "provides": {
            "personas": ["amy-host", "amy-baker"],
            "skills": ["plan-a-menu", "scale-a-recipe"],
        },
    })
}

fn preset_summaries() -> Value {
    json!([
        {
            "slug": "amy",
            "name": "Amy",
            "description": "Plans meals, scales recipes, and keeps the pantry honest.",
            "tagline": "Knows every flavour you have ever made.",
            "pack_id": AGENT_PACK,
            "default_persona": "amy-host",
            "persona_count": 3,
            "read_only": true,
        },
        {
            "slug": "default",
            "name": "Default",
            "description": "The agent this pod is when nobody said otherwise.",
            "default_persona": "default",
            "persona_count": 1,
            "read_only": false,
        },
    ])
}

fn persona_summaries() -> Value {
    json!([
        {
            "slug": "amy-host",
            "name": "Amy — host",
            "description": "Warm, fast, and opinionated about seasoning.",
            "pack_id": AGENT_PACK,
            "read_only": true,
        },
        {
            "slug": "amy-baker",
            "name": "Amy — baker",
            "description": "Precise. Weighs everything. Will not be rushed.",
            "pack_id": AGENT_PACK,
            "read_only": true,
        },
        {
            "slug": "default",
            "name": "Default",
            "description": "The pod's own voice.",
            "read_only": false,
        },
    ])
}

fn skill_summaries() -> Value {
    json!([
        {
            "slug": "plan-a-menu",
            "description": "Build a menu from what is in the pantry and who is coming.",
            "pack_id": AGENT_PACK,
            "read_only": true,
        },
        {
            "slug": "scale-a-recipe",
            "description": "Rescale a recipe by servings without breaking the ratios.",
            "pack_id": AGENT_PACK,
            "read_only": true,
        },
        {
            "slug": "remember-preferences",
            "description": "Write down what someone liked, so the next menu knows.",
            "read_only": false,
        },
    ])
}

fn api_tool_summaries() -> Value {
    json!([
        {
            "name": "octaweave_create_note",
            "description": "Write a note into the connected Octaweave workspace.",
            "pack_id": "octaweave",
            "read_only": true,
        },
        {
            "name": "octaweave_list_notes",
            "description": "List notes in the connected Octaweave workspace.",
            "pack_id": "octaweave",
            "read_only": true,
        },
    ])
}

fn preset_detail(slug: &str) -> Option<Value> {
    match slug {
        "amy" => Some(json!({
            "preset": {
                "slug": "amy",
                "name": "Amy",
                "tagline": "Knows every flavour you have ever made.",
                "description": "Plans meals, scales recipes, and keeps the pantry honest.",
                "version": "1.2.0",
                "default_persona": "amy-host",
                "personas": [
                    { "slug": "amy-host", "role": "primary", "description": "The everyday voice." },
                    { "slug": "amy-baker", "role": "specialist", "description": "For anything weighed." },
                    { "slug": "amy-sommelier", "role": "specialist", "description": "Pairs the wine." },
                ],
                "skills": ["plan-a-menu", "scale-a-recipe"],
                "integrations": ["octaweave"],
                "requires_env": ["OCTAWEAVE_API_KEY"],
                "model": { "tier": "reasoning", "prefer": "gpt-5.4", "min_context": 128000, "needs": ["tools"] },
                "memories": { "file": "memories.jsonl", "count": 412, "dims": 1536, "embed_model": "text-embedding-3-small" },
                "manifest_version": 2,
            },
            // The third persona is not on this pod, and says so rather than
            // being quietly dropped — see `RosterPersona`.
            "personas": [
                {
                    "slug": "amy-host", "installed": true, "name": "Amy — host",
                    "description": "Warm, fast, and opinionated about seasoning.",
                    "tools": ["load_skill", "remember"], "skills": ["plan-a-menu"],
                },
                {
                    "slug": "amy-baker", "installed": true, "name": "Amy — baker",
                    "description": "Precise. Weighs everything. Will not be rushed.",
                    "tools": ["load_skill"], "skills": ["scale-a-recipe"],
                },
                {
                    "slug": "amy-sommelier", "installed": false, "name": "amy-sommelier",
                    "error": "persona 'amy-sommelier' is not installed on this pod",
                },
            ],
        })),
        "default" => Some(json!({
            "preset": {
                "slug": "default",
                "name": "Default",
                "description": "The agent this pod is when nobody said otherwise.",
                "default_persona": "default",
                "personas": [{ "slug": "default" }],
                "manifest_version": 2,
            },
            "personas": [{
                "slug": "default", "installed": true, "name": "Default",
                "description": "The pod's own voice.", "tools": ["load_skill"], "skills": [],
            }],
        })),
        _ => None,
    }
}

fn persona_detail(slug: &str) -> Option<Value> {
    match slug {
        "amy-host" => Some(json!({
            "name": "Amy — host",
            "description": "Warm, fast, and opinionated about seasoning.",
            "tools": ["load_skill", "remember"],
            "skills": ["plan-a-menu", "remember-preferences"],
            "integrations": ["octaweave"],
            "system_prompt": "You are Amy. You cook for people you like.\n\nAsk what is in the fridge before you suggest anything.",
            "version": "1.1.0",
        })),
        "amy-baker" => Some(json!({
            "name": "Amy — baker",
            "description": "Precise. Weighs everything. Will not be rushed.",
            "tools": ["load_skill"],
            "skills": ["scale-a-recipe"],
            "system_prompt": "You are Amy, baking. Grams, never cups.",
        })),
        "default" => Some(json!({
            "name": "Default",
            "description": "The pod's own voice.",
            "tools": ["load_skill"],
            "system_prompt": "You are a helpful agent running on this pod.",
        })),
        _ => None,
    }
}

fn skill_detail(slug: &str) -> Option<Value> {
    let (description, body, pack) = match slug {
        "plan-a-menu" => (
            "Build a menu from what is in the pantry and who is coming.",
            "# Plan a menu\n\n1. Ask who is eating and what they will not eat.\n2. Read the pantry before proposing anything.\n3. Propose three courses, then stop and wait.\n",
            Some(AGENT_PACK),
        ),
        "scale-a-recipe" => (
            "Rescale a recipe by servings without breaking the ratios.",
            "# Scale a recipe\n\nScale by weight, never by volume. Leavening does not scale linearly — hold it at 80% above 2×.\n",
            Some(AGENT_PACK),
        ),
        "remember-preferences" => (
            "Write down what someone liked, so the next menu knows.",
            "# Remember preferences\n\nAfter a meal, record what was eaten and what was left. One memory per person.\n",
            None,
        ),
        _ => return None,
    };
    Some(json!({
        "slug": slug,
        "description": description,
        "body": body,
        "pack_id": pack,
        "read_only": pack.is_some(),
    }))
}

fn api_tool_detail(name: &str) -> Option<Value> {
    match name {
        "octaweave_create_note" => Some(json!({
            "name": "octaweave_create_note",
            "description": "Write a note into the connected Octaweave workspace.",
            "method": "POST",
            "url": "https://octaweave.com/api/v1/notes",
            "headers": { "Authorization": "Bearer ${OCTAWEAVE_API_KEY}" },
            "body_mapping": "params",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "The note's title." },
                    "body": { "type": "string", "description": "Markdown body." },
                },
                "required": ["title"],
            },
        })),
        "octaweave_list_notes" => Some(json!({
            "name": "octaweave_list_notes",
            "description": "List notes in the connected Octaweave workspace.",
            "method": "GET",
            "url": "https://octaweave.com/api/v1/notes",
            "headers": { "Authorization": "Bearer ${OCTAWEAVE_API_KEY}" },
            "parameters": { "type": "object", "properties": {} },
        })),
        _ => None,
    }
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
        Some((status, body)) => (status, Json(body)),
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
            after: None,
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
            after: None,
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
                after: None,
            });
        }
        assert_eq!(
            h.take("GET", "/api/v1/integrations").map(|r| r.status),
            Some(200)
        );
    }

    /// `after` is what makes a rule aimed at the *second* call to an endpoint
    /// possible. Without it, programming `whoami` breaks the buildr.space link
    /// check and the test never reaches the mint it was written for.
    #[test]
    fn an_armed_rule_lets_the_first_calls_past_before_it_fires() {
        let h = Harness::default();
        h.program(Rule::fail("/api/v1/whoami", 401).after(1));
        assert!(
            h.take("GET", "/api/v1/whoami").is_none(),
            "the first goes by"
        );
        assert_eq!(h.take("GET", "/api/v1/whoami").map(|r| r.status), Some(401));
        // And it keeps firing after that, like any other rule without `times`.
        assert_eq!(h.take("GET", "/api/v1/whoami").map(|r| r.status), Some(401));
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
            after: None,
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
            Some((StatusCode::OK, json!([])))
        );
        assert!(default_answer(&h, "GET", "/api/v1/nope").is_none());
    }

    /// The library's seed is a *graph*, not a scatter of rows. If a preset can
    /// name a skill the pod cannot serve, every sub-link the show pages are
    /// built on is decoration — so the edges are asserted rather than assumed.
    #[test]
    fn the_seeded_library_resolves_every_link_it_declares() {
        let h = Harness::default();
        let (_, preset) = default_answer(&h, "GET", "/api/v1/agent-presets/amy").unwrap();

        for skill in preset["preset"]["skills"].as_array().unwrap() {
            let path = format!("/api/v1/skills/{}", skill.as_str().unwrap());
            assert!(
                default_answer(&h, "GET", &path).is_some(),
                "preset amy names a skill the pod will not serve: {path}"
            );
        }
        // The roster's two halves disagree on purpose: the preset asks for three
        // personas and this pod has two, which is the `installed: false` branch.
        let roster = preset["personas"].as_array().unwrap();
        assert_eq!(roster.len(), 3);
        for entry in roster {
            let path = format!("/api/v1/personas/{}", entry["slug"].as_str().unwrap());
            assert_eq!(
                default_answer(&h, "GET", &path).is_some(),
                entry["installed"].as_bool().unwrap(),
                "the roster and the persona store disagree about {path}"
            );
        }

        // And the snapshot is the only way to enumerate any of it, so it has to
        // list what the detail routes will answer for.
        let (_, snap) = default_answer(&h, "GET", "/api/v1/snapshot").unwrap();
        for persona in snap["personas"].as_array().unwrap() {
            let path = format!("/api/v1/personas/{}", persona["slug"].as_str().unwrap());
            assert!(default_answer(&h, "GET", &path).is_some(), "{path}");
        }
    }

    /// The registry browser's routes sit under `/agent-packs/` as well, and the
    /// library must not read `registries` as the name of an installed pack.
    #[test]
    fn a_registry_route_is_not_mistaken_for_an_installed_pack() {
        let h = Harness::default();
        let (_, body) = default_answer(&h, "GET", "/api/v1/agent-packs/registries").unwrap();
        assert!(body["registries"].is_array());
        assert!(default_answer(&h, "GET", "/api/v1/agent-packs/nope").is_none());
    }

    /// The key store is the pod's, not the test's: what was written is what
    /// comes back, so a flow that stores a key and then reads its own status is
    /// checking something real.
    #[test]
    fn the_key_store_remembers_what_was_written_to_it() {
        let h = Harness::default();
        default_answer(&h, "PUT", "/api/v1/keys/OCTAWEAVE_API_KEY");
        assert_eq!(h.keys(), ["OCTAWEAVE_API_KEY"]);

        let (_, listed) = default_answer(&h, "GET", "/api/v1/keys").unwrap();
        assert_eq!(listed[0]["name"], "OCTAWEAVE_API_KEY");

        default_answer(&h, "DELETE", "/api/v1/keys/OCTAWEAVE_API_KEY");
        assert!(h.keys().is_empty());
    }

    /// The gateway's one gate: a pod refuses to wire a channel for a number
    /// nobody has proved they hold. A fake that answered 200 here would let the
    /// card offer a button the real pod rejects.
    #[test]
    fn the_gateway_refuses_to_connect_an_unverified_number() {
        let h = Harness::default();
        let (status, _) =
            default_answer(&h, "POST", "/api/v1/gateway/metalcraft/register").unwrap();
        assert_eq!(status, StatusCode::OK);

        let (status, body) =
            default_answer(&h, "GET", "/api/v1/gateway/metalcraft/status").unwrap();
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["registered"], true);
        assert_eq!(body["verified"], false);

        let (status, _) = default_answer(&h, "POST", "/api/v1/gateway/metalcraft/connect").unwrap();
        assert_eq!(status, StatusCode::CONFLICT);
    }
}
