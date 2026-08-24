//! buildr.space connection (PLAN §9.3) — one button, and the same one as
//! [`super::octaweave`].
//!
//! The pack was installable long before this existed, which is exactly what made
//! it worth building: an installed `buildr-space` pack with no `BUILDR_API_KEY`
//! is 26 tools that all fail on their first call, and nothing in Settings said
//! so or offered to fix it. Octaweave had a card; this had a key store and a
//! name to type into it.
//!
//! [`buildr_connect`] is *resumable rather than interactive*: it returns what it
//! needs instead of blocking on it. Not linked yet → `needs_link` and a URL,
//! which resolves by calling it again — which is why it can be polled while the
//! user is away in the browser without re-opening the browser under them.
//!
//! There is no picker here, and that is the whole difference from Octaweave. A
//! `bsk_` belongs to an *account*, not to one workspace inside it, so there is
//! nothing for the user to choose: the workspaces the agent codes in are made by
//! the agent, at the point it needs one.
//!
//! The credential never reaches the webview: the minted key goes from
//! buildr.space into the pod's key store inside this process, and what comes
//! back is an account and a scope list.

use std::sync::Arc;

use front_cloud::SessionStore;
use front_cloud::buildr::{self, KEY_NAME, KeyHealth, PACK_SLUG};
use front_core::{Integration, PodConnection};
use serde::Serialize;

use crate::diag::DiagLog;
use crate::state::AppState;

type State<'a> = tauri::State<'a, Arc<AppState>>;

/// Whether the key on the pod is still a credential, as far as anyone here can
/// tell.
///
/// Three answers rather than a boolean, because "we could not ask" is a real
/// state and the one a boolean would quietly turn into a lie. The card renders
/// each differently: `Live` is the connection working, `Gone` is a card that
/// must stop saying "Connected", and `Unchecked` is a card that says it does not
/// know — which is worse than knowing and much better than guessing.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum KeyCheck {
    /// Not asked. `why` is shown, because "unknown" without a reason is the same
    /// dead end as no answer at all.
    Unchecked { why: String },
    /// buildr.space lists a key under this app's label. `expires_at` is RFC3339,
    /// or absent for a key that never lapses — whether that date has *passed* is
    /// decided in the renderer, on the clock the user is reading.
    Live { expires_at: Option<String> },
    /// The pod holds a key and buildr.space has none under this app's label. It
    /// was revoked: from buildr.space's own Keys page, from another machine, or
    /// by a disconnect this pod never heard about.
    Gone,
}

impl From<KeyHealth> for KeyCheck {
    fn from(h: KeyHealth) -> Self {
        if h.present {
            Self::Live {
                expires_at: h.expires_at,
            }
        } else {
            Self::Gone
        }
    }
}

/// Where the connection stands, as the settings card renders it.
#[derive(Debug, Clone, Serialize)]
pub struct BuildrStatus {
    /// The pod holds a key under `BUILDR_API_KEY`.
    ///
    /// Presence, and *only* presence. The pod has no way to know whether that
    /// string still authenticates, which is why this is not the whole answer —
    /// see `key_health`.
    pub key_present: bool,
    /// The `buildr-space` integration pack is installed.
    pub pack_installed: bool,
    /// Installed but switched off — the tools exist and will not fire.
    pub pack_enabled: bool,
    pub pack_version: Option<String>,
    /// Tools the pack contributes, when installed.
    pub api_tools: usize,
    /// What buildr.space says about that key. The half the pod cannot answer.
    pub key_health: KeyCheck,
}

/// What the pod has, and whether buildr.space still honours it.
///
/// Two questions, deliberately. The pod is authoritative about what it holds and
/// blind about whether it works; buildr.space is the reverse. Asking only the
/// first is what let a revoked or lapsed key read as "Connected · 26 tools
/// installed" while every one of those tools failed mid-conversation.
#[tauri::command]
pub async fn buildr_status(state: State<'_>) -> Result<BuildrStatus, String> {
    status_of(
        &state.conn(None)?,
        state.diag(),
        SessionStore::pat().as_deref(),
    )
    .await
}

/// The body of [`buildr_status`], over the three things it actually needs.
///
/// Split from the command so it can be *called* — by the dev bridge, which has
/// an `AppState` but no `tauri::State`, and by a test against the stub pod. The
/// PAT is an `Option` because "signed out" is one of the ways the health check
/// cannot happen, and a card that then claimed the key was fine would be making
/// the exact guess this function exists to stop making.
pub async fn status_of(
    conn: &PodConnection,
    diag: &DiagLog,
    pat: Option<&str>,
) -> Result<BuildrStatus, String> {
    let (keys, integrations) = tokio::join!(conn.list_keys(), conn.list_integrations());
    let keys = keys.map_err(|e| e.to_string())?;
    // A pod that cannot list integrations is a connection problem, not a
    // "buildr.space is not installed" answer — but the card is cosmetic, so it
    // degrades rather than failing the whole settings page. That degradation is
    // invisible on screen (an unanswered pod and a genuinely missing pack render
    // the same chip and the same Install button), so it goes to the log.
    let integrations: Vec<Integration> = match integrations {
        Ok(list) => list,
        Err(e) => {
            diag.warn(
                "buildr_status",
                "the pod would not list its integrations, so buildr.space shows as \
                 'not installed' whether or not the pack is actually there",
                Some(e.to_string()),
            );
            Vec::new()
        }
    };
    let pack = integrations.into_iter().find(|i| i.id == PACK_SLUG);
    let key_present = keys.iter().any(|k| k.name == KEY_NAME);

    Ok(BuildrStatus {
        key_present,
        pack_installed: pack.is_some(),
        pack_enabled: pack.as_ref().is_some_and(|p| p.enabled),
        api_tools: pack.as_ref().map(|p| p.api_tools).unwrap_or(0),
        pack_version: pack.map(|p| p.version),
        key_health: health_of(key_present, pat, diag).await,
    })
}

/// The second half of the status: buildr.space's own answer about the key.
///
/// Every path that cannot produce one returns [`KeyCheck::Unchecked`] with the
/// reason rather than an error. This is a *health* check on a connection that
/// may well be fine — failing the whole settings page because buildr.space was
/// briefly unreachable would be a worse outcome than the one being prevented.
/// It stays out of the error log for the same reason: an offline laptop is not
/// an incident, and a log that fills with them is one nobody reads.
async fn health_of(key_present: bool, pat: Option<&str>, diag: &DiagLog) -> KeyCheck {
    if !key_present {
        // Nothing to check, and no call worth making. "Not connected" is already
        // the whole story on screen.
        return KeyCheck::Unchecked {
            why: "there is no key on this pod to check".into(),
        };
    }
    let Some(pat) = pat else {
        return KeyCheck::Unchecked {
            why: "sign in to Metalcraft to check whether that key still works".into(),
        };
    };
    match buildr::key_health(pat).await {
        Ok(h) => {
            // Worth one line: a key that vanished from buildr.space while this
            // pod went on holding it is the state the whole check exists for,
            // and someone reading the log later should find it there too.
            if !h.present {
                diag.warn(
                    "buildr_status",
                    "this pod holds a buildr.space key that buildr.space no longer lists —                      it was revoked, and every tool in the pack will fail until it is                      reconnected",
                    None,
                );
            }
            h.into()
        }
        Err(e) => KeyCheck::Unchecked {
            why: format!("could not ask buildr.space: {e}"),
        },
    }
}

/// What a finished connection looks like. Deliberately carries no key.
#[derive(Debug, Clone, Serialize)]
pub struct BuildrConnection {
    /// The buildr.space account id the key belongs to.
    pub id: String,
    /// The account's own address, which is what the user recognises — not the
    /// key's label, which is a name this app chose.
    pub label: String,
    /// Where the account lives, so the card can offer to open it.
    pub url: String,
    pub scopes: Vec<String>,
    pub status: BuildrStatus,
    /// Set when the key was stored but the pack could not be installed — the
    /// halfway state is real and worth naming rather than reporting success.
    pub pack_error: Option<String>,
    /// How many keys this app had minted here before, now revoked. Shown so a
    /// reconnect does not look like it quietly left the old key working.
    pub replaced: usize,
}

/// One step of connecting: either it is done, or here is the one thing missing.
///
/// Deliberately the same tagged shape as Octaweave's, minus the workspace fork,
/// so one card component and one store slice drive both.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectOutcome {
    /// buildr.space has never seen this Metalcraft account. [`buildr_link`]
    /// opens the browser; calling connect again once the user is back finishes.
    NeedsLink {
        url: String,
    },
    Connected {
        connection: Box<BuildrConnection>,
    },
}

/// Open the browser at buildr.space's link page, and return the URL.
///
/// Split from [`buildr_connect`] precisely so connect can be *polled* while the
/// user is over in the browser — a connect that opened a tab every time it was
/// called would spray tabs across the poll interval.
#[tauri::command]
pub fn buildr_link() -> String {
    let url = buildr::link_url();
    front_cloud::id::open_in_browser(&url);
    url
}

/// Connect, or say what is missing.
///
/// The order is load-bearing. The pod connection is checked *before* anything is
/// minted: a key created and then not storable is a live credential nobody
/// holds, and buildr.space would have no idea it was born orphaned. Verification
/// comes after minting and before storing — a key that cannot identify itself
/// should fail here, not mid-conversation.
#[tauri::command]
pub async fn buildr_connect(state: State<'_>) -> Result<ConnectOutcome, String> {
    // Nothing below is worth doing if the result has nowhere to land.
    let conn = state.conn(None)?;
    let pat = SessionStore::pat()
        .ok_or("sign in to Metalcraft first — the connection is made with your account")?;
    connect_with(&conn, state.diag(), &pat).await
}

/// The body of [`buildr_connect`], over what it actually needs.
///
/// The PAT is a parameter rather than a keychain read so this is reachable from
/// a test: the failures worth pinning here are the ones that leave a live
/// credential behind, and reproducing those against the real buildr.space would
/// mean deliberately breaking an account. See [`crate::stub_buildr`].
pub async fn connect_with(
    conn: &PodConnection,
    diag: &DiagLog,
    pat: &str,
) -> Result<ConnectOutcome, String> {
    // Doubles as the link check, which is why it comes first: a 401 with
    // `not_linked` is a browser trip, and everything below is pointless without
    // an account to mint in.
    let account = match buildr::whoami(pat).await {
        Ok(a) => a,
        Err(buildr::HubError::NotLinked) => {
            return Ok(ConnectOutcome::NeedsLink {
                url: buildr::link_url(),
            });
        }
        Err(e) => return Err(e.to_string()),
    };

    // Best effort, and before the mint: reconnecting should replace this app's
    // key rather than pile another live one beside it.
    let replaced = buildr::revoke_ours(pat).await;

    let minted = buildr::mint_key(pat).await.map_err(|e| e.to_string())?;

    if let Err(e) = buildr::whoami(&minted.token).await {
        // The key exists at buildr.space and is about to be unreachable from
        // here, so take it back out rather than leaving a live one behind.
        //
        // When even that fails, the credential is live in someone's account and
        // no part of this app holds it — the failure the user most needs to hear
        // about, and the one the returned error is not about.
        if let Err(cleanup) = buildr::revoke_key(pat, &minted.id).await {
            diag.error(
                "buildr_connect",
                format!(
                    "a key was created for '{}' and could not be taken back — it is live \
                     at buildr.space and nothing here holds it; delete it from that \
                     account's Keys page",
                    account.email
                ),
                Some(cleanup.to_string()),
            );
        }
        return Err(format!(
            "buildr.space issued a key that will not authenticate: {e}"
        ));
    }

    conn.save_key(KEY_NAME, &minted.token)
        .await
        .map_err(|e| format!("the key was created, but the pod would not store it: {e}"))?;

    // A failed pack install does not fail the call. The key is stored and that
    // is worth keeping — reporting failure would invite the user to redo a step
    // that succeeded, and the pack can be installed on its own afterwards.
    let pack_error = match conn.install_integration(PACK_SLUG).await {
        Ok(_) => None,
        Err(e) => Some(e.to_string()),
    };

    Ok(ConnectOutcome::Connected {
        connection: Box::new(BuildrConnection {
            id: account.sub,
            label: account.email,
            url: format!("{}/account", front_cloud::buildr_base()),
            scopes: minted.scopes,
            status: status_of(conn, diag, Some(pat)).await?,
            pack_error,
            replaced,
        }),
    })
}

/// Install (or repair) just the integration pack, for the case where the key is
/// already in place and only the pack is missing.
#[tauri::command]
pub async fn buildr_install_pack(state: State<'_>) -> Result<BuildrStatus, String> {
    state
        .conn(None)?
        .install_integration(PACK_SLUG)
        .await
        .map_err(|e| e.to_string())?;
    buildr_status(state).await
}

/// Forget the key — and revoke it, when there is still a PAT to revoke it with.
///
/// Deleting it from the pod alone would leave a working credential at
/// buildr.space that nothing holds and nothing shows, which is not what
/// "disconnect" means to anyone pressing it. Revocation is best-effort and
/// second: a pod that dropped the key is disconnected whether or not
/// buildr.space was reachable to hear about it.
///
/// The pack stays installed. Its tools are inert without a key, and
/// reinstalling one to reconnect would be a surprising amount of work for what
/// was asked.
#[tauri::command]
pub async fn buildr_disconnect(state: State<'_>) -> Result<BuildrStatus, String> {
    disconnect_with(&state.conn(None)?, state.diag(), SessionStore::pat()).await
}

/// The body of [`buildr_disconnect`]. The PAT is passed in — and is an
/// `Option`, because "not signed in" is the way this leaves a live key behind
/// and therefore a case worth being able to construct.
///
/// Unlike Octaweave's, this needs nothing else: a `bsk_` is revoked by account,
/// so a disconnect from a window that never connected still revokes — there is
/// no second half to be missing.
pub async fn disconnect_with(
    conn: &PodConnection,
    diag: &DiagLog,
    pat: Option<String>,
) -> Result<BuildrStatus, String> {
    conn.delete_key(KEY_NAME).await.map_err(|e| e.to_string())?;

    match pat {
        Some(pat) => {
            buildr::revoke_ours(&pat).await;
        }
        None => diag.warn(
            "buildr_disconnect",
            "the key was dropped from this pod but not revoked at buildr.space — it is \
             still live there and has to be deleted from the account's Keys page",
            Some("not signed in to Metalcraft, so there was nothing to revoke it with".into()),
        ),
    }

    // The key is gone from the pod, so the health check has nothing to ask
    // about and is not given a PAT to ask with.
    status_of(conn, diag, None).await
}

/// The degradation paths, against a pod and a buildr.space that can both be told
/// to misbehave. Same shape as the Octaweave suite, and here for the same
/// reason: every one of these needs a *server* that fails in a particular way.
#[cfg(all(test, feature = "dev-rpc"))]
mod tests {
    use super::*;
    use crate::stub_buildr::Unlinked;
    use crate::stub_pod::Rule;
    use crate::{stub_buildr, stub_pod};
    use serde_json::json;
    use std::sync::Arc;

    const PACK: &str = r#"[{"id":"buildr-space","name":"buildr.space","version":"0.1.1",
        "enabled":true,"api_tools":26}]"#;

    async fn pod() -> (PodConnection, Arc<stub_pod::Harness>) {
        let (addr, harness) = stub_pod::start(0).await.expect("stub pod binds");
        let conn = PodConnection::new(format!("http://{addr}"), "devkey").expect("connects");
        (conn, harness)
    }

    /// One fake buildr.space for the whole test binary, on a runtime of its own
    /// — see [`crate::rpc::octaweave`]'s twin for why both halves of that are
    /// load-bearing (a process-global `BUILDR_URL`, and a server that must
    /// outlive the first `#[tokio::test]`'s runtime).
    static BUILDR: std::sync::OnceLock<Arc<stub_buildr::StubBuildr>> = std::sync::OnceLock::new();

    /// These tests share that one fake account, so they run one at a time.
    static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    fn buildr_stub() -> Arc<stub_buildr::StubBuildr> {
        BUILDR
            .get_or_init(|| {
                let (tx, rx) = std::sync::mpsc::channel();
                std::thread::spawn(move || {
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .expect("a runtime for the fake");
                    rt.block_on(async move {
                        let (addr, stub) = stub_buildr::start(0)
                            .await
                            .expect("fake buildr.space binds");
                        tx.send((format!("http://{addr}"), stub))
                            .expect("handed back");
                        std::future::pending::<()>().await
                    })
                });
                let (url, stub) = rx.recv().expect("the fake came up");
                // SAFETY: once, in this initializer, before any test reads it.
                unsafe { std::env::set_var("BUILDR_URL", &url) };
                stub
            })
            .clone()
    }

    async fn connected() -> (
        PodConnection,
        Arc<stub_pod::Harness>,
        Arc<stub_buildr::StubBuildr>,
        tokio::sync::MutexGuard<'static, ()>,
    ) {
        let guard = SERIAL.lock().await;
        let stub = buildr_stub();
        stub.harness.reset();
        stub.account.reset();
        let (conn, harness) = pod().await;
        (conn, harness, stub, guard)
    }

    /// A pod that will not answer and a pod with no pack installed produce the
    /// same `pack_installed: false`, so the card offers to install tools that
    /// may already be there. The log is the only place that difference exists.
    #[tokio::test]
    async fn a_pod_that_will_not_list_integrations_is_not_a_missing_pack() {
        let (conn, harness) = pod().await;
        harness.program(Rule::fail("/api/v1/integrations", 503));
        let diag = DiagLog::default();

        let status = status_of(&conn, &diag, None).await.expect("still answers");

        assert!(!status.pack_installed);
        let entries = diag.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source, "buildr_status");
        assert!(
            entries[0]
                .message
                .contains("would not list its integrations")
        );
    }

    /// The other half: a healthy pod must write nothing at all. A log that fills
    /// up when things are working is a log nobody reads when they are not.
    ///
    /// Signed out, so the health half cannot run — and says so instead of
    /// letting a missing answer read as a good one.
    #[tokio::test]
    async fn a_healthy_pod_writes_nothing_to_the_log() {
        let (conn, harness) = pod().await;
        harness.program(Rule::answer(
            "/api/v1/integrations",
            serde_json::from_str(PACK).unwrap(),
        ));
        harness.program(Rule::answer(
            "/api/v1/keys",
            json!([{ "name": "BUILDR_API_KEY", "masked": "bsk_…1234" }]),
        ));
        let diag = DiagLog::default();

        let status = status_of(&conn, &diag, None).await.expect("answers");

        assert!(status.key_present);
        assert!(status.pack_installed);
        assert_eq!(status.api_tools, 26);
        assert!(
            matches!(status.key_health, KeyCheck::Unchecked { ref why } if why.contains("sign in")),
            "not signed in is not the same as fine: {:?}",
            status.key_health
        );
        // Being signed out is not an incident.
        assert!(diag.entries().is_empty(), "nothing went wrong; say nothing");
    }

    /// A pod with no key at all does not go asking about one.
    ///
    /// Worth pinning as a *call* that does not happen: "not connected" is
    /// already the whole story on screen, and a network round trip per settings
    /// mount to learn nothing is the kind of thing that quietly becomes a
    /// request every card makes.
    #[tokio::test]
    async fn an_empty_pod_is_not_worth_asking_buildr_about() {
        let (conn, _pod, bs, _guard) = connected().await;
        let before = bs.seen().len();

        let status = status_of(&conn, &DiagLog::default(), Some("mck_test"))
            .await
            .expect("answers");

        assert!(!status.key_present);
        assert!(matches!(status.key_health, KeyCheck::Unchecked { .. }));
        assert_eq!(bs.seen().len(), before, "no key, no question");
    }

    /// The whole point. A key revoked at buildr.space — from its own Keys page,
    /// or another machine — leaves the pod holding a string that no longer
    /// authenticates, and the pod cannot tell. Before this, the card went on
    /// saying "Connected · 26 tools installed" while every one of those tools
    /// 401'd inside a conversation.
    #[tokio::test]
    async fn a_key_revoked_behind_the_app_s_back_stops_reading_as_connected() {
        let (conn, _pod, bs, _guard) = connected().await;
        let diag = DiagLog::default();
        connect_with(&conn, &diag, "mck_test").await.unwrap();
        bs.revoke_everything();

        let status = status_of(&conn, &diag, Some("mck_test")).await.unwrap();

        // The pod still holds it — that is exactly the trap.
        assert!(status.key_present);
        assert!(matches!(status.key_health, KeyCheck::Gone));
        // And someone reading the log later finds it there too.
        let entry = diag
            .entries()
            .into_iter()
            .find(|d| d.message.contains("no longer lists"))
            .expect("a key that vanished is worth a line");
        assert_eq!(entry.source, "buildr_status");
    }

    /// A live key reports *when it lapses*, not just that it exists. The app
    /// mints without an expiry, so this is the case where someone connected
    /// from an older build, or minted by hand — and a date nobody can see is a
    /// failure scheduled for a month from now.
    #[tokio::test]
    async fn a_live_key_carries_the_date_it_will_stop_working() {
        let (conn, _pod, bs, _guard) = connected().await;
        let diag = DiagLog::default();
        connect_with(&conn, &diag, "mck_test").await.unwrap();
        bs.expire_keys_at("2026-09-30T00:00:00Z");

        let status = status_of(&conn, &diag, Some("mck_test")).await.unwrap();

        let KeyCheck::Live { expires_at } = status.key_health else {
            panic!("the key is listed, so it is live");
        };
        assert_eq!(expires_at.as_deref(), Some("2026-09-30T00:00:00Z"));
        // A dated key is not a problem yet — whether that date has passed is the
        // renderer's call, on the clock the user is reading.
        assert!(diag.entries().is_empty());
    }

    /// And the key this app actually mints has no date at all, which is the
    /// claim the card's footnote makes.
    #[tokio::test]
    async fn the_key_this_app_mints_does_not_lapse() {
        let (conn, _pod, _bs, _guard) = connected().await;
        let diag = DiagLog::default();
        connect_with(&conn, &diag, "mck_test").await.unwrap();

        let status = status_of(&conn, &diag, Some("mck_test")).await.unwrap();

        assert!(matches!(
            status.key_health,
            KeyCheck::Live { expires_at: None }
        ));
    }

    /// A key store that will not answer is a different failure: the status is
    /// not merely incomplete, it is unknowable. Degrading it would report
    /// `key_present: false` and invite someone to reconnect a live connection.
    #[tokio::test]
    async fn a_key_store_that_will_not_answer_fails_rather_than_guessing() {
        let (conn, harness) = pod().await;
        harness.program(Rule::fail("/api/v1/keys", 500));
        assert!(status_of(&conn, &DiagLog::default(), None).await.is_err());
    }

    /// The worst outcome this code can produce: a key is minted, will not
    /// authenticate, and the revoke meant to clean it up *also* fails. The call
    /// returns an error about authentication — which says nothing about the live
    /// credential now sitting in someone's account that no part of this app
    /// holds.
    #[tokio::test]
    async fn a_key_that_cannot_be_taken_back_is_named_rather_than_left_silent() {
        let (conn, _pod, bs, _guard) = connected().await;
        // Minting works; proving the key does not; and neither does the cleanup.
        bs.program(Rule::fail("/api/v1/whoami", 401).times(1).after(1));
        bs.program(Rule::fail("/api/v1/account/tokens/key_1", 500));
        let diag = DiagLog::default();

        let outcome = connect_with(&conn, &diag, "mck_test").await;

        assert!(outcome.unwrap_err().contains("will not authenticate"));
        let entries = diag.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].level, crate::diag::Level::Error);
        assert!(entries[0].message.contains("could not be taken back"));
        // Named by account, because "delete it from that account's Keys page" is
        // not actionable without knowing which account.
        assert!(entries[0].message.contains("dev@example.com"));
        // And it really is still live — the point of the entry.
        assert_eq!(bs.live_keys().len(), 1);
    }

    /// The same failure with a working cleanup writes nothing. The entry is
    /// about an orphaned credential, not about a `whoami` that failed.
    #[tokio::test]
    async fn a_key_that_is_successfully_taken_back_is_not_worth_a_word() {
        let (conn, _pod, bs, _guard) = connected().await;
        bs.program(Rule::fail("/api/v1/whoami", 401).times(1).after(1));
        let diag = DiagLog::default();

        assert!(connect_with(&conn, &diag, "mck_test").await.is_err());

        assert!(diag.entries().is_empty(), "it was cleaned up; say nothing");
        assert!(bs.live_keys().is_empty(), "nothing left behind");
    }

    /// The happy path, end to end through both fakes: a key is minted, proved,
    /// stored on the pod, and the pack installed — with an empty log.
    #[tokio::test]
    async fn connecting_cleanly_mints_stores_and_says_nothing() {
        let (conn, pod, _bs, _guard) = connected().await;
        let diag = DiagLog::default();

        let outcome = connect_with(&conn, &diag, "mck_test").await.unwrap();

        let ConnectOutcome::Connected { connection } = outcome else {
            panic!("a linked account connects without anything to choose");
        };
        assert_eq!(connection.label, "dev@example.com");
        assert_eq!(connection.scopes, ["read", "write"]);
        assert!(diag.entries().is_empty());

        let asked: Vec<String> = pod.seen().into_iter().map(|s| s.path).collect();
        assert!(asked.iter().any(|p| p == "/api/v1/keys"));
        assert!(asked.iter().any(|p| p == "/api/v1/integrations/install"));
    }

    /// Reconnecting replaces the key it made before rather than piling a second
    /// live one beside it — and says how many it took back, so a reconnect never
    /// looks like it quietly left the old key working.
    #[tokio::test]
    async fn reconnecting_revokes_the_key_it_minted_last_time() {
        let (conn, _pod, bs, _guard) = connected().await;
        let diag = DiagLog::default();
        connect_with(&conn, &diag, "mck_test").await.unwrap();

        let outcome = connect_with(&conn, &diag, "mck_test").await.unwrap();

        let ConnectOutcome::Connected { connection } = outcome else {
            panic!("connected");
        };
        assert_eq!(connection.replaced, 1);
        assert_eq!(bs.live_keys().len(), 1, "one key, not two");
    }

    /// Not linked is a fork, not a failure: the app opens a browser and asks
    /// again. Nothing has gone wrong, so nothing is logged.
    ///
    /// Both of buildr.space's link refusals, because it sends two and only one
    /// of them was ever read as the fork. [`Unlinked::DisconnectedAtHub`] — the
    /// uncoded one — is what a first-ever connect gets, so the case that used to
    /// fail here was not an edge at all: it was pressing the button.
    #[tokio::test]
    async fn an_unlinked_account_is_a_fork_in_the_flow_not_an_error() {
        for refusal in [Unlinked::NeverLinked, Unlinked::DisconnectedAtHub] {
            let (conn, _pod, bs, _guard) = connected().await;
            *bs.account.linked.lock() = false;
            *bs.account.unlinked_as.lock() = refusal;
            let diag = DiagLog::default();

            let outcome = connect_with(&conn, &diag, "mck_test").await.unwrap();

            assert!(
                matches!(outcome, ConnectOutcome::NeedsLink { .. }),
                "{refusal:?} should send the user to the browser"
            );
            assert!(diag.entries().is_empty());
            // Nothing was minted on the way to finding out.
            assert!(bs.live_keys().is_empty());
        }
    }

    /// A 401 that is *not* about linking must not send anyone to a browser: the
    /// fix for an inactive token is signing in again, and a link page would sit
    /// there doing nothing forever.
    #[tokio::test]
    async fn a_dead_token_is_an_error_rather_than_a_trip_to_the_browser() {
        let (conn, _pod, bs, _guard) = connected().await;
        bs.program(Rule::fail("/api/v1/whoami", 401).body(json!({
            "error": "that Metalcraft token is not active"
        })));

        let err = connect_with(&conn, &DiagLog::default(), "mck_test")
            .await
            .unwrap_err();

        assert!(err.contains("not active"), "buildr's own words: {err}");
    }

    /// The deployment that will not let a Metalcraft account mint at all.
    ///
    /// Not hypothetical: buildr.space's `main` gates create, list and revoke on
    /// a browser session, so every one-click connect against it dies here — past
    /// the link, past the check, at the first call that would have created
    /// something. The card said "managing API keys requires a browser session",
    /// which is buildr.space explaining its own rule to a person who is not in a
    /// browser and cannot act on it either way.
    ///
    /// The words are the whole fix, so the words are what this asserts.
    #[tokio::test]
    async fn a_deployment_that_refuses_metalcraft_accounts_says_so_in_plain_words() {
        let (conn, _pod, bs, _guard) = connected().await;
        bs.program(Rule::fail("/api/v1/account/tokens", 403).body(json!({
            "error": "managing API keys requires a browser session"
        })));

        let err = connect_with(&conn, &DiagLog::default(), "mck_test")
            .await
            .unwrap_err();

        assert!(
            err.contains("does not accept Metalcraft accounts"),
            "names the deployment as the problem: {err}"
        );
        assert!(
            !err.contains("browser session"),
            "and does not just forward the words that caused the confusion: {err}"
        );
        // The reassurance has to be true: a refused mint creates nothing, so
        // there is no orphaned credential behind this message.
        assert!(bs.live_keys().is_empty());
    }

    /// "Disconnect" that drops the pod's copy and leaves the key live at
    /// buildr.space. Both halves have to happen, and when the second cannot even
    /// be attempted the user's mental model — the connection is gone — is wrong.
    #[tokio::test]
    async fn a_disconnect_that_could_not_revoke_says_the_key_is_still_live() {
        let (conn, _pod, bs, _guard) = connected().await;
        let diag = DiagLog::default();
        connect_with(&conn, &diag, "mck_test").await.unwrap();
        assert_eq!(bs.live_keys().len(), 1);

        // Signed out: the PAT that would authorize the revoke is gone.
        disconnect_with(&conn, &diag, None).await.unwrap();

        let entry = diag
            .entries()
            .into_iter()
            .find(|d| d.source == "buildr_disconnect")
            .expect("the half that did not happen is worth saying");
        assert!(entry.message.contains("still live"));
        assert!(entry.detail.unwrap().contains("not signed in"));
        assert_eq!(bs.live_keys().len(), 1, "not a false alarm");
    }

    /// And a disconnect with the PAT revokes, and says nothing.
    #[tokio::test]
    async fn a_complete_disconnect_leaves_nothing_live_and_nothing_logged() {
        let (conn, _pod, bs, _guard) = connected().await;
        let diag = DiagLog::default();
        connect_with(&conn, &diag, "mck_test").await.unwrap();

        disconnect_with(&conn, &diag, Some("mck_test".into()))
            .await
            .unwrap();

        assert!(bs.live_keys().is_empty(), "revoked at buildr.space");
        assert!(diag.entries().is_empty());
    }
}
