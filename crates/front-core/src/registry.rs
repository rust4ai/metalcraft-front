//! Agent-pack registries, as the pod exposes them.
//!
//! The desktop never talks to Axoniac Prime (or any other host) directly. It goes
//! through the pod, and that is the right shape for three reasons: the pod holds
//! the allowlist of origins it is willing to fetch from, it holds the credential
//! (its own Metalcraft ID token) that a host may want, and it is the thing that
//! ends up installing the pack. A desktop that browsed a host the pod would
//! refuse could show you an install button that cannot work.
//!
//! A registry is a protocol, not a host: four endpoints plus a shared manifest
//! spec. Axoniac is the social discovery host; packs.metalcraftai.com is a peer.

use serde::{Deserialize, Serialize};

/// Where a pod stands with a registry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    /// The host resolved this pod's token to an account there.
    Connected,
    /// The token is good and no account claims it yet — the one state a button
    /// can fix, which is why `link_url` exists.
    Unlinked,
    /// This pod sends no credential here. Public packs still install.
    NoToken,
    /// Refused: expired, revoked, or from another ecosystem.
    Rejected,
    /// The host serves packs and has no identity endpoint. Nothing is wrong —
    /// the contract is four endpoints and none of them is `whoami`.
    Unsupported,
    #[serde(other)]
    Unknown,
}

impl ConnectionState {
    /// Whether browsing and installing *public* packs works in this state — which
    /// is every state. Connecting buys private packs and an identity, not access.
    pub fn public_packs_work(&self) -> bool {
        true
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryConnection {
    pub registry: String,
    pub url: String,
    #[serde(default)]
    pub trust: Option<String>,
    /// The key-store entry the bearer is drawn from — the name, never the value.
    #[serde(default)]
    pub token_key: Option<String>,
    pub state: ConnectionState,
    /// Where a human goes to finish linking. Taken from the host's own answer, so
    /// it stays right after the host moves it.
    #[serde(default)]
    pub link_url: Option<String>,
    #[serde(default)]
    pub account: Option<String>,
    /// The host's own words when something went wrong — shown verbatim rather
    /// than replaced with an invented explanation.
    #[serde(default)]
    pub detail: Option<String>,
}

/// One pack in a browse or search result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    /// What to install: `axoniac:@amy_kitchen`. **Qualified, always** — an
    /// unqualified id is ambiguous the moment two hosts publish the same one, and
    /// a browse list is exactly where that collision shows up.
    pub reference: String,
    /// The id on this host, without the `@`.
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub tagline: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    /// Whether the host vouches for it — worth what the host's `trust` makes it
    /// worth, and on a `verified-only` host it decides whether the pod will
    /// install at all.
    pub verified: bool,
    #[serde(default)]
    pub install_count: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchResults {
    #[serde(default)]
    pub registry: String,
    #[serde(default)]
    pub results: Vec<SearchHit>,
}

/// Whether a pod that refuses unverified packs would decline this one — knowable
/// before the user presses install, so the button can say so instead of
/// producing a 403.
pub fn blocked_by_trust(trust: Option<&str>, verified: bool) -> bool {
    matches!(trust, Some("verified-only" | "verified_only")) && !verified
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_verified_only_host_blocks_an_unvouched_pack() {
        assert!(blocked_by_trust(Some("verified-only"), false));
        assert!(!blocked_by_trust(Some("verified-only"), true));
    }

    #[test]
    fn other_trust_levels_permit_anything_the_host_serves() {
        assert!(!blocked_by_trust(Some("any"), false));
        assert!(!blocked_by_trust(None, false));
    }

    #[test]
    fn an_unfamiliar_connection_state_does_not_break_the_registry_list() {
        // The pod can gain states before the desktop learns them; browsing must
        // keep working, since public packs never needed a credential anyway.
        let c: RegistryConnection = serde_json::from_str(
            r#"{"registry":"axoniac","url":"https://axoniac.com","state":"pending_review"}"#,
        )
        .unwrap();
        assert_eq!(c.state, ConnectionState::Unknown);
        assert!(c.state.public_packs_work());
    }

    #[test]
    fn a_hit_keeps_its_qualified_reference() {
        let hits: SearchResults = serde_json::from_str(
            r#"{"registry":"axoniac","results":[{"reference":"axoniac:@amy_kitchen",
                "id":"amy_kitchen","name":"Amy","verified":true,"tags":["cooking"]}]}"#,
        )
        .unwrap();
        assert_eq!(hits.results[0].reference, "axoniac:@amy_kitchen");
        assert_eq!(hits.results[0].tags, ["cooking"]);
    }
}
