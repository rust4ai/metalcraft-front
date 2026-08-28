//! The pod client, against a **real pod**.
//!
//! Every other test in this repo checks our types against fixtures we wrote,
//! which proves we are self-consistent and nothing else: `PLAN.md` has said
//! "nothing verified against a live pod yet" since the first commit, and the
//! app has grown five surfaces since. A shape we guessed wrong is invisible
//! until a person clicks the thing.
//!
//! Skips (does not fail) without `MC_LIVE_POD`, so CI stays green:
//!
//! ```sh
//! metalcraft-agent --api --api-port 3999      # WORKSHOP_API_KEY=devkey
//! MC_LIVE_POD=http://localhost:3999 MC_LIVE_POD_KEY=devkey \
//!   cargo test -p front-core --test live_pod -- --nocapture
//! ```
//!
//! It **writes** to the pod it points at (a flow, an agent, a conversation), so
//! point it at a scratch pod — `METALCRAFT_DATA_DIR=$(mktemp -d)` — not at
//! anything you care about.

use front_core::PodConnection;

fn pod() -> Option<PodConnection> {
    let url = std::env::var("MC_LIVE_POD").ok()?;
    let key = std::env::var("MC_LIVE_POD_KEY").unwrap_or_else(|_| "devkey".into());
    Some(PodConnection::new(&url, &key).expect("a valid pod URL"))
}

const FLOW: &str = r#"{
  "spec_version": "3", "id": "live-probe", "name": "Live probe",
  "created_at": "2026-08-23T00:00:00Z", "updated_at": "2026-08-23T00:00:00Z",
  "flow": { "nodes": [
      { "id": "entry", "node_type": "entry", "data": { "persona": "research-agent" }, "position": [0,0] },
      { "id": "fin", "node_type": "end", "data": { "status": "completed" }, "position": [1,0] }
    ], "edges": [{ "id": "e0", "source": "entry", "target": "fin" }] }
}"#;

#[tokio::test]
async fn every_shape_this_client_declares_matches_what_a_pod_sends() {
    let Some(pod) = pod() else {
        eprintln!("skipping: set MC_LIVE_POD to run this");
        return;
    };

    // Identity and the two lists the shell loads at boot.
    let info = pod.info().await.expect("GET /info");
    eprintln!("pod: {:?} {:?}", info.name, info.version);
    let presets = pod.list_presets().await.expect("GET /agent-presets");
    assert!(!presets.is_empty(), "a fresh pod seeds presets");
    pod.list_instances().await.expect("GET /agents/instances");
    pod.list_chats().await.expect("GET /chats");
    pod.list_keys().await.expect("GET /keys");
    // Scheduled follow-ups. `Some` rather than merely `Ok`: `None` is the
    // too-old-to-ask branch, and a live pod answering it that way would mean the
    // countdown silently never shows against the very pod we test on.
    assert!(
        pod.list_scheduled_tasks()
            .await
            .expect("GET /scheduled-tasks")
            .is_some(),
        "a current pod has the scheduled-tasks endpoint"
    );

    // The stop button's endpoint. `Some` rather than merely `Ok` for the same
    // reason as the follow-ups above: `None` is the pod-is-too-old branch, and a
    // live pod answering that way would mean the button we ship says "this pod
    // cannot stop a turn" against the very pod we develop on. `false` is the
    // right answer here — a chat nobody has sent a turn to has nothing to stop.
    let chat = pod
        .create_chat(&front_core::NewChat::default())
        .await
        .expect("POST /chats");
    assert_eq!(
        pod.interrupt_chat(&chat.id)
            .await
            .expect("POST /chats/{id}/interrupt"),
        Some(false),
        "a current pod has the interrupt endpoint, and an idle chat has nothing to stop"
    );

    // The pod's own record of what it did — what the debug view reads. `Some`
    // for the same reason as everything else here: `None` is the too-old branch,
    // and a live pod answering that way would mean the view we ship says "no
    // recorded runs" against the very pod we develop on.
    let runs = pod
        .diagnostics_sessions()
        .await
        .expect("GET /diagnostics")
        .expect("a current pod records its runs");
    // A run needs a turn to exist, and this probe deliberately does not spend
    // one — so assert the shape of whatever is there rather than that it is.
    if let Some(run) = runs.first() {
        let detail = pod
            .diagnostics_session(&run.id)
            .await
            .expect("GET /diagnostics/{id}")
            .expect("a listed run can be read back");
        assert_eq!(detail.id, run.id);
        // A trace exists once there is something to time. A chat that was
        // created and never used has a session directory and no trace at all —
        // which is why the debug view treats a missing trace as "nothing to
        // show yet" rather than as a pod that cannot trace.
        let trace = pod
            .diagnostics_trace(&run.id)
            .await
            .expect("GET /diagnostics/{id}/trace");
        if run.turn_count > 0 {
            assert!(trace.is_some(), "a run that took a turn has a trace");
        }
    }
    assert!(
        pod.diagnostics_trace("no-such-run")
            .await
            .expect("a missing trace is an answer, not a transport failure")
            .is_none()
    );

    // Automations. Seed a flow through the pod's own API so the test is
    // self-contained rather than assuming somebody left one lying around.
    let flow: serde_json::Value = serde_json::from_str(FLOW).unwrap();
    pod.put_flow("live-probe", &flow)
        .await
        .expect("PUT /flows/live-probe");
    // Start from a known state. A run that failed mid-way leaves this flow armed,
    // and the next run then fails on an unrelated assertion — a test that only
    // passes on a pristine pod is a test people learn to ignore.
    for sf in pod.list_scheduled_flows().await.unwrap_or_default() {
        if sf.flow_id == "live-probe" {
            let _ = pod.disarm_schedule(&sf.id).await;
        }
    }

    let flows = pod.list_flows().await.expect("GET /flows");
    let probe = flows
        .iter()
        .find(|f| f.id == "live-probe")
        .expect("the flow we just wrote is in the listing");
    assert!(probe.v2, "a spec_version 3 flow runs on the state machine");
    assert!(
        !probe.preset.is_empty(),
        "an unbound flow still resolves an agent"
    );
    assert_eq!(
        probe.scheduled_count, 0,
        "writing a flow schedules nothing: {probe:?}"
    );
    assert!(!probe.is_armed());

    // The arm dialog's payload.
    let binding = pod
        .flow_binding("live-probe")
        .await
        .expect("GET /flows/{id}/binding");
    assert!(!binding.preset.is_empty());
    assert!(
        binding.personas.iter().any(|p| p.slug == "research-agent"),
        "the binding names the personas the graph reaches: {:?}",
        binding.personas
    );

    // The regression this test was written the same day as: a seeded preset has
    // no integration packs, so the consent summary derived from packs alone
    // reported zero tools for an agent whose personas can run `bash`. A dialog
    // that says "0 tools" before granting shell access is worse than no dialog.
    assert!(
        binding.consent.tool_count > 0,
        "a real preset's agents carry tools; consent said {:?}",
        binding.consent
    );
    assert!(
        binding.consent.mutating_tools.iter().any(|t| t == "bash"),
        "the default agent can execute, and the summary must say so: {:?}",
        binding.consent.mutating_tools
    );

    // Arming is what creates the agent.
    let agent = pod
        .arm_schedule(
            "live-probe",
            &front_core::ScheduleSpec {
                kind: "hours".into(),
                name: Some("Hourly".into()),
                interval: Some(1),
                ..Default::default()
            },
            None,
        )
        .await
        .expect("POST /scheduled-flows");
    let scheduled_id = agent.id.clone();
    let agent_id = agent
        .instance_id
        .clone()
        .expect("arming mints the agent it runs as");
    // Straight from the fleet listing, which is also the assertion that it shows
    // up there — an agent doing work on a timer that nobody can see is the
    // failure this pair is guarding.
    let agent = pod
        .list_instances()
        .await
        .expect("GET /agents/instances")
        .into_iter()
        .find(|i| i.id == agent_id)
        .expect("the agent arming just minted is in the fleet");
    assert!(
        matches!(&agent.origin, front_core::InstanceOrigin::Flow { .. }),
        "the agent scheduling minted belongs to the flow: {:?}",
        agent.origin
    );

    // The fields the UI renders, from a pod rather than a fixture.
    let scheduled = pod
        .list_scheduled_flows()
        .await
        .expect("GET /scheduled-flows");
    let sf = scheduled
        .iter()
        .find(|s| s.id == scheduled_id)
        .expect("the schedule we just created");
    assert_eq!(sf.flow_id, "live-probe");
    assert_eq!(sf.schedule.kind, "hours", "the trigger keeps its `type` tag");
    assert_eq!(sf.schedule.interval, Some(1));
    assert!(sf.enabled);
    assert!(
        !sf.description.is_empty(),
        "the pod describes its own trigger"
    );
    assert!(
        sf.next_fire_at.is_some(),
        "an interval trigger projects a next run"
    );
    assert_eq!(
        sf.instance_id.as_deref(),
        Some(agent.id.as_str()),
        "the listing reports which agent the schedule runs as"
    );

    let armed = pod.list_flows().await.unwrap();
    let probe = armed.iter().find(|f| f.id == "live-probe").unwrap();
    assert!(probe.is_armed());
    assert_eq!(probe.scheduled_count, 1);

    // Run it. This flow has no prompt node, so it needs no model and no key —
    // what is under test is the request/response shape, not inference.
    let summary = pod
        .run_flow("live-probe", None, None)
        .await
        .expect("POST …/run");
    assert_eq!(summary.flow_id, "live-probe");
    assert!(!summary.status.is_empty());

    pod.list_flow_runs().await.expect("GET /flow-runs");

    // Installing a pack: the *parameter name* is what is under test. This client
    // sent `?reference=` for months while the pod's field is `#[serde(rename =
    // "ref")]`, so every install failed with "provide ?url=, ?path=, or upload
    // the .agentpack as the request body" — a message about three things the
    // caller never meant. A bogus reference must fail at *resolution*, which is
    // proof the pod read the parameter.
    let refused = pod
        .install_agent_pack("nosuchhost:@nothing", false)
        .await
        .expect_err("a made-up reference cannot install");
    let message = refused.to_string();
    assert!(
        !message.contains("provide ?"),
        "the pod did not see our reference at all — check the query parameter name: {message}"
    );

    // A pack the registry names differently from the pack itself. Axoniac lists
    // buildr.space under the handle `@buildrspace`; the archive calls itself
    // `buildr-space`, and that second name is the one the pod files it under and
    // lists it by. A client that compares the handle with the listed id concludes
    // the pack is not installed no matter how many times it installs it — which is
    // what the packs view did, silently, with no error to show for it.
    //
    // Needs the network, so it is skipped unless the caller asks for it.
    if std::env::var("MC_LIVE_REGISTRY").is_ok() {
        let hit = pod
            .registry_search("axoniac", Some("buildr"), 5)
            .await
            .expect("GET …/search")
            .into_iter()
            .find(|h| h.name.to_lowercase().contains("buildr"))
            .expect("axoniac publishes buildr.space");

        pod.install_agent_pack(&hit.reference, true)
            .await
            .expect("installing by the reference the listing handed us");

        let installed = pod.list_agent_packs().await.expect("GET /agent-packs");
        let mine = installed
            .iter()
            .find(|p| p.presets.iter().any(|s| s.contains("buildr")))
            .expect("the pack the pod just installed is in its own list");
        // The two names, and the reason the UI needs more than string equality.
        assert_ne!(
            mine.id, hit.id,
            "this pack is only interesting while its handle and its id differ"
        );
        // Nested under `manifest` in the pod's answer; a version that does not
        // arrive is an update that can never be offered.
        assert!(
            mine.version.is_some(),
            "an installed pack must carry its version: {mine:?}"
        );
    }

    // Disarm keeps the agent; that is the promise the UI makes when it offers a
    // one-click disarm with no confirmation.
    pod.disarm_schedule(&scheduled_id)
        .await
        .expect("DELETE /scheduled-flows/{id}");
    assert!(
        pod.list_instances()
            .await
            .unwrap()
            .iter()
            .any(|i| i.id == agent.id),
        "disarming must not take the agent with it"
    );

    // Rename it before cleanup. A name patch changes the name and nothing else:
    // the pod used to set a `persistent` flag alongside it, so the gesture for
    // "call it something I recognise" silently changed how long the pod kept it.
    // There is no such flag now — nothing deletes an agent on a timer — so the
    // only thing left for a rename to get wrong is the name.
    let renamed = pod
        .rename_instance(&agent.id, "live-probe renamed")
        .await
        .expect("PATCH …/instances/{id} with a name");
    assert_eq!(renamed.name, "live-probe renamed");
    assert_eq!(renamed.id, agent.id);

    // Clean up the agent this run minted. Not just tidiness: arming mints a new
    // one every time, so without this a pod accumulates a "General Agent —
    // Hourly" per run until the fleet is unreadable. It also exercises the
    // delete path, which refuses while a schedule is still armed — so reaching
    // here at all proves the disarm above took effect.
    pod.delete_instance(&agent.id)
        .await
        .expect("an unarmed agent can be deleted");
}
