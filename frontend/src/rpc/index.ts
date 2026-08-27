/**
 * Typed wrappers over the core's commands. One function per command, named for
 * the surface it drives — the renderer never types a method string itself.
 */
import { call, listen } from './transport'
import type { ResetReport, ResetScope, GatewayRegistration, GatewayStatus, Plan, Diagnostic, ChatContext, ChatCompacted, InferenceStatus, ActivePod, AgentInfo, InstalledPack, KeyEntry, Registries, RegistryConnection, SearchHit, AgentInstance, AgentPreset, ChatDetail, ChatEvent, ChatSummary, DeviceLogin, LoginResult, Pod, Session, Credits, InstanceMemory, ConnectionInfo, ConnectionStatus, ConnectOutcome, OctaweaveWorkspace, ServiceId, PackManifest, PackUpdateReport, RosterPersona, Flow, FlowRun, FlowBinding, FlowRunSummary, PodSnapshot, PresetDetail, PersonaDetail, SkillDetail, Integration, IntegrationDetail, FlowTemplateSummary, ScheduledTask, PodSession, PodSessionDetail } from '@/types'

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
  /** Ask the control plane for a pod. Idempotent — safe to press twice. */
  provision: () => call<Pod>('provision_pod'),
}

/** The upgrade path. Checkout is a hosted Stripe page, so the app's whole part
 *  in it is opening a browser and watching for the result. */
export const billing = {
  /** `null` = the hub cannot say (too old, or billing unconfigured). Show
   *  "Upgrade" with no figure rather than one you cannot stand behind. */
  plan: () => call<Plan | null>('billing_plan'),
  /** Opens the browser and returns the URL, so a failed hand-off degrades to a
   *  link instead of a dead button. */
  checkout: () => call<string>('open_checkout'),
}

/**
 * One service connection, whichever service it is.
 *
 * The two differ in exactly one place — Octaweave can ask which workspace, and
 * that choice comes back as an argument to the next `connect` — so the interface
 * carries an optional `choice` and buildr.space ignores it. Everything above
 * this line (the store, the card) is written once against this shape.
 */
export interface ServiceRpc {
  status: () => Promise<ConnectionStatus>
  /**
   * One step of connecting, in the core: prove the Metalcraft PAT, mint a key
   * scoped to this service, store it on the pod, install the pack. Returns what
   * is still missing rather than blocking on it, so it is safe to call
   * repeatedly — and it never opens a browser, which is what makes polling it
   * harmless.
   */
  connect: (choice?: string) => Promise<ConnectOutcome>
  /** Opens the browser at the service's link page. Returns the URL, so the UI
   *  can show it as a link when the hand-off fails silently. */
  link: () => Promise<string>
  installPack: () => Promise<ConnectionStatus>
  /** Drops the key from the pod, and revokes it at the service. `id` is what the
   *  connection was pinned to — without it Octaweave has nowhere to revoke, and
   *  "disconnect" would leave a live credential behind. */
  disconnect: (id?: string) => Promise<ConnectionStatus>
}

export const octaweave: ServiceRpc = {
  status: () => call<ConnectionStatus>('octaweave_status'),
  // The core calls it a workspace, because that is what it is over there — a
  // key is pinned to one. Renaming it at the boundary is what lets one card
  // drive both services without either core module pretending to be the other.
  connect: async (choice?: string) => {
    const outcome = await call<OctaweaveConnectOutcome>('octaweave_connect', {
      workspace: choice ?? null,
    })
    return outcome.kind === 'connected'
      ? { kind: 'connected', connection: { ...outcome.connection, id: outcome.connection.workspace_id } }
      : outcome
  },
  link: () => call<string>('octaweave_link'),
  installPack: () => call<ConnectionStatus>('octaweave_install_pack'),
  disconnect: (id?: string) =>
    call<ConnectionStatus>('octaweave_disconnect', { workspace: id ?? null }),
}

/**
 * The core's Octaweave shape, before the rename above. Private on purpose: one
 * function knows about `workspace_id`, and it is the one that removes it.
 */
type OctaweaveConnectOutcome =
  | { kind: 'needs_link'; url: string }
  | { kind: 'choose_workspace'; workspaces: OctaweaveWorkspace[] }
  | { kind: 'connected'; connection: ConnectionInfo & { workspace_id: string } }

/**
 * buildr.space. Identical but for the missing choice: a `bsk_` belongs to the
 * account, so there is nothing to pick and the core takes no argument.
 */
export const buildr: ServiceRpc = {
  status: () => call<ConnectionStatus>('buildr_status'),
  connect: () => call<ConnectOutcome>('buildr_connect'),
  link: () => call<string>('buildr_link'),
  installPack: () => call<ConnectionStatus>('buildr_install_pack'),
  disconnect: () => call<ConnectionStatus>('buildr_disconnect'),
}

/** Every connectable service, by the name the store and the cards use. */
export const services: Record<ServiceId, ServiceRpc> = { octaweave, buildr }

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
  /** The name only. Whether an agent is kept is `persistent`, and this never touches it. */
  rename: (id: string, name: string) => call<AgentInstance>('rename_instance', { id, name }),
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

/**
 * WhatsApp and SMS, through the pod (PLAN §10.6).
 *
 * Every call goes to the pod, never to gateway.metalcraftai.com — the pod is
 * what receives a message, and a card that read the gateway directly could show
 * a connection this pod does not have.
 */
export const gateway = {
  /** `null` = a pod older than the endpoint. Not "not connected". */
  status: () => call<GatewayStatus | null>('gateway_status'),
  /** Returns the code to text back. Re-registering replaces the number. */
  register: (phoneNumber: string) =>
    call<GatewayRegistration>('gateway_register', { phoneNumber }),
  /** Wire the channel. Idempotent, so it is also the fix for a stale webhook. */
  connect: () => call<void>('gateway_connect'),
  /** Stop receiving. The number stays registered, so reconnecting needs no
   *  second verification. */
  disconnect: () => call<void>('gateway_disconnect'),
  /** Give the number back: unregister at the gateway *and* disconnect here.
   *  `false` = the pod is too old to have the endpoint. */
  unregister: () => call<boolean>('gateway_unregister'),
}

/**
 * The destructive one, kept apart from everything else so it is never an
 * autocomplete away from a call someone meant to make.
 */
export const danger = {
  /** Erase the pod and restart it as a newly-provisioned one. `null` = the pod
   *  predates the endpoint (agent < 0.35.0); there is no client-side fallback.
   *
   *  Expect the pod to stop answering a beat after this resolves. That is the
   *  restart, and it is success. */
  factoryReset: (scope: ResetScope) => call<ResetReport | null>('factory_reset', { scope }),
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

/**
 * The library — everything installed on this pod, and what each artifact is
 * made of.
 *
 * Read-only, all of it. `snapshot` carries the whole index because personas and
 * skills have no list route on the pod: it is not a batching optimisation, it is
 * the only way to learn those artifacts exist. Every other call here answers a
 * click on something the snapshot already listed.
 */
export const library = {
  /** `null` = a pod older than `/snapshot`. Not "nothing installed". */
  snapshot: () => call<PodSnapshot | null>('pod_snapshot'),
  /** Both halves: what the preset declares, and what this pod resolved. */
  preset: (slug: string) => call<PresetDetail>('preset_detail', { slug }),
  persona: (slug: string) => call<PersonaDetail>('persona_detail', { slug }),
  skill: (slug: string) => call<SkillDetail>('skill_detail', { slug }),
  /** The tool's config verbatim — a request template the pod owns and this app
   *  only displays, so it stays untyped rather than becoming a second copy of a
   *  schema that changes whenever a tool author needs a new body shape. */
  apiTool: (name: string) => call<Record<string, unknown>>('api_tool_detail', { name }),
  integrations: () => call<Integration[]>('list_integrations'),
  integration: (id: string) => call<IntegrationDetail>('integration_detail', { id }),
  /** An installed pack's own manifest, as the pod filed it. */
  pack: (id: string) => call<Record<string, unknown>>('agent_pack_detail', { id }),
  /** What packs shipped, before anyone installed one as a flow — distinct from
   *  `automations.list`, which is what this pod actually runs. */
  flowTemplates: () => call<FlowTemplateSummary[]>('list_flow_templates'),
  /** One template with its graph. Untyped: the graph belongs to the pod's flow
   *  engine, which publishes it untyped for the same reason. */
  flowTemplate: (slug: string) => call<Record<string, unknown>>('flow_template_detail', { slug }),
}

/**
 * The pod's own record of what the agent did — what the debug view reads.
 *
 * Deliberately not folded into `diagnostics` above: that one is the *core's*
 * error log and never touches a pod. These are the pod's, and every one of them
 * answers `null` on a pod too old to be asked rather than an empty list, because
 * "nothing recorded" and "could not ask" must not draw the same panel.
 */
export const podLogs = {
  sessions: () => call<PodSession[] | null>('pod_diagnostics'),
  session: (id: string) => call<PodSessionDetail | null>('pod_diagnostics_session', { id }),
  /** The OTLP trace: a span per turn, per model call and per tool, with real
   *  durations and token counts. `null` for a run recorded before tracing. */
  trace: (id: string) => call<unknown>('pod_diagnostics_trace', { id }),
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
  /** Update an installed pack. Not `install` against the same reference: the pod
   *  reconciles live agents against the new version here and nowhere else, and
   *  the report is the only account of what it changed. */
  update: (id: string, reference: string, allowUnverified = false) =>
    call<PackUpdateReport>('update_pack', { id, reference, allowUnverified }),
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
  /** Ask the running turn to stop. Resolves when the pod took the request, not
   *  when the agent stopped — the `done` frame on `session://{chatId}` is what
   *  says that, and it is what unlocks the composer.
   *
   *  `null` = the pod has no interrupt endpoint and its turns cannot be stopped.
   *  `false` = nothing was running, which is a race and not a failure. */
  interrupt: (chatId: string) => call<boolean | null>('interrupt_turn', { chatId }),
  /** What this chat will do on its own later — the agent's armed follow-ups.
   *  `null` means the pod is too old to be asked, which is not the same as
   *  "nothing scheduled" and must not be rendered as it. */
  followups: (chatId: string) => call<ScheduledTask[] | null>('scheduled_followups', { chatId }),
  /** Call off a pending follow-up. The pod refuses one that already fired. */
  cancelFollowup: (id: string) => call<void>('cancel_followup', { id }),
  /** Live frames for one chat. The channel name is the core's contract. */
  onEvent: (chatId: string, cb: (ev: ChatEvent) => void) => listen<ChatEvent>(`session://${chatId}`, cb),
}
