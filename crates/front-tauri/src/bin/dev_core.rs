//! The core and its dev bridge, with no window.
//!
//! `metalcraft-front` is a GUI binary: it needs a display server, and in a
//! headless or backgrounded shell it aborts inside the platform's launch
//! delegate before any of our code runs. That made the dev bridge unreachable in
//! exactly the situation it exists for — scripting the app.
//!
//! So the bridge gets a second front door. This binary is the same `AppState`
//! and the same dispatch, without `tauri::Builder`: enough to hold a pod
//! connection and answer the renderer's RPC over HTTP, which is all a browser
//! (or a `curl`, or a test) needs.
//!
//! ```sh
//! MC_DEV_RPC=1421 cargo run -p front-tauri --features dev-rpc --bin dev_core
//! VITE_DEV_RPC=http://127.0.0.1:1421 npm run dev -- --port 5174   # the real UI
//!
//! # with MC_STUB_POD=1998 as well, `connect_pod_url` to the stub and every
//! # failure the app has to survive can be arranged rather than waited for.
//! ```
//!
//! The modules are included by path rather than through a lib target: this is a
//! dev tool, and adding a `lib.rs` to reshape the crate for it would be the tail
//! wagging the dog.

#[path = "../dev_rpc.rs"]
mod dev_rpc;
// The command bodies, so the bridge dispatches to the same code the app does
// rather than a second copy of it — see `dev_rpc`'s `octaweave_status` arm.
#[allow(dead_code)]
#[path = "../rpc/mod.rs"]
mod rpc;
// The harness's Rust-facing constructors are used by the tests that live beside
// the command bodies, not by this binary, which only serves it over HTTP.
#[allow(dead_code)]
#[path = "../stub_buildr.rs"]
mod stub_buildr;
#[allow(dead_code)]
#[path = "../stub_octaweave.rs"]
mod stub_octaweave;
#[allow(dead_code)]
#[path = "../stub_pod.rs"]
mod stub_pod;
// Same story as `state` below: this binary records nothing itself, it only
// serves what a full app would have recorded.
#[allow(dead_code)]
#[path = "../diag.rs"]
mod diag;
// The GUI binary uses all of `AppState`; this one holds a pod connection and
// nothing else, so the hub-facing helpers read as dead here. Allowed rather than
// trimmed — they are not dead in the binary that ships.
#[allow(dead_code)]
#[path = "../state.rs"]
mod state;

use std::sync::Arc;

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    if std::env::var("MC_DEV_RPC").is_err() {
        eprintln!("set MC_DEV_RPC=<port> — the bridge is off by default on purpose");
        std::process::exit(2);
    }
    dev_rpc::spawn(Arc::new(state::AppState::default()));
    // Both halves from one process: the bridge to drive the app, and — when
    // MC_STUB_POD names a port — a pod to point it at that can be told to fail.
    stub_pod::spawn();
    stub_octaweave::spawn();
    stub_buildr::spawn();
    // The bridge owns a spawned task; this process exists to keep it alive.
    std::future::pending::<()>().await;
}
