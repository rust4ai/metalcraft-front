/**
 * Typed wrappers over the core's commands. One function per command, named for
 * the surface it drives — the renderer never types a method string itself.
 */
import { call, listen } from './transport'
import type { ChatContext, ChatCompacted, InferenceStatus, ActivePod, AgentInfo, InstalledPack, KeyEntry, Registries, RegistryConnection, SearchHit, AgentInstance, AgentPreset, ChatDetail, ChatEvent, ChatSummary, DeviceLogin, LoginResult, Pod, Session, Credits, InstanceMemory, OctaweaveConnection, OctaweaveStatus, PackManifest, RosterPersona, Flow, FlowRun, FlowBinding, FlowRunSummary } from '@/types'

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
  info: () => call<AgentInfo>('agent_info'),
  active: () => call<ActivePod | null>('active_pod'),
}

export const octaweave = {
  status: () => call<OctaweaveStatus>('octaweave_status'),
  /** Verify → store → install → confirm, in the core. The key is passed in and
   *  never comes back. */
  connect: (token: string) => call<OctaweaveConnection>('octaweave_connect', { token }),
  installPack: () => call<OctaweaveStatus>('octaweave_install_pack'),
  disconnect: () => call<OctaweaveStatus>('octaweave_disconnect'),
  /** Opens the browser; returns the URL so the UI can show it as copyable text
   *  when the hand-off fails silently. */
  openKeys: () => call<string>('octaweave_open_keys'),
  /** The core forwards a key returned by the browser callback. */
  onToken: (cb: (token: string) => void) => listen<string>('octaweave://token', cb),
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
