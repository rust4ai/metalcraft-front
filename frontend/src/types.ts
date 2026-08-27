/**
 * Shapes that cross the RPC boundary.
 *
 * Hand-written for now. Once the app can reach a pod, `npm run gen:types` will
 * generate the pod half from its `/api/v1/openapi.json` (the agent publishes
 * utoipa OpenAPI) and these become the core-owned remainder.
 */

export interface Session {
  email: string
  premium: boolean
}

export interface DeviceLogin {
  device_code: string
  user_code?: string | null
  verify_url: string
  interval_secs?: number | null
  expires_at?: string | null
}

export type LoginResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'signed_in'; email: string; premium: boolean }
  | { status: 'unknown' }

export interface Pod {
  id: string
  slug: string
  url: string
  status?: string | null
  version?: string | null
}

/**
 * The pod's own answer to "can you think?" — `null` from the RPC when the pod is
 * older than the endpoint and cannot say.
 *
 * Needed because the key store cannot answer it. `list_keys` returns `keys.json`;
 * a provisioned pod's credential is injected as container env and is never in
 * there, so a healthy pod reads as keyless. Inferring "no key, cannot think" from
 * that told premium users their working pod was dead.
 */
export interface InferenceStatus {
  /** A credential resolves. Not a promise the turn succeeds — see `gateway`. */
  ready: boolean
  /** Which one answered: bound here, injected/`.env`, or the pod's own identity. */
  credential: 'stored' | 'environment' | 'pod_token' | 'none'
  /** Where inference is routed, secrets stripped. Absent means OpenAI proper. */
  base_url?: string | null
  /** Routed at the Metalcraft gateway, so turns bill the account's credits — and
   *  the account's premium, which the pod cannot see, is still the gate. */
  gateway: boolean
}

/** What a chat's context currently costs — the read behind `/tokens`. */
export interface ChatContext {
  /** Rough estimate (~4 chars per token), the same one compaction decides on. */
  estimated_tokens: number
  message_count: number
  context_window: number
  /** Automatic compaction fires above this. */
  compact_threshold_tokens: number
  would_compact: boolean
}

/** The result of a forced compaction — `/compact`. */
export interface ChatCompacted {
  /** False when there was nothing old enough to summarize. Not an error. */
  compacted: boolean
  tokens_before: number
  tokens_after: number
  messages_before: number
  messages_after: number
  summary?: string | null
}

/**
 * Work the agent armed for **later** with its `schedule_followup` tool, held on
 * the pod and fired by the daemon's poll loop.
 *
 * A turn is synchronous, so "I'll check back in 3 minutes" is only true if one
 * of these exists behind it. Rendering the countdown is what makes the
 * difference visible from the chat.
 */
export interface ScheduledTask {
  id: string
  chat_id?: string | null
  /** RFC-3339, and a floor rather than an exact moment: the daemon fires it on
   *  the first poll tick at or after this time. */
  run_at: string
  created_at?: string
  /** The instruction the wakeup sub-agent runs — self-contained by contract,
   *  which makes it the honest label for the countdown. */
  task: string
  persona?: string | null
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  /** How many times this chain has re-armed itself; the pod caps it at 12. */
  reschedule_depth?: number
}

/** The connected pod, as the renderer is allowed to see it. */
export interface ActivePod {
  slug: string
  url: string
}

export interface AgentInfo {
  name?: string | null
  version?: string | null
  default_persona?: string | null
}

export type InstanceOrigin =
  | { kind: 'workshop' }
  | { kind: 'cli' }
  /** One person on one channel. `sender` is the normalized key; absent on agents
   *  minted before this was per-sender, which answered for the whole channel. */
  | { kind: 'gateway'; channel: string; sender?: string | null }
  | { kind: 'flow'; flow_id: string }
  | { kind: 'unknown' }

export interface AgentInstance {
  id: string
  agent_preset: string
  agent_pack?: string | null
  name: string
  persona: string
  origin: InstanceOrigin
  /** The pack that provided this preset withdrew it; the agent runs on a frozen copy. */
  orphaned_from?: string | null
  /** An update withdrew its persona and it fell back to the preset default. */
  persona_fallback_from?: string | null
  created_at: string
  last_active_at: string
  /** Conversations this agent has accumulated (flattened in by the list endpoint). */
  conversation_count?: number
}

export interface AgentPreset {
  slug: string
  name: string
  description: string
  tagline?: string | null
  /** The agent pack that provided it — `pack_id` on the wire, not `agent_pack`. */
  pack_id?: string | null
  default_persona?: string | null
  persona_count?: number
  /** Pack-provided presets cannot be edited on the pod. */
  read_only?: boolean
  /** **A library, not an agent.** The preset carries a pack's personas and skills
   *  onto the pod and nothing more — the pod refuses to mint an instance from it.
   *  Still listed, because it is a real artifact and the library is a browser;
   *  never offered by anything that starts an agent. Absent on an older pod,
   *  which reads as `false`. */
  library?: boolean
}

export interface KeyEntry {
  name: string
  masked: string
  /** `'global'` or `'channel'`. */
  scope: string
  channel_id?: string | null
  channel_name?: string | null
  /** Platform-injected and read-only; the pod refuses writes to these. */
  managed: boolean
}

/** Where a pod stands with a registry. Public packs install in every state —
 *  connecting buys private packs and an identity, not access. */
export type ConnectionState =
  | 'connected'
  | 'unlinked'
  | 'no_token'
  | 'rejected'
  | 'unsupported'
  | 'unknown'

export interface RegistryConnection {
  registry: string
  url: string
  trust?: string | null
  token_key?: string | null
  state: ConnectionState
  /** Where a human goes to finish linking — the host's own URL, not a guess. */
  link_url?: string | null
  account?: string | null
  /** The host's own words when something failed; show verbatim. */
  detail?: string | null
}

export interface SearchHit {
  /** Qualified, always: `axoniac:@amy_kitchen`. */
  reference: string
  id: string
  name: string
  version?: string | null
  tagline?: string | null
  category?: string | null
  tags: string[]
  avatar_url?: string | null
  verified: boolean
  install_count?: number | null
}

export interface Registry {
  name: string
  url: string
  trust?: string | null
  is_default: boolean
}

export interface Registries {
  origins: string[]
  default: string
  registries: Registry[]
}

/**
 * What updating a pack did — to the pack, and to the agents made from it.
 *
 * The second half is why the pod has a separate `update` endpoint at all. An
 * agent whose persona the new version withdrew is moved to the preset's default;
 * one whose *preset* was withdrawn keeps running from a frozen copy; and every
 * affected agent's shipped knowledge is repointed at the new version so the
 * change is live on the next turn. All three happen silently, which is exactly
 * why they are worth showing to whoever pressed Update.
 */
export interface PackUpdateReport {
  id: string
  from_version: string
  to_version: string
  personas_fell_back: PersonaFallback[]
  orphaned: OrphanedAgent[]
  memory_bases_repointed: string[]
  install?: unknown
}

export interface PersonaFallback {
  instance: string
  name: string
  /** The persona the new version no longer provides. */
  from: string
  /** The preset's default, used instead. */
  to: string
}

export interface OrphanedAgent {
  instance: string
  name: string
  agent_preset: string
  /** Personas and skills copied into the user-local layer so it still runs. */
  frozen: string[]
}

export interface InstalledPack {
  id: string
  name?: string | null
  version?: string | null
  description?: string | null
  presets: string[]
}

export interface ChatSummary {
  id: string
  name?: string | null
  instance_id?: string | null
  persona_slug?: string | null
  model_name?: string | null
  created_at: string
  /** Last activity, from the chat file's mtime — the clock the pod already uses
   *  to decide a gateway conversation has gone quiet. Absent on a pod older than
   *  the session list, where `created_at` is the best available answer. */
  updated_at?: string | null
  /** The start of the last thing said, trimmed to one line — what makes a row
   *  identifiable as *this* conversation rather than a timestamp beside an id,
   *  and what tells you where it got to. Absent when nothing has been said yet,
   *  and on a pod too old to send it. A pod older than the last-message preview
   *  sends the opening line here instead, which still reads as a label. */
  preview?: string | null
  /** How many turns the conversation holds. Absent from a pod too old to report
   *  it, which is not the same as none and is not ranked as if it were. */
  turn_count?: number | null
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'reasoning'; id: string; encrypted: string }
  | { role: 'tool_call'; id: string; call_id?: string | null; name: string; args: unknown }
  | { role: 'tool_result'; id: string; call_id?: string | null; name: string; result: string }
  /** A conversation boundary: everything above it is history the agent no longer
   *  sees. The one message with no model-side counterpart — a reset ends a
   *  context, not a session, so the transcript keeps everything and the context
   *  restarts here. `reason` is short free text shown on the divider. */
  | { role: 'reset'; at: string; reason: string }

export interface ChatDetail {
  id: string
  name?: string | null
  instance_id?: string | null
  persona_slug?: string | null
  model_name?: string | null
  messages: ChatMessage[]
}

/**
 * One run the pod recorded — its own account of what the agent did, which is a
 * different thing from this app's `Diagnostic` (what this side failed to do).
 */
export interface PodSession {
  id: string
  timestamp: string
  persona_slug?: string | null
  model_name?: string | null
  /** `'session'` for an ordinary run, `'flow'` for a flow run. */
  kind?: string | null
  flow_id?: string | null
  instance_id?: string | null
  /** Executor steps recorded, not user turns. */
  turn_count: number
}

/** A recorded run in full: how it was configured, and every event file in order. */
export interface PodSessionDetail {
  id: string
  /** Persona, model, cwd, tools, skills, and the system prompt as actually built.
   *  Untyped: it is the pod's record of its own configuration. */
  session_info?: Record<string, unknown> | null
  timeline: PodSessionEvent[]
}

export interface PodSessionEvent {
  /** The pod's classification: `turn` | `llm_request` | `compaction` | `error`. */
  kind: string
  file: string
  data: unknown
}

/** Mirrors the agent's SSE frames verbatim; see front-core's `events.rs`. */
/** One step of the agent's plan for the current turn, as `update_plan` wrote
 *  it. `persona` is who it intends to delegate to, and is advisory — a plan that
 *  reroutes mid-turn is a plan working as intended. */
export interface PlanStep {
  step: string
  persona?: string | null
  status: 'pending' | 'in_progress' | 'done' | 'skipped'
}

export type ChatEvent =
  | { kind: 'turn_started'; turn_index: number; user_message: string; session_id?: string | null }
  | { kind: 'llm_started' }
  | { kind: 'llm_completed'; messages: ChatMessage[]; duration_ms: number }
  | { kind: 'tool_started'; tool_call_id: string; name: string; args: unknown }
  | { kind: 'tool_completed'; tool_call_id: string; name: string; duration_ms: number; result: ChatMessage }
  | { kind: 'reply'; content: string; awaiting_reply?: boolean; options?: string[] }
  /** A message sent while a turn was running. It has been taken, not started —
   *  `position` is 1 for the next to run. */
  | { kind: 'queued'; message: string; position: number }
  /** A queued message joined the turn already in flight, at a boundary where
   *  doing so was safe. It stops being pending and becomes part of the thread. */
  | { kind: 'injected'; message: string }
  /** The turn's plan as it stands. Sent on every change, including the empty
   *  list a new turn starts with — render it, do not accumulate it. */
  | { kind: 'plan'; steps: PlanStep[] }
  | { kind: 'error'; code: string; message: string; retryable: boolean }
  /** Work that happens before the model is called and emits nothing else —
   *  compaction (a whole extra LLM call) and memory recall (an embeddings call).
   *  An open string, not a union: a pod newer than this client may name a phase
   *  we have never heard of, and rendering its word beats dropping the frame. */
  | { kind: 'phase'; phase: string }
  | { kind: 'done'; status: 'completed' | 'interrupted' | 'failed'; reason?: string | null }
  /** The context ended — see the `reset` message role. Arrives on its own,
   *  outside any turn's lifecycle: a flow resets before its 3am run, and a
   *  session open at the time has to draw the line without being told twice. */
  | { kind: 'reset'; at: string; reason: string }
  | { kind: 'unknown' }

/**
 * The account's credit balance, from Metalcraft ID's ledger (UI_PLAN §2, S5).
 *
 * `available` is the number the bar shows: `credits` is the raw balance, but a
 * turn already in flight has authorized against it and not yet settled, so the
 * difference is not actually spendable.
 */
export interface Credits {
  credits: number
  available: number
  micro_credits: number
}

/** One persona an instance may be switched to. */
export interface RosterPersona {
  slug: string
  installed: boolean
  name: string
  description: string
  tools: string[]
  skills: string[]
  /** Why it could not be resolved; present only when `installed` is false. */
  error?: string | null
}

/** What one agent knows. `shipped` came from its pack, `learned` it worked out. */
export interface InstanceMemory {
  instance_id: string
  base?: string | null
  shipped: number
  learned: number
  forgotten: number
  sample: MemorySample[]
}

export interface MemorySample {
  id: string
  kind: string
  text: string
  importance: number
  origin: string
  entity?: string | null
  tags: string[]
}

/**
 * What a host says about one pack without downloading it — the registry
 * protocol's `/manifest` (PLAN §9.4, axoniac-prime §11.1).
 *
 * Everything past `id`/`name`/`version` is optional because the protocol is a
 * contract between independent hosts, not one server's serializer: a
 * conforming registry may publish a pack with no skills, no env requirements
 * and no declared domains, and the UI must render that rather than break on it.
 */
export interface PackManifest {
  manifest_version?: number
  id: string
  name: string
  description?: string
  version: string
  tags?: string[]
  presets?: string[]
  provides?: {
    personas?: string[]
    skills?: string[]
    integrations?: { id: string; version: string; content_sha256: string }[]
  }
  /** What the pack needs in the pod's key store to actually work. */
  requires_env?: { name: string; needed_by: string[]; required: boolean }[]
  /** Hosts the pack will reach out to. */
  domains?: string[]
  content_sha256?: string
}

/**
 * An **integration pack** on the pod — HTTP-tool packs from
 * packs.metalcraftai.com, a separate system from the agent packs in the registry
 * browser. `octaweave` is this kind.
 */
export interface Integration {
  id: string
  name: string
  description: string
  version: string
  enabled: boolean
  personas: number
  skills: number
  api_tools: number
  flow_templates: number
  requires_env: string[]
}

/**
 * One line in the error log.
 *
 * The same shape whichever half produced it — the core's `list_diagnostics` or
 * the renderer's own capture — because the person reading it does not care
 * which side of the IPC boundary a failure happened on, only what broke.
 */
export interface Diagnostic {
  id: string
  /** Milliseconds since the epoch. */
  at: number
  level: 'warn' | 'error'
  /** Where it happened: a command name, or a renderer surface. */
  source: string
  /** What it means, in a sentence. */
  message: string
  /** The underlying error, kept apart so `message` stays readable. */
  detail?: string | null
  /** Occurrences collapsed into this line. 1 is the common case. */
  count: number
  /** Which half recorded it. The log labels core entries, because "the app
   *  never heard about this" and "the core decided not to tell you" are
   *  different problems with the same symptom. */
  origin: 'core' | 'app'
}

/**
 * The services the app can connect a pod to in one click: Octaweave (the *life*
 * workspace — notes, board, drive, calendar) and buildr.space (the *work* box —
 * clone a repo, run it, push it).
 *
 * One union rather than two parallel ones because the flow is the same to the
 * last detail: mint a key with the Metalcraft account already signed in here,
 * prove it, store it on the pod, install the pack. The core keeps them apart —
 * different origins, different endpoints, different prose — and everything from
 * the transport up treats them as one shape with a name attached.
 */
export type ServiceId = 'octaweave' | 'buildr'

/**
 * Whether the key on the pod is still a credential, as far as anyone can tell.
 *
 * Three answers rather than a boolean, because "we could not ask" is a real
 * state and the one a boolean would quietly turn into a lie. Reported only where
 * the core can check it — today buildr.space, whose key list the app can read
 * with the person's Metalcraft token. Absent means the question was never asked,
 * which is why every field the card branches on is optional rather than false.
 */
export type KeyCheck =
  /** Not asked. `why` is shown: "unknown" without a reason is a dead end. */
  | { state: 'unchecked'; why: string }
  /** The service still lists it. `expires_at` is RFC3339, or absent for a key
   *  that never lapses — whether that date has *passed* is judged here, on the
   *  clock the person is reading. */
  | { state: 'live'; expires_at?: string | null }
  /** The pod holds a key the service no longer lists: revoked, from its own UI,
   *  from another machine, or by a disconnect this pod never heard about. */
  | { state: 'gone' }

/** Where a service connection stands, as the settings card renders it. */
export interface ConnectionStatus {
  /**
   * The pod holds the key the pack reads.
   *
   * Presence, and only presence — the pod has no way to know whether that string
   * still authenticates. `key_health` is the half it cannot answer.
   */
  key_present: boolean
  pack_installed: boolean
  /** Installed but switched off — the tools exist and will never fire. */
  pack_enabled: boolean
  pack_version?: string | null
  api_tools: number
  /** Absent for a service whose core does not check. */
  key_health?: KeyCheck | null
}

/** One Octaweave workspace this account administers, as the picker lists them.
 *  buildr.space has no equivalent: a key there belongs to the account. */
export interface OctaweaveWorkspace {
  id: string
  org_slug: string
  slug: string
  name: string
  /** Always `admin` in a picker — the core filters out what it could not mint in. */
  role: string
}

/** A finished connection. Carries no key — that never leaves the core. */
export interface ConnectionInfo {
  /** What the key is pinned to: a workspace for Octaweave, an account for
   *  buildr.space. Handed back on disconnect so the core can revoke it. */
  id: string
  /** The name the user recognises — a workspace's, or an account's address. */
  label: string
  url: string
  scopes: string[]
  status: ConnectionStatus
  /** The key stored but the pack did not install — a real halfway state. */
  pack_error?: string | null
  /** Keys this app had minted here before, now revoked. */
  replaced: number
}

/**
 * One step of connecting: done, or the single thing still missing.
 *
 * Every unfinished case resolves by calling connect again — which is what lets
 * the app poll while the user is away in the browser instead of holding a
 * request open. `choose_workspace` comes from Octaweave alone; buildr.space has
 * nothing to pick between, so it never appears there.
 */
export type ConnectOutcome =
  | { kind: 'needs_link'; url: string }
  | { kind: 'choose_workspace'; workspaces: OctaweaveWorkspace[] }
  | { kind: 'connected'; connection: ConnectionInfo }

/**
 * What premium costs, as the hub reports it (`GET /billing/plan`).
 *
 * Minor units, because that is Stripe's unit and rounding on the way through is
 * how a price becomes a different price. Priced by the hub from Stripe rather
 * than written here — a desktop that quoted its own number would be a fourth
 * place for the price to be wrong, and the one a customer checks against their
 * invoice.
 */
export interface Plan {
  amount: number
  currency: string
  interval: string | null
  promo: {
    /** A discount is configured and switched on. */
    offered: boolean
    /** Whether *this* account may still take it. `null` = the hub could not tell
     *  who was asking; the offer is per email, so it is unanswerable, not false. */
    eligible: boolean | null
    first_month_amount: number | null
  }
}

/**
 * The Metalcraft Gateway — WhatsApp and SMS (PLAN §10.6).
 *
 * The pod's shape, not the gateway's: the channel and its webhook live on the
 * pod, so the pod is what gets asked. Four booleans rather than one, because
 * they are four different dead ends with four different fixes.
 */
export interface GatewayStatus {
  /** The pod is linked to a Metalcraft account at all. */
  configured: boolean
  registered: boolean
  /** Proved by texting the code back. Required before connecting. */
  verified: boolean
  /** The pod's `metalcraft` channel is enabled and holds a webhook secret. */
  connected: boolean
  /** The inbound long-poll is draining *right now* — liveness, not config.
   *  Always false in push mode, where no long-poll runs. */
  streaming: boolean
  active_number?: string | null
  /** `whatsapp` or `sms`. */
  channel?: string | null
  has_public_url: boolean
  /** Connected, but the registered webhook no longer points here: green light,
   *  dead pipe. */
  webhook_stale: boolean
  /** The pod could not reach the gateway. The local half above is still true. */
  error?: string | null
}

/** What registering a number answers with. The code is an instruction, not a
 *  secret — the user texts it back from that phone. */
export interface GatewayRegistration {
  personal_number?: string | null
  active_number?: string | null
  channel?: string | null
  verified: boolean
  /** Absent when the number was already verified: nothing to text. */
  verify_code?: string | null
  verify_expires_at?: string | null
}

// ── Automations ────────────────────────────────────────────────────────────
//
// The pod says *flow*; this app says **Automation**. These types name the wire,
// so they keep the pod's word — see `metalcraft-agent/docs/FLOWS_AS_AGENTS_PLAN.md`
// §2.1. Everything a user reads says Automation.

/** One flow from `GET /flows` — the *work*. When it runs is a `ScheduledFlow`. */
export interface Flow {
  id: string
  name: string
  node_count: number
  created_at: string
  updated_at: string
  /** v2/v3 flows run on the state-machine executor; v1 is the legacy prompt list. */
  v2: boolean
  /** The agent preset it runs as; unbound resolves to the pod's default agent. */
  preset: string
  /** How many schedules point at this flow. Zero is the *normal* case — packs
   *  install flows scheduling nothing. */
  scheduled_count: number
  /** Of those, how many fire. Zero with a non-zero `scheduled_count` is a paused
   *  automation, which should read differently from an unscheduled one. */
  enabled_count: number
}

/**
 * A vertex in a flow graph.
 *
 * `data` is deliberately `unknown`: its shape is defined per `node_type` by the
 * flow spec (§5.1), and thirteen core shapes plus open-ended vendor ones do not
 * belong in one union. Renderers narrow it per type; anything they do not
 * understand is carried through untouched.
 */
export interface FlowNode {
  id: string
  /** A core type (`entry`, `prompt`, `conditional`, `branch`, `set_variable`,
   *  `tool`, `http`, `sub_agent`, `approval`, `wait`, `foreach`, `end`,
   *  `branch_tool`) or a vendor type like `slack:send_message`. An **open**
   *  string on purpose — SPEC §5.2 allows any `vendor:name`, and refusing one
   *  would mean refusing to open a flow the pod runs happily. */
  node_type: string
  data: unknown
  /** `[x, y]` for visual editors. Absent or all-zero on flows written by packs
   *  and by the agent itself, which is the common case — see `layout()`. */
  position?: [number, number]
}

/** A directed arc. `source_handle` names which output port it leaves from, which
 *  is how a `conditional`/`branch` node's several outcomes are told apart. */
export interface FlowEdge {
  id: string
  source: string
  target: string
  source_handle?: string | null
  target_handle?: string | null
}

export interface FlowDefinition {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

/** A whole flow document — `GET /flows/{id}`. */
export interface SavedFlow {
  spec_version: string
  id: string
  name: string
  created_at: string
  updated_at: string
  requires?: unknown
  flow: FlowDefinition
}

/** `POST /flows/validate` — what is wrong with a graph, without saving it. */
export interface FlowValidation {
  /** Enable a save button on this rather than on an empty `errors`, so a future
   *  non-fatal warning does not silently start blocking saves. */
  valid: boolean
  errors: string[]
}

/** One scheduled flow from `GET /scheduled-flows` — *when* a flow runs, and as
 *  which agent. Creating one is arming; deleting one keeps the agent. */
export interface ScheduledFlow {
  /** Opaque (`sf_…`). Never shown — use `schedule.name` or `description`. */
  id: string
  flow_id: string
  /** Absent when that flow is gone: a schedule that can never fire. */
  flow_name?: string | null
  enabled: boolean
  schedule: ScheduleSpec
  /** The agent it runs as, so successive firings remember each other. */
  instance_id?: string | null
  /** Absent if the agent was deleted out from under it. */
  instance_name?: string | null
  /** The pod's own rendering of the trigger — including `Invalid cron …`. Show
   *  it verbatim: a schedule that will never fire should look broken. */
  description: string
  next_fire_at?: string | null
}

export interface ScheduleSpec {
  /** Trigger tag: `manual` | `minutes` | `hours` | `cron`. */
  type: string
  name?: string | null
  cron?: string | null
  interval?: number | null
  timezone?: string | null
  persona?: string | null
  inputs?: Record<string, unknown> | null
}

/** A persisted flow run. The pod only persists runs that **paused**, so this is
 *  largely the list of things waiting on a human. */
export interface FlowRun {
  id: string
  flow_id: string
  /** `running` | `paused` | `completed` | `failed`. */
  status: string
  current_node_id: string
  instance_id?: string | null
  pause?: FlowPause | null
  warnings: string[]
  created_at: string
  updated_at: string
}

/** One node's turn in a run — the trace `RunOverlay` replays onto the graph. */
export interface FlowStep {
  node_id: string
  node_type: string
  /** `advanced` | `routed:<handle>` | `completed` | `failed`. */
  outcome: string
  /** Answer snippet, error, or chosen handle. */
  detail?: string | null
}

/** A run with everything needed to read it — `GET /flow-runs/{id}`. */
export interface FlowRunDetail extends FlowRun {
  /** In execution order. */
  steps?: FlowStep[]
  /** The graph as it was when the run took it. Read the run against **this**,
   *  not against the flow on disk, which may have been edited since. Absent on
   *  records written before snapshots existed. */
  flow?: SavedFlow | null
  variables?: unknown
}

export interface FlowPause {
  /** `approval` or `wait`. */
  reason: string
  resume_handles: string[]
  message?: string | null
  wake_at?: string | null
}

/** `GET /flows/{id}/binding` — what arming this would actually permit. */
export interface FlowBinding {
  flow_id: string
  preset: string
  bound: boolean
  personas: { slug: string; allowed: boolean }[]
  armed: {
    schedule_id: string
    /** The schedule's label, so the dialog can name it without an opaque id. */
    name: string
    instance_id: string
    instance_name?: string | null
  }[]
  consent: ArmConsent
}

export interface ArmConsent {
  preset_name: string
  domains: string[]
  requires_env: string[]
  /** Credentials this pod does not have — those tools fail at 3am, unwatched. */
  missing_env: string[]
  mutating_tools: string[]
  tool_count: number
  base_memories: number
}

/** What a hand-triggered run answers with. */
export interface FlowRunSummary {
  run_id: string
  flow_id: string
  status: string
  /** The conversation it wrote — the link from "it ran" to "here is what it did". */
  chat_id?: string | null
  warnings: string[]
}

// ── The library ─────────────────────────────────────────────────────────────
//
// What is actually installed on this pod, and what each artifact is made of.
// Every type here is a read: the library is a browser, and the value it adds is
// that the pod's artifacts reference each other by name — a preset names
// personas, a persona names skills and integrations, an integration provides
// api tools — so what looks like a list of strings is really a graph with the
// edges left as text until something renders them as links.

/**
 * `GET /api/v1/snapshot`, narrowed to the artifacts the library shows.
 *
 * One call rather than five because it is the *only* call: the pod serves
 * `/personas/{slug}` and `/skills/{slug}` but publishes no list beside either,
 * so without the snapshot there is no way to know which personas and skills
 * exist. `null` from the RPC means the pod is too old to have the endpoint —
 * distinct from a pod that answered with nothing installed.
 */
export interface PodSnapshot {
  agent_presets: AgentPreset[]
  personas: PersonaSummary[]
  skills: SkillSummary[]
  api_tools: ApiToolSummary[]
  /** The preset a pod with nothing chosen runs as. */
  default_agent_preset: string
}

/** Set on any artifact an integration provided; absent means it was authored on
 *  this pod. It is also a link: the id is an integration's show page. */
interface Provided {
  pack_id?: string | null
  /** Pack-provided artifacts cannot be edited on the pod. */
  read_only?: boolean
}

export interface PersonaSummary extends Provided {
  slug: string
  name: string
  description: string
}

/** A skill without its body — the listing shape. The body is the artifact, and
 *  it is one `/skills/{slug}` away. */
export interface SkillSummary extends Provided {
  slug: string
  description: string
}

/** `name`, not `slug`: it is the string a model calls the tool by. */
export interface ApiToolSummary extends Provided {
  name: string
  description: string
}

/**
 * One persona in full.
 *
 * `integrations` is a *whole-integration grant* and is deliberately kept apart
 * from `tools`: every HTTP tool that integration provides joins the persona's
 * tool set without being named here, so folding the two lists together would
 * show a persona with three tools when it has thirty.
 *
 * The wire carries no slug — it is in the path — so the caller keeps the one it
 * navigated with.
 */
export interface PersonaDetail {
  name: string
  description: string
  tools: string[]
  skills: string[]
  integrations: string[]
  system_prompt: string
  version?: string | null
}

export interface SkillDetail extends Provided {
  slug: string
  description: string
  /** The markdown the agent actually loads. */
  body: string
}

/**
 * A preset as its own file declares it.
 *
 * The richest artifact on the pod: it names personas, skills and integrations,
 * states what it needs in the key store, and declares a capability floor rather
 * than a model. Every one of those is a link somewhere else, which is why this
 * is the show page the library is built around.
 */
export interface AgentPresetDetail {
  slug: string
  name: string
  tagline?: string | null
  description: string
  version?: string | null
  avatar?: string | null
  default_persona: string
  personas: PresetPersona[]
  skills: string[]
  integrations: string[]
  requires_env: string[]
  model?: ModelFloor | null
  memories?: MemoriesRef | null
  /** See {@link AgentPreset.library}. */
  library?: boolean
  manifest_version: number
}

/** A persona as the *preset* names it, before the pod tried to find it.
 *  `RosterPersona` is the same entry after resolution. */
export interface PresetPersona {
  slug: string
  description?: string | null
  role?: string | null
}

/** **A capability floor, not a model name.** A preset that hard-codes a model
 *  breaks on a pod without it, so it says what it needs and the pod maps that
 *  onto what it has. `prefer` is a hint and is labelled as one. */
export interface ModelFloor {
  tier?: string | null
  prefer?: string | null
  min_context?: number | null
  needs: string[]
}

/** Seed memories a pack ships with a preset — what an agent spawned from it
 *  knows before its first turn. */
export interface MemoriesRef {
  file: string
  count: number
  dims?: number | null
  embed_model?: string | null
}

/** `GET /agent-presets/{slug}` — the declaration and the resolution together.
 *  `preset` is absent on a pod too old to return it. */
export interface PresetDetail {
  preset?: AgentPresetDetail | null
  personas: RosterPersona[]
}

/** An integration with its contents named rather than counted — the list route
 *  (`Integration`) gives four numbers, this gives four sets of links. */
export interface IntegrationDetail {
  id: string
  name: string
  description: string
  version: string
  enabled: boolean
  personas: string[]
  skills: string[]
  api_tools: string[]
  flow_templates: string[]
  requires_env: string[]
}

/** An automation a pack shipped, before anyone installed it as a flow. */
export interface FlowTemplateSummary {
  slug: string
  name: string
  pack_id?: string | null
}

// ── Factory reset ────────────────────────────────────────────────────────

/** How much of a pod to erase. */
export type ResetScope = 'full' | 'keep_keys'

/** Whether the pod expects to come back on its own after it exits. `manual`
 *  means nothing is watching the process — the pod stays down until someone
 *  starts it, which is a thing to say *before* the button, not after. */
export type RestartExpectation = 'supervised' | 'manual'

export interface ResetFailure {
  name: string
  error: string
}

/** The pod's last word before it restarts. There is no confirming read to
 *  follow it with: the pod that answers next has no memory of the request. */
export interface ResetReport {
  scope: ResetScope
  data_dir: string
  removed: string[]
  kept: string[]
  /** Non-empty means the pod is *not* factory-fresh, whatever else succeeded. */
  failed: ResetFailure[]
  restart: RestartExpectation
}
