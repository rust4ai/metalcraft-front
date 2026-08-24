//! What the core swallowed, kept where a person can read it.
//!
//! Several commands here degrade rather than fail, and they are right to: the
//! Octaweave card must not take the settings page down with it when a pod will
//! not answer, and a best-effort revoke must not undo a disconnect that already
//! succeeded. The cost is that the *reason* vanishes. `octaweave_status`
//! degrading to an empty integration list is indistinguishable, on screen, from
//! a pod that genuinely has no Octaweave pack — so the card offers to install
//! something that may already be installed, and nothing anywhere says why.
//!
//! This is the record of those moments. A degradation calls [`DiagLog::warn`] or
//! [`DiagLog::error`] instead of dropping the error, the renderer reads the
//! buffer with `list_diagnostics`, and the error log surfaces it next to the
//! failures the renderer saw for itself.
//!
//! Two rules make it readable rather than a firehose:
//!
//! - **The message is the consequence, not the exception.** "the pod would not
//!   list its integrations, so Octaweave reads as not-installed" is actionable;
//!   `error decoding response body` is not. The exception goes in `detail`.
//! - **Repeats collapse.** A status call on a poll would otherwise write the
//!   same line every few seconds and bury everything else; an identical
//!   (source, message) bumps a count and a timestamp instead.
//!
//! Everything recorded here also goes to `log::warn!`/`log::error!`, so a
//! terminal-attached build keeps the record it has always had.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::Serialize;

/// Enough to hold a session's worth of distinct problems, and — because repeats
/// collapse — far more than a session's worth of occurrences. The oldest go
/// first, which is the right end to lose: a log this size is read after
/// something went wrong, and that something is at the new end.
const CAP: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    /// The call still returned something usable, but it is not the whole truth.
    Warn,
    /// Something is broken or left behind, and someone has to act on it.
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct Diagnostic {
    pub id: u64,
    /// Milliseconds since the epoch. The renderer owns formatting — it is the
    /// half that knows the user's locale and timezone.
    pub at: u64,
    pub level: Level,
    /// The command it happened in. The renderer shows it verbatim, because the
    /// command name is the thing you grep the source for.
    pub source: String,
    /// What it means for the person using the app.
    pub message: String,
    /// The underlying error, kept apart so `message` stays a sentence.
    pub detail: Option<String>,
    /// How many times this exact (source, message) has happened. 1 is the
    /// common case and the renderer says nothing about it.
    pub count: u32,
}

#[derive(Default)]
pub struct DiagLog {
    /// Oldest first. `list_diagnostics` reverses on the way out, so the buffer
    /// keeps the order that makes eviction a `pop_front`.
    entries: Mutex<VecDeque<Diagnostic>>,
    next_id: AtomicU64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl DiagLog {
    /// The call returned, but not with the whole truth.
    pub fn warn(&self, source: &str, message: impl Into<String>, detail: Option<String>) {
        self.note(Level::Warn, source, message, detail);
    }

    /// Something is broken or was left behind.
    pub fn error(&self, source: &str, message: impl Into<String>, detail: Option<String>) {
        self.note(Level::Error, source, message, detail);
    }

    fn note(&self, level: Level, source: &str, message: impl Into<String>, detail: Option<String>) {
        let message = message.into();
        match level {
            Level::Warn => log::warn!("{source}: {message}{}", suffix(&detail)),
            Level::Error => log::error!("{source}: {message}{}", suffix(&detail)),
        }

        let mut entries = self.entries.lock();

        // Collapse against the *whole* buffer rather than the newest entry: two
        // degradations alternating on a poll would each look new to a
        // last-entry check, and between them they would evict everything else.
        if let Some(at) = entries
            .iter()
            .position(|d| d.source == source && d.message == message)
        {
            let mut existing = entries.remove(at).expect("position came from iter");
            existing.count = existing.count.saturating_add(1);
            existing.at = now_ms();
            // The newest exception wins: when a problem changes shape under a
            // stable summary, the current cause is the useful one.
            existing.detail = detail;
            entries.push_back(existing);
            return;
        }

        entries.push_back(Diagnostic {
            id: self.next_id.fetch_add(1, Ordering::Relaxed),
            at: now_ms(),
            level,
            source: source.to_string(),
            message,
            detail,
            count: 1,
        });
        while entries.len() > CAP {
            entries.pop_front();
        }
    }

    /// Newest first — the order the log is read in.
    pub fn entries(&self) -> Vec<Diagnostic> {
        self.entries.lock().iter().rev().cloned().collect()
    }

    pub fn clear(&self) {
        self.entries.lock().clear();
    }
}

fn suffix(detail: &Option<String>) -> String {
    detail.as_ref().map(|d| format!(" — {d}")).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeats_collapse_instead_of_burying_everything_else() {
        let log = DiagLog::default();
        log.warn("octaweave_status", "the pod would not answer", None);
        log.warn("other", "something else", None);
        for _ in 0..50 {
            log.warn("octaweave_status", "the pod would not answer", None);
        }

        let entries = log.entries();
        assert_eq!(entries.len(), 2, "a poll must not write 50 lines");
        // Newest first, and the repeated one is newest because it just happened.
        assert_eq!(entries[0].count, 51);
        assert_eq!(entries[1].message, "something else");
    }

    #[test]
    fn the_newest_cause_wins_under_a_stable_summary() {
        let log = DiagLog::default();
        log.warn("s", "same summary", Some("connection refused".into()));
        log.warn("s", "same summary", Some("404 not found".into()));
        assert_eq!(log.entries()[0].detail.as_deref(), Some("404 not found"));
    }

    #[test]
    fn the_oldest_go_first_when_it_fills() {
        let log = DiagLog::default();
        for i in 0..CAP + 10 {
            log.warn("s", format!("problem {i}"), None);
        }
        let entries = log.entries();
        assert_eq!(entries.len(), CAP);
        assert_eq!(entries[0].message, format!("problem {}", CAP + 9));
        assert_eq!(entries[CAP - 1].message, "problem 10");
    }
}
