//! The pod client.
//!
//! Two reqwest clients, deliberately. The pooled `client` serves CRUD with a
//! per-request timeout. The `stream_client` serves the two long-lived SSE
//! endpoints and differs in two ways that were both learned the hard way in
//! metalcraft-workshop:
//!
//! - **No client-wide timeout.** A turn streams for as long as the agent runs,
//!   which can be minutes when a tool makes its own slow HTTP call. A total
//!   timeout aborts the stream mid-flight — surfacing as reqwest's opaque "error
//!   decoding response body" — even though the turn completes fine server-side.
//! - **No idle-connection pooling.** A new chat's first turn is usually the first
//!   activity after an idle spell, so a pooled socket is often one the pod's
//!   ingress already closed; the read fails instantly and the UI reports a lost
//!   connection that never existed. These requests are rare and long, so paying
//!   for a fresh handshake each time is free in practice.

use std::sync::{Arc, RwLock};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio::sync::mpsc;

use crate::events::ChatEvent;
use crate::models::*;
use crate::registry::{RegistryConnection, SearchHit, SearchResults};

/// A Bearer token that can be replaced underneath a live connection.
///
/// Metalcraft ID connection tokens are audience-scoped to `pod:{slug}` and live
/// about an hour; front-cloud's refresher re-mints into this cell so a chat open
/// all afternoon never drops.
pub type SharedToken = Arc<RwLock<String>>;

/// Bound for ordinary CRUD calls. Long enough for a cold pod to answer, short
/// enough that a dead one fails visibly instead of hanging a panel forever.
const CRUD_TIMEOUT: Duration = Duration::from_secs(30);

/// Installs and registry round-trips reach a third host from the pod, so they get
/// longer than a local read before we call them dead.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(120);

/// How long to wait on a dream.
///
/// Generous because the work genuinely is: a full run is one model call per
/// episode plus one per merge cluster, and the pod allows ten minutes for any
/// single inference call. This is a backstop against a dead socket, not a
/// latency budget — and hitting it does not cancel the run. The pod finishes and
/// journals it either way, so the next read of the agent's memory shows the
/// result even when this request gave up waiting for it.
const DREAM_TIMEOUT: Duration = Duration::from_secs(900);

/// Percent-encode a query value. Tiny by design: the only untrusted thing that
/// reaches a URL here is a search box.
fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "+".to_string(),
            other => format!("%{other:02X}"),
        })
        .collect()
}

#[derive(Clone)]
pub struct PodConnection {
    base_url: String,
    token: SharedToken,
    client: reqwest::Client,
    stream_client: reqwest::Client,
}

/// Redacted by hand: a derived `Debug` would print the Bearer into any log line
/// or panic message that happens to include a connection.
impl std::fmt::Debug for PodConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PodConnection")
            .field("base_url", &self.base_url)
            .field("token", &"<redacted>")
            .finish()
    }
}

impl PodConnection {
    /// Connect with a fixed Bearer that never changes — a self-hosted agent in
    /// `--api <KEY>` mode, or a manually entered key.
    pub fn new(base_url: impl Into<String>, token: impl Into<String>) -> anyhow::Result<Self> {
        Self::build(base_url, Arc::new(RwLock::new(token.into())))
    }

    /// Connect with a refreshable Bearer. The caller keeps a clone and re-mints
    /// into it; every request reads the current value.
    pub fn with_shared_token(
        base_url: impl Into<String>,
        token: SharedToken,
    ) -> anyhow::Result<Self> {
        Self::build(base_url, token)
    }

    fn build(base_url: impl Into<String>, token: SharedToken) -> anyhow::Result<Self> {
        let raw = base_url.into();
        let trimmed = raw.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            anyhow::bail!("base URL is empty");
        }
        // Require an explicit scheme so reqwest gives a clean error rather than a
        // confusing relative-URL failure when someone types `localhost:3002`.
        if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
            anyhow::bail!("base URL must start with http:// or https://");
        }
        Ok(Self {
            base_url: trimmed.to_string(),
            token,
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .build()?,
            stream_client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .pool_max_idle_per_host(0)
                .build()?,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn bearer(&self) -> String {
        self.token.read().map(|t| t.clone()).unwrap_or_default()
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api/v1{}", self.base_url, path)
    }

    // ---- generic helpers -------------------------------------------------

    async fn get<T: DeserializeOwned>(&self, path: &str) -> anyhow::Result<T> {
        let resp = self
            .client
            .get(self.url(path))
            .bearer_auth(self.bearer())
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        Self::decode(resp, path).await
    }

    async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> anyhow::Result<T> {
        let resp = self
            .client
            .post(self.url(path))
            .bearer_auth(self.bearer())
            .json(body)
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        Self::decode(resp, path).await
    }

    async fn patch<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> anyhow::Result<T> {
        let resp = self
            .client
            .patch(self.url(path))
            .bearer_auth(self.bearer())
            .json(body)
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        Self::decode(resp, path).await
    }

    async fn put<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> anyhow::Result<T> {
        let resp = self
            .client
            .put(self.url(path))
            .bearer_auth(self.bearer())
            .json(body)
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        Self::decode(resp, path).await
    }

    async fn delete_path(&self, path: &str) -> anyhow::Result<()> {
        let resp = self
            .client
            .delete(self.url(path))
            .bearer_auth(self.bearer())
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        if !resp.status().is_success() {
            anyhow::bail!(
                "{} {}: {}",
                resp.status(),
                path,
                resp.text().await.unwrap_or_default()
            );
        }
        Ok(())
    }

    /// Decode a response, turning a non-2xx into an error that carries the pod's
    /// own message — the agent returns `{"error": "..."}` and that text is far
    /// more useful to a user than "500".
    async fn decode<T: DeserializeOwned>(resp: reqwest::Response, path: &str) -> anyhow::Result<T> {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            let detail = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
                .unwrap_or(body);
            anyhow::bail!("{status} {path}: {detail}");
        }
        Ok(serde_json::from_str(&body)?)
    }

    // ---- surfaces --------------------------------------------------------

    pub async fn info(&self) -> anyhow::Result<AgentInfo> {
        self.get("/info").await
    }

    /// The pod wraps its lists (`{"instances": [...]}`, `{"presets": [...]}`,
    /// `{"agent_packs": [...]}`) while `keys` and `chats` come back bare. The
    /// asymmetry is the pod's, so it is absorbed here rather than leaking into
    /// every caller.
    pub async fn list_instances(&self) -> anyhow::Result<Vec<AgentInstance>> {
        let wrapped: InstanceList = self.get("/agents/instances").await?;
        Ok(wrapped.instances)
    }

    pub async fn create_instance(
        &self,
        preset: &str,
        name: Option<&str>,
    ) -> anyhow::Result<AgentInstance> {
        let body = serde_json::json!({ "agent_preset": preset, "name": name });
        self.post("/agents/instances", &body).await
    }

    pub async fn delete_instance(&self, id: &str) -> anyhow::Result<()> {
        self.delete_path(&format!("/agents/instances/{id}")).await
    }

    /// Rename an agent.
    ///
    /// Only the name: the pod used to set `persistent` on any patch carrying one,
    /// and does not any more. Whether an agent is kept is its own field.
    pub async fn rename_instance(&self, id: &str, name: &str) -> anyhow::Result<AgentInstance> {
        let body = serde_json::json!({ "name": name });
        self.patch(&format!("/agents/instances/{id}"), &body).await
    }

    /// Switch which persona an instance speaks as.
    ///
    /// The pod validates against the preset's roster and returns 400 with the
    /// roster in the message when it does not match, so the error is worth
    /// showing verbatim rather than replacing with "could not update".
    pub async fn set_instance_persona(
        &self,
        id: &str,
        persona: &str,
    ) -> anyhow::Result<AgentInstance> {
        let body = serde_json::json!({ "persona": persona });
        self.patch(&format!("/agents/instances/{id}"), &body).await
    }

    /// The personas an instance may be switched to, resolved by the pod.
    pub async fn preset_personas(&self, slug: &str) -> anyhow::Result<Vec<RosterPersona>> {
        let detail: PresetDetail = self.get(&format!("/agent-presets/{slug}")).await?;
        Ok(detail.personas)
    }

    /// The conversations this one agent has had.
    ///
    /// Asked of the agent rather than filtered out of `/chats`, which is what
    /// this replaced: the pod knows which chats are whose, and a client-side
    /// filter on `instance_id` silently drops every chat written by a pod too
    /// old to stamp one — and reads the whole pod's history to answer a question
    /// about one agent.
    pub async fn instance_conversations(&self, id: &str) -> anyhow::Result<Vec<ChatSummary>> {
        self.get(&format!("/agents/instances/{id}/conversations"))
            .await
    }

    /// What this agent does on its own — the schedules pointing at it.
    ///
    /// Wrapped like `/agents/instances`, and unwrapped here for the same reason:
    /// the asymmetry is the pod's, not every caller's.
    pub async fn instance_flows(&self, id: &str) -> anyhow::Result<Vec<ScheduledFlow>> {
        let wrapped: InstanceFlows = self.get(&format!("/agents/instances/{id}/flows")).await?;
        Ok(wrapped.scheduled)
    }

    /// What one agent knows. Read-only by construction on the pod side — looking
    /// at an agent's memory must not touch its access counts or decay curve.
    pub async fn instance_memory(&self, id: &str, limit: u32) -> anyhow::Result<InstanceMemory> {
        self.get(&format!("/agents/instances/{id}/memory?limit={limit}"))
            .await
    }

    /// Consolidate this agent's memory now instead of waiting for tonight.
    ///
    /// **Blocks for the whole run.** The full five stages are several model calls
    /// and can take minutes; `stages` narrows it, and `[1, 5]` is the mechanical
    /// pass (drain the capture queue, run decay) which returns immediately.
    ///
    /// The pod answers 200 with a report even when a stage failed — the stages
    /// that succeeded did real work, and the failure is named inside.
    pub async fn dream_instance(
        &self,
        id: &str,
        stages: Option<Vec<u8>>,
    ) -> anyhow::Result<DreamReport> {
        self.post_timeout(
            &format!("/agents/instances/{id}/memory/dream"),
            &serde_json::json!({ "stages": stages }),
            DREAM_TIMEOUT,
        )
        .await
    }

    pub async fn list_presets(&self) -> anyhow::Result<Vec<AgentPresetSummary>> {
        let wrapped: PresetList = self.get("/agent-presets").await?;
        Ok(wrapped.presets)
    }

    /// What this pod is set to prefer.
    pub async fn pod_settings(&self) -> anyhow::Result<PodSettings> {
        self.get("/settings").await
    }

    /// Replace them. The whole document: clearing a preference has to be
    /// expressible, and a merge on the client would make "unset" unreachable.
    pub async fn set_pod_settings(&self, settings: &PodSettings) -> anyhow::Result<PodSettings> {
        self.put("/settings", settings).await
    }

    /// Every timezone this pod can resolve, grouped by region.
    pub async fn timezones(&self) -> anyhow::Result<Vec<TimezoneRegion>> {
        self.get("/timezones").await
    }

    /// The keys this pod's enabled packs read by name, and whether each resolves.
    ///
    /// `list_keys` answers "what is stored"; this answers "what is *wanted*",
    /// which is the question a key store cannot derive on its own — an unset
    /// credential is invisible until a tool fails on it.
    pub async fn recommended_keys(&self) -> anyhow::Result<Vec<RecommendedKey>> {
        self.get("/keys/recommended").await
    }

    pub async fn list_chats(&self) -> anyhow::Result<Vec<ChatSummary>> {
        self.get("/chats").await
    }

    pub async fn create_chat(&self, new: &NewChat) -> anyhow::Result<ChatDetail> {
        self.post("/chats", new).await
    }

    pub async fn get_chat(&self, id: &str) -> anyhow::Result<ChatDetail> {
        self.get(&format!("/chats/{id}")).await
    }

    pub async fn delete_chat(&self, id: &str) -> anyhow::Result<()> {
        self.delete_path(&format!("/chats/{id}")).await
    }

    /// What this conversation's context currently costs.
    pub async fn chat_context(&self, id: &str) -> anyhow::Result<ChatContext> {
        self.get(&format!("/chats/{id}/context")).await
    }

    /// Compact now, whatever the size. The pod's automatic rule only fires at 60%
    /// of the window, which is long after the point where someone can feel a
    /// conversation getting heavy and wants room before the question that matters.
    ///
    /// Summarizing costs an LLM call, so this is slower than it looks — the pod
    /// holds the chat busy for its duration and refuses a concurrent turn.
    pub async fn compact_chat(&self, id: &str) -> anyhow::Result<ChatCompacted> {
        self.post(&format!("/chats/{id}/compact"), &()).await
    }

    /// Reset the agent's context, keep the conversation. Distinct from
    /// [`Self::delete_chat`], which removes the conversation itself.
    ///
    /// Hits `/clear` rather than the `/reset` it is now an alias for, so a pod
    /// older than the rename still answers.
    pub async fn clear_chat(&self, id: &str) -> anyhow::Result<ChatContext> {
        self.post(&format!("/chats/{id}/clear"), &()).await
    }

    /// Ask a running turn to stop — the stop button.
    ///
    /// Returns when the pod has *recorded* the request, not when the turn is
    /// over: the executor notices at its next step boundary and ends the turn
    /// itself, which arrives here as `done{status:"interrupted"}` on the chat's
    /// event stream. That frame is what unlocks the composer; this call only
    /// promises the ask landed.
    ///
    /// Three answers, and a stop button needs all three:
    ///   * `Some(true)`  — a turn was running and has been asked to stop.
    ///   * `Some(false)` — nothing was running. An ordinary race (the turn ended
    ///     between the press and the request), not a failure.
    ///   * `None`        — the pod has no such endpoint. Every pod before
    ///     `POST /chats/{id}/interrupt` shipped is one whose turns cannot be
    ///     stopped, and saying so is better than a button that reports success
    ///     while the agent keeps working and keeps spending.
    ///
    /// A 404 also covers "no such chat", which collapses into `None` here on
    /// purpose: for the one caller — a session watching a live turn — the chat
    /// demonstrably exists, and both answers mean the same thing on screen.
    pub async fn interrupt_chat(&self, id: &str) -> anyhow::Result<Option<bool>> {
        let path = format!("/chats/{id}/interrupt");
        let resp = self
            .client
            .post(self.url(&path))
            .bearer_auth(self.bearer())
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let body: ChatInterrupt = Self::decode(resp, &path).await?;
        Ok(Some(body.stopping))
    }

    // ---- the pod's own diagnostics ---------------------------------------
    //
    // Everything under here is read-only and about *this pod's* record of what it
    // did. It has nothing to do with `front-core`'s own error log, which is about
    // what this app failed to do — the two answer opposite questions and are
    // deliberately not merged.

    /// Every run the pod recorded, newest first.
    ///
    /// `Ok(None)` on 404, the same contract as [`Self::inference_status`]: a pod
    /// too old to be asked, which must not be rendered as "this pod has never
    /// run anything".
    pub async fn diagnostics_sessions(&self) -> anyhow::Result<Option<Vec<PodSession>>> {
        self.get_optional("/diagnostics").await
    }

    /// One recorded run in full — configuration, every turn's messages, every
    /// prompt as it was actually sent.
    pub async fn diagnostics_session(&self, id: &str) -> anyhow::Result<Option<PodSessionDetail>> {
        self.get_optional(&format!("/diagnostics/{id}")).await
    }

    /// The OTLP trace for a run: a span per turn, per model call and per tool,
    /// with real timings and token usage.
    ///
    /// The one read that answers *where the time went*, which its sibling above
    /// cannot: a session's files say what was sent, never how long it took.
    ///
    /// Left as raw JSON on purpose. It is an OpenTelemetry document following a
    /// published spec that neither this crate nor the pod owns, and typing it
    /// here would be a third copy to keep in step for no gain — the one consumer
    /// walks spans.
    pub async fn diagnostics_trace(&self, id: &str) -> anyhow::Result<Option<serde_json::Value>> {
        self.get_optional(&format!("/diagnostics/{id}/trace")).await
    }

    /// A GET whose 404 means "nothing to show", not "something went wrong".
    ///
    /// Covers both of the reasons a diagnostics read comes back empty — a pod
    /// older than the endpoint, and a run with no trace — because a caller can
    /// do nothing different about either: there is no timeline to draw.
    async fn get_optional<T: DeserializeOwned>(&self, path: &str) -> anyhow::Result<Option<T>> {
        let resp = self
            .client
            .get(self.url(path))
            .bearer_auth(self.bearer())
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(Self::decode(resp, path).await?))
    }

    // ---- scheduled follow-ups --------------------------------------------
    //
    // The agent's `schedule_followup` tool arms deferred work and then ends its
    // turn saying "I'll check back". Reading these back is what lets the desktop
    // tell an armed promise from an invented one.

    /// Every follow-up the pod holds, newest-armed first.
    ///
    /// `Ok(None)` on 404, the same contract as [`Self::inference_status`]: a pod
    /// older than the endpoint cannot say, and a chat that simply has nothing
    /// scheduled must not look the same as one whose pod cannot be asked.
    pub async fn list_scheduled_tasks(&self) -> anyhow::Result<Option<Vec<ScheduledTask>>> {
        let resp = self
            .client
            .get(self.url("/scheduled-tasks"))
            .bearer_auth(self.bearer())
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(Self::decode(resp, "/scheduled-tasks").await?))
    }

    /// The follow-ups one chat is still going to act on, newest-armed first.
    ///
    /// `done` and `cancelled` jobs are dropped. A delivered follow-up already
    /// appears in the transcript as its own turn, so listing it again would
    /// double it; a cancelled one is a thing the user just did. `failed`
    /// survives the filter deliberately — it is the only outcome that is
    /// otherwise completely silent, and a promise that quietly died is exactly
    /// what someone waiting on a countdown needs told.
    pub async fn followups_for_chat(
        &self,
        chat_id: &str,
    ) -> anyhow::Result<Option<Vec<ScheduledTask>>> {
        Ok(self.list_scheduled_tasks().await?.map(|tasks| {
            tasks
                .into_iter()
                .filter(|t| t.chat_id.as_deref() == Some(chat_id))
                .filter(|t| t.is_pending() || t.status == "failed")
                .collect()
        }))
    }

    /// Cancel a pending follow-up. The pod refuses one that already fired, which
    /// is right: cancelling is about the future, and a delivered result stays.
    pub async fn cancel_scheduled_task(&self, id: &str) -> anyhow::Result<()> {
        self.delete_path(&format!("/scheduled-tasks/{id}")).await
    }

    // ---- the Metalcraft Gateway (WhatsApp / SMS) -------------------------
    //
    // Four calls, all of them the pod's own. The gateway is an account-level
    // service and this app holds an account PAT, so it *could* be called
    // directly — the iOS app does exactly that. It is deliberately not called
    // that way here: the pod is what actually receives a message, the channel
    // and its webhook secret live on the pod, and a desktop that asked the
    // gateway instead would render a connection the agent does not have. Same
    // reasoning the gateway's own web UI settled on (its `agent.rs` proxies to
    // the pod rather than reading its own tables).

    /// Registration, verification and connection, in one read.
    ///
    /// `Ok(None)` on 404 — a pod older than the endpoint, which is a different
    /// thing from a pod that answered "not connected" and wants a different card.
    /// Same shape as [`Self::inference_status`].
    pub async fn gateway_status(&self) -> anyhow::Result<Option<GatewayStatus>> {
        let resp = self
            .client
            .get(self.url("/gateway/metalcraft/status"))
            .bearer_auth(self.bearer())
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(
            Self::decode(resp, "/gateway/metalcraft/status").await?,
        ))
    }

    /// Register a personal number, and get back the code to text from it.
    ///
    /// The pod proxies this with its own account token, so re-registering
    /// replaces whatever number was there before — there is no separate "change
    /// number" call, and none is wanted.
    pub async fn gateway_register(
        &self,
        phone_number: &str,
    ) -> anyhow::Result<GatewayRegistration> {
        let body = serde_json::json!({ "phone_number": phone_number.trim() });
        self.post("/gateway/metalcraft/register", &body).await
    }

    /// Wire the channel: fetch the config, register the inbound webhook, store
    /// the signing secret, enable the `metalcraft` channel. Idempotent, so it
    /// doubles as "re-sync" when a number is reassigned or a webhook goes stale.
    ///
    /// **No connection token is sent.** The pod would adopt one as the channel's
    /// outbound bearer, and the only token this app has is audience-scoped to
    /// `pod:{slug}` — which the gateway rejects (`require_audience("gateway")`).
    /// Omitting it is the Workshop path: the pod authenticates with its own
    /// `METALCRAFT_TOKEN`.
    pub async fn gateway_connect(&self) -> anyhow::Result<GatewayConnected> {
        let resp = self
            .client
            .post(self.url("/gateway/metalcraft/connect"))
            .bearer_auth(self.bearer())
            .json(&serde_json::json!({}))
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        // The pod's 409 means one thing only, and its own sentence says it
        // better than a status line does.
        if resp.status() == reqwest::StatusCode::CONFLICT {
            anyhow::bail!("register and verify your number before connecting");
        }
        Self::decode(resp, "/gateway/metalcraft/connect").await
    }

    /// Disable the channel and drop its secrets. Idempotent, and local to the
    /// pod: the number stays registered at the gateway, so reconnecting needs no
    /// second verification.
    pub async fn gateway_disconnect(&self) -> anyhow::Result<()> {
        let _: serde_json::Value = self.post("/gateway/metalcraft/disconnect", &()).await?;
        Ok(())
    }

    /// Give the number back: unregister at the gateway, and disconnect locally.
    ///
    /// The exit [`Self::gateway_disconnect`] deliberately is not. Disconnecting
    /// stops this pod receiving; the account keeps the number, bound and
    /// verified, which is what makes reconnecting free — and what makes leaving
    /// impossible. A verified registration cannot be claimed by another account,
    /// so a number nobody unregisters is a number nobody else can ever use.
    ///
    /// `Ok(false)` when the pod is too old to have the endpoint. The desktop has
    /// no fallback to offer — it holds no account credential by design — so the
    /// honest move is to say so rather than to leave a button that 404s.
    pub async fn gateway_unregister(&self) -> anyhow::Result<bool> {
        let resp = self
            .client
            .post(self.url("/gateway/metalcraft/unregister"))
            .bearer_auth(self.bearer())
            .json(&serde_json::json!({}))
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(false);
        }
        let _: serde_json::Value = Self::decode(resp, "/gateway/metalcraft/unregister").await?;
        Ok(true)
    }

    /// Erase the pod and restart it as a newly-provisioned one.
    ///
    /// The confirmation phrase is supplied here rather than taken as an
    /// argument: it is the pod's guard against an *accidental* call, and a
    /// deliberate call that has come this far has already passed the UI's
    /// type-it-out gate. Threading it through the RPC boundary would only give
    /// the renderer a way to get it wrong.
    ///
    /// `Ok(None)` when the pod predates the endpoint (agent < 0.35.0). Same
    /// reasoning as [`Self::inference_status`]: "this pod cannot do that" and
    /// "the call failed" want different words, and only one of them should
    /// suggest trying again.
    ///
    /// Expect the connection to die shortly after this returns — that is the
    /// pod restarting, and it is success, not an error to surface.
    pub async fn factory_reset(&self, scope: ResetScope) -> anyhow::Result<Option<ResetReport>> {
        let resp = self
            .client
            .post(self.url("/factory-reset"))
            .bearer_auth(self.bearer())
            .json(&serde_json::json!({
                "confirm": "FACTORY RESET",
                "scope": scope,
            }))
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(Self::decode(resp, "/factory-reset").await?))
    }

    pub async fn list_keys(&self) -> anyhow::Result<Vec<KeyEntry>> {
        self.get("/keys").await
    }

    /// Ask the pod whether it can actually think.
    ///
    /// Worth a round trip of its own because `list_keys` cannot answer it: it
    /// lists `keys.json`, and the credential a provisioned pod runs on is injected
    /// as container env. Inferring "no key, cannot think" from an empty store told
    /// premium users their working pod was dead.
    ///
    /// `Ok(None)` on 404 — a pod older than this endpoint. Same reasoning as
    /// `IdClient::credits`: "this pod cannot say" and "the call failed" want
    /// opposite UI, and the caller has a weaker signal to fall back on.
    pub async fn inference_status(&self) -> anyhow::Result<Option<InferenceStatus>> {
        let resp = self
            .client
            .get(self.url("/inference"))
            .bearer_auth(self.bearer())
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(Self::decode(resp, "/inference").await?))
    }

    /// Upsert a secret. This is the mechanism behind binding an interface source:
    /// `OPENAI_API_KEY` + `OPENAI_BASE_URL` written here are what point the agent
    /// at Metalcraft Inference, OpenAI, OpenRouter, or a custom gateway.
    ///
    /// The name is in the path and only the value in the body — and the pod
    /// rejects an empty value outright, so clearing a key means `delete_key`.
    pub async fn save_key(&self, name: &str, value: &str) -> anyhow::Result<()> {
        let body = serde_json::json!({ "value": value });
        let resp = self
            .client
            .put(self.url(&format!("/keys/{name}")))
            .bearer_auth(self.bearer())
            .json(&body)
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            anyhow::bail!(
                "{status} saving {name}: {}",
                resp.text().await.unwrap_or_default()
            );
        }
        Ok(())
    }

    pub async fn delete_key(&self, name: &str) -> anyhow::Result<()> {
        self.delete_path(&format!("/keys/{name}")).await
    }

    // ---- automations (the pod's flows) -----------------------------------

    /// Every flow on the pod — the *work*, without its timing.
    ///
    /// Unscheduled flows come back too, deliberately: they are the majority (packs
    /// install them scheduling nothing) and the ones an arm dialog exists to act
    /// on. Pair with [`Self::list_scheduled_flows`] and join by `flow_id`.
    pub async fn list_flows(&self) -> anyhow::Result<Vec<Flow>> {
        let wrapped: FlowList = self.get("/flows").await?;
        Ok(wrapped.flows)
    }

    /// Everything this pod will do on its own, in one call.
    ///
    /// The complete answer: nothing else fires a flow on a timer, so an empty list
    /// means the pod acts only when asked.
    pub async fn list_scheduled_flows(&self) -> anyhow::Result<Vec<ScheduledFlow>> {
        let wrapped: ScheduledFlowList = self.get("/scheduled-flows").await?;
        Ok(wrapped.scheduled)
    }

    // ── Goals ────────────────────────────────────────────────────────────────

    /// Every goal on the pod, with how far each has got.
    pub async fn list_goals(&self) -> anyhow::Result<GoalList> {
        self.get("/goals").await
    }

    /// One goal, with the scratchpad that is its whole memory.
    pub async fn get_goal(&self, id: &str) -> anyhow::Result<GoalDetail> {
        self.get(&format!("/goals/{id}")).await
    }

    /// Set a goal.
    ///
    /// The consent point: this creates the goal *and* the agent that will pursue
    /// it, because "work at this while I am not here" is one decision rather
    /// than two.
    pub async fn create_goal(&self, new: &NewGoal) -> anyhow::Result<Goal> {
        self.post("/goals", new).await
    }

    /// Pause, resume, retarget — or answer what it blocked on.
    pub async fn update_goal(&self, id: &str, update: &GoalUpdate) -> anyhow::Result<Goal> {
        self.patch(&format!("/goals/{id}"), update).await
    }

    /// Forget a goal. Its agent survives, holding what it learned.
    pub async fn delete_goal(&self, id: &str) -> anyhow::Result<()> {
        self.delete_path(&format!("/goals/{id}")).await
    }

    /// What it has been doing, one entry per tick, newest last.
    pub async fn goal_journal(&self, id: &str, limit: u32) -> anyhow::Result<GoalJournal> {
        self.get(&format!("/goals/{id}/journal?limit={limit}")).await
    }

    /// Rewrite the scratchpad by hand — the repair hatch for a plan that has
    /// drifted or a groom that went wrong. The pod snapshots the previous
    /// version, so this is never the last copy.
    pub async fn put_goal_scratchpad(
        &self,
        id: &str,
        markdown: &str,
    ) -> anyhow::Result<GoalDetail> {
        self.put(
            &format!("/goals/{id}/scratchpad"),
            &serde_json::json!({ "markdown": markdown }),
        )
        .await
    }

    /// Persisted flow runs, newest first. The pod only persists a run that
    /// **paused**, so this is largely the list of things waiting on a human.
    pub async fn list_flow_runs(&self) -> anyhow::Result<Vec<FlowRun>> {
        self.get("/flow-runs").await
    }

    /// One run, with its step trace and the graph it actually ran against.
    ///
    /// Raw JSON, like the flow endpoints: the record embeds a `SavedFlow`
    /// snapshot, and the reason to want that snapshot is that it is the graph the
    /// run took — re-parsing it through a narrower type here would lose exactly
    /// the vendor nodes someone is trying to debug.
    pub async fn get_flow_run(&self, run_id: &str) -> anyhow::Result<serde_json::Value> {
        self.get(&format!("/flow-runs/{run_id}")).await
    }

    /// One flow, graph included.
    ///
    /// Raw JSON for the same reason as [`Self::put_flow`]: this client does not
    /// own the shape, and a viewer that parsed into a narrower type would quietly
    /// drop the vendor node data (`slack:send_message`) the spec requires be
    /// preserved verbatim. What comes back is what goes back.
    pub async fn get_flow(&self, flow_id: &str) -> anyhow::Result<serde_json::Value> {
        self.get(&format!("/flows/{flow_id}")).await
    }

    /// Check a graph without saving it.
    ///
    /// The editor's live feedback. `put_flow` validates too and stays the
    /// authority; this only means someone finds out while they can still act on
    /// it. An invalid graph answers 200 with `valid: false` — a transport error
    /// is a different thing and must stay distinguishable from a wrong graph.
    pub async fn validate_flow(
        &self,
        flow: &serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        self.post("/flows/validate", flow).await
    }

    /// Create or replace a flow.
    ///
    /// Takes the graph as raw JSON rather than a typed `SavedFlow`: the shape is
    /// the `metalcraft-flows` crate's, this client does not own it, and an editor
    /// round-trips what the pod sent it. The pod validates — a bad cron is a 400
    /// with its own message, which is the one worth showing.
    pub async fn put_flow(
        &self,
        flow_id: &str,
        flow: &serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        self.put(&format!("/flows/{flow_id}"), flow).await
    }

    /// When a trigger would actually fire, asked before anything is saved.
    ///
    /// The cron the pod parses is six fields, seconds first; a five-field POSIX
    /// expression is accepted by the form, saved, and then never fires. Only the
    /// pod can tell those apart, and this is how it is asked while somebody is
    /// still typing rather than after they have armed it.
    pub async fn preview_schedule(
        &self,
        schedule: &ScheduleSpec,
    ) -> anyhow::Result<SchedulePreview> {
        let body = serde_json::json!({ "schedule": schedule });
        self.post("/scheduled-flows/preview", &body).await
    }

    /// What this flow needs that the pod may not have, pack by pack.
    ///
    /// A companion to `flow_binding`, which answers the same question for
    /// *credentials* and personas but says nothing about packs: a flow whose
    /// graph reaches a pack this agent does not have fails when it fires, and
    /// nothing on the arming path used to say so.
    ///
    /// `POST`, and it only reports — the pod deliberately refuses to install a
    /// pack from here.
    pub async fn flow_dependencies(&self, flow_id: &str) -> anyhow::Result<FlowDependencies> {
        self.post(&format!("/flows/{flow_id}/check-dependencies"), &())
            .await
    }

    /// Run a flow now.
    ///
    /// Omitting `instance_id` lets the pod resolve the flow's armed agent, so
    /// pressing "run" on an automation that fires every morning is the same act
    /// as the morning firing — same memory, same conversation. An unarmed flow
    /// runs memoryless and leaves nothing behind, which is what testing one
    /// should do.
    pub async fn run_flow(
        &self,
        flow_id: &str,
        instance_id: Option<&str>,
        inputs: Option<&serde_json::Value>,
    ) -> anyhow::Result<FlowRunSummary> {
        // `inputs` are the entry node's declared parameters. Omitted, the pod
        // falls back to each input's default and warns about the rest rather
        // than refusing — so a flow can always be tried before it is filled in.
        let body = serde_json::json!({ "instance_id": instance_id, "inputs": inputs });
        self.post(&format!("/flows/{flow_id}/run"), &body).await
    }

    /// What arming this flow would actually permit: personas, domains, keys, and
    /// which of its tools mutate.
    pub async fn flow_binding(&self, flow_id: &str) -> anyhow::Result<FlowBinding> {
        self.get(&format!("/flows/{flow_id}/binding")).await
    }

    /// Resume a run paused at an `approval` or `wait` node.
    ///
    /// `handle` is the decision — one of the pause's `resume_handles`. The run
    /// continues **in the conversation it paused in**, so the agent still has the
    /// thread it was mid-way through rather than being handed a decision it has
    /// no context for.
    pub async fn resume_flow_run(
        &self,
        run_id: &str,
        handle: &str,
    ) -> anyhow::Result<FlowRunSummary> {
        let body = serde_json::json!({ "handle": handle });
        self.post(&format!("/flow-runs/{run_id}/resume"), &body)
            .await
    }

    /// Schedule a flow — **the act that creates the agent**. The pod mints a
    /// persistent instance (or attaches to `instance_id` if given) and returns the
    /// scheduled flow, agent included.
    ///
    /// Errors carry the pod's own message, which names the offending persona and
    /// the roster it is missing from when the containment rule refuses; that
    /// sentence is worth showing verbatim.
    pub async fn arm_schedule(
        &self,
        flow_id: &str,
        schedule: &ScheduleSpec,
        instance_id: Option<&str>,
    ) -> anyhow::Result<ScheduledFlow> {
        let body = serde_json::json!({
            "flow_id": flow_id,
            "schedule": schedule,
            "instance_id": instance_id,
        });
        self.post("/scheduled-flows", &body).await
    }

    /// Change a schedule: a new trigger, or pause/resume it.
    ///
    /// Pausing (`enabled: false`) keeps the schedule and its agent — the
    /// difference between "not now" and "never again", which deleting would erase.
    pub async fn update_schedule(
        &self,
        scheduled_id: &str,
        schedule: Option<&ScheduleSpec>,
        enabled: Option<bool>,
    ) -> anyhow::Result<ScheduledFlow> {
        let mut body = serde_json::Map::new();
        if let Some(s) = schedule {
            body.insert("schedule".into(), serde_json::to_value(s)?);
        }
        if let Some(e) = enabled {
            body.insert("enabled".into(), serde_json::Value::Bool(e));
        }
        self.put(
            &format!("/scheduled-flows/{scheduled_id}"),
            &serde_json::Value::Object(body),
        )
        .await
    }

    /// Disarm: delete the schedule. **The agent and everything it remembers are
    /// kept** — disarming is not deletion of the agent, and the UI should not
    /// imply otherwise. The flow stays too, and can still be run by hand.
    pub async fn disarm_schedule(&self, scheduled_id: &str) -> anyhow::Result<()> {
        self.delete_path(&format!("/scheduled-flows/{scheduled_id}"))
            .await
    }

    // ---- the library -----------------------------------------------------
    //
    // Reads only. Everything here answers "what is on this pod", which is a
    // question the app could not previously ask: presets were listed for the
    // spawn picker and integrations for one settings card, and nothing else the
    // pod holds had a surface at all.

    /// Everything installed, in one call.
    ///
    /// This was once the *only* way to enumerate personas and skills. The pod
    /// has published `/personas` and `/skills` since, so it is now a choice
    /// rather than a necessity — and still the right one: those routes return
    /// the same `PersonaSummary`/`SkillSummary` this already carries, so reading
    /// them instead would cost two more round trips for identical data and still
    /// leave presets, api-tools and the default preset to fetch.
    ///
    /// `Ok(None)` on 404, the same contract as [`Self::inference_status`]: a pod
    /// older than the endpoint cannot say, which wants a different screen from a
    /// pod that answered "nothing installed".
    pub async fn snapshot(&self) -> anyhow::Result<Option<PodSnapshot>> {
        let resp = self
            .client
            .get(self.url("/snapshot"))
            .bearer_auth(self.bearer())
            .timeout(CRUD_TIMEOUT)
            .send()
            .await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(Self::decode(resp, "/snapshot").await?))
    }

    /// A preset with both halves: what it declares, and what this pod resolved.
    ///
    /// [`Self::preset_personas`] is the same request narrowed to the roster; it
    /// stays because the persona switcher wants exactly that and nothing else.
    pub async fn preset_detail(&self, slug: &str) -> anyhow::Result<PresetDetail> {
        self.get(&format!("/agent-presets/{slug}")).await
    }

    /// One persona: its prompt, its tools, its skills, its integration grants.
    pub async fn persona(&self, slug: &str) -> anyhow::Result<PersonaDetail> {
        self.get(&format!("/personas/{slug}")).await
    }

    /// One skill, body included. The body is the artifact — a skill listing
    /// without it is a filename.
    pub async fn skill(&self, slug: &str) -> anyhow::Result<SkillDetail> {
        self.get(&format!("/skills/{slug}")).await
    }

    /// One HTTP API tool's config, verbatim.
    ///
    /// Kept as `Value` on purpose: the config is a request template — mappings,
    /// nested parameter paths, multipart descriptors — that the pod's executor
    /// owns and this app only displays. Typing it here would be inventing a
    /// second copy of a schema that changes whenever a tool author needs a new
    /// body shape.
    pub async fn api_tool(&self, name: &str) -> anyhow::Result<serde_json::Value> {
        self.get(&format!("/api-tools/{name}")).await
    }

    /// An integration with its contents named rather than counted.
    pub async fn integration(&self, id: &str) -> anyhow::Result<IntegrationDetail> {
        self.get(&format!("/integrations/{id}")).await
    }

    /// An installed agent pack's manifest, as the pod filed it. `Value` for the
    /// same reason as [`Self::registry_manifest`]: the manifest is the pack
    /// author's document, not this app's type.
    pub async fn agent_pack(&self, id: &str) -> anyhow::Result<serde_json::Value> {
        self.get(&format!("/agent-packs/{id}")).await
    }

    /// The automations packs shipped, before anyone installed one as a flow.
    pub async fn flow_templates(&self) -> anyhow::Result<Vec<FlowTemplateSummary>> {
        self.get("/flow-templates").await
    }

    /// One template, graph included. `Value` because the graph belongs to the
    /// external `metalcraft-flows` crate — the pod itself exposes it untyped for
    /// the same reason, and inventing a shape here would be inventing one for a
    /// document neither side owns.
    pub async fn flow_template(&self, slug: &str) -> anyhow::Result<serde_json::Value> {
        self.get(&format!("/flow-templates/{slug}")).await
    }

    pub async fn list_agent_packs(&self) -> anyhow::Result<Vec<InstalledAgentPack>> {
        let wrapped: AgentPackList = self.get("/agent-packs").await?;
        // The pod nests each pack's own fields under `manifest`; callers want one
        // flat pack. See `InstalledAgentPack::flattened`.
        Ok(wrapped
            .agent_packs
            .into_iter()
            .map(InstalledAgentPack::flattened)
            .collect())
    }

    /// Integration packs installed on this pod — the HTTP-tool packs, a
    /// different system from the agent packs in `list_agent_packs`.
    pub async fn list_integrations(&self) -> anyhow::Result<Vec<Integration>> {
        self.get("/integrations").await
    }

    /// Install an integration pack by registry slug.
    ///
    /// The pod fetches it from packs.metalcraftai.com itself; the desktop never
    /// downloads a pack. Enabling is part of installing on the pod side.
    ///
    /// **Only that one registry.** The slug is not looked up anywhere else, so a
    /// pack published to Axoniac 404s here and the pod reports the miss as a 502
    /// — an error that names a gateway for what is really a wrong-host lookup.
    /// Reach for [`Self::install_agent_pack`] and a qualified reference unless
    /// the pack is genuinely on packs.metalcraftai.com.
    pub async fn install_integration(&self, slug: &str) -> anyhow::Result<Integration> {
        let body = serde_json::json!({ "slug": slug });
        self.post_long("/integrations/install", &body).await
    }

    /// The hosts this pod will fetch packs from — Axoniac Prime and any peer.
    pub async fn registries(&self) -> anyhow::Result<Registries> {
        self.get("/agent-packs/registries").await
    }

    // ---- registries -------------------------------------------------------

    /// Where this pod stands with a host: connected, unlinked (with somewhere to
    /// go and fix it), anonymous, refused, or a host with no identity endpoint at
    /// all. Public packs install in every one of those states.
    pub async fn registry_status(&self, name: &str) -> anyhow::Result<RegistryConnection> {
        self.get(&format!("/agent-packs/registries/{name}/status"))
            .await
    }

    /// Point a registry at the credential this pod already holds. Mints nothing.
    pub async fn registry_connect(&self, name: &str) -> anyhow::Result<RegistryConnection> {
        self.post_query(&format!("/agent-packs/registries/{name}/connect"), &[])
            .await
    }

    pub async fn registry_disconnect(&self, name: &str) -> anyhow::Result<RegistryConnection> {
        self.post_query(&format!("/agent-packs/registries/{name}/disconnect"), &[])
            .await
    }

    /// Browse a host. An empty query is the catalogue rather than an error, which
    /// is what makes this usable as the landing view.
    pub async fn registry_search(
        &self,
        name: &str,
        query: Option<&str>,
        limit: u32,
    ) -> anyhow::Result<Vec<SearchHit>> {
        let mut path = format!("/agent-packs/registries/{name}/search?limit={limit}");
        if let Some(q) = query.map(str::trim).filter(|q| !q.is_empty()) {
            path.push_str(&format!("&q={}", urlencode(q)));
        }
        let results: SearchResults = self.get(&path).await?;
        Ok(results.results)
    }

    /// The raw `agent_pack.json` — what the pack says it provides and needs.
    pub async fn registry_manifest(
        &self,
        name: &str,
        id: &str,
    ) -> anyhow::Result<serde_json::Value> {
        self.get(&format!(
            "/agent-packs/registries/{name}/packs/{id}/manifest"
        ))
        .await
    }

    /// Read what a pack actually contains, before installing it.
    ///
    /// Not the same question as the registry's `/manifest`, which is the
    /// *registry's* description of a pack. This is the pod opening the archive
    /// it would install, so it can answer two things nothing else can: which
    /// credentials it will be missing, and whether a preset inside it collides
    /// with one another installed pack already provides.
    ///
    /// Same `ref` trap as `install_agent_pack`, and the same `allow_unverified`
    /// override — a `verified-only` pod refuses an unvouched pack at *inspect*
    /// too, so without it there is no way to read what a thing wants before
    /// deciding about it.
    pub async fn inspect_agent_pack(
        &self,
        reference: &str,
        allow_unverified: bool,
    ) -> anyhow::Result<AgentPackPreview> {
        self.post_query(
            "/agent-packs/inspect",
            &[
                ("ref", reference.to_string()),
                ("allow_unverified", allow_unverified.to_string()),
            ],
        )
        .await
    }

    /// Install by qualified reference (`axoniac:@amy_kitchen`).
    ///
    /// `allow_unverified` exists because a pod may be configured to take only
    /// packs its host vouches for; overriding that is a decision a person makes
    /// deliberately, so it is a parameter rather than a default.
    pub async fn install_agent_pack(
        &self,
        reference: &str,
        allow_unverified: bool,
    ) -> anyhow::Result<serde_json::Value> {
        self.post_query(
            "/agent-packs/install",
            &[
                // `ref`, not `reference`: the pod's query field is
                // `#[serde(rename = "ref")]`. Sending the long name meant the pod
                // saw *no* source and answered "provide ?url=, ?path=, or upload
                // the .agentpack as the request body" — a message that never
                // mentions the parameter the caller actually meant, which is why
                // this survived a whole registry browser being built on it.
                ("ref", reference.to_string()),
                ("allow_unverified", allow_unverified.to_string()),
            ],
        )
        .await
    }

    /// Update an installed pack to what a registry now serves.
    ///
    /// Deliberately not `install_agent_pack` against the same reference. The pod
    /// draws the distinction, and it is not cosmetic: `install` replaces files,
    /// while `update` afterwards reconciles the agents already made from the pack
    /// — falling back a persona the new version withdrew, freezing a withdrawn
    /// preset so an existing agent keeps running, and evicting the memory base so
    /// the change takes effect on the next turn instead of after a restart. Going
    /// through `install` skipped all of that and reported none of it.
    ///
    /// No version gate is needed: this landed in metalcraft-agent 0.29.0, and
    /// browsing a registry at all needs 0.30.0, so any pod that could show an
    /// update can apply one.
    pub async fn update_agent_pack(
        &self,
        id: &str,
        reference: &str,
        allow_unverified: bool,
    ) -> anyhow::Result<PackUpdateReport> {
        self.post_query(
            &format!("/agent-packs/{id}/update"),
            &[
                // `ref`, not `reference` — the same rename that hid on the install
                // path for months. See `install_agent_pack`.
                ("ref", reference.to_string()),
                ("allow_unverified", allow_unverified.to_string()),
            ],
        )
        .await
    }

    /// POST with query parameters and no body — the shape the pod uses for
    /// installs and registry connections.
    async fn post_query<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, String)],
    ) -> anyhow::Result<T> {
        let resp = self
            .client
            .post(self.url(path))
            .bearer_auth(self.bearer())
            .query(params)
            .timeout(INSTALL_TIMEOUT)
            .send()
            .await?;
        Self::decode(resp, path).await
    }

    /// A POST with a JSON body and the install-length timeout: the pod reaches a
    /// third host to fetch the pack, so this gets longer than a local read.
    async fn post_long<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> anyhow::Result<T> {
        self.post_timeout(path, body, INSTALL_TIMEOUT).await
    }

    /// A POST with a JSON body and a caller-chosen timeout, for the handful of
    /// routes whose work is measured in minutes rather than milliseconds.
    async fn post_timeout<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
        timeout: Duration,
    ) -> anyhow::Result<T> {
        let resp = self
            .client
            .post(self.url(path))
            .bearer_auth(self.bearer())
            .json(body)
            .timeout(timeout)
            .send()
            .await?;
        Self::decode(resp, path).await
    }

    // ---- streaming -------------------------------------------------------

    /// Run one turn, streaming frames as they happen.
    ///
    /// Returns a receiver rather than a `Stream` so callers (the Tauri event
    /// bridge, a test) can move it straight into a task without pinning generics.
    /// The task ends when the pod closes the stream.
    pub fn turn(&self, chat_id: &str, message: &str) -> mpsc::Receiver<ChatEvent> {
        let req = self
            .stream_client
            .post(self.url(&format!("/chats/{chat_id}/turn")))
            .bearer_auth(self.bearer())
            .json(&serde_json::json!({ "message": message }));
        self.spawn_sse(req)
    }

    /// Subscribe to a chat's broadcast event channel without driving a turn.
    ///
    /// This is what makes a live fleet view possible at all: the pod fans the same
    /// frames out to every subscriber, so N open sessions (and a phone) can watch
    /// one turn without any of them owning it.
    pub fn subscribe(&self, chat_id: &str) -> mpsc::Receiver<ChatEvent> {
        let req = self
            .stream_client
            .get(self.url(&format!("/chats/{chat_id}/events")))
            .bearer_auth(self.bearer());
        self.spawn_sse(req)
    }

    fn spawn_sse(&self, req: reqwest::RequestBuilder) -> mpsc::Receiver<ChatEvent> {
        let (tx, rx) = mpsc::channel(256);
        tokio::spawn(async move {
            let resp = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx
                        .send(ChatEvent::Error {
                            code: "transport".into(),
                            message: e.to_string(),
                            retryable: true,
                        })
                        .await;
                    let _ = tx
                        .send(ChatEvent::Done {
                            status: "failed".into(),
                            reason: None,
                        })
                        .await;
                    return;
                }
            };
            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                let _ = tx
                    .send(ChatEvent::Error {
                        code: format!("http_{}", status.as_u16()),
                        message: if body.is_empty() {
                            status.to_string()
                        } else {
                            body
                        },
                        // A 409 means the chat is already mid-turn — retrying at
                        // once just collides again, so it is not "retryable".
                        retryable: status.is_server_error(),
                    })
                    .await;
                let _ = tx
                    .send(ChatEvent::Done {
                        status: "failed".into(),
                        reason: None,
                    })
                    .await;
                return;
            }

            let mut stream = resp.bytes_stream();
            let mut buf = String::new();
            while let Some(chunk) = stream.next().await {
                let Ok(bytes) = chunk else { break };
                buf.push_str(&String::from_utf8_lossy(&bytes));
                while let Some(idx) = find_frame_end(&buf) {
                    let (frame, rest) = buf.split_at(idx);
                    let frame = frame.to_string();
                    buf = rest.trim_start_matches(['\r', '\n']).to_string();
                    if let Some(ev) = parse_sse_frame(&frame) {
                        let terminal = ev.is_terminal();
                        if tx.send(ev).await.is_err() || terminal {
                            return;
                        }
                    }
                }
            }
        });
        rx
    }
}

/// Index just past the blank line that terminates an SSE frame.
fn find_frame_end(buf: &str) -> Option<usize> {
    buf.find("\n\n")
        .map(|i| i + 2)
        .or_else(|| buf.find("\r\n\r\n").map(|i| i + 4))
}

/// Pull the `data:` payload out of one frame and decode it. Comment lines
/// (`:keep-alive`) and any other field are ignored, and a frame we cannot decode
/// is dropped rather than killing the stream.
fn parse_sse_frame(frame: &str) -> Option<ChatEvent> {
    let mut data = String::new();
    for line in frame.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.trim_start());
        }
    }
    if data.is_empty() {
        return None;
    }
    match serde_json::from_str(&data) {
        Ok(ev) => Some(ev),
        Err(e) => {
            log::warn!("dropping undecodable SSE frame: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_url_without_a_scheme() {
        let err = PodConnection::new("localhost:3002", "k")
            .unwrap_err()
            .to_string();
        assert!(err.contains("http://"), "{err}");
    }

    #[test]
    fn trims_a_trailing_slash_so_paths_do_not_double_up() {
        let c = PodConnection::new("https://pod.example.com/", "k").unwrap();
        assert_eq!(c.url("/info"), "https://pod.example.com/api/v1/info");
    }

    #[test]
    fn parses_a_data_frame_and_ignores_keepalive_comments() {
        assert!(parse_sse_frame(":keep-alive\n").is_none());
        let ev = parse_sse_frame("data: {\"kind\":\"llm_started\"}\n\n").unwrap();
        assert!(matches!(ev, ChatEvent::LlmStarted));
    }

    #[test]
    fn splits_frames_on_the_blank_line() {
        let buf = "data: {\"kind\":\"llm_started\"}\n\ndata: {\"kind\":\"done\",\"status\":\"completed\"}\n\n";
        let end = find_frame_end(buf).unwrap();
        assert!(matches!(
            parse_sse_frame(&buf[..end]),
            Some(ChatEvent::LlmStarted)
        ));
    }

    #[test]
    fn a_refreshed_token_is_seen_by_the_next_request() {
        let cell: SharedToken = Arc::new(RwLock::new("first".into()));
        let conn =
            PodConnection::with_shared_token("https://pod.example.com", cell.clone()).unwrap();
        assert_eq!(conn.bearer(), "first");
        *cell.write().unwrap() = "second".into();
        assert_eq!(conn.bearer(), "second");
    }
}
