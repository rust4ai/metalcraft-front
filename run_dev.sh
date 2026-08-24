#!/usr/bin/env bash
#
# Run the UI in a browser, on the real core, against a real pod.
#
#   ./run_dev.sh                       a throwaway pod + the core + Vite
#   ./run_dev.sh --pod http://host:p   point at a pod you already have
#   ./run_dev.sh --no-open             skip opening the browser
#
# Why this exists: the renderer reaches the core only through `Transport`, and
# the only implementation is Tauri IPC — so the app could not be scripted, and
# `PLAN.md` said "nothing verified against a live pod" while five surfaces were
# built on top of it. Three processes close that gap:
#
#   1. a pod          — a scratch `metalcraft-agent`, its data in a temp dir
#   2. `dev_core`     — the app's own core, exposing its RPC over HTTP
#                       (`crates/front-tauri/src/dev_rpc.rs`)
#   3. Vite           — the real renderer, pointed at (2) instead of Tauri IPC
#
# What you get is the shipping UI, in a browser, driving the shipping core. It
# is how the `?ref=` install bug was found after a whole registry browser had
# been built on it — both sides looked correct, and only running them together
# disagreed.
#
# The bridge is unauthenticated and hands out everything the pod can do, so it
# needs BOTH the `dev-rpc` feature and `MC_DEV_RPC`; it binds to 127.0.0.1 and
# release builds cannot serve it at all. Nothing here should ever run on a
# machine you do not own.
set -euo pipefail
cd "$(dirname "$0")"

POD_PORT="${POD_PORT:-3999}"
RPC_PORT="${RPC_PORT:-1421}"
# 5174, not Vite's default: `run.sh` uses :5173 for the desktop shell, and the
# two are useful at the same time.
UI_PORT="${UI_PORT:-5174}"
POD_KEY="${WORKSHOP_API_KEY:-devkey}"
AGENT_DIR="${MC_AGENT_DIR:-$HOME/ai/metalcraft-agent}"

pod_url=""
open_browser=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pod) pod_url="${2:?--pod needs a URL}"; shift 2 ;;
    --no-open) open_browser=0; shift ;;
    *) echo "run_dev.sh: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

wait_for() { # url, what
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "$1" && return 0
    sleep 0.5
  done
  echo "run_dev.sh: $2 did not come up — stopping rather than half-running." >&2
  exit 1
}

# ── 1. a pod ────────────────────────────────────────────────────────────────
if [[ -z "$pod_url" ]]; then
  pod_url="http://localhost:$POD_PORT"
  if curl -sf -o /dev/null "$pod_url/health"; then
    echo "run_dev.sh: using the pod already on :$POD_PORT"
  else
    [[ -d "$AGENT_DIR" ]] || {
      echo "run_dev.sh: no metalcraft-agent at $AGENT_DIR." >&2
      echo "            Set MC_AGENT_DIR, or pass --pod <url> to use one you have." >&2
      exit 1
    }
    # A temp data dir every run: this pod is disposable, and a dev harness must
    # never be one typo away from writing into somebody's real agents.
    data_dir="$(mktemp -d)"
    echo "run_dev.sh: building the pod…"
    (cd "$AGENT_DIR" && cargo build --quiet --bin metalcraft-agent)
    echo "run_dev.sh: starting a scratch pod on :$POD_PORT (data: $data_dir)"
    (
      cd "$AGENT_DIR"
      # Its .env carries OPENAI_API_KEY, without which the pod serves its API
      # but cannot think — flows would run and every prompt node would fail.
      [[ -f .env ]] && { set -a; . ./.env; set +a; }
      METALCRAFT_DATA_DIR="$data_dir" WORKSHOP_API_KEY="$POD_KEY" \
        exec ./target/debug/metalcraft-agent --api --api-port "$POD_PORT"
    ) >/dev/null 2>&1 &
    pids+=("$!")
    wait_for "$pod_url/health" "the pod"
  fi
fi

# ── 2. the core, without a window ───────────────────────────────────────────
# The GUI binary aborts in the platform's launch delegate when there is no
# session to attach to, which is exactly where scripting is wanted — so the
# bridge has its own windowless front door.
echo "run_dev.sh: building the core bridge…"
cargo build --quiet -p front-tauri --features dev-rpc --bin dev_core
MC_DEV_RPC="$RPC_PORT" ./target/debug/dev_core >/dev/null 2>&1 &
pids+=("$!")
for _ in $(seq 1 40); do
  curl -sf -o /dev/null -X POST "http://127.0.0.1:$RPC_PORT/rpc/active_pod" && break
  sleep 0.25
done

# Connect it now, so the browser lands in the fleet instead of on a form. Boot
# asks the core what it is already connected to, so this survives a reload too.
connected=$(curl -sf -m 20 -X POST -H 'content-type: application/json' \
  -d "{\"url\":\"$pod_url\",\"key\":\"$POD_KEY\"}" \
  "http://127.0.0.1:$RPC_PORT/rpc/connect_pod_url" || true)
if [[ "$connected" == *'"name"'* ]]; then
  echo "run_dev.sh: core connected to $pod_url"
else
  echo "run_dev.sh: could not connect the core to $pod_url — the UI will ask." >&2
  echo "            (pod key is '$POD_KEY'; set WORKSHOP_API_KEY to change it)" >&2
fi

# ── 3. the renderer ─────────────────────────────────────────────────────────
(cd frontend && VITE_DEV_RPC="http://127.0.0.1:$RPC_PORT" \
  exec npx vite --port "$UI_PORT" --strictPort) >/dev/null 2>&1 &
pids+=("$!")
wait_for "http://localhost:$UI_PORT/" "Vite"

echo
echo "  UI      http://localhost:$UI_PORT"
echo "  core    http://127.0.0.1:$RPC_PORT/rpc/<command>   (POST, JSON args)"
echo "  pod     $pod_url"
echo
echo "  e.g.  curl -sXPOST -d '{}' http://127.0.0.1:$RPC_PORT/rpc/list_flows | jq"
echo
echo "run_dev.sh: ctrl-C to stop everything."

[[ "$open_browser" == 1 ]] && command -v open >/dev/null && open "http://localhost:$UI_PORT"

wait
