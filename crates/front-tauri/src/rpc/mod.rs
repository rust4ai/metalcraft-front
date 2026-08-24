//! Typed RPC, one module per surface.
//!
//! Split by surface rather than collected into one file on purpose:
//! metalcraft-workshop's equivalent is a 2 000-line `main.rs` holding every
//! command, and it is the part of that codebase that hurts most to work in.
//!
//! Every command returns `Result<T, String>` because that is what crosses the
//! Tauri boundary cleanly, and the string is always the pod's or hub's own
//! message — a user can act on "session expired", not on "500".

pub mod auth;
pub mod chat;
pub mod diagnostics;
pub mod fleet;
pub mod flows;
pub mod gateway;
pub mod keys;
pub mod octaweave;
pub mod packs;
pub mod pods;
