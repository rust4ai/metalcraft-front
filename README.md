# metalcraft-front

An Orca-style **Agent Development Environment** for the Metalcraft cloud agent.

Sign in with Metalcraft ID, bind an interface source (Metalcraft Inference · OpenAI ·
OpenRouter · custom), optionally connect an Octaweave workspace and install agent packs
from Axoniac Prime — then work a fleet of agent instances running on your pod.

Where Orca is `Electron → node-pty → CLI → git worktree`, this is
`Tauri → HTTPS + SSE → pod /api/v1/* → agent instances`.

**Plan: [`PLAN.md`](PLAN.md)** — user story in §9, phases in §11, upstream dependencies in §12.

## Layout

| Path | What |
|---|---|
| `crates/front-core` | pod client: models + `PodConnection` over `/api/v1/*` (+ SSE) |
| `crates/front-cloud` | Metalcraft ID device flow, pod control plane, connection-token mint |
| `crates/front-tauri` | the desktop shell: state, typed RPC modules, event bridge |
| `frontend/` | React 19 · Vite · Tailwind 4 renderer |

## Develop

```bash
npm --prefix frontend install
npm --prefix frontend run build      # or `run dev` for HMR
cargo build
cargo run -p front-tauri
```
