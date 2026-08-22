#!/usr/bin/env bash
# Build the renderer and run the shell.
#
# The touch is not superstition: `tauri-build` embeds `frontendDist` at compile
# time but does not treat it as a rebuild input, so a fresh `dist/` alone leaves
# you running the previous UI and wondering why your change did nothing.
set -euo pipefail
cd "$(dirname "$0")"

npm --prefix frontend run build
touch crates/front-tauri/src/main.rs
RUST_LOG="${RUST_LOG:-info}" cargo run -p front-tauri "$@"
