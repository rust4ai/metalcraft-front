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
  | { kind: 'gateway'; channel: string }
  | { kind: 'flow'; flow_id: string }
  | { kind: 'unknown' }

export interface AgentInstance {
  id: string
  agent_preset: string
  agent_pack?: string | null
  name: string
  persona: string
  origin: InstanceOrigin
  persistent: boolean
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
  updated_at?: string | null
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'reasoning'; id: string; encrypted: string }
  | { role: 'tool_call'; id: string; call_id?: string | null; name: string; args: unknown }
  | { role: 'tool_result'; id: string; call_id?: string | null; name: string; result: string }

export interface ChatDetail {
  id: string
  name?: string | null
  instance_id?: string | null
  persona_slug?: string | null
  model_name?: string | null
  messages: ChatMessage[]
}

/** Mirrors the agent's SSE frames verbatim; see front-core's `events.rs`. */
export type ChatEvent =
  | { kind: 'turn_started'; turn_index: number; user_message: string; session_id?: string | null }
  | { kind: 'llm_started' }
  | { kind: 'llm_completed'; messages: ChatMessage[]; duration_ms: number }
  | { kind: 'tool_started'; tool_call_id: string; name: string; args: unknown }
  | { kind: 'tool_completed'; tool_call_id: string; name: string; duration_ms: number; result: ChatMessage }
  | { kind: 'reply'; content: string }
  | { kind: 'error'; code: string; message: string; retryable: boolean }
  | { kind: 'done'; status: 'completed' | 'interrupted' | 'failed'; reason?: string | null }
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

/** Where the Octaweave connection stands, as the settings card renders it. */
export interface OctaweaveStatus {
  key_present: boolean
  pack_installed: boolean
  pack_enabled: boolean
  pack_version?: string | null
  api_tools: number
}

/** One Octaweave workspace this account administers, as the picker lists them. */
export interface OctaweaveWorkspace {
  id: string
  org_slug: string
  slug: string
  name: string
  /** Always `admin` in a picker — the core filters out what it could not mint in. */
  role: string
}

/** A finished connection. Carries no key — that never leaves the core. */
export interface OctaweaveConnection {
  workspace_id: string
  /** The workspace's own name, which is what the user recognises. */
  label: string
  url: string
  scopes: string[]
  status: OctaweaveStatus
  /** The key stored but the pack did not install — a real halfway state. */
  pack_error?: string | null
  /** Keys this app had minted here before, now revoked. */
  replaced: number
}

/**
 * One step of connecting: done, or the single thing still missing.
 *
 * Both unfinished cases resolve by calling connect again — which is what lets
 * the app poll while the user is away in the browser instead of holding a
 * request open.
 */
export type OctaweaveConnectOutcome =
  | { kind: 'needs_link'; url: string }
  | { kind: 'choose_workspace'; workspaces: OctaweaveWorkspace[] }
  | { kind: 'connected'; connection: OctaweaveConnection }

// ── Automations ────────────────────────────────────────────────────────────
//
// The pod says *flow*; this app says **Automation**. These types name the wire,
// so they keep the pod's word — see `metalcraft-agent/docs/FLOWS_AS_AGENTS_PLAN.md`
// §2.1. Everything a user reads says Automation.

/** One flow, already joined against its binding by `GET /flows`. */
export interface Flow {
  id: string
  name: string
  /** The flow-wide switch. Disabled is the *normal* case — packs ship flows off. */
  enabled: boolean
  node_count: number
  created_at: string
  updated_at: string
  /** v2 flows run on the state-machine executor; v1 is the legacy prompt list. */
  v2: boolean
  /** The agent preset it runs as; unbound resolves to the pod's default agent. */
  preset: string
  /** Any schedule armed — i.e. this automation has an agent. */
  armed: boolean
  schedules: FlowSchedule[]
}

export interface FlowSchedule {
  id: string
  enabled: boolean
  /** Trigger tag: `manual` | `minutes` | `hours` | `cron`. */
  type: string
  name?: string | null
  cron?: string | null
  interval?: number | null
  timezone?: string | null
  persona?: string | null
  /** The agent this schedule was armed with; absent means it never fires. */
  instance_id?: string | null
  /** Absent if the agent was deleted out from under the binding. */
  instance_name?: string | null
  /** The pod's own rendering of the trigger — including `Invalid cron …`. Show
   *  it verbatim: a schedule that will never fire should look broken. */
  description: string
  next_fire_at?: string | null
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
  armed: { schedule_id: string; instance_id: string; instance_name?: string | null }[]
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
