# metalcraft-front — an Orca-style ADE for the Metalcraft cloud agent

**Status:** P0 and P6 done, P1–P5 partial (2026-08-22) — sign-in → connect → interface source
→ fleet → session with a live SSE transcript → registry browser, on the Beautiful UI token
layer. 6 commits on local `main`, no remote. **Nothing verified against a live pod yet.**
**Repo:** `~/ai/metalcraft-front` → `git@github.com:rust4ai/metalcraft-front.git`
**Stack:** Tauri 2 (Rust core) + React 19 / Vite / Tailwind 4 / shadcn-Radix (Orca's renderer aesthetic)

---

## 1. Thesis

Orca is an **Agent Development Environment**: a fleet of agents worked in parallel, each in
its own isolated context, all visible in one dashboard, with review/diff/terminal surfaces
attached. Its agent boundary is `node-pty` — a local CLI process per git worktree.

metalcraft-front keeps Orca's *product shape* and *frontend architecture* but swaps the
boundary: **the agent is a remote pod, not a local process.**

```
Orca              : Electron ──node-pty──▶ claude/codex CLI ──▶ local git worktree
metalcraft-front  : Tauri ──HTTPS + SSE──▶ pod /api/v1/* ──▶ agent instances
                              └──HTTPS──▶ code.metalcraftai.com ──▶ sprite workspaces
```

That swap is not a downgrade — it is the reason this app can exist as a *thin* client:
sessions survive laptop sleep by construction (they run in k3s, not in our process tree),
mobile/web clients can attach to the same live session over the same broadcast SSE, and
there is no per-agent CLI install/auth to babysit.

The metalcraft-workshop Tauri app already proves out the hard plumbing (device login, pod
token minting, streaming chat, flow editor). metalcraft-front is **workshop v2 with Orca's
information architecture**: fleet-first instead of file-editor-first.

## 2. What we take from Orca, and what we can't

**Take (frontend architecture + aesthetic):**
- Renderer stack: React 19, Tailwind 4, shadcn/ui on Radix, `lucide-react`, `sonner`,
  `cmdk` command palette, `@tanstack/react-virtual`, `zustand` for state.
- **Beautiful UI** (beautifului.dev, MIT — mirrored in `~/ai/beautifului-dev`) for the parts
  Orca's aesthetic does not name: the 20 primitives for *where a model is doing the work*.
  Its token layer is adopted wholesale — OKLCH surfaces, a three-level ink ramp, the
  ring-plus-multi-stop shadow ladder, the two decelerating motion curves. Its four principles
  are load-bearing here: **latency is content** (elapsed counters, not spinners), **reasoning
  is disclosed, not hidden or forced** (traces collapse to one past-tense line), **proposed ≠
  applied**, and **provenance travels with the claim**.
- **Process split discipline.** Orca's `src/main` (privileged, owns PTYs/creds) vs
  `src/renderer` (pure view) maps 1:1 onto Tauri's Rust core vs webview. Same rule:
  *no secret and no network credential ever crosses into the webview.*
- Typed RPC-per-method layout (`src/main/runtime/rpc/methods/*`) instead of one god-file
  of `#[tauri::command]`s — workshop's `main.rs` is already 2 000 lines and hurts.
- Tabs / panes / split layouts, session restore, hibernation, quick-open, per-session
  status chips, "fleet dashboard" as the home screen.
- Toolchain: oxlint + vitest, `max-lines` ratchet, changed-files lint gates. **npm, not pnpm** —
  it is what metalcraft-workshop uses and pnpm is not installed on the dev machine.

**Can't take (and don't fake):**
- PTY/terminal-as-source-of-truth. Our transcript *is* structured (`ChatEvent` SSE), which
  is strictly better — Orca's Chat UI is a best-effort decoder over ANSI; ours is native.
- Local git worktrees. Our isolation unit is an **agent instance** (+ optionally a
  **metalcraft-code workspace**), not a directory on this machine.
- Design Mode's embedded Chromium (`agent-browser`) — v2 at the earliest, and it would
  drive the *sprite's* exposed port, not a local dev server.

## 3. Concept mapping

| Orca | metalcraft-front | Backed by |
|---|---|---|
| Worktree | Agent instance (`InstanceOrigin::Workshop`) | `GET/POST /api/v1/agents/instances` |
| Agent combobox (30+ CLIs) | Agent preset picker | `/api/v1/agent-presets`, `/api/v1/agent-packs` |
| Installing a CLI agent | Installing an agent pack | `POST /api/v1/agent-packs/install` (registry) |
| Terminal pane (PTY) | Transcript pane (structured SSE) | `POST /chats/{id}/turn`, `GET /chats/{id}/events` |
| Session history | Chats per instance + diagnostics sessions | `/api/v1/chats`, `/api/v1/diagnostics` |
| Hibernation | Ephemeral vs `persistent` instances (TTL reaper) | `agent_instance.rs` |
| Remote Orca Server | The pod itself (always remote) | `pods.metalcraftai.com` |
| SSH worktrees | metalcraft-code sprite workspaces | `code.metalcraftai.com /api/v1/workspaces` |
| Diff review + comments | Workspace file diff + "send to agent" | `GET/PUT /workspaces/{id}/files`, `/git` |
| Orca skills registry / MCP | Skills + packs + flows | `/api/v1/skills`, `/api/v1/flows` |
| Provider accounts + hot-swap | **Interface source** (OpenAI / Metalcraft Inference / OpenRouter / custom) | pod Keys API (`OPENAI_API_KEY`, `OPENAI_BASE_URL`) |
| "Install an agent from the picker" | **Axoniac Prime** pack browser → install to pod | axoniac public API + `POST /api/v1/agent-packs/install` |
| — (no analogue) | **Octaweave workspace** — notes/board/drive/calendar/blog/studio the agent shares with you | `octaweave.com/api/v1` + `owk_live_` key in pod Keys |
| Usage & rate-limit tracking | Credits / inference usage | metalcraft-id + inference (needs endpoint) |
| Mobile companion | metalcraft-mobile (exists, APNs) | same SSE broadcast |

The single most important alignment: **agent instances are already many-per-pod, each with
its own preset, persona, memory and many conversations** (`src/agent_instance.rs`). That is
exactly Orca's fleet model, already implemented server-side. This app is the missing UI.

## 4. Stack decision

**Core (Rust, Tauri 2):**
- `tauri = "2"` + `tauri-plugin-dialog`, `tauri-plugin-deep-link` (already used by workshop),
  add `tauri-plugin-store`, `tauri-plugin-updater`, `tauri-plugin-single-instance`,
  **`keyring`** for the PAT (workshop writes it plaintext to `~/Library/Application Support` —
  fix that here).
- `reqwest` + `eventsource-stream` for pod SSE, `tokio`, `anyhow`, `serde`.
- Types shared with the agent via **`openapi-typescript` against the pod's
  `/api/v1/openapi.json`** (agent 0.16.0+ publishes utoipa OpenAPI; workshop already does
  `pnpm gen:types`). Rust side reuses `workshop-api`'s structs.

**Renderer:** React 19, Vite 6 (Orca uses `rolldown-vite`; standard Vite until there is a
reason to swap), Tailwind 4 (`@tailwindcss/vite`), shadcn-style primitives on Radix,
zustand, cmdk, `@tanstack/react-virtual`, `react-markdown`+remark/rehype+shiki-ish
highlighting, `monaco-editor` (workspace file editing), `@xterm/xterm` (workspace `exec`
output only), `@xyflow/react` (flow editor, ported from workshop), `sonner`, `lucide-react`.

**Why Tauri over Electron:** we already have a Rust HTTP/SSE client layer (`workshop-api`)
that is the whole backend of this app; shipping Electron would mean rewriting it in TS or
running a sidecar. Bundle size and memory are a bonus, not the reason.

## 5. Repo layout

```
metalcraft-front/
├── crates/
│   ├── front-core/          # fork of workshop-api: ProjectConnection, RemoteConnection,
│   │                        # models (personas/skills/flows/chat/keys/gateway/agents)
│   ├── front-cloud/         # NEW: metalcraft-id device flow, pods control plane,
│   │                        # pod token mint+refresh, metalcraft-code client
│   └── front-tauri/         # thin: state, rpc/ modules, event bridge, updater
│       └── src/rpc/{auth,pods,instances,chat,workspaces,flows,keys,gateway,packs}.rs
├── frontend/
│   └── src/
│       ├── app/             # shell: titlebar, tabs, panes, split layout, routing
│       ├── features/        # fleet, session, workspace, flows, packs, keys, gateway, settings
│       ├── components/ui/   # shadcn primitives
│       ├── stores/          # zustand slices (connection, fleet, sessions, ui)
│       ├── rpc/             # typed method wrappers + event subscriptions
│       │   └── transport/   # tauri (invoke/listen) | http (fetch/EventSource) — see §8
│       └── api-types.ts     # generated from pod openapi.json
├── vite.web.config.ts       # second target: the browser build (retires workshop-web)
├── config/                  # oxlint/oxfmt/vitest configs + ratchet scripts (Orca-style)
└── docs/
```

Note `front-cloud` is new and does **not** exist in workshop — there the cloud bits are
inlined in `main.rs:1240-1500`. Extracting them is a precondition for reuse by
metalcraft-mobile / a future web build.

## 6. What to steal from metalcraft-workshop

| Source | Take | Change |
|---|---|---|
| `crates/workshop-api/*` (4 181 LOC) | whole crate → `front-core` | drop `LocalConnection`/`watcher.rs` (no local project mode); keep `RemoteConnection` only |
| `main.rs:1240-1500` | device flow, pod list, mint + background refresher | move to `front-cloud`; PAT → OS keychain; support **multiple pods connected at once** (workshop holds one `RemoteConnection`; we need a map) |
| `main.rs` pod-readiness poll (10×15 s) | keep verbatim | surface as a "waking" state chip in the fleet grid instead of a blocking spinner |
| `chat_turn` + `subscribe_chat_events` | keep the SSE→Tauri-event bridge | one subscription **per open session**, not one global (`stop_chat_events` implies a singleton today) |
| `components/ChatsView.tsx` (936) | transcript rendering, tool-call cards, markdown | restyle to shadcn; split into `Transcript`/`ToolCard`/`Composer`; virtualize |
| `components/FlowsView.tsx` (2 217) | xyflow graph editor + node inspectors | port near-verbatim; it is the single biggest asset here |
| `AgentsView` / `AgentPacksView` (1 330) | preset/instance/pack CRUD | becomes the **agent picker + pack registry** surfaces |
| `KeysView`, `GatewayView`, `IntegrationsView`, `SessionsView`, `NetworkView` | logic | reskin, move behind Settings/secondary tabs |
| `hooks/useWorkshop.ts` | connection lifecycle | replaced by zustand `connectionStore` |
| `openapi.json` + `gen:types` | keep the codegen step | pin to the connected pod's version; warn on drift |

Rough reuse estimate: **~60 % of the Rust and ~40 % of the TSX carries over**; the shell,
fleet view, workspace surface and design system are new.

## 7. Auth & connection

```
1. Sign in       POST id.metalcraftai.com/auth/device/start → open browser → /auth/device/poll
                 → PAT (mck_) + email  →  OS keychain (NOT plaintext json)
2. List pods     GET pods.metalcraftai.com/api/pods            (Bearer PAT)
3. Connect       POST /api/pods/{slug}/connection/mint         → aud=pod:{slug}, ~1 h
                 background refresher re-mints before expiry
4. Talk          {slug}.metalcraftai.com/api/v1/*              (Bearer connection token)
5. Code          POST code.metalcraftai.com/api/v1/account/tokens → mck_ for workspaces
```

Decisions:
- **One pod today, many later.** The cluster gives one pod per premium member, so v1 ships
  **no pod-switcher UI** — the fleet grid is instances-only and the connected pod is implicit
  in the titlebar. The connection layer is still a `HashMap<slug, Connection>` from day one
  (self-hosted pods and workshop's manual "API key (Bearer)" escape hatch are extra entries),
  so growing to many pods is a UI change, not a re-architecture.
- Tokens live in Rust only. The webview gets pod *slugs*, never a bearer.
- Deep link `metalcraft-front://` for the device-flow return (plugin already in workshop).
- Offline/expired → a non-blocking banner + per-card "reconnect", never a modal wall.

## 8. Frontend architecture (Orca-style, concretely)

- **Stores (zustand, sliced):** `connection` (pods, tokens' *state* only), `fleet`
  (instances × pods, live status), `sessions` (open tabs, transcripts, composer drafts),
  `workspaces`, `ui` (layout, theme, palette). Selector-fanout discipline copied from Orca:
  components subscribe to leaf selectors, never whole slices.
- **Event bridge:** Rust emits `session://{chat_id}/event` Tauri events carrying `ChatEvent`
  frames verbatim; the renderer reduces them into transcript state. Because the pod's
  `GET /chats/{id}/events` is a **broadcast** channel, we can subscribe to *every* active
  chat at once — that is what makes the fleet dashboard live rather than polled.
- **Draft persistence + session restore:** composer drafts and open-tab layout in
  `tauri-plugin-store`, restored on launch (Orca parity). **Local only** — layout is not
  synced to the pod; metalcraft-mobile keeps its own IA and there is no cross-device tab
  state to reconcile.
- **Transport abstraction (required at P2, not retrofitted).** Because a browser build is in
  scope (§11 P11), no component may call `invoke()` or `listen()` directly. All RPC goes
  through `rpc/transport`, with two implementations behind one interface:
  `tauri` (invoke + Tauri events) and `http` (fetch + `EventSource` against a thin proxy,
  reusing workshop-web's stateless-proxy design). Enforced by an oxlint rule banning
  `@tauri-apps/api` imports outside `rpc/transport/tauri.ts`.
- **Transcript reducer** handles the real event set: `turn_started`, `llm_started`,
  `llm_completed`, `tool_started`, `tool_completed`, `reply`, `error{code,message,retryable}`,
  `done{status,reason}` (see `workshop_api.rs:3728-3786`). `error` gets first-class UI —
  the 402 out-of-credits path already has a taxonomy.
- **Optimistic composer:** user bubble appears immediately; a 409 "chat is already mid-turn"
  rolls it back with a toast (the pod rejects concurrent turns per chat).

## 9. Onboarding — the first-run story

This is the spine of the product, and every surface in §10 is reachable from it. Four steps,
each individually skippable except the first, each resumable (state in `tauri-plugin-store`,
so a half-finished setup survives a quit).

### 9.1 Sign in with Metalcraft ID
Device flow (§7) → PAT in keychain → pod list → auto-connect the single pod, showing the
"waking" state while the readiness poll runs. No pod → the *get a pod* hand-off (premium
upsell / trial code), mirroring Axoniac's §10.2 "visitor with no pod" funnel.

### 9.2 Bind an interface source  ← *the step that makes the agent able to think*
An **interface source** is where completions come from. The wizard offers:

| Source | Base URL | Key | Notes |
|---|---|---|---|
| **Metalcraft Inference** (default) | `inference.metalcraftai.com/v1` | minted from the signed-in account | billed in hub credits; the zero-config path |
| **OpenAI** | `api.openai.com/v1` | user's `sk-…` | direct billing |
| **OpenRouter** | `openrouter.ai/api/v1` | user's `sk-or-…` | wide model catalog |
| **Custom** | any | any | self-hosted / other gateways |

Mechanically this writes two values into the pod's key store via the existing Keys API:
`OPENAI_API_KEY` and `OPENAI_BASE_URL`. The agent's client builder is **OpenAI-Responses-API
shaped** for every source (`runtime.rs:415-435` explains why: chat/completions rejects the
agent's parallel-tool-call message layout), so a source is only compatible if it implements
`POST {base}/responses`. **The UI must state this** — OpenRouter/custom sources get a
"verify" step that runs a throwaway turn and reports the failure legibly rather than letting
the user discover it mid-conversation. Metalcraft Inference passes by construction (it
proxies `/responses`).

Blocked on the upstream fix in §12.1 — today the key is read from process env, not the key
store. Until that lands, the wizard writes the keys, shows what it wrote, and tells the user
a pod restart is required; after it lands, the next turn picks it up with no restart.

Model list per source is client-side (the pod's `AVAILABLE_MODELS` is a compile-time
constant — §12.2), with a free-text override.

### 9.3 One-click Octaweave workspace *(optional)*
[Octaweave](https://octaweave.com) is notes + kanban + drive + calendar + blog + image
studio — the workspace a person lives in, that their agent can work in too via the
`octaweave` agent pack (32 typed tools, `octaweave-agent-skills/metalcraft-agent/`).

One click, four things:
1. Browser hand-off to octaweave.com to create/pick a workspace (an `owk_` key **cannot mint
   another key**, and key creation refuses key-auth outright — so this step is a signed-in
   human in a browser, by design, not something the app can do headlessly).
2. Return via `metalcraft-front://octaweave/callback` with the `owk_live_…` token, which is
   shown exactly once at creation.
3. Store it as `OCTAWEAVE_API_KEY` in the pod's key store (global scope).
4. Install the `octaweave` agent pack, then verify with `GET /api/v1/whoami` and show
   `actor.workspace_id` + granted scopes as confirmation.

Scope defaults to the **narrowest set that works** — `notes:write board:write calendar:write
drive:write` — with `studio:write` off by default and flagged in the UI as "spends money".
`blog:publish` is off by default: publishing is a public act.

*Open:* whether the app should offer a workspace-creation API path if octaweave later exposes
a session-authed provisioning endpoint. The browser hand-off works today and is the honest
version of "one click".

### 9.4 Browse Axoniac Prime and install agent packs *(optional)*
[Axoniac Prime](https://github.com/…/axoniac-prime) is "Instagram, where every profile is an
agent" — the social registry where a pack is a profile page. Its public API is already
specified (`axoniac-prime/PLAN.md` §6) and, crucially, §9 establishes that **a registry is a
protocol, not a host**: four endpoints (`/version`, `/manifest`, `/download`, optional
`/search`) plus the shared `metalcraft-packs` spec crate. packs.metalcraftai.com is a peer,
not an upstream.

So the pack browser is written against *the contract*, and shows every registry the pod is
willing to fetch from (`GET /api/v1/agent-packs/registries` returns origins + trust + default
precisely so a UI can say what it accepts **before** the user pastes a link). Axoniac is the
default social host; the first-party ecosystem host is a second tab.

Per pack, before installing, show what Axoniac exposes: presets, personas, skills, **what it
already knows** (`/presets/{slug}/memories`), and `/requirements` — integration packs,
domains, and env it needs. Requirements that are unmet on this pod (a missing key, an
unbound interface source) are listed as a pre-install checklist, not discovered as a runtime
failure. Install → `POST /api/v1/agent-packs/install` → the pack's presets appear in the
agent picker (§10.3) and can be spawned as instances immediately.

Each host publishes a signing key; the pod verifies content hashes on install (agent already
does hash-verify — see the `flows-requires-and-pack-versioning` work). The UI surfaces the
verified/unverified state rather than hiding it.

### 9.5 Done → Fleet
The wizard ends by spawning the first instance (from a just-installed pack, or the default
preset) and dropping the user into its session. Re-runnable any time from Settings; each
step is also a standalone settings surface.

---

## 10. UI surfaces

0. **First-run wizard** — §9, as a four-step flow; each step also lives permanently in
   Settings (Interface source · Octaweave · Registries & packs).
1. **Fleet** (home). Grid of agent-instance cards across pods: preset icon, persona, last
   activity, live status (idle / thinking / running `tool` / needs-attention / error),
   turn-count, origin badge (workshop | gateway | flow | cli). Click → open session tab.
   `⌘K` quick-open across instances, chats, flows, skills, workspaces.
2. **Session.** Split: transcript (virtualized, tool calls collapsed into one
   `Ran N tools` trace, markdown+mermaid+katex) | right rail (instance memory, persona switch within the preset roster, model,
   linked workspace, diagnostics deep-link). Composer with attachments and slash commands
   mapped to agent skills.
3. **New agent** dialog = Orca's agent combobox: pick **agent preset** (from installed
   packs) → persona → name → persistent? → optional workspace to attach.
4. **Workspace** (metalcraft-code). File tree + Monaco + git status/diff + `exec` output in
   xterm + build/test/actions runs. "Send selection to agent" mirrors Orca's diff-comment
   → prompt flow. Hibernate/wake controls.
5. **Packs & Flows.** Registry browser (**Axoniac Prime** by default, packs.metalcraftai.com
   as a peer tab, any contract-compliant host addable), flow graph editor, schedules,
   flow-run inspector.
6. **Settings.** Account, pods, **interface source**, **Octaweave connection**, keys/secrets
   (global + per-channel scopes), registries & installed packs, gateway channels,
   integrations, diagnostics, updates, theme.

## 11. Phases

| P | Deliverable | Done when |
|---|---|---|
| **P0** ✅ | Repo skeleton: Tauri 2 + Vite/React 19/Tailwind 4, oxlint/vitest, CI | done — lint + 10 vitest + 14 cargo tests + clippy clean; window opens |
| **P1** 🟡 | `front-core` (pod client, remote-only) + `front-cloud` (device flow, pods, mint+refresh, keychain) | written and unit-tested; **unverified against a live pod** |
| **P2** 🟡 | Shell: sidebar, tabs/panes/splits, `cmdk` palette, theme, session restore — see **`UI_PLAN.md`** | Orca three-column frame, sidebar agent tree, tabs + restore, transport boundary done (UI_PLAN S1–S3); right rail, status meters, nudges, palette outstanding (S4–S7) |
| **P3** 🟡 | **Fleet view** — list instances, live status via multiplexed SSE, create/rename/delete from presets | grid, cards, origin/orphan notices, spawn dialog, and per-instance live status from the session subscription done; fleet-wide status without an open session needs §12.5 |
| **P4** 🟡 | **Session view** — transcript reducer over all `ChatEvent` variants, tool cards, composer, drafts, error/402 rendering, diagnostics deep-link | transcript + tool cards + composer + error rendering done and tested against stubbed frames; **live-pod round trip outstanding**; markdown, drafts, virtualization, deep-link outstanding |
| **P5** 🟡 | **Onboarding wizard** (§9) + **interface source** binding: the four providers, key/base-URL write via Keys API, verify-turn, model picker, resumable state | source picker + atomic key/base-URL write + honest restart/`/responses` warnings done, and a keyless pod routes here instead of to a dead fleet; **verify-turn and model picker outstanding** |
| **P6** ✅ | **Axoniac Prime pack browser**: registry list from the pod's allowlist, browse/search, profile view (presets · personas · skills · what-it-knows · requirements checklist), install/update/uninstall, orphaned-preset + persona-fallback warnings | built against the pod's own registry proxy (status/connect/search/manifest, agent `3a6ab9a`); verified against a stubbed pod — **live install still unverified** |
| **P7** | **Octaweave one-click**: browser hand-off + deep-link callback, key stored at narrowest scopes, pack install, `whoami` confirmation, connection card in Settings | agent reads and writes a real Octaweave workspace in the next turn |
| **P8** | **Workspaces** (metalcraft-code): list/create/clone, file tree + Monaco, git diff, exec/build/test with run output, attach-to-instance (client-side map first, server field when it lands — §12.8) | agent edits a repo while the diff updates in-app |
| **P9** | Flows port (xyflow) + schedules + flow-run inspector; keys/gateway/channels settings | parity with workshop's editors |
| **P10** | Release: signed macOS (notarized) / Windows / Linux bundles, `tauri-plugin-updater`, Homebrew cask | `metalcraft-front` installs and self-updates |
| **P11** | **Web target**: `vite.web.config.ts` + `http` transport against a stateless Rust/Axum proxy (lifted from metalcraft-workshop-web: `mc_session` cookie login, in-memory pod-connect, streaming `/api/pod/*`) | the same UI runs at `workshop.metalcraftai.com`; workshop-web retires |

**P0–P5 is the product**: sign in, bind a source, talk to an agent. P6–P7 are the two optional
onboarding branches (packs, workspace) and are what make it *interesting* rather than merely
functional — do them next. P8–P9 is parity + depth, P10 ships it, P11 collapses two codebases
into one.

## 12. Upstream gaps this exposes (work in metalcraft-agent / metalcraft-code)

These are **not** blockers for P0–P4, but the UI will be visibly better with them:

1. ~~**Interface source is env-only.**~~ **FIXED** in agent 0.31.0 (`0f9df96`): both settings now
   resolve through `key_store::lookup_present()`, which treats a blank value as absent at every
   level, and the turn path re-reads per turn so a client-written key applies with no restart.
   `memory::embeddings()` had the same bug plus a `OnceLock` caching the absence for the life of
   the process; it caches successes and re-checks absence now. Original diagnosis:
   `AgentRuntimeContext::from_environment()`
   reads `OPENAI_API_KEY` from process env (`runtime.rs:437-440`) and `build_openai_client`
   reads `OPENAI_BASE_URL` from env (`runtime.rs:426-432`). Neither consults the key store, so
   §9.2 cannot take effect without a pod restart. **Fix: resolve both through
   `key_store::lookup()`**, which already implements "stored wins over env" for ordinary keys
   (`key_store.rs:290`, test `ordinary_key_is_store_first`). Because the turn path calls
   `from_environment()` **per turn** (`workshop_api.rs:3881`), the very next turn picks up a
   key written by the Keys API — no restart, no new storage, no new endpoint. *(agent, small —
   do this first)*
2. **Model catalog is compile-time.** `AVAILABLE_MODELS` is a `const` (`runtime.rs:22`), so the
   client can't know what an OpenRouter or custom source offers. Add `GET /api/v1/models`
   (pod-side, source-aware) or accept a client-side catalog per provider + free-text override.
   *(agent, small)*
3. **Turn cancellation.** There is no `POST /chats/{id}/interrupt`; `Done{status:"interrupted"}`
   only comes from the executor's own guard (`workshop_api.rs:4156`). A stop button needs a
   real endpoint. *(agent, small)*
4. **Token-level streaming.** `LlmCompleted` arrives whole — no deltas. Orca's chat feels
   live because a PTY streams bytes. Add `LlmDelta { text }` frames behind a feature flag.
   *(agent, medium)*
5. **Fleet status endpoint.** Today "is this instance busy?" means holding an SSE per chat.
   A `GET /api/v1/agents/instances?with_status=1` (busy/last_event) would make the dashboard
   cheap, especially on mobile. *(agent, small)*
6. **Usage/credits.** Orca ships rate-limit tracking; our equivalent lives in
   metalcraft-inference/id. Expose a per-account usage summary the client can poll.
7. **metalcraft-code run streaming.** `runs/{run_id}` is poll-only — no SSE anywhere in the
   backend. Add an event-stream for long `exec`/`build` so xterm output is live. *(code, small)*
8. **Workspace ↔ instance binding.** Add an optional `workspace_id` to `AgentInstance` so
   "this agent is working on that repo" is server-side state and metalcraft-mobile can show
   it too. Cosmetic, not load-bearing — the client keeps a local map until it exists.
   *(agent, small)*
9. **MCP client in the agent** (0 hits for `mcp` in `metalcraft-agent/src`). Not required —
   packs cover our tools — but it is the one thing that would let metalcraft agents consume
   the wider ecosystem the way Orca-hosted CLIs do. Separate decision, separate plan.

## 13. Testing & release

- **Rust:** unit tests on `front-core` models + a mock pod (`axum` test server) for the SSE
  reducer; `front-cloud` device-flow/mint tested against stubbed hub responses.
- **Renderer:** vitest + Testing Library for the transcript reducer (feed recorded SSE
  fixtures — capture real ones from a pod into `tests/fixtures/`), stores, and palette.
- **E2E:** Playwright against `tauri driver` for launch → login (stubbed) → fleet → send turn.
- **Gates copied from Orca:** oxlint (native + type-aware) on changed files, max-lines
  ratchet, `knip` dead-code audit, react-doctor.
- **Release:** `tauri-action` in GitHub Actions, macOS notarization, updater manifest on R2,
  Homebrew cask under `Casks/` (same shape Orca uses).

## 14. Decisions (resolved 2026-08-22)

1. **One pod now, many later.** v1 has no pod switcher; the multi-pod map stays in the
   connection layer as future-proofing. → §7, §10.1
2. **Layout is local.** Simpler, and mobile has its own IA. No pod-side tab state. → §8
3. **Workspace ↔ instance binding: server-side, eventually.** Nice-to-have cosmetic, so the
   client ships a local map at P6 and moves to an `AgentInstance.workspace_id` when the agent
   adds one. → §11 P8, §12.8
4. **Web build: yes.** A second Vite target retires metalcraft-workshop-web. The cost is paid
   up front as a transport abstraction at P2 — retrofitting one after the renderer is full of
   `invoke()` calls is the expensive version. → §5, §8, §11 P11
5. **Name: `metalcraft-front`** — shipped product name and repo name.

6. **Two different "workspaces", deliberately.** **Octaweave** (§9.3) is the *life* workspace —
   notes, board, drive, calendar, blog, studio — and is onboarding (P7). **metalcraft-code**
   (§10.4, P8) is the *code* workspace — sprite, repo clone, git, exec. They are not competing
   surfaces and neither blocks the other; if only one ships, ship Octaweave, because it is the
   one in the user story.

Still genuinely unknown (answer during build, not now):

- Whether P4's transcript feels acceptable without token-level streaming (§12.4). If it
  doesn't, `LlmDelta` moves from "nice" to a P4 blocker.
- Whether any non-Metalcraft interface source actually works end-to-end. Every source must
  implement `POST {base}/responses` (§9.2). OpenAI does; OpenRouter's compatibility needs a
  real test before the wizard offers it without a warning label.
- Whether one SSE subscription per active chat scales to a full fleet grid, or whether the
  busy-status endpoint (§12.5) is needed sooner than P6.
