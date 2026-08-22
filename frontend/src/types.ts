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
