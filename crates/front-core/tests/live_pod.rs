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
  "spec_version": "2", "id": "live-probe", "name": "Live probe",
  "created_at": "2026-08-23T00:00:00Z", "updated_at": "2026-08-23T00:00:00Z",
  "enabled": true,
  "schedules": [
    { "id": "hourly", "name": "Hourly", "type": "hours", "interval": 1, "enabled": true }
  ],
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

    // Automations. Seed a flow through the pod's own API so the test is
    // self-contained rather than assuming somebody left one lying around.
    let flow: serde_json::Value = serde_json::from_str(FLOW).unwrap();
    pod.put_flow("live-probe", &flow)
        .await
        .expect("PUT /flows/live-probe");
    // Start from a known state. A run that failed mid-way leaves this flow armed,
    // and the next run then fails on an unrelated assertion — a test that only
    // passes on a pristine pod is a test people learn to ignore.
    let _ = pod.disarm_schedule("live-probe", "hourly").await;

    let flows = pod.list_flows().await.expect("GET /flows");
    let probe = flows
        .iter()
        .find(|f| f.id == "live-probe")
        .expect("the flow we just wrote is in the listing");
    assert!(probe.v2, "a spec_version 2 flow reads as v2");
    assert!(
        !probe.preset.is_empty(),
        "an unbound flow still resolves an agent"
    );
    let schedule = probe.schedules.first().expect("its schedule");
    // The fields the UI renders, from a pod rather than from a fixture: the
    // flattened spec, and the pod's own rendering of the trigger.
    assert_eq!(
        schedule.kind, "hours",
        "the flattened spec keeps its `type` tag"
    );
    assert_eq!(schedule.interval, Some(1));
    assert!(
        !schedule.description.is_empty(),
        "the pod describes its own trigger"
    );
    assert!(
        schedule.next_fire_at.is_some(),
        "an interval trigger projects a next run"
    );
    assert!(schedule.instance_id.is_none(), "nothing armed it yet");

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
        .arm_schedule("live-probe", "hourly", None)
        .await
        .expect("POST …/arm");
    assert!(agent.persistent, "an armed schedule's agent is kept");
    assert!(
        pod.list_instances()
            .await
            .unwrap()
            .iter()
            .any(|i| i.id == agent.id),
        "and it shows up in the fleet"
    );

    let armed = pod.list_flows().await.unwrap();
    let probe = armed.iter().find(|f| f.id == "live-probe").unwrap();
    assert!(probe.armed);
    assert_eq!(
        probe.schedules[0].instance_id.as_deref(),
        Some(agent.id.as_str()),
        "the listing reports which agent the schedule runs as"
    );

    // Run it. This flow has no prompt node, so it needs no model and no key —
    // what is under test is the request/response shape, not inference.
    let summary = pod.run_flow("live-probe", None).await.expect("POST …/run");
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

    // Disarm keeps the agent; that is the promise the UI makes when it offers a
    // one-click disarm with no confirmation.
    pod.disarm_schedule("live-probe", "hourly")
        .await
        .expect("DELETE …/arm");
    assert!(
        pod.list_instances()
            .await
            .unwrap()
            .iter()
            .any(|i| i.id == agent.id),
        "disarming must not take the agent with it"
    );

    // Clean up the agent this run minted. Not just tidiness: arming mints a new
    // one every time, so without this a pod accumulates a "General Agent —
    // Hourly" per run until the fleet is unreadable. It also exercises the
    // delete path, which refuses while a schedule is still armed — so reaching
    // here at all proves the disarm above took effect.
    pod.delete_instance(&agent.id)
        .await
        .expect("an unarmed agent can be deleted");
}
