//! The chat SSE wire format, mirrored from the agent's `workshop_api::ChatEvent`.
//!
//! This is the payoff of a structured agent API: Orca's chat view has to *decode*
//! a PTY byte stream per CLI vendor, guessing where a tool call started. Ours is
//! typed at the source. Keep these shapes byte-compatible with the agent — they
//! are also what the renderer's transcript reducer consumes, verbatim.

use serde::{Deserialize, Serialize};

/// One step of the agent's plan for the current turn, as `update_plan` wrote it.
///
/// `persona` is who it intends to delegate to, and is advisory — a plan that
/// reroutes mid-turn is a plan working as intended.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStep {
    pub step: String,
    #[serde(default)]
    pub persona: Option<String>,
    #[serde(default)]
    pub status: PlanStepStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStepStatus {
    #[default]
    Pending,
    InProgress,
    Done,
    /// Deliberately abandoned — an earlier step made it unnecessary. Closed, not
    /// outstanding.
    Skipped,
}

/// One message in a chat. Tagged by `role`, matching `ChatMessageWire`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "snake_case")]
pub enum ChatMessage {
    User {
        content: String,
    },
    Assistant {
        content: String,
    },
    /// Preserved so a tool call can be replayed with its reasoning item on a later
    /// turn — a Responses API requirement for reasoning models. Never rendered.
    Reasoning {
        id: String,
        encrypted: String,
    },
    ToolCall {
        id: String,
        #[serde(default)]
        call_id: Option<String>,
        name: String,
        args: serde_json::Value,
    },
    ToolResult {
        id: String,
        #[serde(default)]
        call_id: Option<String>,
        name: String,
        result: String,
    },
}

/// A frame from `POST /chats/{id}/turn` or `GET /chats/{id}/events`.
///
/// Lifecycle: `turn_started` → `phase`* → (`llm_started` → `llm_completed` →
/// `tool_started`* → `tool_completed`*)+ → `done`. An `error` may precede `done`.
///
/// `Unknown` is deliberate: a pod can be newer than this client (the fleet is
/// rolled independently of the desktop app), and an unrecognised frame must not
/// abort a live turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChatEvent {
    TurnStarted {
        turn_index: usize,
        user_message: String,
        #[serde(default)]
        session_id: Option<String>,
    },
    LlmStarted,
    LlmCompleted {
        messages: Vec<ChatMessage>,
        duration_ms: u64,
    },
    ToolStarted {
        tool_call_id: String,
        name: String,
        args: serde_json::Value,
    },
    ToolCompleted {
        tool_call_id: String,
        name: String,
        duration_ms: u64,
        result: ChatMessage,
    },
    /// The agent's user-facing message (a `say_to_user` or `ask_user` call). In
    /// tool-only mode this — not free-text `llm_completed` content — is the
    /// assistant's message.
    ///
    /// `awaiting_reply` marks a question rather than an answer: the turn has
    /// ended but the conversation has not, and `options` are the answers the
    /// agent offered. Both default, so a pod older than `ask_user` still decodes.
    Reply {
        content: String,
        #[serde(default)]
        awaiting_reply: bool,
        #[serde(default)]
        options: Vec<String>,
    },
    /// A message sent while a turn was running: taken, not started. `position`
    /// is 1 for the next to run.
    Queued {
        message: String,
        position: usize,
    },
    /// A queued message joined the turn already in flight. It stops being
    /// pending and becomes part of the thread.
    Injected {
        message: String,
    },
    /// The turn's plan as it stands. Sent on every change, including the empty
    /// list a new turn starts with — render it, do not accumulate it.
    Plan {
        #[serde(default)]
        steps: Vec<PlanStep>,
    },
    /// Classified, user-safe failure. `code` branches (see the agent's
    /// `runtime::ErrorCode`); `402`-class codes mean out of credits / not premium.
    /// A `done` still follows.
    Error {
        code: String,
        message: String,
        retryable: bool,
    },
    /// What the turn is doing *before* the model is called — work that emits no
    /// other frame.
    ///
    /// Compaction is an entire extra summarization LLM call and recall is an
    /// embeddings call, both ahead of the executor, so a turn could spend minutes
    /// between `turn_started` and the first `llm_started` without saying a word.
    /// The phase is an open string (the pod's `runtime::phase`) rather than an
    /// enum: a pod newer than this client must be able to name a phase we have
    /// never heard of, and the worst that can happen is we render its own word.
    Phase {
        phase: String,
    },
    /// Terminal. `status` is `completed` | `interrupted` | `failed`.
    Done {
        status: String,
        #[serde(default)]
        reason: Option<String>,
    },
    #[serde(other)]
    Unknown,
}

impl ChatEvent {
    /// Whether this frame ends the turn — the signal to stop a live subscription
    /// and flip a fleet card back to idle.
    pub fn is_terminal(&self) -> bool {
        matches!(self, ChatEvent::Done { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_the_documented_lifecycle() {
        let frames = [
            r#"{"kind":"turn_started","turn_index":0,"user_message":"hi"}"#,
            r#"{"kind":"phase","phase":"compacting"}"#,
            r#"{"kind":"llm_started"}"#,
            r#"{"kind":"tool_started","tool_call_id":"c1","name":"read_file","args":{"path":"a"}}"#,
            r#"{"kind":"reply","content":"done"}"#,
            r#"{"kind":"done","status":"completed"}"#,
        ];
        let parsed: Vec<ChatEvent> = frames
            .iter()
            .map(|f| serde_json::from_str(f).expect("frame"))
            .collect();
        assert!(matches!(
            parsed[0],
            ChatEvent::TurnStarted { turn_index: 0, .. }
        ));
        // The frame that exists so a silent phase stops looking like a hang.
        assert!(matches!(&parsed[1], ChatEvent::Phase { phase } if phase == "compacting"));
        assert!(parsed.last().unwrap().is_terminal());
    }

    #[test]
    fn unknown_frame_from_a_newer_pod_does_not_fail() {
        let ev: ChatEvent = serde_json::from_str(r#"{"kind":"llm_delta","text":"x"}"#).unwrap();
        assert!(matches!(ev, ChatEvent::Unknown));
        assert!(!ev.is_terminal());
    }

    #[test]
    fn error_frame_carries_its_taxonomy() {
        let ev: ChatEvent = serde_json::from_str(
            r#"{"kind":"error","code":"out_of_credits","message":"no credits","retryable":false}"#,
        )
        .unwrap();
        match ev {
            ChatEvent::Error {
                code, retryable, ..
            } => {
                assert_eq!(code, "out_of_credits");
                assert!(!retryable);
            }
            _ => panic!("expected error"),
        }
    }
}
