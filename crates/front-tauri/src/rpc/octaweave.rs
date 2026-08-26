//! Octaweave connection (PLAN §9.3, P7) — one button.
//!
//! Connecting used to ask the user to open a browser, find the Keys page, create
//! a key and paste it back. Every one of those steps still happens; none of them
//! is the user's to do any more. The core holds a Metalcraft PAT, Octaweave
//! accepts one (`ECOSYSTEM_PIVOT_PLAN.md` §3), and so the app lists the person's
//! workspaces and mints the key itself.
//!
//! [`octaweave_connect`] is therefore *resumable rather than interactive*: it
//! returns what it needs instead of blocking on it. Not linked yet → `needs_link`
//! and a URL. More than one workspace → `choose_workspace` and the list. Both
//! resolve by calling it again, which is why it can be polled while the user is
//! away in the browser without re-opening the browser under them.
//!
//! The credential still never reaches the webview: the minted key goes from
//! Octaweave into the pod's key store inside this process, and what comes back
//! is a workspace and a scope list.

use std::sync::Arc;

use front_cloud::ALLOW_UNVERIFIED_PACKS;
use front_cloud::SessionStore;
use front_cloud::octaweave::{self, KEY_NAME, PACK_ID, PACK_REF, Workspace};
use front_core::{Integration, PodConnection};
use serde::Serialize;

use crate::diag::DiagLog;
use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// Where the connection stands, as the settings card renders it.
#[derive(Debug, Clone, Default, Serialize)]
pub struct OctaweaveStatus {
    /// The pod holds a key under `OCTAWEAVE_API_KEY`.
    pub key_present: bool,
    /// The `octaweave` integration pack is installed.
    pub pack_installed: bool,
    /// Installed but switched off — the tools exist and will not fire.
    pub pack_enabled: bool,
    pub pack_version: Option<String>,
    /// Tools the pack contributes, when installed.
    pub api_tools: usize,
}

/// Read-only: what the pod already has. Never touches Octaweave itself, because
/// the key lives on the pod and the desktop has no copy to verify with.
#[tauri::command]
pub async fn octaweave_status(state: State<'_>) -> Result<OctaweaveStatus, String> {
    status_of(&state.conn(None)?, state.diag()).await
}

/// The body of [`octaweave_status`], over the two things it actually needs.
///
/// Split from the command so it can be *called* — by the dev bridge, which has
/// an `AppState` but no `tauri::State`, and by a test against the stub pod. The
/// alternative was the bridge re-implementing it, and a mirror that drifts from
/// the thing it mirrors is worse than no mirror: the UI would behave one way in
/// the app and another in a browser, which is the hardest kind of bug to place.
pub async fn status_of(conn: &PodConnection, diag: &DiagLog) -> Result<OctaweaveStatus, String> {
    let (keys, integrations) = tokio::join!(conn.list_keys(), conn.list_integrations());
    let keys = keys.map_err(|e| e.to_string())?;
    // A pod that cannot list integrations is a connection problem, not an
    // "Octaweave is not installed" answer — but the card is cosmetic, so it
    // degrades to "not installed" rather than failing the whole settings page.
    //
    // That degradation is invisible on screen: an unanswered pod and a genuinely
    // missing pack render the same "Key only" chip and the same Install button,
    // and someone whose pack is already installed is invited to install it
    // again. Dropping the error is the right call for the page and the wrong
    // call for the person, so it goes to the log instead of nowhere.
    let integrations: Vec<Integration> = match integrations {
        Ok(list) => list,
        Err(e) => {
            diag.warn(
                "octaweave_status",
                "the pod would not list its integrations, so Octaweave shows as \
                 'not installed' whether or not the pack is actually there",
                Some(e.to_string()),
            );
            Vec::new()
        }
    };
    // `PACK_ID`, not the reference it was installed by — the pod lists what the
    // archive calls itself.
    let pack = integrations.into_iter().find(|i| i.id == PACK_ID);

    Ok(OctaweaveStatus {
        key_present: keys.iter().any(|k| k.name == KEY_NAME),
        pack_installed: pack.is_some(),
        pack_enabled: pack.as_ref().is_some_and(|p| p.enabled),
        api_tools: pack.as_ref().map(|p| p.api_tools).unwrap_or(0),
        pack_version: pack.map(|p| p.version),
    })
}

/// What a finished connection looks like. Deliberately carries no key.
#[derive(Debug, Clone, Serialize)]
pub struct OctaweaveConnection {
    pub workspace_id: String,
    /// The workspace's own name, which is what the user recognises — not the
    /// key's label, which is a name this app chose.
    pub label: String,
    /// Where the workspace lives, so the card can offer to open it.
    pub url: String,
    pub scopes: Vec<String>,
    pub status: OctaweaveStatus,
    /// Set when the key was stored but the pack could not be installed — the
    /// halfway state is real and worth naming rather than reporting success.
    pub pack_error: Option<String>,
    /// How many keys this app had minted here before, now revoked. Shown so a
    /// reconnect does not look like it quietly left the old key working.
    pub replaced: usize,
}

/// One step of connecting: either it is done, or here is the one thing missing.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectOutcome {
    /// Octaweave has never seen this Metalcraft account. [`octaweave_link`] opens
    /// the browser; calling connect again once the user is back finishes the job.
    NeedsLink { url: String },
    /// Several workspaces, and picking one is a judgement this app should not
    /// make for someone. Calling connect again with an id settles it.
    ChooseWorkspace { workspaces: Vec<Workspace> },
    Connected {
        connection: Box<OctaweaveConnection>,
    },
}

/// Open the browser at Octaweave's link page, and return the URL.
///
/// Split from [`octaweave_connect`] precisely so connect can be *polled* while
/// the user is over in the browser — a connect that opened a tab every time it
/// was called would spray tabs across the poll interval.
#[tauri::command]
pub fn octaweave_link() -> String {
    let url = octaweave::link_url();
    front_cloud::id::open_in_browser(&url);
    url
}

/// Connect, or say what is missing.
///
/// The order is load-bearing. The pod connection is checked *before* anything is
/// minted: a key created and then not storable is a live credential nobody holds,
/// and Octaweave would have no idea it was born orphaned. Verification comes
/// after minting and before storing, for the same reason it always did — a key
/// that cannot identify itself should fail here, not mid-conversation.
#[tauri::command]
pub async fn octaweave_connect(
    workspace: Option<String>,
    state: State<'_>,
) -> Result<ConnectOutcome, String> {
    // Nothing below is worth doing if the result has nowhere to land.
    let conn = state.conn(None)?;
    let pat = SessionStore::pat()
        .ok_or("sign in to Metalcraft first — the connection is made with your account")?;
    connect_with(&conn, state.diag(), &pat, workspace).await
}

/// The body of [`octaweave_connect`], over what it actually needs.
///
/// The PAT is a parameter rather than a keychain read so this is reachable from
/// a test: the failures worth pinning here are the ones that leave a live
/// credential behind, and reproducing those against the real Octaweave would
/// mean deliberately breaking an account. See [`crate::stub_octaweave`].
pub async fn connect_with(
    conn: &PodConnection,
    diag: &DiagLog,
    pat: &str,
    workspace: Option<String>,
) -> Result<ConnectOutcome, String> {
    let all = match octaweave::workspaces(pat).await {
        Ok(list) => list,
        Err(octaweave::HubError::NotLinked) => {
            return Ok(ConnectOutcome::NeedsLink {
                url: octaweave::link_url(),
            });
        }
        Err(e) => return Err(e.to_string()),
    };

    // Editors and viewers are filtered out here rather than at the mint, so the
    // picker never offers a workspace that would fail on the next click.
    let mintable: Vec<Workspace> = all.iter().filter(|w| w.can_mint()).cloned().collect();
    let chosen = match (&workspace, mintable.len()) {
        (Some(id), _) => mintable
            .iter()
            .find(|w| &w.id == id || &w.slug == id)
            .cloned()
            .ok_or("that workspace is not one you administer")?,
        (None, 1) => mintable[0].clone(),
        (None, 0) if all.is_empty() => {
            return Err("that Octaweave account has no workspaces yet — make one first".into());
        }
        (None, 0) => {
            return Err(
                "you are a member of Octaweave workspaces but administer none, \
                        and creating a key needs admin"
                    .into(),
            );
        }
        (None, _) => {
            return Ok(ConnectOutcome::ChooseWorkspace {
                workspaces: mintable,
            });
        }
    };

    // Best effort, and before the mint: reconnecting should replace this app's
    // key rather than pile another live one beside it.
    let replaced = octaweave::revoke_ours(pat, &chosen.id).await;

    let minted = octaweave::mint_key(pat, &chosen.id)
        .await
        .map_err(|e| e.to_string())?;

    if let Err(e) = octaweave::whoami(&minted.token).await {
        // The key exists on Octaweave and is about to be unreachable from here,
        // so take it back out rather than leaving a live one behind.
        //
        // When even that fails, the credential is live in someone's workspace
        // and no part of this app holds it — the failure the user most needs to
        // hear about, and the one the returned error is not about.
        if let Err(cleanup) = octaweave::revoke_key(pat, &chosen.id, &minted.id).await {
            diag.error(
                "octaweave_connect",
                format!(
                    "a key was created in '{}' and could not be taken back — it is live \
                     at Octaweave and nothing here holds it; delete it from that \
                     workspace's Keys page",
                    chosen.name
                ),
                Some(cleanup.to_string()),
            );
        }
        return Err(format!(
            "Octaweave issued a key that will not authenticate: {e}"
        ));
    }

    conn.save_key(KEY_NAME, &minted.token)
        .await
        .map_err(|e| format!("the key was created, but the pod would not store it: {e}"))?;

    // A failed pack install does not fail the call. The key is stored and that is
    // worth keeping — reporting failure would invite the user to redo a step that
    // succeeded, and the pack can be installed on its own afterwards.
    let pack_error = match conn
        .install_agent_pack(PACK_REF, ALLOW_UNVERIFIED_PACKS)
        .await
    {
        Ok(_) => None,
        Err(e) => Some(e.to_string()),
    };

    Ok(ConnectOutcome::Connected {
        connection: Box::new(OctaweaveConnection {
            workspace_id: chosen.id,
            label: chosen.name,
            url: format!(
                "{}/{}/{}",
                front_cloud::octaweave_base(),
                chosen.org_slug,
                chosen.slug
            ),
            scopes: minted.scopes,
            status: status_of(conn, diag).await?,
            pack_error,
            replaced,
        }),
    })
}

/// Install (or repair) just the integration pack, for the case where the key is
/// already in place and only the pack is missing.
#[tauri::command]
pub async fn octaweave_install_pack(state: State<'_>) -> Result<OctaweaveStatus, String> {
    state
        .conn(None)?
        .install_agent_pack(PACK_REF, ALLOW_UNVERIFIED_PACKS)
        .await
        .map_err(|e| e.to_string())?;
    octaweave_status(state).await
}

/// Forget the key — and revoke it, when we still know where it lives.
///
/// Deleting it from the pod alone would leave a working credential on Octaweave
/// that nothing holds and nothing shows, which is not what "disconnect" means to
/// anyone pressing it. Revocation is best-effort and second: a pod that dropped
/// the key is disconnected whether or not Octaweave was reachable to hear about
/// it, and the keys are visible in Octaweave's own UI either way.
///
/// The pack stays installed. Its tools are inert without a key, and reinstalling
/// one to reconnect would be a surprising amount of work for what was asked.
#[tauri::command]
pub async fn octaweave_disconnect(
    workspace: Option<String>,
    state: State<'_>,
) -> Result<OctaweaveStatus, String> {
    disconnect_with(
        &state.conn(None)?,
        state.diag(),
        SessionStore::pat(),
        workspace,
    )
    .await
}

/// The body of [`octaweave_disconnect`]. The PAT is passed in — and is an
/// `Option`, because "not signed in" is one of the two ways this leaves a live
/// key behind and therefore a case worth being able to construct.
pub async fn disconnect_with(
    conn: &PodConnection,
    diag: &DiagLog,
    pat: Option<String>,
    workspace: Option<String>,
) -> Result<OctaweaveStatus, String> {
    conn.delete_key(KEY_NAME).await.map_err(|e| e.to_string())?;

    // Revocation needs both halves, and when either is missing "disconnect" has
    // done only the local half: the key is gone from the pod and still live in
    // the workspace. Nothing on screen distinguishes that from a clean
    // disconnect, so the log is the only place it can be said.
    match (workspace, pat) {
        (Some(ws), Some(pat)) => {
            octaweave::revoke_ours(&pat, &ws).await;
        }
        (ws, pat) => diag.warn(
            "octaweave_disconnect",
            "the key was dropped from this pod but not revoked at Octaweave — it is \
             still live there and has to be deleted from the workspace's Keys page",
            Some(
                if pat.is_none() {
                    "not signed in to Metalcraft, so there was nothing to revoke it with"
                } else if ws.is_none() {
                    "the workspace this key belongs to is not known to this window"
                } else {
                    "unreachable"
                }
                .to_string(),
            ),
        ),
    }

    status_of(conn, diag).await
}

/// The degradation paths, against a pod that can be told to misbehave.
///
/// These are the cases that have no other way to be checked: every one of them
/// needs a *server* that fails in a particular way, and until the stub pod there
/// was no way to ask for one. They are the reason the harness exists.
#[cfg(all(test, feature = "dev-rpc"))]
mod tests {
    use super::*;
    use crate::stub_pod::Rule;
    use crate::{stub_octaweave, stub_pod};
    use serde_json::json;
    use std::sync::Arc;

    const PACK: &str = r#"[{"id":"octaweave","name":"Octaweave","version":"1.0.0",
        "enabled":true,"api_tools":32}]"#;

    async fn pod() -> (PodConnection, std::sync::Arc<stub_pod::Harness>) {
        let (addr, harness) = stub_pod::start(0).await.expect("stub pod binds");
        let conn = PodConnection::new(format!("http://{addr}"), "devkey").expect("connects");
        (conn, harness)
    }

    /// One fake Octaweave for the whole test binary, on a runtime of its own.
    ///
    /// Both halves of that are load-bearing:
    ///
    /// - **One fake**, because pointing the client at it means setting
    ///   `OCTAWEAVE_URL`, a process-global. `set_var` is unsafe in edition 2024
    ///   for exactly that reason; it is sound here because it happens once,
    ///   inside a `OnceLock` initializer, before any test reads it.
    /// - **Its own runtime**, because `#[tokio::test]` builds a runtime per test
    ///   and drops it at the end. A server spawned onto the first test's runtime
    ///   dies with it, and every later test gets "error sending request" against
    ///   a port nothing is listening on — which is exactly what happened.
    static OCTAWEAVE: std::sync::OnceLock<Arc<stub_octaweave::StubOctaweave>> =
        std::sync::OnceLock::new();

    /// These tests share that one fake account, so they run one at a time.
    static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    fn octaweave() -> Arc<stub_octaweave::StubOctaweave> {
        OCTAWEAVE
            .get_or_init(|| {
                let (tx, rx) = std::sync::mpsc::channel();
                std::thread::spawn(move || {
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .expect("a runtime for the fake");
                    rt.block_on(async move {
                        let (addr, stub) = stub_octaweave::start(0)
                            .await
                            .expect("fake Octaweave binds");
                        tx.send((format!("http://{addr}"), stub))
                            .expect("handed back");
                        // This thread is the fake's whole life; parking it here
                        // is what keeps it up across every test's runtime.
                        std::future::pending::<()>().await
                    })
                });
                let (url, stub) = rx.recv().expect("the fake came up");
                // SAFETY: once, in this initializer, before any test reads it.
                unsafe { std::env::set_var("OCTAWEAVE_URL", &url) };
                stub
            })
            .clone()
    }

    /// A pod, a fake Octaweave reset to a linked account with one workspace, and
    /// the lock that keeps the two tests using them from overlapping.
    async fn connected() -> (
        PodConnection,
        Arc<stub_pod::Harness>,
        Arc<stub_octaweave::StubOctaweave>,
        tokio::sync::MutexGuard<'static, ()>,
    ) {
        let guard = SERIAL.lock().await;
        let stub = octaweave();
        stub.harness.reset();
        stub.account.reset();
        let (conn, harness) = pod().await;
        (conn, harness, stub, guard)
    }

    /// The bug that started all of this. A pod that will not answer and a pod
    /// with no pack installed produce the same `pack_installed: false`, so the
    /// card offers to install tools that may already be there — and before the
    /// error log, nothing anywhere said which had happened.
    #[tokio::test]
    async fn a_pod_that_will_not_list_integrations_is_not_a_missing_pack() {
        let (conn, harness) = pod().await;
        harness.program(Rule::fail("/api/v1/integrations", 503));
        let diag = DiagLog::default();

        let status = status_of(&conn, &diag).await.expect("still answers");

        // Still degrades — the settings page must not die over a cosmetic card.
        assert!(!status.pack_installed);
        // But no longer silently.
        let entries = diag.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source, "octaweave_status");
        assert!(
            entries[0]
                .message
                .contains("would not list its integrations")
        );
        // The consequence is in the message; the exception is kept apart.
        assert!(entries[0].detail.is_some());
    }

    /// The other half, and the one that keeps the log honest: a healthy pod must
    /// write nothing at all. A log that fills up when things are working is a log
    /// nobody reads when they are not.
    #[tokio::test]
    async fn a_healthy_pod_writes_nothing_to_the_log() {
        let (conn, harness) = pod().await;
        harness.program(Rule::answer(
            "/api/v1/integrations",
            serde_json::from_str(PACK).unwrap(),
        ));
        harness.program(Rule::answer(
            "/api/v1/keys",
            json!([{ "name": "OCTAWEAVE_API_KEY", "masked": "owk_…1234" }]),
        ));
        let diag = DiagLog::default();

        let status = status_of(&conn, &diag).await.expect("answers");

        assert!(status.key_present);
        assert!(status.pack_installed);
        assert_eq!(status.api_tools, 32);
        assert!(diag.entries().is_empty(), "nothing went wrong; say nothing");
    }

    /// A key store that will not answer is a different failure: the status is not
    /// merely incomplete, it is unknowable, so this one is allowed to fail the
    /// call rather than degrade. Worth pinning — degrading it would report
    /// `key_present: false` and invite someone to reconnect a live connection.
    #[tokio::test]
    async fn a_key_store_that_will_not_answer_fails_rather_than_guessing() {
        let (conn, harness) = pod().await;
        harness.program(Rule::fail("/api/v1/keys", 500));
        let diag = DiagLog::default();

        assert!(status_of(&conn, &diag).await.is_err());
    }

    /// Recovery, which needs the failure to be *temporary* — the thing a
    /// harness can arrange and a broken pod cannot.
    #[tokio::test]
    async fn the_next_look_is_right_once_the_pod_comes_back() {
        let (conn, harness) = pod().await;
        // The pack is installed; the pod just will not say so, once. Order
        // matters: the newest matching rule wins, so the temporary failure goes
        // on last and retires back onto the baseline underneath it.
        harness.program(Rule::answer(
            "/api/v1/integrations",
            serde_json::from_str(PACK).unwrap(),
        ));
        harness.program(Rule::fail("/api/v1/integrations", 503).times(1));
        let diag = DiagLog::default();

        let first = status_of(&conn, &diag).await.expect("degrades");
        assert!(!first.pack_installed);

        let second = status_of(&conn, &diag).await.expect("answers");
        assert!(second.pack_installed);
        // The entry stays. It happened, and a log that erases what recovered is
        // a log that cannot explain what someone saw a minute ago.
        assert_eq!(diag.entries().len(), 1);
    }

    /// Not what the pod answered, but whether the app asked at all — invisible
    /// from the response side, and the half that catches a call being skipped.
    #[tokio::test]
    async fn it_asks_the_pod_rather_than_reasoning_from_the_key_store() {
        let (conn, harness) = pod().await;
        let _ = status_of(&conn, &DiagLog::default()).await;

        let asked: Vec<String> = harness.seen().into_iter().map(|s| s.path).collect();
        assert!(asked.iter().any(|p| p == "/api/v1/keys"));
        assert!(asked.iter().any(|p| p == "/api/v1/integrations"));
        assert!(
            harness.seen().iter().all(|s| s.authorized),
            "bearer on every call"
        );
    }

    // ── the connect flow, against a fake Octaweave ──────────────────────────

    /// The worst outcome this code can produce, and the one that had no test:
    /// a key is minted, will not authenticate, and the revoke meant to clean it
    /// up *also* fails. The call returns an error about authentication — which
    /// says nothing about the live credential now sitting in someone's
    /// workspace that no part of this app holds.
    #[tokio::test]
    async fn a_key_that_cannot_be_taken_back_is_named_rather_than_left_silent() {
        let (conn, _pod, ow, _guard) = connected().await;
        // Minting works; proving the key does not; and neither does the cleanup.
        ow.program(Rule::fail("/api/v1/whoami", 401));
        ow.program(Rule::fail("/api/v1/w/ws_1/keys/key_1", 500));
        let diag = DiagLog::default();

        let outcome = connect_with(&conn, &diag, "mck_test", None).await;

        // The user is told what they asked about: the key will not authenticate.
        assert!(outcome.unwrap_err().contains("will not authenticate"));
        // And the thing they were never told is now somewhere they can read it.
        let entries = diag.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].level, crate::diag::Level::Error);
        assert!(entries[0].message.contains("could not be taken back"));
        // Named by workspace, because "delete it from that workspace's Keys
        // page" is not actionable without knowing which workspace.
        assert!(entries[0].message.contains("My workspace"));
        // And it really is still live — the point of the entry.
        assert_eq!(ow.live_keys("ws_1").len(), 1);
    }

    /// The same failure with a working cleanup writes nothing. The entry is
    /// about an orphaned credential, not about a `whoami` that failed — and a
    /// log that fires on the recoverable case is one nobody trusts.
    #[tokio::test]
    async fn a_key_that_is_successfully_taken_back_is_not_worth_a_word() {
        let (conn, _pod, ow, _guard) = connected().await;
        ow.program(Rule::fail("/api/v1/whoami", 401));
        let diag = DiagLog::default();

        assert!(connect_with(&conn, &diag, "mck_test", None).await.is_err());

        assert!(diag.entries().is_empty(), "it was cleaned up; say nothing");
        assert!(ow.live_keys("ws_1").is_empty(), "nothing left behind");
    }

    /// The happy path, end to end through both fakes: a key is minted, proved,
    /// stored on the pod, and the pack installed — with an empty log.
    #[tokio::test]
    async fn connecting_cleanly_mints_stores_and_says_nothing() {
        let (conn, pod, _ow, _guard) = connected().await;
        let diag = DiagLog::default();

        let outcome = connect_with(&conn, &diag, "mck_test", None).await.unwrap();

        let ConnectOutcome::Connected { connection } = outcome else {
            panic!("one admin workspace should connect without a picker");
        };
        assert_eq!(connection.workspace_id, "ws_1");
        assert_eq!(connection.label, "My workspace");
        assert!(diag.entries().is_empty());

        // The credential reached the pod, and the pack install was attempted.
        let asked: Vec<String> = pod.seen().into_iter().map(|s| s.path).collect();
        assert!(asked.iter().any(|p| p == "/api/v1/keys"));
        assert!(asked.iter().any(|p| p == "/api/v1/agent-packs/install"));
    }

    /// Not linked is a fork, not a failure: the app opens a browser and asks
    /// again. Nothing has gone wrong, so nothing is logged.
    #[tokio::test]
    async fn an_unlinked_account_is_a_fork_in_the_flow_not_an_error() {
        let (conn, _pod, ow, _guard) = connected().await;
        *ow.account.linked.lock() = false;
        let diag = DiagLog::default();

        let outcome = connect_with(&conn, &diag, "mck_test", None).await.unwrap();

        assert!(matches!(outcome, ConnectOutcome::NeedsLink { .. }));
        assert!(diag.entries().is_empty());
    }

    // ── disconnect ─────────────────────────────────────────────────────────

    /// "Disconnect" that drops the pod's copy and leaves the key live at
    /// Octaweave. Both halves have to happen, and when the second cannot even be
    /// attempted the user's mental model — the connection is gone — is wrong.
    #[tokio::test]
    async fn a_disconnect_that_could_not_revoke_says_the_key_is_still_live() {
        let (conn, _pod, ow, _guard) = connected().await;
        let diag = DiagLog::default();
        // Connect first, so there is a real key to leave behind.
        connect_with(&conn, &diag, "mck_test", None).await.unwrap();
        assert_eq!(ow.live_keys("ws_1").len(), 1);

        // Signed out: the PAT that would authorize the revoke is gone.
        disconnect_with(&conn, &diag, None, Some("ws_1".into()))
            .await
            .unwrap();

        let entry = diag
            .entries()
            .into_iter()
            .find(|d| d.source == "octaweave_disconnect")
            .expect("the half that did not happen is worth saying");
        assert!(entry.message.contains("still live"));
        assert!(entry.detail.unwrap().contains("not signed in"));
        // Not a false alarm: it really is still there.
        assert_eq!(ow.live_keys("ws_1").len(), 1);
    }

    /// The other way to reach the same state: signed in, but this window does
    /// not know which workspace the key belongs to, so there is nothing to
    /// revoke *in*. Different cause, same consequence, and the detail says which.
    #[tokio::test]
    async fn a_disconnect_with_no_workspace_says_which_half_was_missing() {
        let (conn, _pod, _ow, _guard) = connected().await;
        let diag = DiagLog::default();

        disconnect_with(&conn, &diag, Some("mck_test".into()), None)
            .await
            .unwrap();

        let entry = diag
            .entries()
            .into_iter()
            .find(|d| d.source == "octaweave_disconnect")
            .expect("recorded");
        assert!(entry.detail.unwrap().contains("workspace"));
    }

    /// And a disconnect with both halves revokes, and says nothing.
    #[tokio::test]
    async fn a_complete_disconnect_leaves_nothing_live_and_nothing_logged() {
        let (conn, _pod, ow, _guard) = connected().await;
        let diag = DiagLog::default();
        connect_with(&conn, &diag, "mck_test", None).await.unwrap();

        disconnect_with(&conn, &diag, Some("mck_test".into()), Some("ws_1".into()))
            .await
            .unwrap();

        assert!(ow.live_keys("ws_1").is_empty(), "revoked at Octaweave");
        assert!(diag.entries().is_empty());
    }
}
