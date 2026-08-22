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
}

#[cfg(test)]
mod tests {
    use super::*;

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
