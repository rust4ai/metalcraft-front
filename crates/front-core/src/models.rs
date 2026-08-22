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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPresetSummary {
    pub slug: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub agent_pack: Option<String>,
    #[serde(default)]
    pub default_persona: Option<String>,
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
    pub masked: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub channel_id: Option<String>,
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
