# metalcraft-front

An Orca-style **Agent Development Environment** for the Metalcraft cloud agent.

Sign in with Metalcraft ID, bind an interface source (Metalcraft Inference · OpenAI ·
OpenRouter · custom), optionally connect an Octaweave workspace or a buildr.space
account, and install agent packs from Axoniac Prime — then work a fleet of agent
instances running on your pod.

 
<img width="2594" height="1596" alt="image" src="https://github.com/user-attachments/assets/353106ec-7bec-4cf2-871f-0fedb89548b4" />

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
