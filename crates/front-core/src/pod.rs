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

    /// What one agent knows. Read-only by construction on the pod side — looking
    /// at an agent's memory must not touch its access counts or decay curve.
    pub async fn instance_memory(&self, id: &str, limit: u32) -> anyhow::Result<InstanceMemory> {
        self.get(&format!("/agents/instances/{id}/memory?limit={limit}"))
            .await
    }

    pub async fn list_presets(&self) -> anyhow::Result<Vec<AgentPresetSummary>> {
        let wrapped: PresetList = self.get("/agent-presets").await?;
        Ok(wrapped.presets)
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

    pub async fn list_keys(&self) -> anyhow::Result<Vec<KeyEntry>> {
        self.get("/keys").await
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

    pub async fn list_agent_packs(&self) -> anyhow::Result<Vec<InstalledAgentPack>> {
        let wrapped: AgentPackList = self.get("/agent-packs").await?;
        Ok(wrapped.agent_packs)
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
                ("reference", reference.to_string()),
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
        let resp = self
            .client
            .post(self.url(path))
            .bearer_auth(self.bearer())
            .json(body)
            .timeout(INSTALL_TIMEOUT)
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
