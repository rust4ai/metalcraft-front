#!/usr/bin/env bash
#
# Run metalcraft-front.
#
#   ./run.sh              dev: Vite dev server + the debug shell (HMR)
#   ./run.sh --release    release: frontend embedded in the binary, no server
#
# The distinction is not cosmetic, and it is not the cargo profile that decides
# it: the `tauri` crate computes `dev = !custom_protocol`, so a build *without*
# the `custom-protocol` feature loads `build.devUrl` and never looks at
# `frontendDist` — release profile included. The tauri CLI passes that feature on
# `tauri build`; we use plain cargo, so `--release` passes it here. Get this wrong
# and you get a blank white window with an empty log.
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--release" ]]; then
  npm --prefix frontend run build
  # tauri-build embeds frontendDist at compile time but does not treat it as a
  # rebuild input, so without this you ship the previous UI.
  touch crates/front-tauri/src/main.rs
  exec cargo run --release --features custom-protocol -p front-tauri
fi

vite_pid=""
cleanup() {
  [[ -n "$vite_pid" ]] && kill "$vite_pid" 2>/dev/null || true
}
trap cleanup EXIT

if curl -sf -o /dev/null http://localhost:5173/; then
  echo "run.sh: using the Vite dev server already on :5173"
else
  echo "run.sh: starting the Vite dev server…"
  npm --prefix frontend run dev >/dev/null 2>&1 &
  vite_pid=$!
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null http://localhost:5173/ && break
    sleep 0.5
  done
  if ! curl -sf -o /dev/null http://localhost:5173/; then
    echo "run.sh: Vite did not come up on :5173 — the window would be blank, so stopping." >&2
    exit 1
  fi
fi

RUST_LOG="${RUST_LOG:-info}" cargo run -p front-tauri
