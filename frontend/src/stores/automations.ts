import { create } from 'zustand'
import { automations } from '@/rpc'
import type { AgentInstance, Flow, FlowRun } from '@/types'

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

  load: () => Promise<void>
  /** Returns the new agent, or null with `error` set — the pod's refusal names
   *  the persona and the roster it is missing from, so it is worth showing. */
  arm: (flowId: string, scheduleId: string, instanceId?: string) => Promise<AgentInstance | null>
  disarm: (flowId: string, scheduleId: string) => Promise<void>
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

  load: async () => {
    set({ loading: true, error: null })
    try {
      const [flows, runs] = await Promise.all([automations.list(), automations.runs()])
      set({ flows, runs, loading: false })
    } catch (e) {
      set({ loading: false, error: String(e) })
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
