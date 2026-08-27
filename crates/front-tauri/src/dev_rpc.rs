//! A local HTTP mirror of the renderer's RPC surface, for driving the app
//! without a Tauri window.
//!
//! The renderer only reaches the core through `Transport`, and the only
//! implementation was Tauri IPC — so the UI could not be scripted, and
//! `PLAN.md` said "nothing verified against a live pod" while five surfaces were
//! built on top of that. This is the missing half: with it, `npm run dev` in a
//! browser is the **real UI on the real core**, and a test (or a person, or an
//! agent) can drive it with `curl`.
//!
//! It is also a down payment on P11: the web target needs an `http` transport
//! against a server that speaks exactly these method names.
//!
//! **Two gates, both required.** The `dev-rpc` Cargo feature keeps `axum` out of
//! release builds entirely, and `MC_DEV_RPC=<port>` decides whether a build that
//! *has* the feature listens at all. Both, because this endpoint is
//! unauthenticated and hands out everything the connected pod can do — it binds
//! to 127.0.0.1 and it must never be on by accident.
//!
//! Method names mirror `main.rs`'s `invoke_handler!` list. They are re-dispatched
//! rather than shared, which is a drift risk; `dev_rpc_covers_the_commands`
//! (below) reads both source files and fails when the lists disagree.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State as AxumState};
use axum::response::IntoResponse;
use axum::response::sse::{Event, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use front_core::{ChatEvent, NewChat, PodConnection};
use serde_json::{Value, json};
use tokio::sync::broadcast;

use crate::state::{AppState, ConnectedPod};

#[derive(Clone)]
struct Bridge {
    app: Arc<AppState>,
    /// `session://{chat_id}` -> live frames, mirroring what `chat.rs` emits to
    /// the webview.
    channels: Arc<parking_lot::Mutex<HashMap<String, broadcast::Sender<ChatEvent>>>>,
}

/// Start the bridge if `MC_DEV_RPC` names a port. Never returns an error: a dev
/// convenience must not be able to stop the app from starting.
pub fn spawn(app: Arc<AppState>) {
    let Ok(port) = std::env::var("MC_DEV_RPC") else {
        return;
    };
    let Ok(port) = port.trim().parse::<u16>() else {
        log::warn!("MC_DEV_RPC is not a port number; not starting the dev bridge");
        return;
    };
    let bridge = Bridge {
        app,
        channels: Arc::new(parking_lot::Mutex::new(HashMap::new())),
    };
    tokio::spawn(async move {
        let router = Router::new()
            .route("/rpc/{method}", post(rpc))
            .route("/sse", get(sse))
            .layer(
                tower_http::cors::CorsLayer::new()
                    .allow_origin(tower_http::cors::Any)
                    .allow_methods(tower_http::cors::Any)
                    .allow_headers(tower_http::cors::Any),
            )
            .with_state(bridge);
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(l) => {
                log::warn!("dev RPC bridge on http://127.0.0.1:{port} — unauthenticated, dev only");
                let _ = axum::serve(l, router).await;
            }
            Err(e) => log::warn!("dev RPC bridge could not bind {port}: {e}"),
        }
    });
}

/// The pod's own error text survives to the renderer; a serialization failure
/// here would be our bug, and says so.
fn j<T: serde::Serialize>(r: Result<T, anyhow::Error>) -> Result<Value, String> {
    r.map_err(|e| e.to_string())
        .and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
}

fn arg<'a>(args: &'a Value, name: &str) -> Option<&'a str> {
    args.get(name).and_then(|v| v.as_str())
}

fn need<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
    arg(args, name).ok_or_else(|| format!("missing argument '{name}'"))
}

async fn rpc(
    AxumState(bridge): AxumState<Bridge>,
    Path(method): Path<String>,
    // Raw bytes rather than `Json<Value>`: this endpoint exists to be curl'd,
    // and the typed extractor rejects `curl -d '{}'` with "Expected request with
    // `Content-Type: application/json`" — a papercut that costs a minute every
    // time and teaches nothing. An empty body means no arguments.
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let args = if body.is_empty() {
        json!({})
    } else {
        match serde_json::from_slice::<Value>(&body) {
            Ok(v) => v,
            Err(e) => {
                return (
                    axum::http::StatusCode::BAD_REQUEST,
                    Json(json!({ "error": format!("arguments are not JSON: {e}") })),
                );
            }
        }
    };
    match dispatch(&bridge, &method, &args).await {
        Ok(value) => (axum::http::StatusCode::OK, Json(value)),
        // The renderer surfaces the string; keep it the core's own message.
        Err(e) => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({ "error": e })),
        ),
    }
}

/// One arm per renderer-visible command. Bodies stay one-liners over
/// `PodConnection` so the mirror is obviously the same call the Tauri command
/// makes.
async fn dispatch(bridge: &Bridge, method: &str, args: &Value) -> Result<Value, String> {
    let app = &bridge.app;
    let ok = |v: Value| Ok(v);

    match method {
        // Identity. The bridge has no hub: it exists to drive a pod directly, so
        // it reports "signed out" rather than pretending to an account.
        "session" | "refresh_session" | "logout" | "account_credits" | "report_boot" => {
            ok(Value::Null)
        }
        // The funnel's hub half. The bridge has no keychain PAT and no browser,
        // so it reports "nothing to sell you" rather than pretending: a null
        // plan is the same answer a hub with billing unconfigured gives, and the
        // card already renders it.
        "billing_plan" => ok(Value::Null),
        "open_checkout" | "provision_pod" => {
            Err("the dev bridge has no account to upgrade or provision for".into())
        }
        // Not a pod call, but the browser the bridge is being driven from
        // cannot follow a transcript link on its own either — the renderer
        // routes every link click through this one name.
        "open_url" => crate::rpc::system::open_url(need(args, "url")?.to_string())
            .await
            .map(|()| Value::Null),
        "list_pods" => ok(json!([])),
        "connect_pod_url" => {
            let url = need(args, "url")?.trim().trim_end_matches('/').to_string();
            let key = need(args, "key")?;
            let conn = PodConnection::new(&url, key).map_err(|e| e.to_string())?;
            let info = conn.info().await.map_err(|e| e.to_string())?;
            let slug = url.rsplit('/').next().unwrap_or("pod").to_string();
            app.insert(ConnectedPod {
                slug,
                url,
                conn,
                refresher: None,
            });
            j(Ok::<_, anyhow::Error>(info))
        }
        "active_pod" => ok(serde_json::to_value(app.active_pod()).unwrap_or(Value::Null)),
        "agent_info" => j(app.conn(None)?.info().await),
        "inference_status" => j(app.conn(None)?.inference_status().await),

        // The one octaweave command that needs nothing but a pod. It calls the
        // command's own body rather than restating it, so the bridge cannot
        // drift from the app on the exact question this was built to answer:
        // what the card shows when the pod will not list its integrations.
        "octaweave_status" => {
            let conn = app.conn(None)?;
            crate::rpc::octaweave::status_of(&conn, app.diag())
                .await
                .and_then(|s| serde_json::to_value(s).map_err(|e| e.to_string()))
        }

        // Its sibling, and mirrored for the same reason: this is the arm that
        // answers "the pack is installed but nothing said the key was missing",
        // which is the bug the buildr.space card exists to fix.
        "buildr_status" => {
            let conn = app.conn(None)?;
            // No PAT here: the bridge has no keychain, so the key-health half
            // reports itself unchecked rather than pretending.
            crate::rpc::buildr::status_of(&conn, app.diag(), None)
                .await
                .and_then(|s| serde_json::to_value(s).map_err(|e| e.to_string()))
        }

        // The error log. Process state, no pod involved — which is exactly why
        // it is mirrored while the remaining octaweave commands are not: this is
        // where a browser-driven run finds out what the core swallowed.
        "list_diagnostics" => ok(serde_json::to_value(app.diag().entries()).unwrap_or(json!([]))),
        "clear_diagnostics" => {
            app.diag().clear();
            ok(Value::Null)
        }

        // The gateway (WhatsApp/SMS). Every arm is a pod call and nothing else
        // — no account credential, no hub — so all four mirror cleanly, which
        // is the point: this is the surface whose failures are hardest to
        // arrange on a real account and easiest to program on the stub pod.
        "gateway_status" => j(app.conn(None)?.gateway_status().await),
        "gateway_register" => j(app
            .conn(None)?
            .gateway_register(need(args, "phoneNumber")?)
            .await),
        "gateway_connect" => j(app.conn(None)?.gateway_connect().await),
        "gateway_disconnect" => j(app
            .conn(None)?
            .gateway_disconnect()
            .await
            .map(|_| json!(null))),
        "gateway_unregister" => j(app.conn(None)?.gateway_unregister().await),

        // Factory reset. Scope is optional here so a bare `curl -d '{}'` gets
        // the same default the pod uses — the full wipe.
        "factory_reset" => {
            let scope = match arg(args, "scope") {
                Some("keep_keys") => front_core::ResetScope::KeepKeys,
                Some("full") | None => front_core::ResetScope::Full,
                Some(other) => return Err(format!("unknown reset scope '{other}'")),
            };
            j(app.conn(None)?.factory_reset(scope).await)
        }

        // Keys.
        "list_keys" => j(app.conn(None)?.list_keys().await),
        "save_key" => j(app
            .conn(None)?
            .save_key(need(args, "name")?, need(args, "value")?)
            .await
            .map(|_| json!(null))),
        "delete_key" => j(app
            .conn(None)?
            .delete_key(need(args, "name")?)
            .await
            .map(|_| json!(null))),

        // Fleet.
        "list_instances" => j(app.conn(None)?.list_instances().await),
        "list_presets" => j(app.conn(None)?.list_presets().await),
        "create_instance" => j(app
            .conn(None)?
            .create_instance(need(args, "preset")?, arg(args, "name"))
            .await),
        "delete_instance" => j(app
            .conn(None)?
            .delete_instance(need(args, "id")?)
            .await
            .map(|_| json!(null))),
        "rename_instance" => j(app
            .conn(None)?
            .rename_instance(need(args, "id")?, need(args, "name")?)
            .await),
        "set_instance_persona" => j(app
            .conn(None)?
            .set_instance_persona(need(args, "id")?, need(args, "persona")?)
            .await),
        "list_preset_personas" => j(app.conn(None)?.preset_personas(need(args, "preset")?).await),
        "instance_memory" => j(app.conn(None)?.instance_memory(need(args, "id")?, 50).await),

        // Chats.
        "list_chats" => j(app.conn(None)?.list_chats().await),
        "get_chat" => j(app.conn(None)?.get_chat(need(args, "id")?).await),
        "chat_context" => j(app.conn(None)?.chat_context(need(args, "chatId")?).await),
        "compact_chat" => j(app.conn(None)?.compact_chat(need(args, "chatId")?).await),
        "clear_chat" => j(app.conn(None)?.clear_chat(need(args, "chatId")?).await),
        "delete_chat" => j(app.conn(None)?.delete_chat(need(args, "chatId")?).await),
        "interrupt_turn" => j(app.conn(None)?.interrupt_chat(need(args, "chatId")?).await),
        "pod_diagnostics" => j(app.conn(None)?.diagnostics_sessions().await),
        "pod_diagnostics_session" => {
            j(app.conn(None)?.diagnostics_session(need(args, "id")?).await)
        }
        "pod_diagnostics_trace" => j(app.conn(None)?.diagnostics_trace(need(args, "id")?).await),
        "scheduled_followups" => j(app.conn(None)?.followups_for_chat(need(args, "chatId")?).await),
        "cancel_followup" => j(app.conn(None)?.cancel_scheduled_task(need(args, "id")?).await),
        "create_chat" => {
            let new = NewChat {
                instance_id: arg(args, "instanceId").map(str::to_string),
                agent_preset: arg(args, "agentPreset").map(str::to_string),
                name: arg(args, "name").map(str::to_string),
                ..Default::default()
            };
            j(app.conn(None)?.create_chat(&new).await)
        }
        "send_turn" => {
            let chat_id = need(args, "chatId")?.to_string();
            let rx = app.conn(None)?.turn(&chat_id, need(args, "message")?);
            bridge.pump(chat_id, rx);
            ok(Value::Null)
        }
        "watch_chat" => {
            let chat_id = need(args, "chatId")?.to_string();
            let rx = app.conn(None)?.subscribe(&chat_id);
            bridge.pump(chat_id, rx);
            ok(Value::Null)
        }

        // Automations.
        "list_flows" => j(app.conn(None)?.list_flows().await),
        "get_flow" => j(app.conn(None)?.get_flow(need(args, "flowId")?).await),
        "get_flow_run" => j(app.conn(None)?.get_flow_run(need(args, "runId")?).await),
        // The graph is a whole object, not a string field, so it comes out of
        // `args` directly — `need`/`arg` only reach string values.
        "validate_flow" => j(app
            .conn(None)?
            .validate_flow(
                args.get("flow")
                    .ok_or_else(|| "missing argument 'flow'".to_string())?,
            )
            .await),
        "list_flow_runs" => j(app.conn(None)?.list_flow_runs().await),
        "flow_binding" => j(app.conn(None)?.flow_binding(need(args, "flowId")?).await),
        "run_flow" => j(app
            .conn(None)?
            .run_flow(need(args, "flowId")?, arg(args, "instanceId"))
            .await),
        "arm_schedule" => j(app
            .conn(None)?
            .arm_schedule(
                need(args, "flowId")?,
                need(args, "scheduleId")?,
                arg(args, "instanceId"),
            )
            .await),
        "disarm_schedule" => j(app
            .conn(None)?
            .disarm_schedule(need(args, "flowId")?, need(args, "scheduleId")?)
            .await
            .map(|_| json!(null))),
        "resume_flow_run" => j(app
            .conn(None)?
            .resume_flow_run(need(args, "runId")?, need(args, "handle")?)
            .await),

        // The library. Every arm is a plain pod read with no credential of its
        // own, so the whole surface mirrors — which is what lets the library be
        // driven from a browser tab against the stub pod, including the pods
        // that answer 404 to `/snapshot`.
        "pod_snapshot" => j(app.conn(None)?.snapshot().await),
        "preset_detail" => j(app.conn(None)?.preset_detail(need(args, "slug")?).await),
        "persona_detail" => j(app.conn(None)?.persona(need(args, "slug")?).await),
        "skill_detail" => j(app.conn(None)?.skill(need(args, "slug")?).await),
        "api_tool_detail" => j(app.conn(None)?.api_tool(need(args, "name")?).await),
        "list_integrations" => j(app.conn(None)?.list_integrations().await),
        "integration_detail" => j(app.conn(None)?.integration(need(args, "id")?).await),
        "agent_pack_detail" => j(app.conn(None)?.agent_pack(need(args, "id")?).await),
        "list_flow_templates" => j(app.conn(None)?.flow_templates().await),
        "flow_template_detail" => j(app.conn(None)?.flow_template(need(args, "slug")?).await),

        // Packs.
        "list_registries" => j(app.conn(None)?.registries().await),
        "registry_status" => j(app.conn(None)?.registry_status(need(args, "name")?).await),
        "list_installed_packs" => j(app.conn(None)?.list_agent_packs().await),
        "registry_search" => j(app
            .conn(None)?
            .registry_search(need(args, "name")?, arg(args, "query"), 50)
            .await),
        "registry_manifest" => j(app
            .conn(None)?
            .registry_manifest(need(args, "name")?, need(args, "id")?)
            .await),
        // Mirrored despite reaching a remote host: installing is the flow most
        // worth being able to drive, and the one where a wire mismatch hid for
        // months (`?ref=` vs `?reference=`). A bridge that cannot reproduce the
        // bug you are chasing is not much of a bridge.
        "install_pack" => j(app
            .conn(None)?
            .install_agent_pack(
                need(args, "reference")?,
                args.get("allowUnverified")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
            )
            .await),
        // Mirrored for the same reason as install, and one more: this is the call
        // whose *absence* was the bug — the browser offered "Update" and sent an
        // install. A bridge that cannot exercise it cannot show that it now does.
        "update_pack" => j(app
            .conn(None)?
            .update_agent_pack(
                need(args, "id")?,
                need(args, "reference")?,
                args.get("allowUnverified")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
            )
            .await),

        other => Err(format!("dev bridge does not mirror '{other}'")),
    }
}

impl Bridge {
    /// Fan a chat's frames into the channel an SSE subscriber reads — the
    /// bridge's equivalent of `chat.rs`'s `app.emit`.
    fn pump(&self, chat_id: String, mut rx: tokio::sync::mpsc::Receiver<ChatEvent>) {
        let channel = format!("session://{chat_id}");
        let tx = self
            .channels
            .lock()
            .entry(channel)
            .or_insert_with(|| broadcast::channel(64).0)
            .clone();
        tokio::spawn(async move {
            while let Some(ev) = rx.recv().await {
                let _ = tx.send(ev);
            }
        });
    }
}

async fn sse(
    AxumState(bridge): AxumState<Bridge>,
    Query(q): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let channel = q.get("channel").cloned().unwrap_or_default();
    let rx = bridge
        .channels
        .lock()
        .entry(channel)
        .or_insert_with(|| broadcast::channel(64).0)
        .subscribe();
    let stream = tokio_stream::wrappers::BroadcastStream::new(rx).filter_map(|ev| {
        futures_util::future::ready(
            ev.ok()
                .and_then(|ev| Event::default().json_data(&ev).ok())
                .map(Ok::<Event, std::convert::Infallible>),
        )
    });
    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}

use futures_util::StreamExt as _;

#[cfg(test)]
mod tests {
    /// The bridge re-dispatches commands rather than sharing them with
    /// `invoke_handler!`, so the two lists can drift — and a drifted bridge is
    /// worse than none: the UI would work in the desktop app and fail in the
    /// browser, which is the hardest kind of bug to place.
    ///
    /// Reading the source is crude, but `generate_handler!` exposes no list at
    /// runtime, and a crude check that runs is worth more than an elegant one
    /// that doesn't.
    #[test]
    fn dev_rpc_covers_the_commands() {
        let main = include_str!("main.rs");
        let bridge = include_str!("dev_rpc.rs");

        // Commands the bridge deliberately does not mirror, with the reason.
        const SKIP: &[&str] = &[
            // The hub half: device login, the pod list, the credit ledger. The
            // bridge exists to drive a pod directly and reports signed-out.
            "login_start",
            "login_poll",
            // Octaweave *connecting* needs the desktop's keychain PAT and a
            // browser to link — neither of which a dev browser tab has. Reading
            // the status needs only a pod, so that one is mirrored above.
            "octaweave_connect",
            "octaweave_install_pack",
            "octaweave_disconnect",
            "octaweave_link",
            // Same story for buildr.space: minting a `bsk_` needs the keychain
            // PAT and linking needs a browser. Its status is mirrored above.
            "buildr_connect",
            "buildr_install_pack",
            "buildr_disconnect",
            "buildr_link",
            // Connecting a registry mints and stores a credential; that is the
            // one registry action not worth the blast radius in a dev bridge.
            // Search, manifest and install are mirrored — see the install arm.
            "registry_connect",
            "registry_disconnect",
            // Not a pod call.
            "connect_pod",
            "bind_interface_source",
        ];

        let handlers: Vec<&str> = main
            .lines()
            .filter_map(|l| l.trim().strip_prefix("rpc::"))
            .filter_map(|l| l.split("::").nth(1))
            .filter_map(|l| l.strip_suffix(','))
            .collect();
        assert!(
            handlers.len() > 20,
            "parsed too few handlers from main.rs — did the list move?"
        );

        let missing: Vec<&str> = handlers
            .into_iter()
            .filter(|name| !SKIP.contains(name))
            .filter(|name| !bridge.contains(&format!("\"{name}\"")))
            .collect();
        assert!(
            missing.is_empty(),
            "these commands exist in main.rs but the dev bridge does not mirror them \
             (add an arm, or list them in SKIP with a reason): {missing:?}"
        );
    }
}
