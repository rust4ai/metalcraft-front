//! `front-core` — everything metalcraft-front knows about talking to a pod.
//!
//! One transport, one shape: a [`PodConnection`] holding a base URL and a Bearer
//! token, speaking the agent's `/api/v1/*` surface. Unlike `workshop-api`, which
//! this crate is descended from, there is **no local-filesystem mode** — a pod is
//! always remote, so the `ProjectConnection` trait that existed only to abstract
//! over "local directory vs HTTP" is gone and the HTTP impl is the whole crate.
//!
//! The token is held behind an `Arc<RwLock<String>>` so the owner (front-cloud's
//! refresher) can re-mint an expiring connection token underneath a live
//! connection without tearing it down mid-chat.

pub mod events;
pub mod models;
pub mod pod;

pub use events::{ChatEvent, ChatMessage};
pub use models::*;
pub use pod::{PodConnection, SharedToken};
