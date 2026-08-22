//! Octaweave — the *life* workspace an agent shares with you (PLAN §9.3).
//!
//! This module exists so the `owk_live_…` key never reaches the webview. The
//! renderer asks the core to connect and gets back a confirmation — workspace,
//! scopes, actor — while the key itself goes straight from here into the pod's
//! key store. That is the same process-split rule the rest of the app follows
//! (PLAN §2): no network credential crosses into the view layer.
//!
//! **What is verifiable here and what is not.** `GET /api/v1/whoami` is real and
//! deployed (401 for an anonymous caller, which is the correct answer). It is
//! also, per the pack's own tooling, "the cheapest proof the key works" — so it
//! is the gate a key must pass *before* it is written anywhere. The browser
//! hand-off in §9.3 needs Octaweave to redirect back to
//! `metalcraft-front://octaweave/callback`, and whether it does is not
//! discoverable from outside: octaweave.com is a single-page app that answers
//! 200 on every path. Our half of that contract is implemented; theirs is not
//! assumed.

use serde::{Deserialize, Serialize};

use crate::http;

/// Octaweave origin. `OCTAWEAVE_URL` overrides for local testing.
pub fn octaweave_base() -> String {
    std::env::var("OCTAWEAVE_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://octaweave.com".to_string())
}

/// The key store name the `octaweave` integration pack reads
/// (`pack.json: requires_env`). Not a choice — the pack will not work under any
/// other name.
pub const KEY_NAME: &str = "OCTAWEAVE_API_KEY";

/// The integration pack's registry slug.
pub const PACK_SLUG: &str = "octaweave";

/// What `GET /api/v1/whoami` says about a key.
///
/// A key is pinned to exactly one workspace, and `actor.workspace_id` is the
/// only reliable way to learn which — every other tool in the pack needs it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WhoAmI {
    #[serde(default)]
    pub actor: Actor,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub is_admin: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Actor {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub workspace_id: String,
}

/// Prove a key works, and learn which workspace it is pinned to.
///
/// Called before the key is stored anywhere. A key that cannot identify itself
/// is not worth writing into a pod and then discovering mid-conversation.
pub async fn whoami(token: &str) -> anyhow::Result<WhoAmI> {
    let resp = http()
        .get(format!("{}/api/v1/whoami", octaweave_base()))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("could not reach Octaweave: {e}"))?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        anyhow::bail!("Octaweave rejected that key — it may be revoked, or copied incompletely");
    }
    if !resp.status().is_success() {
        anyhow::bail!("Octaweave returned {}", resp.status());
    }
    Ok(resp.json().await?)
}

/// Extract the token from a `metalcraft-front://octaweave/callback?token=…` URL.
///
/// Deliberately strict about the path: the app registers one scheme for every
/// deep link it will ever handle, so a callback for something else must not be
/// read as an Octaweave key.
pub fn token_from_callback(url: &str) -> Option<String> {
    let rest = url.strip_prefix("metalcraft-front://")?;
    let (path, query) = rest.split_once('?')?;
    if path.trim_end_matches('/') != "octaweave/callback" {
        return None;
    }
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == "token" && !v.is_empty()).then(|| percent_decode(v))
    })
}

/// Enough percent-decoding for a token in a query string.
fn percent_decode(s: &str) -> String {
    let bytes = s.replace('+', " ").into_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(b) = u8::from_str_radix(&String::from_utf8_lossy(&bytes[i + 1..i + 3]), 16)
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_token_out_of_the_callback() {
        assert_eq!(
            token_from_callback("metalcraft-front://octaweave/callback?token=owk_live_abc"),
            Some("owk_live_abc".to_string())
        );
    }

    /// `%2B` is a literal plus and a bare `+` is a space — the form-encoding
    /// convention, and getting it backwards would corrupt a token by one
    /// character in a way that only shows up as a 401 much later.
    #[test]
    fn decodes_and_survives_extra_params() {
        assert_eq!(
            token_from_callback(
                "metalcraft-front://octaweave/callback?state=x&token=owk%5Flive%5Fa%2Bb"
            ),
            Some("owk_live_a+b".to_string())
        );
        assert_eq!(
            token_from_callback("metalcraft-front://octaweave/callback?token=a+b"),
            Some("a b".to_string())
        );
    }

    /// One scheme serves every deep link this app will ever register, so another
    /// feature's callback must never be mistaken for a key.
    #[test]
    fn refuses_a_callback_meant_for_something_else() {
        assert_eq!(
            token_from_callback("metalcraft-front://login/callback?token=not-a-key"),
            None
        );
    }

    #[test]
    fn refuses_a_callback_with_no_token() {
        assert_eq!(
            token_from_callback("metalcraft-front://octaweave/callback?error=denied"),
            None
        );
        assert_eq!(
            token_from_callback("metalcraft-front://octaweave/callback"),
            None
        );
    }

    #[test]
    fn refuses_an_empty_token() {
        // A blank token would sail through whoami's 401 as a confusing error
        // rather than the obvious "nothing came back" it actually is.
        assert_eq!(
            token_from_callback("metalcraft-front://octaweave/callback?token="),
            None
        );
    }
}
