//! The persisted Metalcraft ID session.
//!
//! Two halves, deliberately split: the **PAT goes to the OS keychain** and the
//! non-secret display fields go to a small JSON file. metalcraft-workshop wrote
//! the PAT in cleartext next to the email; that is a long-lived credential for
//! the user's whole account, and a desktop app has a keychain right there.
//!
//! The JSON half exists so the launch path can render "signed in as …" without
//! prompting for keychain access before the user has asked for anything.
//!
//! # Why the PAT is cached in memory
//!
//! macOS binds a keychain item's ACL to the *code identity* of the app reading
//! it, and a `cargo run` binary is ad-hoc signed — its CDHash changes on every
//! rebuild, so "Always Allow" authorises one build and nothing after it. Every
//! read is then a password prompt. Boot used to make five separate reads
//! (refresh the session, re-save it, list pods, connect, fetch credits), and
//! React's `StrictMode` runs boot twice in dev, so signing in cost the user ten
//! prompts before the window was usable.
//!
//! So the PAT is read **once per process** and held here. Every mutation goes
//! through [`SessionStore::save`] or [`SessionStore::clear`], both of which
//! update the cell, so there is no path by which the cache can go stale.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.metalcraft.front";
const ACCOUNT: &str = "metalcraft-id-pat";

/// The process-lifetime PAT cell.
///
/// The outer `Option` is "have we asked the keychain yet"; the inner one is the
/// answer. `Some(None)` — asked, and there is no PAT — is cached too, so a
/// signed-out app does not re-query on every call either.
type Cache = Mutex<Option<Option<String>>>;

fn cache() -> MutexGuard<'static, Option<Option<String>>> {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    // A poisoned lock here means some other caller panicked mid-update. The
    // value behind it is still a plain `Option<String>` and still correct to
    // use; refusing to read it would take out sign-in for the rest of the run.
    CACHE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// Whether a `save` has to touch the keychain, given what the cache holds.
///
/// Re-writing a PAT the keychain already has is a no-op with a password prompt
/// attached — and `refresh_session` does exactly that on every launch, because
/// it re-saves the session after re-reading the account.
fn needs_write(cached: Option<&Option<String>>, pat: &str) -> bool {
    !matches!(cached, Some(Some(current)) if current == pat)
}

/// The non-secret half — safe to read on every launch.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Session {
    pub email: String,
    #[serde(default)]
    pub premium: bool,
}

pub struct SessionStore;

impl SessionStore {
    fn path() -> Option<PathBuf> {
        Some(
            dirs::config_dir()?
                .join("metalcraft-front")
                .join("session.json"),
        )
    }

    /// Persist a signed-in session: PAT to the keychain, the rest to disk.
    pub fn save(session: &Session, pat: &str) -> anyhow::Result<()> {
        let mut slot = cache();
        if needs_write(slot.as_ref(), pat) {
            keyring::Entry::new(SERVICE, ACCOUNT)?.set_password(pat)?;
            *slot = Some(Some(pat.to_string()));
        }
        drop(slot);
        if let Some(p) = Self::path() {
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(p, serde_json::to_string_pretty(session)?)?;
        }
        Ok(())
    }

    /// Who is signed in, for display. `None` means "show the login screen".
    pub fn load() -> Option<Session> {
        let raw = std::fs::read_to_string(Self::path()?).ok()?;
        serde_json::from_str(&raw).ok()
    }

    /// The PAT itself. Kept separate from [`load`] so the keychain is only touched
    /// when a call actually needs to authenticate — and, after the first such
    /// call, not even then (see the module docs).
    ///
    /// The lock is held across the keychain read on purpose: boot fires several
    /// commands at once, and letting them all miss the cache together would put
    /// back the pile of prompts this exists to remove.
    pub fn pat() -> Option<String> {
        let mut slot = cache();
        if let Some(known) = slot.as_ref() {
            return known.clone();
        }
        let read = keyring::Entry::new(SERVICE, ACCOUNT)
            .ok()
            .and_then(|entry| entry.get_password().ok());
        *slot = Some(read.clone());
        read
    }

    /// Forget everything. Keychain deletion failing (already gone) is not an error.
    pub fn clear() {
        let mut slot = cache();
        if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
            let _ = entry.delete_credential();
        }
        // Cached as a known absence, not as "unread": re-querying after a
        // deliberate sign-out would prompt for a secret we just threw away.
        *slot = Some(None);
        drop(slot);
        if let Some(p) = Self::path() {
            let _ = std::fs::remove_file(p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unchanged_pat_does_not_go_back_to_the_keychain() {
        let cached = Some("mck_live".to_string());
        assert!(!needs_write(Some(&cached), "mck_live"));
    }

    #[test]
    fn a_rotated_pat_is_written() {
        let cached = Some("mck_old".to_string());
        assert!(needs_write(Some(&cached), "mck_new"));
    }

    #[test]
    fn an_unread_or_absent_cache_always_writes() {
        // Nothing known yet, and "known to be signed out" — in both cases the
        // keychain may disagree with us, so the write has to happen.
        assert!(needs_write(None, "mck_live"));
        assert!(needs_write(Some(&None), "mck_live"));
    }
}
