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
//! ```
//!
//! The modules are included by path rather than through a lib target: this is a
//! dev tool, and adding a `lib.rs` to reshape the crate for it would be the tail
//! wagging the dog.

#[path = "../dev_rpc.rs"]
mod dev_rpc;
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
    // The bridge owns a spawned task; this process exists to keep it alive.
    std::future::pending::<()>().await;
}
