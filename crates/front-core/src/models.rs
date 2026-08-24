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
/// origin badge on a fleet card and whether the instance defaults to persistent.
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
    #[serde(default)]
    pub persistent: bool,
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
}

/// `GET /agents/instances` — the instance plus what the pod counts alongside it.
#[derive(Debug, Clone, Deserialize)]
pub struct InstanceList {
    #[serde(default)]
    pub instances: Vec<AgentInstance>,
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
            "persona":"orchestrator-agent","origin":{"kind":"workshop"},"persistent":true,
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
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PresetDetail {
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

// ── Automations (the pod calls them flows) ──────────────────────────────────
//
// Vocabulary, decided once and held to: the pod says *flow* on the wire and this
// crate matches it, because these types are that wire. The renderer says
// **Automation**, because what a person arms is not a graph — it is a standing
// instruction. See `~/ai/metalcraft-agent/docs/FLOWS_AS_AGENTS_PLAN.md` §2.1.

/// One flow on the pod, already joined against its binding by
/// `GET /flows` — see the agent's `FlowListItem`.
///
/// The join matters: *which agent runs this*, *is it armed*, and *when does it
/// fire next* live in three different places on the pod (the flow file,
/// `flow_bindings.json`, a cron projection), and the endpoint exists precisely so
/// a client does not make four calls per flow to answer them.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Flow {
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// The flow-wide master switch. **Disabled is the normal case** — agent packs
    /// ship their flows off — so this is a state to render, not a reason to hide
    /// the row.
    #[serde(default)]
    pub enabled: bool,
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
    /// Any schedule armed — i.e. this automation has an agent.
    #[serde(default)]
    pub armed: bool,
    #[serde(default)]
    pub schedules: Vec<FlowSchedule>,
}

/// One schedule of a flow: the stored spec (flattened by the pod) plus what it is
/// armed to and when it fires next.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FlowSchedule {
    pub id: String,
    #[serde(default)]
    pub enabled: bool,
    /// The trigger tag: `manual` | `minutes` | `hours` | `cron`.
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub cron: Option<String>,
    #[serde(default)]
    pub interval: Option<u64>,
    #[serde(default)]
    pub timezone: Option<String>,
    /// Persona override for runs from this schedule.
    #[serde(default)]
    pub persona: Option<String>,
    /// The agent this schedule was armed with. `None` means unarmed: it will not
    /// fire, and no agent accumulates memory from it.
    #[serde(default)]
    pub instance_id: Option<String>,
    /// Absent if the agent was deleted out from under the binding.
    #[serde(default)]
    pub instance_name: Option<String>,
    /// The pod's own rendering of the trigger — `"Every 5 minute(s)"`, or
    /// `"Invalid cron `0 8 * * *`: …"` when it cannot parse. Show it verbatim: a
    /// schedule that will never fire should look broken rather than merely empty.
    #[serde(default)]
    pub description: String,
    /// Next projected fire, absent for a manual (or unparseable) trigger.
    #[serde(default)]
    pub next_fire_at: Option<String>,
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

    /// The pod flattens each schedule's stored spec into the same object that
    /// carries `instance_id` / `next_fire_at`, so the wire has one schedule shape
    /// rather than two. Pinned here because that flattening is easy to break on
    /// the pod side and the failure would be silent: serde would simply leave
    /// `kind`/`cron` empty and the UI would render a schedule with no trigger.
    const LISTING: &str = r#"{
      "flows": [{
        "id": "brief", "name": "Morning brief", "enabled": true,
        "node_count": 2, "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-02T00:00:00Z", "v2": true,
        "preset": "amy-kitchen", "armed": true,
        "schedules": [
          { "id": "morning", "name": "Morning brief", "type": "cron",
            "cron": "0 0 8 * * *", "enabled": true,
            "instance_id": "inst_abc", "instance_name": "Amy — Morning brief",
            "description": "Cron `0 0 8 * * *` (local time)",
            "next_fire_at": "2026-08-24T08:00:00-04:00" },
          { "id": "adhoc", "type": "manual", "enabled": true,
            "description": "Manual (runs only when triggered)" }
        ]
      }]
    }"#;

    #[test]
    fn a_listing_carries_the_agent_each_schedule_runs_as() {
        let list: FlowList = serde_json::from_str(LISTING).expect("parse listing");
        let flow = &list.flows[0];
        assert!(flow.armed);
        assert_eq!(flow.preset, "amy-kitchen");

        let armed = &flow.schedules[0];
        assert_eq!(armed.kind, "cron");
        assert_eq!(armed.cron.as_deref(), Some("0 0 8 * * *"));
        assert_eq!(armed.instance_id.as_deref(), Some("inst_abc"));
        assert!(armed.next_fire_at.is_some());

        // Unarmed: no agent, nothing accumulating, and nothing to click through to.
        let unarmed = &flow.schedules[1];
        assert_eq!(unarmed.kind, "manual");
        assert!(unarmed.instance_id.is_none());
        assert!(unarmed.next_fire_at.is_none());
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
