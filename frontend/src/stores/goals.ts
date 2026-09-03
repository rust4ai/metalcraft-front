import { create } from 'zustand'
import { goals as api } from '@/rpc'
import type { Goal, GoalDetail, GoalJournalEntry, GoalUpdate, NewGoal } from '@/types'

/**
 * Goals: what this pod is working towards while nobody is watching.
 *
 * The list and the open goal are separate pieces of state because they answer
 * different questions and reload on different beats — the list is a standing
 * overview that refreshes on a timer, the detail is one goal somebody is reading
 * right now, and re-fetching every scratchpad to redraw a list of cards would be
 * the whole pod's memory over the wire every thirty seconds.
 */
interface GoalsState {
  goals: Goal[]
  /** How many are ticking, against the pod's ceiling — what the "new goal"
   *  button needs to know before it is pressed rather than after it fails. */
  active: number
  maxActive: number
  loading: boolean
  error: string | null
  /** In-flight marker, keyed by goal id. */
  busy: Record<string, boolean>

  /** The goal on screen, with its scratchpad, and its journal. */
  open: GoalDetail | null
  journal: GoalJournalEntry[]
  openLoading: boolean

  load: () => Promise<void>
  create: (goal: NewGoal) => Promise<Goal | null>
  /** Load one goal and its journal together: the detail screen is unreadable
   *  with one and not the other. */
  select: (goalId: string) => Promise<void>
  close: () => void
  update: (goalId: string, update: GoalUpdate) => Promise<void>
  remove: (goalId: string) => Promise<void>
  writeScratchpad: (goalId: string, markdown: string) => Promise<void>
}

/** Goals that need somebody, first; then the ones still working; then the rest.
 *
 *  A blocked goal is the only state here that is *waiting on a person* — its
 *  heartbeat has stopped, so nothing else will ever raise it again — and it must
 *  not sort below three finished ones. */
const rank = (g: Goal) =>
  g.status === 'blocked' ? 0 : g.status === 'active' ? 1 : g.status === 'paused' ? 2 : 3

export function attentionFirst(list: Goal[]): Goal[] {
  // `sort`, not `toSorted`: the build targets safari15 for older macOS webviews.
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...list].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(b.created_at) - Date.parse(a.created_at),
  )
}

/** A pod older than goals has no `/goals`, and its 404 would otherwise read as a
 *  transport failure — leaving someone to conclude the pod is broken when it is
 *  merely older than this app. */
function describeLoadFailure(e: unknown): string {
  const text = String(e)
  return /404|not found/i.test(text)
    ? 'This pod is older than this app: it does not have goals yet. Update the pod to set one here.'
    : text
}

export const useGoals = create<GoalsState>((set, get) => ({
  goals: [],
  active: 0,
  maxActive: 0,
  loading: false,
  error: null,
  busy: {},
  open: null,
  journal: [],
  openLoading: false,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const list = await api.list()
      set({
        goals: attentionFirst(list.goals),
        active: list.active,
        maxActive: list.max_active,
        loading: false,
      })
    } catch (e) {
      set({ loading: false, error: describeLoadFailure(e) })
    }
  },

  create: async (goal) => {
    set({ error: null })
    try {
      const created = await api.create(goal)
      // Reload rather than push: creating a goal also mints its agent and counts
      // against the ceiling, and re-reading is one call that cannot disagree
      // with the pod.
      await get().load()
      return created
    } catch (e) {
      set({ error: String(e) })
      return null
    }
  },

  select: async (goalId) => {
    set({ openLoading: true, error: null })
    try {
      const [open, journal] = await Promise.all([api.get(goalId), api.journal(goalId)])
      set({ open, journal: journal.entries, openLoading: false })
    } catch (e) {
      set({ openLoading: false, error: String(e) })
    }
  },

  close: () => set({ open: null, journal: [] }),

  update: async (goalId, update) => {
    set({ busy: { ...get().busy, [goalId]: true }, error: null })
    try {
      await api.update(goalId, update)
      // Both, because an answer changes the scratchpad as well as the row: the
      // pod appends it to State, which is where the next tick will look for it.
      await Promise.all([get().load(), get().open?.id === goalId ? get().select(goalId) : null])
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ busy: { ...get().busy, [goalId]: false } })
    }
  },

  remove: async (goalId) => {
    set({ busy: { ...get().busy, [goalId]: true }, error: null })
    try {
      await api.remove(goalId)
      if (get().open?.id === goalId) get().close()
      await get().load()
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ busy: { ...get().busy, [goalId]: false } })
    }
  },

  writeScratchpad: async (goalId, markdown) => {
    set({ busy: { ...get().busy, [goalId]: true }, error: null })
    try {
      const open = await api.writeScratchpad(goalId, markdown)
      set({ open })
      await get().load()
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ busy: { ...get().busy, [goalId]: false } })
    }
  },
}))
