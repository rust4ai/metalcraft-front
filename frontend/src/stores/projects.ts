import { create } from 'zustand'
import { projects as api } from '@/rpc'
import type { Project, ProjectDetail, ProjectJournalEntry, ProjectUpdate, NewProject } from '@/types'

/**
 * Goals: what this pod is working towards while nobody is watching.
 *
 * The list and the open project are separate pieces of state because they answer
 * different questions and reload on different beats — the list is a standing
 * overview that refreshes on a timer, the detail is one project somebody is reading
 * right now, and re-fetching every scratchpad to redraw a list of cards would be
 * the whole pod's memory over the wire every thirty seconds.
 */
interface GoalsState {
  projects: Project[]
  /** How many are ticking, against the pod's ceiling — what the "new project"
   *  button needs to know before it is pressed rather than after it fails. */
  active: number
  maxActive: number
  loading: boolean
  error: string | null
  /** In-flight marker, keyed by project id. */
  busy: Record<string, boolean>

  /** The project on screen, with its scratchpad, and its journal. */
  open: ProjectDetail | null
  journal: ProjectJournalEntry[]
  openLoading: boolean

  load: () => Promise<void>
  create: (project: NewProject) => Promise<Project | null>
  /** Load one project and its journal together: the detail screen is unreadable
   *  with one and not the other. */
  select: (projectId: string) => Promise<void>
  close: () => void
  update: (projectId: string, update: ProjectUpdate) => Promise<void>
  remove: (projectId: string) => Promise<void>
  writeScratchpad: (projectId: string, markdown: string) => Promise<void>
  /** Ask for a tick now. The list refreshes, so the next-wake time updates. */
  tick: (projectId: string) => Promise<void>
}

/** Goals that need somebody, first; then the ones still working; then the rest.
 *
 *  A blocked project is the only state here that is *waiting on a person* — its
 *  heartbeat has stopped, so nothing else will ever raise it again — and it must
 *  not sort below three finished ones. */
const rank = (g: Project) =>
  g.status === 'blocked' ? 0 : g.status === 'active' ? 1 : g.status === 'paused' ? 2 : 3

export function attentionFirst(list: Project[]): Project[] {
  // `sort`, not `toSorted`: the build targets safari15 for older macOS webviews.
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...list].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(b.created_at) - Date.parse(a.created_at),
  )
}

/** A pod older than projects has no `/projects`, and its 404 would otherwise read as a
 *  transport failure — leaving someone to conclude the pod is broken when it is
 *  merely older than this app. */
function describeLoadFailure(e: unknown): string {
  const text = String(e)
  return /404|not found/i.test(text)
    ? 'This pod is older than this app: it does not have projects yet. Update the pod to set one here.'
    : text
}

export const useProjects = create<GoalsState>((set, get) => ({
  projects: [],
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
        projects: attentionFirst(list.projects),
        active: list.active,
        maxActive: list.max_active,
        loading: false,
      })
    } catch (e) {
      set({ loading: false, error: describeLoadFailure(e) })
    }
  },

  create: async (project) => {
    set({ error: null })
    try {
      const created = await api.create(project)
      // Reload rather than push: creating a project also mints its agent and counts
      // against the ceiling, and re-reading is one call that cannot disagree
      // with the pod.
      await get().load()
      return created
    } catch (e) {
      set({ error: String(e) })
      return null
    }
  },

  select: async (projectId) => {
    set({ openLoading: true, error: null })
    try {
      const [open, journal] = await Promise.all([api.get(projectId), api.journal(projectId)])
      set({ open, journal: journal.entries, openLoading: false })
    } catch (e) {
      set({ openLoading: false, error: String(e) })
    }
  },

  close: () => set({ open: null, journal: [] }),

  update: async (projectId, update) => {
    set({ busy: { ...get().busy, [projectId]: true }, error: null })
    try {
      await api.update(projectId, update)
      // Both, because an answer changes the scratchpad as well as the row: the
      // pod appends it to State, which is where the next tick will look for it.
      await Promise.all([get().load(), get().open?.id === projectId ? get().select(projectId) : null])
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ busy: { ...get().busy, [projectId]: false } })
    }
  },

  remove: async (projectId) => {
    set({ busy: { ...get().busy, [projectId]: true }, error: null })
    try {
      await api.remove(projectId)
      if (get().open?.id === projectId) get().close()
      await get().load()
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ busy: { ...get().busy, [projectId]: false } })
    }
  },

  tick: async (projectId) => {
    set((s) => ({ busy: { ...s.busy, [projectId]: true } }))
    try {
      await api.tick(projectId)
      await get().load()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      set((s) => ({ busy: { ...s.busy, [projectId]: false } }))
    }
  },

  writeScratchpad: async (projectId, markdown) => {
    set({ busy: { ...get().busy, [projectId]: true }, error: null })
    try {
      const open = await api.writeScratchpad(projectId, markdown)
      set({ open })
      await get().load()
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ busy: { ...get().busy, [projectId]: false } })
    }
  },
}))
