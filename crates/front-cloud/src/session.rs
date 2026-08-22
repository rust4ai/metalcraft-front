//! The persisted Metalcraft ID session.
//!
//! Two halves, deliberately split: the **PAT goes to the OS keychain** and the
//! non-secret display fields go to a small JSON file. metalcraft-workshop wrote
//! the PAT in cleartext next to the email; that is a long-lived credential for
//! the user's whole account, and a desktop app has a keychain right there.
//!
//! The JSON half exists so the launch path can render "signed in as …" without
//! prompting for keychain access before the user has asked for anything.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.metalcraft.front";
const ACCOUNT: &str = "metalcraft-id-pat";

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
        let entry = keyring::Entry::new(SERVICE, ACCOUNT)?;
        entry.set_password(pat)?;
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
    /// when a call actually needs to authenticate.
    pub fn pat() -> Option<String> {
        keyring::Entry::new(SERVICE, ACCOUNT)
            .ok()?
            .get_password()
            .ok()
    }

    /// Forget everything. Keychain deletion failing (already gone) is not an error.
    pub fn clear() {
        if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
            let _ = entry.delete_credential();
        }
        if let Some(p) = Self::path() {
            let _ = std::fs::remove_file(p);
        }
    }
}
