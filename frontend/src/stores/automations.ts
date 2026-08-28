import { create } from 'zustand'
import { automations } from '@/rpc'
import { useFleet } from './fleet'
import type {
  Flow,
  FlowBinding,
  FlowRun,
  FlowRunSummary,
  ScheduleSpec,
  ScheduledFlow,
} from '@/types'

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
  /** What the pod will do on its own. Separate from `flows` because the pod
   *  keeps them separate: a flow is the work, a scheduled flow is the plan. */
  scheduled: ScheduledFlow[]
  runs: FlowRun[]
  loading: boolean
  error: string | null
  /** In-flight marker, keyed by flow id (running) or scheduled-flow id (arming). */
  busy: Record<string, boolean>
  /** What arming each flow would permit, cached per flow. Fetched when the arm
   *  dialog opens — it is the pod's answer, never assembled here. */
  bindings: Record<string, FlowBinding>

  load: () => Promise<void>
  loadBinding: (flowId: string) => Promise<void>
  /** The schedules of one flow, from the loaded list. */
  schedulesOf: (flowId: string) => ScheduledFlow[]
  /** Returns the new schedule (agent included), or null with `error` set — the
   *  pod's refusal names the persona and the roster it is missing from, so it is
   *  worth showing. */
  arm: (
    flowId: string,
    schedule: ScheduleSpec,
    instanceId?: string,
  ) => Promise<ScheduledFlow | null>
  /** Delete a schedule. The agent and the flow both stay. */
  disarm: (scheduledId: string) => Promise<void>
  /** Pause or resume a schedule without deleting it. */
  setEnabled: (scheduledId: string, enabled: boolean) => Promise<void>
  /** Run now, and return what it did. Null with `error` set on refusal.
   *  `inputs` seed the flow's declared entry parameters. */
  run: (flowId: string, inputs?: Record<string, unknown>) => Promise<FlowRunSummary | null>
  /** Answer a paused run. `handle` is one of its `resume_handles`. */
  resume: (runId: string, handle: string) => Promise<FlowRunSummary | null>
}

/** A pod that predates the flow/schedule split has no `/scheduled-flows`, and its
 *  404 would otherwise read as a transport failure — leaving someone to conclude
 *  the pod is broken when it is merely older than this app.
 *
 *  Deliberately not a fallback to the old endpoints: they are gone, and quietly
 *  half-working against an old pod would hide the one action that fixes it. */
function describeLoadFailure(e: unknown): string {
  const text = String(e)
  return /404|not found/i.test(text)
    ? 'This pod is older than this app: it does not have scheduled flows yet. Update the pod to manage automations here.'
    : text
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
  scheduled: [],
  runs: [],
  loading: false,
  error: null,
  busy: {},
  bindings: {},

  load: async () => {
    set({ loading: true, error: null })
    try {
      const [flows, scheduled, runs] = await Promise.all([
        automations.list(),
        automations.scheduled(),
        automations.runs(),
      ])
      set({ flows, scheduled, runs, loading: false })
    } catch (e) {
      set({ loading: false, error: describeLoadFailure(e) })
    }
  },

  schedulesOf: (flowId) => get().scheduled.filter((s) => s.flow_id === flowId),

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

  arm: async (flowId, schedule, instanceId) => {
    const key = `arm:${flowId}`
    set({ busy: { ...get().busy, [key]: true }, error: null })
    try {
      const armed = await automations.arm(flowId, schedule, instanceId)
      // Reload rather than patch: arming can mint an agent *or* attach to an
      // existing one, and it also flips the flow's `armed`. Re-reading is one
      // call and cannot disagree with the pod.
      //
      // **And reload the fleet**, which is where that new agent lives. Arming
      // ends by opening the agent it created, and `SessionView` resolves it from
      // the fleet store — so without this the app navigates to an agent it has
      // never heard of and the rail reports it "no longer on the pod". Found by
      // clicking Arm against a real pod; no stubbed test caught it, because the
      // stub had no fleet to be stale.
      await Promise.all([get().load(), useFleet.getState().load()])
      return armed
    } catch (e) {
      set({ error: String(e) })
      return null
    } finally {
      const busy = { ...get().busy }
      delete busy[key]
      set({ busy })
    }
  },

  run: async (flowId, inputs) => {
    // Keyed by flow rather than schedule: running is an act on the whole graph,
    // and the row it disables is the flow's own Run button.
    set({ busy: { ...get().busy, [flowId]: true }, error: null })
    try {
      const summary = await automations.run(flowId, inputs)
      // A run leaves a conversation and may leave a paused record; both are
      // things this view shows, so re-read rather than infer.
      //
      // **And the fleet**, for the same reason arming does: a flow's first run
      // mints its agent, and the app is about to navigate into it. Without this
      // it lands on an agent the fleet store has never heard of — and the home
      // screen would not show the new one until something else reloaded it.
      await Promise.all([get().load(), useFleet.getState().load()])
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

  disarm: async (scheduledId) => {
    set({ busy: { ...get().busy, [scheduledId]: true }, error: null })
    try {
      await automations.disarm(scheduledId)
      await get().load()
    } catch (e) {
      set({ error: String(e) })
    } finally {
      const busy = { ...get().busy }
      delete busy[scheduledId]
      set({ busy })
    }
  },

  setEnabled: async (scheduledId, enabled) => {
    set({ busy: { ...get().busy, [scheduledId]: true }, error: null })
    try {
      await automations.setEnabled(scheduledId, enabled)
      await get().load()
    } catch (e) {
      set({ error: String(e) })
    } finally {
      const busy = { ...get().busy }
      delete busy[scheduledId]
      set({ busy })
    }
  },
}))
