/**
 * Typed wrappers over the core's commands. One function per command, named for
 * the surface it drives — the renderer never types a method string itself.
 */
import { call, listen } from './transport'
import type { Diagnostic, ChatContext, ChatCompacted, InferenceStatus, ActivePod, AgentInfo, InstalledPack, KeyEntry, Registries, RegistryConnection, SearchHit, AgentInstance, AgentPreset, ChatDetail, ChatEvent, ChatSummary, DeviceLogin, LoginResult, Pod, Session, Credits, InstanceMemory, OctaweaveConnectOutcome, OctaweaveStatus, PackManifest, RosterPersona, Flow, FlowRun, FlowBinding, FlowRunSummary } from '@/types'

export const auth = {
  start: () => call<DeviceLogin>('login_start'),
  poll: (deviceCode: string) => call<LoginResult>('login_poll', { deviceCode }),
  session: () => call<Session | null>('session'),
  /** Re-read the account from Metalcraft ID. `premium` decides whether a pod's
   *  turns can bill the gateway, so a sign-in-time snapshot is not good enough. */
  refresh: () => call<Session | null>('refresh_session'),
  logout: () => call<void>('logout'),
}

export const pods = {
  list: () => call<Pod[]>('list_pods'),
  connect: (podId: string) => call<AgentInfo>('connect_pod', { podId }),
  /** Connect to a pod you run yourself: its URL and its `WORKSHOP_API_KEY`. No
   *  hub, no account, no minted token. */
  connectUrl: (url: string, key: string) => call<AgentInfo>('connect_pod_url', { url, key }),
  info: () => call<AgentInfo>('agent_info'),
  active: () => call<ActivePod | null>('active_pod'),
}

export const octaweave = {
  status: () => call<OctaweaveStatus>('octaweave_status'),
  /**
   * One step of connecting, in the core: list workspaces with the Metalcraft
   * PAT, mint an `owk_` key, store it, install the pack. Returns what is still
   * missing rather than blocking on it, so it is safe to call repeatedly — and
   * it never opens a browser, which is what makes polling it harmless.
   */
  connect: (workspace?: string) =>
    call<OctaweaveConnectOutcome>('octaweave_connect', { workspace: workspace ?? null }),
  /** Opens the browser at Octaweave's link page. Returns the URL, so the UI can
   *  show it as a link when the hand-off fails silently. */
  link: () => call<string>('octaweave_link'),
  installPack: () => call<OctaweaveStatus>('octaweave_install_pack'),
  /** Drops the key from the pod, and revokes it at Octaweave when the workspace
   *  is still known — otherwise "disconnect" leaves a live credential behind. */
  disconnect: (workspace?: string) =>
    call<OctaweaveStatus>('octaweave_disconnect', { workspace: workspace ?? null }),
}

/**
 * The core's half of the error log — what commands over there swallowed instead
 * of returning. Deliberately the one surface that never touches a pod: a log you
 * can only read while the connection is healthy is a log you cannot read when
 * you need it.
 */
export const diagnostics = {
  list: () => call<Diagnostic[]>('list_diagnostics'),
  clear: () => call<void>('clear_diagnostics'),
}

export const account = {
  /** `null` when this deployment does not report credits — not an error, and not zero. */
  credits: () => call<Credits | null>('account_credits'),
}

export const fleet = {
  instances: () => call<AgentInstance[]>('list_instances'),
  presets: () => call<AgentPreset[]>('list_presets'),
  create: (preset: string, name?: string) => call<AgentInstance>('create_instance', { preset, name }),
  remove: (id: string) => call<void>('delete_instance', { id }),
  setPersona: (id: string, persona: string) =>
    call<AgentInstance>('set_instance_persona', { id, persona }),
  personas: (preset: string) => call<RosterPersona[]>('list_preset_personas', { preset }),
  memory: (id: string) => call<InstanceMemory>('instance_memory', { id }),
}

/**
 * Automations. The commands are named for the pod's vocabulary (`list_flows`);
 * this object is named for the surface it drives.
 */
export const automations = {
  list: () => call<Flow[]>('list_flows'),
  /** Persisted runs — mostly the paused ones, which are the ones that need a human. */
  runs: () => call<FlowRun[]>('list_flow_runs'),
  /** What arming would permit: personas, domains, keys, which tools mutate. */
  binding: (flowId: string) => call<FlowBinding>('flow_binding', { flowId }),
  /** Run now. The pod resolves the armed agent, so this is the same act as a
   *  scheduled firing. Resolves when the flow finishes, not when it starts. */
  run: (flowId: string, instanceId?: string) =>
    call<FlowRunSummary>('run_flow', { flowId, instanceId }),
  /** Take the decision a paused run is waiting on. It picks up in the
   *  conversation it paused in. */
  resume: (runId: string, handle: string) =>
    call<FlowRunSummary>('resume_flow_run', { runId, handle }),
  /** Arming is what creates the agent. Pass `instanceId` to attach to one instead. */
  arm: (flowId: string, scheduleId: string, instanceId?: string) =>
    call<AgentInstance>('arm_schedule', { flowId, scheduleId, instanceId }),
  /** Stops the timer. Keeps the agent and everything it remembers. */
  disarm: (flowId: string, scheduleId: string) =>
    call<void>('disarm_schedule', { flowId, scheduleId }),
}

export const keys = {
  list: () => call<KeyEntry[]>('list_keys'),
  /** Whether the pod can run a turn. `null` = too old to say; fall back to what
   *  the account knows rather than guessing from an empty key store. */
  inference: () => call<InferenceStatus | null>('inference_status'),
  save: (name: string, value: string) => call<void>('save_key', { name, value }),
  remove: (name: string) => call<void>('delete_key', { name }),
  /** Write the pair atomically so the pod is never left on one provider's URL
   *  with another's key. */
  bindInterfaceSource: (apiKey: string, baseUrl: string | null) =>
    call<void>('bind_interface_source', { apiKey, baseUrl }),
}

export const packs = {
  registries: () => call<Registries>('list_registries'),
  status: (name: string) => call<RegistryConnection>('registry_status', { name }),
  connect: (name: string) => call<RegistryConnection>('registry_connect', { name }),
  disconnect: (name: string) => call<RegistryConnection>('registry_disconnect', { name }),
  search: (name: string, query?: string) => call<SearchHit[]>('registry_search', { name, query }),
  manifest: (name: string, id: string) => call<PackManifest>('registry_manifest', { name, id }),
  installed: () => call<InstalledPack[]>('list_installed_packs'),
  install: (reference: string, allowUnverified = false) =>
    call<unknown>('install_pack', { reference, allowUnverified }),
}

export const chats = {
  list: () => call<ChatSummary[]>('list_chats'),
  create: (args: { instanceId?: string; agentPreset?: string; name?: string }) =>
    call<ChatDetail>('create_chat', args),
  get: (id: string) => call<ChatDetail>('get_chat', { id }),
  send: (chatId: string, message: string) => call<void>('send_turn', { chatId, message }),
  watch: (chatId: string) => call<void>('watch_chat', { chatId }),
  /** What this conversation's context costs right now. */
  context: (chatId: string) => call<ChatContext>('chat_context', { chatId }),
  /** Compact now, whatever the size — the pod's automatic rule only fires at 60%
   *  of the window, long after someone can feel a conversation getting heavy. */
  compact: (chatId: string) => call<ChatCompacted>('compact_chat', { chatId }),
  /** Drop the conversation, keep the chat. Distinct from deleting it. */
  clear: (chatId: string) => call<ChatContext>('clear_chat', { chatId }),
  /** Live frames for one chat. The channel name is the core's contract. */
  onEvent: (chatId: string, cb: (ev: ChatEvent) => void) => listen<ChatEvent>(`session://${chatId}`, cb),
}
