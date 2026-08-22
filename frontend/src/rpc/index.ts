/**
 * Typed wrappers over the core's commands. One function per command, named for
 * the surface it drives — the renderer never types a method string itself.
 */
import { call, listen } from './transport'
import type { ActivePod, AgentInfo, InstalledPack, KeyEntry, Registries, RegistryConnection, SearchHit, AgentInstance, AgentPreset, ChatDetail, ChatEvent, ChatSummary, DeviceLogin, LoginResult, Pod, Session, Usage } from '@/types'

export const auth = {
  start: () => call<DeviceLogin>('login_start'),
  poll: (deviceCode: string) => call<LoginResult>('login_poll', { deviceCode }),
  session: () => call<Session | null>('session'),
  logout: () => call<void>('logout'),
}

export const pods = {
  list: () => call<Pod[]>('list_pods'),
  connect: (podId: string) => call<AgentInfo>('connect_pod', { podId }),
  info: () => call<AgentInfo>('agent_info'),
  active: () => call<ActivePod | null>('active_pod'),
}

export const account = {
  /** `null` when this hub does not report usage — not an error, and not zero. */
  usage: () => call<Usage | null>('account_usage'),
}

export const fleet = {
  instances: () => call<AgentInstance[]>('list_instances'),
  presets: () => call<AgentPreset[]>('list_presets'),
  create: (preset: string, name?: string) => call<AgentInstance>('create_instance', { preset, name }),
  remove: (id: string) => call<void>('delete_instance', { id }),
}

export const keys = {
  list: () => call<KeyEntry[]>('list_keys'),
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
  manifest: (name: string, id: string) => call<unknown>('registry_manifest', { name, id }),
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
  /** Live frames for one chat. The channel name is the core's contract. */
  onEvent: (chatId: string, cb: (ev: ChatEvent) => void) => listen<ChatEvent>(`session://${chatId}`, cb),
}
