import { create } from 'zustand'
import { automations } from '@/rpc'
import type { AgentInstance, Flow, FlowBinding, FlowRun, FlowRunSummary } from '@/types'

/**
 * Automations: the pod's flows, and the runs they leave behind.
 *
 * Flows and runs load together because the surface answers one question —
 * *what is this pod set up to do, and is any of it stuck?* — and a runs list
 * that arrives a beat after the flows would make the paused ones, the only
 * urgent thing here, the last to appear.
 */
interface AutomationsState {
  flows: Flow[]
  runs: FlowRun[]
  loading: boolean
  error: string | null
  /** Per-schedule in-flight marker, keyed `flowId:scheduleId`. */
  busy: Record<string, boolean>
  /** What arming each flow would permit, cached per flow. Fetched when the arm
   *  dialog opens — it is the pod's answer, never assembled here. */
  bindings: Record<string, FlowBinding>

  load: () => Promise<void>
  loadBinding: (flowId: string) => Promise<void>
  /** Returns the new agent, or null with `error` set — the pod's refusal names
   *  the persona and the roster it is missing from, so it is worth showing. */
  arm: (flowId: string, scheduleId: string, instanceId?: string) => Promise<AgentInstance | null>
  disarm: (flowId: string, scheduleId: string) => Promise<void>
  /** Run now, and return what it did. Null with `error` set on refusal. */
  run: (flowId: string) => Promise<FlowRunSummary | null>
  /** Answer a paused run. `handle` is one of its `resume_handles`. */
  resume: (runId: string, handle: string) => Promise<FlowRunSummary | null>
}

/** Paused outranks failed outranks everything else: the first needs a person,
 *  the second wants one, the rest are history. */
const rank = (r: FlowRun) => (r.status === 'paused' ? 0 : r.status === 'failed' ? 1 : 2)

/** Runs that are waiting on a human, first. */
export function pausedFirst(runs: FlowRun[]): FlowRun[] {
  // `sort` rather than `toSorted`: the build targets safari15 for older macOS
  // webviews. Copy first so the store's array is never sorted in place.
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...runs].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(b.updated_at) - Date.parse(a.updated_at),
  )
}

export const useAutomations = create<AutomationsState>((set, get) => ({
  flows: [],
  runs: [],
  loading: false,
  error: null,
  busy: {},
  bindings: {},

  load: async () => {
    set({ loading: true, error: null })
    try {
      const [flows, runs] = await Promise.all([automations.list(), automations.runs()])
      set({ flows, runs, loading: false })
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  loadBinding: async (flowId) => {
    try {
      const binding = await automations.binding(flowId)
      set({ bindings: { ...get().bindings, [flowId]: binding } })
    } catch (e) {
      // Refetched every time the dialog opens rather than cached through an
      // error: a consent summary that failed to load must not leave a stale one
      // on screen next time.
      set({ error: String(e) })
    }
  },

  arm: async (flowId, scheduleId, instanceId) => {
    const key = `${flowId}:${scheduleId}`
    set({ busy: { ...get().busy, [key]: true }, error: null })
    try {
      const agent = await automations.arm(flowId, scheduleId, instanceId)
      // Reload rather than patch: arming can mint an agent *or* attach to an
      // existing one, and it also flips the flow's `armed`. Re-reading is one
      // call and cannot disagree with the pod.
      await get().load()
      return agent
    } catch (e) {
      set({ error: String(e) })
      return null
    } finally {
      const busy = { ...get().busy }
      delete busy[key]
      set({ busy })
    }
  },

  run: async (flowId) => {
    // Keyed by flow rather than schedule: running is an act on the whole graph,
    // and the row it disables is the flow's own Run button.
    set({ busy: { ...get().busy, [flowId]: true }, error: null })
    try {
      const summary = await automations.run(flowId)
      // A run leaves a conversation and may leave a paused record; both are
      // things this view shows, so re-read rather than infer.
      await get().load()
      return summary
    } catch (e) {
      set({ error: String(e) })
      return null
    } finally {
      const busy = { ...get().busy }
      delete busy[flowId]
      set({ busy })
    }
  },

  resume: async (runId, handle) => {
    set({ busy: { ...get().busy, [runId]: true }, error: null })
    try {
      const summary = await automations.resume(runId, handle)
      // The answer may finish the run, fail it, or land on the *next* approval;
      // only the pod knows which, so re-read rather than assume it is done.
      await get().load()
      return summary
    } catch (e) {
      set({ error: String(e) })
      return null
    } finally {
      const busy = { ...get().busy }
      delete busy[runId]
      set({ busy })
    }
  },

  disarm: async (flowId, scheduleId) => {
    const key = `${flowId}:${scheduleId}`
    set({ busy: { ...get().busy, [key]: true }, error: null })
    try {
      await automations.disarm(flowId, scheduleId)
      await get().load()
    } catch (e) {
      set({ error: String(e) })
    } finally {
      const busy = { ...get().busy }
      delete busy[key]
      set({ busy })
    }
  },
}))
