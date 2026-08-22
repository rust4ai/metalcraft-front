#!/usr/bin/env bash
#
# Run metalcraft-front.
#
#   ./run.sh              dev: Vite dev server + the debug shell (HMR)
#   ./run.sh --release    release: frontend embedded in the binary, no server
#
# The distinction is not cosmetic. A **debug** Tauri build loads `build.devUrl`
# from tauri.conf.json — it does not look at `frontendDist` at all — so running
# the debug binary without Vite gives you a blank white window and no error.
# Only a release build embeds `frontend/dist`.
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--release" ]]; then
  npm --prefix frontend run build
  # tauri-build embeds frontendDist at compile time but does not treat it as a
  # rebuild input, so without this you ship the previous UI.
  touch crates/front-tauri/src/main.rs
  exec cargo run --release -p front-tauri
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
