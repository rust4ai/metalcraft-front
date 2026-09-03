//! Wire types for the pod surfaces metalcraft-front drives.
//!
//! Deliberately loose where the agent is still moving: unknown fields are ignored
//! rather than rejected, and anything the UI only displays is kept as
//! `serde_json::Value`. A desktop app that refuses to list a fleet because a pod
//! added a field is worse than one that shows it a turn late.

use serde::{Deserialize, Serialize};

/// `GET /api/v1/info` — who we are connected to.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentInfo {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub default_persona: Option<String>,
}

/// Where an instance came from. Mirrors the agent's `InstanceOrigin`; drives the
/// origin badge on a fleet card.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InstanceOrigin {
    #[default]
    Workshop,
    Cli,
    Gateway {
        channel: String,
    },
    Flow {
        flow_id: String,
    },
    #[serde(other)]
    Unknown,
}

/// A live agent on the pod — the unit Orca calls a worktree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInstance {
    pub id: String,
    pub agent_preset: String,
    #[serde(default)]
    pub agent_pack: Option<String>,
    pub name: String,
    pub persona: String,
    #[serde(default)]
    pub origin: InstanceOrigin,
    /// Set when the pack that provided this agent's preset withdrew it. The agent
    /// keeps working against a frozen copy — the UI says so rather than pretending.
    #[serde(default)]
    pub orphaned_from: Option<String>,
    /// Set when an update withdrew the persona it was using. The agent's voice
    /// changed and nobody asked for that, so it is reported.
    #[serde(default)]
    pub persona_fallback_from: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub last_active_at: String,
    /// Flattened into the instance by the list endpoint — how many conversations
    /// this agent has accumulated.
    #[serde(default)]
    pub conversation_count: usize,
}

/// A preset as the pod summarises it (`agent_preset::PresetSummary`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPresetSummary {
    pub slug: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tagline: Option<String>,
    /// The agent pack that provided it, if any. Named `pack_id` on the wire.
    #[serde(default)]
    pub pack_id: Option<String>,
    #[serde(default)]
    pub default_persona: Option<String>,
    #[serde(default)]
    pub persona_count: usize,
    /// Pack-provided presets cannot be edited on the pod.
    #[serde(default)]
    pub read_only: bool,
    /// **A library, not an agent.** The preset exists to carry a pack's personas
    /// and skills onto the pod; the pod refuses to mint an instance from it. It is
    /// still listed — the library is a browser and this is a real artifact — but
    /// nothing that starts an agent may offer it.
    ///
    /// Absent on a pod older than the flag, which reads as `false`: the previous
    /// behaviour, where every preset was startable.
    #[serde(default)]
    pub library: bool,
}

/// `GET /agents/instances` — the instance plus what the pod counts alongside it.
#[derive(Debug, Clone, Deserialize)]
pub struct InstanceList {
    #[serde(default)]
    pub instances: Vec<AgentInstance>,
}

/// `GET /agents/instances/{id}/flows` — what this agent does on its own.
#[derive(Debug, Clone, Deserialize)]
pub struct InstanceFlows {
    #[serde(default)]
    pub scheduled: Vec<ScheduledFlow>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PresetList {
    #[serde(default)]
    pub presets: Vec<AgentPresetSummary>,
    /// The preset used when a caller names none.
    #[serde(default)]
    pub default: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentPackList {
    #[serde(default)]
    pub agent_packs: Vec<InstalledAgentPack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSummary {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub instance_id: Option<String>,
    #[serde(default)]
    pub persona_slug: Option<String>,
    #[serde(default)]
    pub model_name: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,
    /// How many turns this conversation holds. `None` from a pod too old to
    /// report it — which is not "no turns", and must not be ranked as if it were.
    #[serde(default)]
    pub turn_count: Option<u32>,
    /// The last thing said, as one line. The only thing that makes a row
    /// identifiable as *this* conversation rather than a timestamp beside an id.
    ///
    /// It was missing here while the UI and the TS type both expected it, so the
    /// pod sent it and this struct quietly dropped it on the way through: every
    /// row in the conversation list read "Nothing said yet".
    #[serde(default)]
    pub preview: Option<String>,
    /// Set when this conversation is a **flow run** rather than something typed.
    /// A flow agent's list is otherwise a column of timestamps: every row is a
    /// run, and none of them says so.
    #[serde(default)]
    pub flow_run: Option<FlowRunRef>,
}

/// Which run of which flow a conversation is.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowRunRef {
    pub flow_id: String,
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatDetail {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub instance_id: Option<String>,
    #[serde(default)]
    pub persona_slug: Option<String>,
    #[serde(default)]
    pub model_name: Option<String>,
    #[serde(default)]
    pub messages: Vec<crate::events::ChatMessage>,
}

/// What a new chat is started as. Every field is optional because the agent has a
/// defensible default for each; sending none reproduces pre-preset behaviour.
#[derive(Debug, Clone, Default, Serialize)]
pub struct NewChat {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_preset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persona_slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// A secret in the pod's key store, masked. Writing one of these is how
/// metalcraft-front binds an interface source (see `InterfaceSource`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyEntry {
    pub name: String,
    #[serde(default)]
    pub masked: String,
    /// `"global"` or `"channel"`.
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub channel_id: Option<String>,
    #[serde(default)]
    pub channel_name: Option<String>,
    /// Platform-injected and read-only — the pod refuses writes to these, so the
    /// UI must not offer one.
    #[serde(default)]
    pub managed: bool,
}

/// The pod's own reading of a pack archive, from `POST /agent-packs/inspect`.
///
/// Deliberately narrow: the fields here are the ones a registry manifest cannot
/// answer. Everything descriptive still comes from the manifest.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentPackPreview {
    /// Credentials the pod does not have yet. A warning, not a blocker — the
    /// pack installs and its tools fail clearly when they are used.
    #[serde(default)]
    pub missing_env: Vec<String>,
    /// Preset slugs another installed pack already provides.
    #[serde(default)]
    pub preset_collisions: Vec<String>,
    /// The version already installed under this id. Present means this is an
    /// upgrade or a downgrade, not a first install.
    #[serde(default)]
    pub installed_version: Option<String>,
    /// Content hash of the archive as received.
    #[serde(default)]
    pub content_sha256: Option<String>,
}

/// Projected firing times for a trigger, from `POST /scheduled-flows/preview`.
///
/// Takes an *unsaved* spec, which is the point: the pod is the only thing that
/// can say whether a cron parses, and until this it only said so after the
/// schedule was armed — as `Invalid cron …` on a row that then never fired.
///
/// An empty `next_runs` on a cron trigger is that failure, visible before
/// saving. (It is also simply what a manual trigger looks like.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulePreview {
    /// Human-readable trigger, e.g. ``"Cron `0 0 8 * * *` (America/Detroit)"``.
    #[serde(default)]
    pub description: String,
    /// The next few firing times, RFC-3339.
    #[serde(default)]
    pub next_runs: Vec<String>,
}

/// One pack a flow requires, and whether this pod has it.
///
/// From `POST /flows/{id}/check-dependencies`, which **reports rather than
/// installs** — fetching a pack from there would be a second install path into a
/// second layout, so a missing one is news to act on, not a thing this fixes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackRequirement {
    pub pack: String,
    /// `"installed" | "already-satisfied" | "skipped" | "failed"`.
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
}

impl PackRequirement {
    /// Whether this pod can actually run the flow's use of this pack.
    pub fn satisfied(&self) -> bool {
        matches!(self.status.as_str(), "installed" | "already-satisfied")
    }
}

/// `POST /flows/{id}/check-dependencies` — what a flow needs, pack by pack.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowDependencies {
    #[serde(default)]
    pub flow: String,
    #[serde(default)]
    pub packs: Vec<PackRequirement>,
}

/// What a pod is set to prefer — `GET /settings`.
///
/// One field so far, and it is the one that decides when things happen: a cron
/// schedule that names no zone is read in this one. Before it existed, such a
/// schedule was read on the pod's own clock — UTC in the cluster — so "08:00"
/// meant the middle of the night unless whoever armed it also typed a zone.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PodSettings {
    /// IANA name, e.g. `America/Detroit`. `None` on a pod nobody has told.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
}

/// One region's worth of timezones — `GET /timezones`.
///
/// From the pod rather than from this machine's own tz database, so a picker
/// offers exactly the names the pod will accept.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TimezoneRegion {
    /// IANA area — `America`, `Europe` — or `UTC`.
    pub region: String,
    /// Full zone names in it, sorted.
    pub zones: Vec<String>,
}

/// A key an *enabled* integration says it needs, from its `requires_env`.
///
/// `configured: false` is the whole point: the pod knows which credentials its
/// installed packs read by name, so a key store can list the ones nobody has
/// filled in yet instead of leaving a pack silently broken until somebody runs a
/// tool and reads the error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendedKey {
    pub name: String,
    /// Resolves from the key store or the environment.
    #[serde(default)]
    pub configured: bool,
    /// Which enabled packs declare it.
    #[serde(default)]
    pub packs: Vec<String>,
    /// Platform-injected and env-authoritative. Show it as provided, never as
    /// something to paste a value into.
    #[serde(default)]
    pub managed: bool,
}

/// Whether the pod can run a turn, and on whose credential — the pod's own answer
/// to a question nothing outside it can answer.
///
/// `list_keys` shows `keys.json`; a provisioned pod's credential is injected as
/// container env and is never in there, so a healthy pod looks keyless from here.
/// Reading that as "cannot think" is how a working pod got reported dead.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceStatus {
    /// A credential resolves. Not a promise the turn *succeeds* — the gateway
    /// still meters credits and wants the account's premium, neither of which the
    /// pod can see.
    pub ready: bool,
    /// `"stored"`, `"environment"`, `"pod_token"`, or `"none"`.
    #[serde(default)]
    pub credential: String,
    /// Where inference is routed, secrets stripped. Absent means OpenAI proper.
    #[serde(default)]
    pub base_url: Option<String>,
    /// Routed at the Metalcraft gateway, so turns bill the account's credits.
    #[serde(default)]
    pub gateway: bool,
}

/// What a chat's context costs — the read behind `/tokens`, and the number a
/// client needs to show headroom before someone hits the wall.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatContext {
    pub estimated_tokens: usize,
    pub message_count: usize,
    pub context_window: usize,
    pub compact_threshold_tokens: usize,
    #[serde(default)]
    pub would_compact: bool,
}

/// The result of a forced compaction — `/compact`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompacted {
    /// False when there was nothing old enough to summarize. Not an error.
    pub compacted: bool,
    pub tokens_before: usize,
    pub tokens_after: usize,
    pub messages_before: usize,
    pub messages_after: usize,
    #[serde(default)]
    pub summary: Option<String>,
}

/// One of the pod's own diagnostics sessions — a run it recorded, listed.
///
/// Distinct from this app's `Diagnostic`, which is the *core's* error log. This
/// is the pod's: what the agent did, on the machine that did it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodSession {
    pub id: String,
    pub timestamp: String,
    #[serde(default)]
    pub persona_slug: Option<String>,
    #[serde(default)]
    pub model_name: Option<String>,
    /// `"session"` for an ordinary run, `"flow"` for a flow run.
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub flow_id: Option<String>,
    #[serde(default)]
    pub instance_id: Option<String>,
    /// How far the run actually got — one per executor step, not per user turn.
    pub turn_count: usize,
}

/// One recorded session in full: its configuration, and every event file the pod
/// wrote for it in order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodSessionDetail {
    pub id: String,
    /// Persona, model, cwd, tools, skills — and the system prompt as actually
    /// built. Untyped because it is the pod's record of its own configuration,
    /// which changes with the pod and not with this client.
    #[serde(default)]
    pub session_info: Option<serde_json::Value>,
    pub timeline: Vec<PodSessionEvent>,
}

/// One file in a session's timeline. `kind` is the pod's classification
/// (`turn`, `llm_request`, `compaction`, `error`); `data` is the file verbatim.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PodSessionEvent {
    pub kind: String,
    pub file: String,
    pub data: serde_json::Value,
}

/// The pod's answer to a stop press. `stopping` is false when nothing was
/// running — the turn ended between the press and the request, which is a race
/// and not an error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatInterrupt {
    pub stopping: bool,
}

/// A **scheduled follow-up**: work the agent armed for later with its
/// `schedule_followup` tool, stored on the pod and fired by the daemon's poll
/// loop (every 30s by default).
///
/// This is the one thing an agent can promise that outlives its own turn. A turn
/// is synchronous, so "I'll check back in 3 minutes" is a lie unless the agent
/// armed one of these — and until this shape reached the desktop, an armed
/// follow-up and an invented one looked exactly alike from the chat. That is the
/// whole reason it is here: the countdown is the receipt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    /// The chat the result is delivered to. `None` for a gateway-bound or
    /// unbound job, whose reply is logged rather than said to anyone here.
    #[serde(default)]
    pub chat_id: Option<String>,
    /// RFC-3339. The daemon fires *at or after* this, on its next poll tick, so
    /// treat it as "not before" rather than an exact moment.
    pub run_at: String,
    #[serde(default)]
    pub created_at: String,
    /// The instruction the wakeup sub-agent runs. Self-contained by contract —
    /// which also makes it the honest label for the countdown.
    #[serde(default)]
    pub task: String,
    #[serde(default)]
    pub persona: Option<String>,
    /// `pending` | `running` | `done` | `failed` | `cancelled`.
    #[serde(default)]
    pub status: String,
    /// How many times this chain has re-armed itself. The pod caps it at 12; a
    /// follow-up deep in that chain is one worth being able to see and stop.
    #[serde(default)]
    pub reschedule_depth: u32,
}

impl ScheduledTask {
    /// Still going to happen — the only status a countdown belongs on.
    pub fn is_pending(&self) -> bool {
        self.status == "pending" || self.status == "running"
    }
}

/// A host the pod is willing to fetch agent packs from.
///
/// The pod returns these (rather than only enforcing them) so a UI can say what it
/// accepts *before* someone pastes a link and gets refused. Axoniac Prime is one
/// such host; packs.metalcraftai.com is a peer, not an upstream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Registry {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub trust: Option<String>,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Registries {
    #[serde(default)]
    pub origins: Vec<String>,
    #[serde(default)]
    pub default: String,
    #[serde(default)]
    pub registries: Vec<Registry>,
}

/// An agent pack installed on the pod.
///
/// Flat, deliberately. The pod answers `GET /agent-packs` with `{"id", "root",
/// "manifest": {...}}` and every field worth showing — the version, the name, the
/// presets — is one level down. Left alone, `version` was `None` for every pack
/// ever listed, which is not a cosmetic loss: it is what a UI compares against a
/// registry's version to know an update exists, so the comparison silently could
/// not happen.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledAgentPack {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub presets: Vec<String>,
    /// The nested form, read on the way in and folded into the fields above by
    /// [`InstalledAgentPack::flattened`]. Never sent onward — callers get one
    /// shape, not two.
    #[serde(default, skip_serializing)]
    pub manifest: Option<AgentPackFields>,
}

/// What updating an installed pack did — to the pack, and to the agents made from
/// it.
///
/// The second half is the reason `POST /agent-packs/{id}/update` exists and
/// `install` is not a substitute for it. Installing over a pack replaces files;
/// updating reconciles what was already running against them: an agent whose
/// persona the new version withdrew is moved to the preset's default rather than
/// left pointing at a persona that is gone, an agent whose *preset* was withdrawn
/// keeps working from a frozen copy instead of resolving to nothing, and every
/// affected agent's memory base is repointed so the change is live on the next
/// turn rather than after a restart.
///
/// All three are silent when they happen. Carrying them back means the person who
/// pressed Update is told which of their agents changed underneath them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PackUpdateReport {
    pub id: String,
    #[serde(default)]
    pub from_version: String,
    #[serde(default)]
    pub to_version: String,
    /// Live agents whose persona was withdrawn, and what they fell back to.
    #[serde(default)]
    pub personas_fell_back: Vec<PersonaFallback>,
    /// Live agents whose preset the new version no longer ships.
    #[serde(default)]
    pub orphaned: Vec<OrphanedAgent>,
    /// Agents now resolving against the new version's shipped knowledge.
    #[serde(default)]
    pub memory_bases_repointed: Vec<String>,
    /// The install underneath, for the requirements the new version added.
    #[serde(default)]
    pub install: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaFallback {
    pub instance: String,
    #[serde(default)]
    pub name: String,
    /// The persona the new version no longer provides.
    pub from: String,
    /// The preset's default, which it now uses instead.
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrphanedAgent {
    pub instance: String,
    #[serde(default)]
    pub name: String,
    pub agent_preset: String,
    /// Personas and skills copied into the user-local layer so it still runs.
    #[serde(default)]
    pub frozen: Vec<String>,
}

/// The subset of a pack's manifest the desktop reads.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentPackFields {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub presets: Vec<String>,
}

impl InstalledAgentPack {
    /// Fold the nested manifest up into the flat fields, keeping anything the pod
    /// already answered at the top level — a pod that flattens these itself later
    /// must not be overwritten by this.
    pub fn flattened(mut self) -> Self {
        if let Some(m) = self.manifest.take() {
            self.name = self.name.or(m.name);
            self.version = self.version.or(m.version);
            self.description = self.description.or(m.description);
            if self.presets.is_empty() {
                self.presets = m.presets;
            }
        }
        self
    }
}


// ── Goals ────────────────────────────────────────────────────────────────────

/// A long-running goal: what the pod is working towards on its own.
///
/// The desktop's view of it is deliberately the pod's list row, not the whole
/// record. A goal's real state is a markdown scratchpad, and everything a list
/// needs to draw — where it is, whether it needs somebody — the pod derives and
/// sends, so no client ever parses that document to render a progress bar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    /// Short handle for lists.
    #[serde(default)]
    pub title: String,
    /// The instruction itself, verbatim. Shown in full on the detail screen: it
    /// is what the agent reads every tick, so it is what a person is really
    /// editing when they change their mind.
    #[serde(default)]
    pub goal: String,
    /// `build` | `audit`.
    #[serde(default)]
    pub kind: String,
    /// `active` | `blocked` | `paused` | `done` | `failed`.
    #[serde(default)]
    pub status: String,
    /// The question it stopped on. Present only when blocked, and the whole
    /// reason that state has to be loud.
    #[serde(default)]
    pub blocked_reason: Option<String>,
    #[serde(default)]
    pub instance_id: String,
    #[serde(default)]
    pub progress: ProjectProgress,
    #[serde(default)]
    pub ticks: u32,
    #[serde(default)]
    pub last_tick_at: Option<String>,
    /// When it next wakes. Absent for a goal that is not going to.
    #[serde(default)]
    pub next_tick_at: Option<String>,
    #[serde(default)]
    pub every_minutes: u32,
    #[serde(default)]
    pub created_at: String,
}

impl Project {
    /// Whether this goal is waiting on a person. The one state the list has to
    /// shout about: nothing else will ever mention it again, because the
    /// heartbeat that would have is what stopped.
    pub fn needs_attention(&self) -> bool {
        self.status == "blocked"
    }
    /// Whether it is still working.
    pub fn is_running(&self) -> bool {
        self.status == "active"
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ProjectProgress {
    #[serde(default)]
    pub done: u32,
    #[serde(default)]
    pub total: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectList {
    #[serde(default)]
    pub goals: Vec<Project>,
    #[serde(default)]
    pub active: usize,
    #[serde(default)]
    pub max_active: usize,
}

/// One goal, with the document that is its whole memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDetail {
    #[serde(flatten)]
    pub goal: Project,
    /// The scratchpad, verbatim markdown. Rendered read-only by default and
    /// editable as the repair hatch — a groom that went wrong is otherwise only
    /// fixable by asking the agent nicely.
    #[serde(default)]
    pub scratchpad: String,
    #[serde(default)]
    pub needs_groom: bool,
}

/// One line of what a goal did, per tick.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectJournalEntry {
    #[serde(default)]
    pub at: String,
    #[serde(default)]
    pub tick: u32,
    /// `plan` | `work` | `review`.
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub plan_done: u32,
    #[serde(default)]
    pub plan_total: u32,
    /// False when the tick left the scratchpad untouched — it thought, spent,
    /// and recorded nothing. Worth showing: a run of these is what the pod's own
    /// no-progress rail is counting.
    #[serde(default)]
    pub progressed: bool,
    #[serde(default)]
    pub duration_secs: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectJournal {
    #[serde(default)]
    pub entries: Vec<ProjectJournalEntry>,
}

/// What creating a goal needs. Everything but `goal` has a defensible default,
/// because this is a form somebody fills in once and then leaves running.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct NewProject {
    pub goal: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub every_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_id: Option<String>,
    /// Create it paused, to read the plan before it starts spending.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub paused: bool,
}

/// A change to a goal. Every field optional: the same shape answers a question,
/// pauses it, retargets it, and changes its cadence.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ProjectUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// The answer to what it blocked on. Sending one un-blocks the goal by
    /// itself — replying *is* saying carry on, and making someone also flip a
    /// switch would be a second step whose omission looks like being ignored.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub every_minutes: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real answer from `GET /api/v1/agent-packs`, which keeps the version and
    /// the presets one level down. A pack whose version does not survive the trip
    /// can never be shown as out of date.
    #[test]
    fn an_installed_pack_takes_its_version_from_the_nested_manifest() {
        let json = r#"{"agent_packs":[{"id":"buildr-space","root":"/data/agent_packs/buildr-space",
            "manifest":{"id":"buildr-space","handle":"buildr_space","name":"buildr.space",
            "version":"0.1.1","presets":["buildr-space"]}}]}"#;
        let list: AgentPackList = serde_json::from_str(json).unwrap();
        let pack = list.agent_packs.into_iter().next().unwrap().flattened();
        assert_eq!(pack.id, "buildr-space");
        assert_eq!(pack.version.as_deref(), Some("0.1.1"));
        assert_eq!(pack.name.as_deref(), Some("buildr.space"));
        assert_eq!(pack.presets, ["buildr-space"]);
    }

    /// A pod that answers flat is answering for itself. Folding must not clobber it.
    #[test]
    fn a_flat_answer_wins_over_the_nested_one() {
        let json = r#"{"id":"p","version":"2.0.0","presets":["a"],
            "manifest":{"version":"1.0.0","presets":["b"]}}"#;
        let pack: InstalledAgentPack = serde_json::from_str(json).unwrap();
        let pack = pack.flattened();
        assert_eq!(pack.version.as_deref(), Some("2.0.0"));
        assert_eq!(pack.presets, ["a"]);
    }

    /// Shapes copied from the agent's handlers. If the pod changes one of these,
    /// this is where it should break — not in a panel that silently shows zero
    /// agents.
    #[test]
    fn instance_list_unwraps_and_keeps_the_flattened_count() {
        let json = r#"{"instances":[{"id":"i1","agent_preset":"general-agent","name":"Amy",
            "persona":"orchestrator-agent","origin":{"kind":"workshop"},
            "created_at":"2026-08-01T00:00:00Z","last_active_at":"2026-08-02T00:00:00Z",
            "conversation_count":3}]}"#;
        let list: InstanceList = serde_json::from_str(json).unwrap();
        assert_eq!(list.instances[0].conversation_count, 3);
        assert!(matches!(list.instances[0].origin, InstanceOrigin::Workshop));
    }

    #[test]
    fn a_gateway_instance_keeps_its_channel() {
        let json = r#"{"id":"i2","agent_preset":"p","name":"n","persona":"x",
            "origin":{"kind":"gateway","channel":"metalcraft"},"created_at":"","last_active_at":""}"#;
        let i: AgentInstance = serde_json::from_str(json).unwrap();
        match i.origin {
            InstanceOrigin::Gateway { channel } => assert_eq!(channel, "metalcraft"),
            other => panic!("expected gateway, got {other:?}"),
        }
    }

    #[test]
    fn preset_list_unwraps_and_reads_pack_id() {
        // The pod calls it `pack_id`, not `agent_pack` — the field the New agent
        // dialog shows to say where a preset came from.
        let json = r#"{"presets":[{"slug":"amy","name":"Amy","description":"d","tagline":null,
            "default_persona":"chef","persona_count":2,"pack_id":"amy_kitchen","read_only":true}],
            "default":"general-agent"}"#;
        let list: PresetList = serde_json::from_str(json).unwrap();
        assert_eq!(list.presets[0].pack_id.as_deref(), Some("amy_kitchen"));
        assert!(list.presets[0].read_only);
        assert_eq!(list.default.as_deref(), Some("general-agent"));
    }

    #[test]
    fn a_managed_key_is_flagged_so_the_ui_does_not_offer_to_edit_it() {
        let json =
            r#"[{"name":"METALCRAFT_TOKEN","masked":"mck_…1234","scope":"global","managed":true}]"#;
        let keys: Vec<KeyEntry> = serde_json::from_str(json).unwrap();
        assert!(keys[0].managed);
        assert_eq!(keys[0].scope, "global");
    }

    #[test]
    fn an_unknown_origin_kind_does_not_fail_the_whole_fleet() {
        let i: AgentInstance = serde_json::from_str(
            r#"{"id":"i","agent_preset":"p","name":"n","persona":"x",
                "origin":{"kind":"telepathy"},"created_at":"","last_active_at":""}"#,
        )
        .unwrap();
        assert!(matches!(i.origin, InstanceOrigin::Unknown));
    }
}

/// One persona an instance may be switched to, as `GET /agent-presets/{slug}`
/// resolves it.
///
/// `installed: false` is not an error to hide: a pack can name a persona that is
/// not on this pod, and a row reading "morning-briefer — not installed" tells the
/// user why the switch they expected is unavailable. The agent resolves this
/// server-side precisely so a client can render it without N more round-trips.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RosterPersona {
    pub slug: String,
    #[serde(default)]
    pub installed: bool,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub error: Option<String>,
}

/// `GET /agent-presets/{slug}` — the preset plus its resolved persona roster.
///
/// Both halves are needed and they answer different questions: `preset` is what
/// the file *declares* (its skills, its integrations, the keys it needs, the
/// model floor it wants), `personas` is what this pod could actually *find*. The
/// roster alone was enough while this endpoint only fed the persona switcher;
/// the library's preset page is about the declaration, so `preset` stopped being
/// discarded.
///
/// `Option`, because a pod older than the typed response omits it — a missing
/// declaration renders as a thinner page, not as a failed load.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PresetDetail {
    #[serde(default)]
    pub preset: Option<AgentPresetDetail>,
    #[serde(default)]
    pub personas: Vec<RosterPersona>,
}

/// `GET /agents/instances/{id}/memory` — what one agent knows.
///
/// The shipped/learned split is the point: memories a pack gave the agent and
/// memories it formed itself are different kinds of claim, and `forgotten`
/// records shipped ones it has been told to drop.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct InstanceMemory {
    #[serde(default)]
    pub instance_id: String,
    /// `<preset>@<version>` when this agent was shipped a knowledge base.
    #[serde(default)]
    pub base: Option<String>,
    #[serde(default)]
    pub shipped: usize,
    #[serde(default)]
    pub learned: usize,
    #[serde(default)]
    pub forgotten: usize,
    #[serde(default)]
    pub sample: Vec<MemorySample>,
    /// How the machinery behind those counts is configured, and when it last ran.
    ///
    /// `#[serde(default)]` like everything else here, and load-bearing: a pod
    /// older than the dream serves this view without the field, and the rail has
    /// to render what it does have rather than fail to parse the response.
    #[serde(default)]
    pub system: Option<MemorySystemStatus>,
}

/// The state of the memory subsystem for one agent — what is switched on, what is
/// waiting to be distilled, and what the dream did about it last.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct MemorySystemStatus {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub capture_enabled: bool,
    #[serde(default)]
    pub recall_enabled: bool,
    /// Turns captured but not yet distilled. A number that only grows means a
    /// dream that is not running.
    #[serde(default)]
    pub pending_captures: usize,
    #[serde(default)]
    pub by_kind: Vec<KindCount>,
    #[serde(default)]
    pub links: usize,
    #[serde(default)]
    pub archived: usize,
    #[serde(default)]
    pub superseded: usize,
    #[serde(default)]
    pub dream: DreamStatus,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct KindCount {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub count: usize,
}

/// When the nightly dream runs, and what happened the last time it did.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct DreamStatus {
    #[serde(default)]
    pub nightly_enabled: bool,
    #[serde(default)]
    pub cron: String,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub active_days: i64,
    #[serde(default)]
    pub next_run_at: Option<String>,
    #[serde(default)]
    pub last_run_at: Option<String>,
    /// One line on what the last run did, written by the pod to be printed.
    #[serde(default)]
    pub last_summary: Option<String>,
    #[serde(default)]
    pub last_trigger: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
}

/// One run of the dream, as the pod reports it.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct DreamReport {
    #[serde(default)]
    pub instance_id: String,
    #[serde(default)]
    pub trigger: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub started_at: String,
    #[serde(default)]
    pub finished_at: String,
    #[serde(default)]
    pub stages: Vec<DreamStageReport>,
    #[serde(default)]
    pub memories_before: usize,
    #[serde(default)]
    pub memories_after: usize,
    #[serde(default)]
    pub captures_pending_before: usize,
    #[serde(default)]
    pub captures_pending_after: usize,
    #[serde(default)]
    pub snapshot_written: bool,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct DreamStageReport {
    #[serde(default)]
    pub stage: u8,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub ran: bool,
    #[serde(default)]
    pub counts: std::collections::BTreeMap<String, usize>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub millis: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemorySample {
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub importance: f32,
    /// `"shipped"` or `"learned"`.
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub entity: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// An **integration pack** installed on the pod (`GET /integrations`).
///
/// Not to be confused with an *agent pack* (`AgentPresetSummary`, PLAN §9.4).
/// They are separate systems with separate registries and separate pod routes:
/// agent packs bring presets and personas from axoniac, integration packs bring
/// HTTP tools from packs.metalcraftai.com. The `octaweave` pack is the second
/// kind, which PLAN §9.3 got wrong by calling it an agent pack.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Integration {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub personas: usize,
    #[serde(default)]
    pub skills: usize,
    #[serde(default)]
    pub api_tools: usize,
    #[serde(default)]
    pub flow_templates: usize,
    /// Keys this pack needs in the pod's key store to actually work.
    #[serde(default)]
    pub requires_env: Vec<String>,
}

// ── The library: what is actually installed on this pod ─────────────────────
//
// Every type below is a *read*. The pod is the authority on what it holds, and
// this app's job here is to make that legible — an agent pack is a delivery
// mechanism, but what an agent actually runs on is a preset naming personas
// naming skills and integrations, and until you can walk that graph the pod is
// a box you install things into and never see inside.
//
// The shapes are the pod's own (`ProjectSnapshot`, `PersonaSummary`, `Skill`,
// …). Every field past the identifier is `#[serde(default)]`, because these are
// the surfaces the agent moves most and a library that refuses to list anything
// because one artifact grew a field is worse than one that renders it plainly.

/// `GET /api/v1/snapshot` — everything installed, in one call.
///
/// The reason this is one request rather than six: personas and skills have no
/// list route of their own (only `/personas/{slug}`), so the snapshot is the
/// *only* way to enumerate them. Agent packs and integrations are fetched
/// alongside it because they are the two artifact kinds it leaves out.
///
/// Fields the library does not render — `sessions`, `keys`, `flows`,
/// `agent_instances` — are dropped on the way in rather than carried and
/// ignored: each already has a surface of its own, and the pod's key summaries
/// have no business crossing into a webview twice.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PodSnapshot {
    #[serde(default)]
    pub agent_presets: Vec<AgentPresetSummary>,
    #[serde(default)]
    pub personas: Vec<PersonaSummary>,
    #[serde(default)]
    pub skills: Vec<SkillSummary>,
    #[serde(default)]
    pub api_tools: Vec<ApiToolSummary>,
    /// Which preset a pod with nothing selected runs as. Rendered as a badge on
    /// that preset — "this is what your pod is when nobody said otherwise".
    #[serde(default)]
    pub default_agent_preset: String,
}

/// One persona in the snapshot's roster. `pack_id` is what makes a persona
/// *sub-linkable*: set means an integration provided it, absent means someone
/// wrote it on this pod.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaSummary {
    pub slug: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub pack_id: Option<String>,
    #[serde(default)]
    pub read_only: bool,
}

/// A skill without its body — the listing shape. The body is one `/skills/{slug}`
/// away and is the whole point of the show page, so it is never sent in bulk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSummary {
    pub slug: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub pack_id: Option<String>,
    #[serde(default)]
    pub read_only: bool,
}

/// An HTTP API tool, as the snapshot lists it. Named `name` rather than `slug`
/// because that is the string a model calls it by.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiToolSummary {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub pack_id: Option<String>,
    #[serde(default)]
    pub read_only: bool,
}

/// `GET /api/v1/personas/{slug}` — the persona itself.
///
/// The wire shape carries no slug (it is in the path), so the caller keeps the
/// one it navigated with. `integrations` is a whole-integration grant: every
/// HTTP tool that integration provides joins the persona's tool set without
/// being named, which is why a show page has to render it *beside* `tools`
/// rather than folded into it — the two lists mean different things.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PersonaDetail {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    /// Reads `packs` too — the field's name before integrations stopped being
    /// separately installable. Personas carrying the old name are already on
    /// people's pods, so both are accepted.
    #[serde(default, alias = "packs")]
    pub integrations: Vec<String>,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub version: Option<String>,
}

/// `GET /api/v1/skills/{slug}` — frontmatter plus the markdown body the agent
/// actually loads.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkillDetail {
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub pack_id: Option<String>,
    #[serde(default)]
    pub read_only: bool,
}

/// The preset as its own file declares it — the half `PresetDetail` used to
/// throw away.
///
/// This is the richest artifact on the pod and the one worth a real show page:
/// it names personas, skills and integrations, states what it needs in the key
/// store, and declares a *capability floor* rather than a model. Every one of
/// those is a link to another artifact, which is the whole reason the library
/// exists rather than a flat list.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentPresetDetail {
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub tagline: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub default_persona: String,
    #[serde(default)]
    pub personas: Vec<PresetPersona>,
    #[serde(default)]
    pub skills: Vec<String>,
    /// Reads `integration_packs` too — the pre-0.30 name, still in every preset
    /// authored before the rename.
    #[serde(default, alias = "integration_packs")]
    pub integrations: Vec<String>,
    #[serde(default)]
    pub requires_env: Vec<String>,
    #[serde(default)]
    pub model: Option<ModelFloor>,
    #[serde(default)]
    pub memories: Option<MemoriesRef>,
    /// See [`AgentPresetSummary::library`] — the show page reads it from here so
    /// it does not have to find the preset in the snapshot to know.
    #[serde(default)]
    pub library: bool,
    #[serde(default)]
    pub manifest_version: u32,
}

/// A persona as the *preset* names it, before resolution. Distinct from
/// [`RosterPersona`], which is the same entry after the pod has tried to find it
/// — the show page renders them zipped, so a persona the preset wants and the
/// pod lacks reads as a gap rather than an absence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetPersona {
    pub slug: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
}

/// **A capability floor, not a model name.** A preset that hard-codes `gpt-5.4`
/// breaks on a pod without it, so it declares what it needs and the pod maps
/// that onto what it has. `prefer` is a hint and is labelled as one.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelFloor {
    #[serde(default)]
    pub tier: Option<String>,
    #[serde(default)]
    pub prefer: Option<String>,
    #[serde(default)]
    pub min_context: Option<u32>,
    #[serde(default)]
    pub needs: Vec<String>,
}

/// The seed memories an agent pack ships with a preset — what an agent spawned
/// from it knows before its first turn.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MemoriesRef {
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub count: u32,
    #[serde(default)]
    pub dims: Option<u32>,
    #[serde(default)]
    pub embed_model: Option<String>,
}

/// `GET /api/v1/integrations/{id}` — the integration with its contents named
/// rather than counted.
///
/// The list route ([`Integration`]) gives four numbers; this gives four lists,
/// and each entry is another artifact to open. Same distinction as everywhere
/// else in this file: a count tells you how big something is, a name lets you go
/// there.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IntegrationDetail {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub personas: Vec<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub api_tools: Vec<String>,
    #[serde(default)]
    pub flow_templates: Vec<String>,
    #[serde(default)]
    pub requires_env: Vec<String>,
}

/// `GET /api/v1/flow-templates` — the automations a pack shipped, before anyone
/// installed one as a flow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowTemplateSummary {
    pub slug: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub pack_id: Option<String>,
}

// ── Automations (the pod calls them flows) ──────────────────────────────────
//
// Vocabulary, decided once and held to: the pod says *flow* on the wire and this
// crate matches it, because these types are that wire. The renderer says
// **Automation**, because what a person arms is not a graph — it is a standing
// instruction. See `~/ai/metalcraft-agent/docs/FLOWS_AS_AGENTS_PLAN.md` §2.1.

/// One flow on the pod — the *work*, from `GET /flows` (the agent's `FlowListItem`).
///
/// **When** it runs is not here. Since spec v3 that is a separate artifact:
/// [`ScheduledFlow`], listed in one call by `GET /scheduled-flows` and joined
/// against this by `flow_id`. A flow with `scheduled_count == 0` never runs on its
/// own, which is the normal state for anything an agent pack just installed.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Flow {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub node_count: usize,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    /// v2 flows run on the state-machine executor; v1 flows are the legacy
    /// prompt-list shape and answer `/run` differently.
    #[serde(default)]
    pub v2: bool,
    /// The agent preset this flow runs as. Always populated: unbound resolves to
    /// the pod's default agent.
    #[serde(default)]
    pub preset: String,
    /// How many schedules point at this flow.
    #[serde(default)]
    pub scheduled_count: usize,
    /// Of those, how many are enabled. Zero means nothing fires — including when
    /// `scheduled_count` is not zero, which is a paused automation rather than an
    /// unscheduled one, and should read differently in the UI.
    #[serde(default)]
    pub enabled_count: usize,
}

impl Flow {
    /// Whether this flow will run on its own.
    pub fn is_armed(&self) -> bool {
        self.enabled_count > 0
    }
}

/// One scheduled flow: *when* a flow runs, as its own artifact on the pod
/// (`GET /scheduled-flows`).
///
/// Creating one is arming — it also creates the agent the runs belong to —
/// and deleting one is disarming, which keeps that agent and its memory.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScheduledFlow {
    /// Opaque, pod-generated (`sf_…`). Not for display: use
    /// [`ScheduledFlow::label`].
    pub id: String,
    /// The flow this runs.
    #[serde(default)]
    pub flow_id: String,
    /// Name of that flow, absent when it no longer exists — a schedule that can
    /// never fire, which should read as broken rather than as fine.
    #[serde(default)]
    pub flow_name: Option<String>,
    /// Whether it fires. The only switch there is.
    #[serde(default)]
    pub enabled: bool,
    /// The trigger and its overrides.
    #[serde(default)]
    pub schedule: ScheduleSpec,
    /// The agent it runs as, so successive firings remember each other.
    #[serde(default)]
    pub instance_id: Option<String>,
    /// Absent if the agent was deleted out from under it.
    #[serde(default)]
    pub instance_name: Option<String>,
    /// The pod's own rendering of the trigger — `"Every 5 minute(s)"`, or
    /// ``"Invalid cron `0 8 * * *`: …"`` when it cannot parse. Show it verbatim: a
    /// schedule that will never fire should look broken rather than merely empty.
    #[serde(default)]
    pub description: String,
    /// Next projected fire, absent for a manual (or unparseable) trigger.
    #[serde(default)]
    pub next_fire_at: Option<String>,
}

impl ScheduledFlow {
    /// What to show a person: the schedule's name, else the pod's description of
    /// the trigger. Never the id, which is deliberately meaningless.
    pub fn label(&self) -> &str {
        match self.schedule.name.as_deref() {
            Some(n) if !n.trim().is_empty() => n,
            _ => &self.description,
        }
    }
}

/// A trigger plus the overrides applied to the runs it starts.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ScheduleSpec {
    /// The trigger tag: `manual` | `minutes` | `hours` | `cron`.
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cron: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    /// Persona override for runs from this schedule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona: Option<String>,
    /// Inputs handed to the flow when this fires.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inputs: Option<serde_json::Value>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ScheduledFlowList {
    #[serde(default)]
    pub scheduled: Vec<ScheduledFlow>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct FlowList {
    #[serde(default)]
    pub flows: Vec<Flow>,
}

/// A persisted flow run. Only runs that **paused** are persisted by the pod, so
/// this list is mostly "what is waiting on a human", which is exactly what makes
/// it worth showing.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FlowRun {
    pub id: String,
    #[serde(default)]
    pub flow_id: String,
    /// `running` | `paused` | `completed` | `failed`.
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub current_node_id: String,
    /// The agent this run belongs to, when a schedule armed one.
    #[serde(default)]
    pub instance_id: Option<String>,
    /// The conversation this run wrote — the link from "it ran" to "here is what
    /// it said".
    ///
    /// A run is an agent plus a chat: arming mints the instance, and the first
    /// node that actually speaks opens a conversation in it. Absent for a run
    /// with no agent, and for a tool-only flow that never spoke — neither of
    /// which leaves a transcript to point at.
    #[serde(default)]
    pub chat_id: Option<String>,
    #[serde(default)]
    pub pause: Option<FlowPause>,
    /// Missing packs/personas noticed when the run started — a run that cannot
    /// fully work, saying so.
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// Why a run is paused and what would resume it.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FlowPause {
    /// `"approval"` or `"wait"`.
    #[serde(default)]
    pub reason: String,
    /// For an approval: the decisions a human may take. For a wait: `["after"]`.
    #[serde(default)]
    pub resume_handles: Vec<String>,
    /// The (interpolated) prompt shown to the human.
    #[serde(default)]
    pub message: Option<String>,
    /// RFC-3339 time at/after which a `wait` may resume.
    #[serde(default)]
    pub wake_at: Option<String>,
}

/// `GET /flows/{id}/binding` — everything the arm dialog needs.
///
/// Arming is the second consent moment after installing a pack, and the sharper
/// one: an armed automation acts **while nobody is watching**, so a mutating tool
/// inside it is a bigger commitment than the same tool in a chat where an approval
/// prompt exists.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FlowBinding {
    #[serde(default)]
    pub flow_id: String,
    #[serde(default)]
    pub preset: String,
    /// The preset was chosen deliberately rather than defaulted.
    #[serde(default)]
    pub bound: bool,
    #[serde(default)]
    pub personas: Vec<FlowPersonaCheck>,
    #[serde(default)]
    pub armed: Vec<ArmedSchedule>,
    #[serde(default)]
    pub consent: ArmConsent,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FlowPersonaCheck {
    #[serde(default)]
    pub slug: String,
    /// Whether the flow's preset can reach this persona — the containment rule.
    #[serde(default)]
    pub allowed: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ArmedSchedule {
    #[serde(default)]
    pub schedule_id: String,
    #[serde(default)]
    pub instance_id: String,
    #[serde(default)]
    pub instance_name: Option<String>,
}

/// The resolved content of the arm dialog.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ArmConsent {
    #[serde(default)]
    pub preset_name: String,
    /// Origins its tools can reach.
    #[serde(default)]
    pub domains: Vec<String>,
    #[serde(default)]
    pub requires_env: Vec<String>,
    /// Credentials this pod does not have — those tools fail at 3am rather than
    /// at a moment anyone is looking. The sharpest field here.
    #[serde(default)]
    pub missing_env: Vec<String>,
    /// Tools that can change something on the other end.
    #[serde(default)]
    pub mutating_tools: Vec<String>,
    #[serde(default)]
    pub tool_count: usize,
    /// Seed memories the agent starts from; it accumulates more every run.
    #[serde(default)]
    pub base_memories: usize,
}

#[cfg(test)]
mod automation_tests {
    use super::*;

    /// The pod flattens each scheduled flow's stored document into the same object
    /// that carries `instance_name` / `next_fire_at`, so the wire has one shape
    /// rather than two. Pinned here because that flattening is easy to break on the
    /// pod side and the failure would be silent: serde would leave `kind`/`cron`
    /// empty and the UI would render a schedule with no trigger.
    const LISTING: &str = r#"{
      "flows": [{
        "id": "brief", "name": "Morning brief",
        "node_count": 2, "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-02T00:00:00Z", "v2": true,
        "preset": "amy-kitchen", "scheduled_count": 2, "enabled_count": 1
      }]
    }"#;

    const SCHEDULED: &str = r#"{
      "scheduled": [
        { "id": "sf_abc123", "flow_id": "brief", "flow_name": "Morning brief",
          "enabled": true,
          "schedule": { "type": "cron", "cron": "0 0 8 * * *", "name": "Morning brief",
                        "timezone": "America/Detroit" },
          "instance_id": "inst_abc", "instance_name": "Amy — Morning brief",
          "description": "Cron `0 0 8 * * *` (America/Detroit)",
          "next_fire_at": "2026-08-24T08:00:00-04:00" },
        { "id": "sf_def456", "flow_id": "brief", "flow_name": "Morning brief",
          "enabled": false,
          "schedule": { "type": "manual" },
          "description": "Manual (runs only when triggered)" }
      ]
    }"#;

    #[test]
    fn a_flow_listing_says_how_much_is_scheduled_without_saying_when() {
        let list: FlowList = serde_json::from_str(LISTING).expect("parse listing");
        let flow = &list.flows[0];
        assert_eq!(flow.preset, "amy-kitchen");
        assert_eq!(flow.scheduled_count, 2);
        assert_eq!(flow.enabled_count, 1);
        assert!(flow.is_armed(), "one of the two fires");
    }

    #[test]
    fn a_schedule_carries_the_agent_it_runs_as() {
        let list: ScheduledFlowList = serde_json::from_str(SCHEDULED).expect("parse schedules");
        let armed = &list.scheduled[0];
        assert_eq!(armed.flow_id, "brief");
        assert_eq!(armed.schedule.kind, "cron");
        assert_eq!(armed.schedule.cron.as_deref(), Some("0 0 8 * * *"));
        assert_eq!(armed.instance_id.as_deref(), Some("inst_abc"));
        assert!(armed.next_fire_at.is_some());
        assert_eq!(armed.label(), "Morning brief");

        // Paused: it exists, names no agent, and has nothing coming up. Distinct
        // from "not scheduled at all", which is simply no row here.
        let paused = &list.scheduled[1];
        assert!(!paused.enabled);
        assert_eq!(paused.schedule.kind, "manual");
        assert!(paused.instance_id.is_none());
        assert!(paused.next_fire_at.is_none());
        // Unnamed: falls back to the pod's description, never the opaque id.
        assert_eq!(paused.label(), "Manual (runs only when triggered)");
    }

    #[test]
    fn a_paused_run_says_what_it_is_waiting_for() {
        let run: FlowRun = serde_json::from_str(
            r#"{ "id": "run_1", "flow_id": "brief", "status": "paused",
                 "current_node_id": "approve", "instance_id": "inst_abc",
                 "pause": { "reason": "approval",
                            "resume_handles": ["approve", "reject"],
                            "message": "Order 3 items?" },
                 "variables": { "x": 1 }, "steps": [], "persona": "amy",
                 "model": "gpt-5", "cwd": ".",
                 "created_at": "2026-08-22T00:00:00Z",
                 "updated_at": "2026-08-22T00:00:00Z" }"#,
        )
        .expect("parse run");
        let pause = run.pause.expect("paused runs carry their pause");
        assert_eq!(pause.reason, "approval");
        assert_eq!(pause.resume_handles, ["approve", "reject"]);
        // `variables`, `steps`, `persona`, `model`, `cwd` are the executor's
        // business: ignored here rather than modelled, so a pod-side addition to
        // the run record cannot break this client.
    }
}

/// What `POST /flows/{id}/run` answers with for a v2 flow.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FlowRunSummary {
    #[serde(default)]
    pub run_id: String,
    #[serde(default)]
    pub flow_id: String,
    /// `completed` | `failed` | `paused`, or whatever the terminal `end` node
    /// declared as its status.
    #[serde(default)]
    pub status: String,
    /// The conversation the run wrote itself into, when it had an agent and
    /// something to say. This is the link from "it ran" to "here is what it did".
    #[serde(default)]
    pub chat_id: Option<String>,
    /// Non-fatal notes — a missing pack, or an ambiguity the pod refused to guess
    /// through. Worth showing: they are why a run did less than expected.
    #[serde(default)]
    pub warnings: Vec<String>,
}

// ── The Metalcraft Gateway: WhatsApp and SMS ────────────────────────────────
//
// The pod is the source of truth for this connection, not the gateway and not
// the control plane (`metalcraft-gateway/src/controllers/agent.rs` says so in as
// many words: the gateway's own web UI is a stateless proxy to the pod). So
// these shapes are the pod's `/api/v1/gateway/metalcraft/*` surface, and the
// desktop asks the same endpoints the Workshop did rather than opening a second
// account-level client of its own.

// ── Factory reset ────────────────────────────────────────────────────────

/// How much of a pod to erase. Mirrors the agent's `ResetScope`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResetScope {
    /// Everything, including the key store. The only scope that genuinely
    /// replays a first run, so it is the default here as it is on the pod.
    #[default]
    Full,
    /// Everything but `keys.json`, so a bound source survives.
    KeepKeys,
}

/// Whether the pod expects to come back by itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RestartExpectation {
    Supervised,
    /// Nothing is watching the process. It exits, and stays down until someone
    /// starts it — the case the UI has to warn about *before* the button, not
    /// after, because afterwards there is no pod left to be told by.
    Manual,
}

/// One entry the wipe could not remove.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ResetFailure {
    pub name: String,
    pub error: String,
}

/// The pod's last word before it restarts.
///
/// Worth carrying through to the renderer in full — this is the only evidence
/// that will ever exist about what a reset did. The pod that answers the next
/// request has no memory of having been asked.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ResetReport {
    #[serde(default)]
    pub scope: ResetScope,
    #[serde(default)]
    pub data_dir: String,
    #[serde(default)]
    pub removed: Vec<String>,
    #[serde(default)]
    pub kept: Vec<String>,
    /// Non-empty means the pod is *not* factory-fresh, whatever else succeeded.
    #[serde(default)]
    pub failed: Vec<ResetFailure>,
    pub restart: RestartExpectation,
}

impl ResetReport {
    pub fn is_clean(&self) -> bool {
        self.failed.is_empty()
    }
}

/// Registration, verification and connection, in one read.
///
/// Four booleans because they are four different failures with four different
/// fixes, and collapsing them into "connected: false" is what makes a messaging
/// setup impossible to debug: no account token on the pod, no number registered,
/// a number registered but never verified, and a verified number whose channel
/// was never wired up.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct GatewayStatus {
    /// The pod holds a `METALCRAFT_TOKEN` — i.e. it is linked to an account at
    /// all. False here makes every other field meaningless.
    #[serde(default)]
    pub configured: bool,
    /// A personal number is registered at the gateway.
    #[serde(default)]
    pub registered: bool,
    /// …and proved, by texting the code back. Required before connecting.
    #[serde(default)]
    pub verified: bool,
    /// The pod's `metalcraft` channel is enabled and holds a webhook secret.
    #[serde(default)]
    pub connected: bool,
    /// The Inbound Pull long-poll is draining right now. Distinct from
    /// `connected` on purpose: that one is config on disk, this one is intrinsic
    /// liveness and cannot be true while inbound delivery is dead. Always false
    /// in push mode, where no long-poll runs.
    #[serde(default)]
    pub streaming: bool,
    /// The gateway number the user's messages arrive at.
    #[serde(default)]
    pub active_number: Option<String>,
    /// `whatsapp` or `sms`.
    #[serde(default)]
    pub channel: Option<String>,
    /// Whether the pod knows its own public URL, for the inbound webhook. A pull-
    /// mode pod does not need one.
    #[serde(default)]
    pub has_public_url: bool,
    /// The registered webhook no longer points at this pod — "green light, dead
    /// pipe". `connected` can be true while this is, which is exactly why it is
    /// reported separately.
    #[serde(default)]
    pub webhook_stale: bool,
    /// Why the pod could not ask the gateway. Carried rather than thrown: the
    /// local half of the status is still true and still worth rendering.
    #[serde(default)]
    pub error: Option<String>,
}

/// What registering a number answers with.
///
/// `verify_code` is the whole point: the user texts it back from that number,
/// which is what proves they hold it. It is not a secret to hide from them —
/// it is an instruction.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct GatewayRegistration {
    #[serde(default)]
    pub personal_number: Option<String>,
    #[serde(default)]
    pub active_number: Option<String>,
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub verified: bool,
    /// Absent when the number was already verified — re-registering it is then a
    /// no-op that re-points the integration, with nothing to text.
    #[serde(default)]
    pub verify_code: Option<String>,
    /// RFC 3339. Fifteen minutes out, at the gateway's clock.
    #[serde(default)]
    pub verify_expires_at: Option<String>,
}

/// What connecting answers with: the channel is wired and the pod will now
/// receive.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct GatewayConnected {
    #[serde(default)]
    pub connected: bool,
    #[serde(default)]
    pub active_number: String,
    #[serde(default)]
    pub integration_id: String,
    #[serde(default)]
    pub channel: String,
}

#[cfg(test)]
mod gateway_tests {
    use super::*;

    /// A pod that cannot reach the gateway still answers — with the local half
    /// filled in and `error` set. Treating that as a failed call would blank a
    /// card that has something true to say.
    #[test]
    fn a_status_that_carries_an_error_still_carries_the_local_half() {
        let status: GatewayStatus = serde_json::from_str(
            r#"{"configured":true,"registered":false,"verified":false,"connected":true,
                "streaming":false,"active_number":null,"channel":null,
                "has_public_url":true,"webhook_stale":false,
                "error":"gateway phone request failed"}"#,
        )
        .expect("parse status");
        assert!(status.connected);
        assert!(status.has_public_url);
        assert_eq!(status.active_number, None);
        assert!(status.error.is_some());
    }

    /// Every field is defaulted, so a pod older than one of them — or newer than
    /// this client — deserializes rather than erroring the whole card out.
    #[test]
    fn a_status_missing_every_optional_field_still_parses() {
        let status: GatewayStatus = serde_json::from_str(r#"{"configured":true}"#).unwrap();
        assert!(status.configured);
        assert!(!status.streaming);
        assert!(!status.webhook_stale);
    }

    /// The list row carries everything a goal card draws, so the renderer never
    /// opens the scratchpad to find out how far along something is.
    #[test]
    fn a_goal_row_answers_progress_and_attention_without_its_scratchpad() {
        let goal: Project = serde_json::from_str(
            r#"{"id":"goal_1","title":"Billing","goal":"Ship it","kind":"build",
                "status":"blocked","blocked_reason":"test key or live key?",
                "instance_id":"inst_1","progress":{"done":2,"total":5},
                "ticks":11,"every_minutes":30,"created_at":"2026-09-03T00:00:00Z"}"#,
        )
        .expect("parse goal");
        assert!(goal.needs_attention());
        assert!(!goal.is_running());
        assert_eq!(goal.progress.done, 2);
        assert_eq!(goal.progress.total, 5);
        // A blocked goal reports no next tick, because there is not going to be
        // one — the card must not promise activity that will never come.
        assert_eq!(goal.next_tick_at, None);
    }

    /// A pod older than goals answers `{}`, and an empty list is the honest
    /// reading of that — not a crash, and not an error banner.
    #[test]
    fn an_empty_goal_list_parses() {
        let list: ProjectList = serde_json::from_str("{}").expect("parse");
        assert!(list.goals.is_empty());
        assert_eq!(list.max_active, 0);
    }

    /// Re-registering an already-verified number answers without a code. The UI
    /// must not then tell someone to text nothing.
    #[test]
    fn a_verified_registration_comes_back_without_a_code() {
        let reg: GatewayRegistration = serde_json::from_str(
            r#"{"personal_number":"+15550100","active_number":"+15550199",
                "channel":"whatsapp","verified":true,"integration_id":"int_1",
                "signing_secret":"whsec_x"}"#,
        )
        .expect("parse registration");
        assert!(reg.verified);
        assert_eq!(reg.verify_code, None);
        // `signing_secret` is in the pod's passthrough and deliberately not in
        // this shape: the desktop has no use for it, so it never crosses into
        // the renderer.
    }
}
