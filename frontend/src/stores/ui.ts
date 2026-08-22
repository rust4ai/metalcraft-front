import { create } from 'zustand'
import { keys } from '@/rpc'

/**
 * Where the user is, plus the one onboarding fact the shell has to know: whether
 * this pod has an interface source bound. Kept in its own store so the fleet and
 * session stores never import each other.
 */
export type View =
  | { kind: 'fleet' }
  | { kind: 'session'; instanceId: string }
  | { kind: 'source' }
  | { kind: 'packs' }
  | { kind: 'settings' }

export interface Tab {
  /** Derived from the view, never generated — see `keyFor`. */
  key: string
  view: View
}

/**
 * A tab *is* its view.
 *
 * Deriving identity instead of minting an id is what keeps this store small:
 * `go()` becomes open-or-focus with no lookup table, opening the same agent
 * twice can't produce two tabs, and a persisted tab needs no id reconciliation
 * on restore.
 */
export function keyFor(view: View): string {
  return view.kind === 'session' ? `session:${view.instanceId}` : view.kind
}

/** The fleet tab is pinned at index 0 and cannot be closed, so `tabs` is never
 *  empty and there is always an active tab to render. */
export const FLEET_TAB: Tab = { key: 'fleet', view: { kind: 'fleet' } }

export interface UiState {
  tabs: Tab[]
  activeKey: string
  newAgentOpen: boolean
  /** null until checked — the UI must not flash the setup step at someone who is
   *  already set up. */
  sourceBound: boolean | null

  /** Open a tab for this view, or focus it if it is already open. */
  go: (view: View) => void
  close: (key: string) => void
  select: (key: string) => void
  /** Cycle by ±1, wrapping. */
  step: (delta: number) => void
  /** Drop session tabs whose instance is gone — a restored tab can outlive the
   *  agent it pointed at. */
  prune: (liveInstanceIds: string[]) => void

  setNewAgentOpen: (open: boolean) => void
  /** Ask the pod whether a provider key exists; routes to setup if not. */
  checkSource: () => Promise<void>
  markSourceBound: () => void
}

const KEY = 'mc.tabs'

function load(): { tabs: Tab[]; activeKey: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { tabs?: Tab[]; activeKey?: string } | null
    const restored = (saved?.tabs ?? []).filter((t) => t?.view && keyFor(t.view) === t.key)
    // Rebuild around the pinned tab rather than trusting the stored order to
    // contain it: an older build's payload, or a hand-edited one, would
    // otherwise leave the app with no home.
    const tabs = [FLEET_TAB, ...restored.filter((t) => t.key !== FLEET_TAB.key)]
    const activeKey = tabs.some((t) => t.key === saved?.activeKey) ? saved!.activeKey! : FLEET_TAB.key
    return { tabs, activeKey }
  } catch {
    return { tabs: [FLEET_TAB], activeKey: FLEET_TAB.key }
  }
}

export const useUi = create<UiState>((set, get) => {
  const persist = () => {
    const { tabs, activeKey } = get()
    try {
      localStorage.setItem(KEY, JSON.stringify({ tabs, activeKey }))
    } catch {
      // Losing tab restore is cosmetic; never fail a navigation over it.
    }
  }
  const commit = (patch: Partial<UiState>) => {
    set(patch)
    persist()
  }

  return {
    ...load(),
    newAgentOpen: false,
    sourceBound: null,

    go: (view) => {
      const key = keyFor(view)
      const { tabs } = get()
      commit({ tabs: tabs.some((t) => t.key === key) ? tabs : [...tabs, { key, view }], activeKey: key })
    },

    close: (key) => {
      if (key === FLEET_TAB.key) return
      const { tabs, activeKey } = get()
      const index = tabs.findIndex((t) => t.key === key)
      if (index < 0) return
      const next = tabs.filter((t) => t.key !== key)
      // Closing the focused tab lands on its right-hand neighbour, falling back
      // to the left — the tab that took its place on screen.
      commit({
        tabs: next,
        activeKey: activeKey === key ? (next[index] ?? next[index - 1] ?? FLEET_TAB).key : activeKey,
      })
    },

    select: (key) => {
      if (get().tabs.some((t) => t.key === key)) commit({ activeKey: key })
    },

    step: (delta) => {
      const { tabs, activeKey } = get()
      const at = tabs.findIndex((t) => t.key === activeKey)
      const next = tabs[(at + delta + tabs.length) % tabs.length]
      if (next) commit({ activeKey: next.key })
    },

    prune: (liveInstanceIds) => {
      const live = new Set(liveInstanceIds)
      const { tabs, activeKey } = get()
      const next = tabs.filter((t) => t.view.kind !== 'session' || live.has(t.view.instanceId))
      if (next.length === tabs.length) return
      commit({ tabs: next, activeKey: next.some((t) => t.key === activeKey) ? activeKey : FLEET_TAB.key })
    },

    setNewAgentOpen: (newAgentOpen) => set({ newAgentOpen }),

    checkSource: async () => {
      try {
        const stored = await keys.list()
        const bound = stored.some((k) => k.name === 'OPENAI_API_KEY')
        set({ sourceBound: bound })
        if (!bound) get().go({ kind: 'source' })
      } catch {
        // A pod that will not answer its key store is a connection problem, not an
        // onboarding one — leave the user on the fleet and let that error surface.
        set({ sourceBound: true })
      }
    },

    markSourceBound: () => {
      set({ sourceBound: true })
      get().close('source')
    },
  }
})

/** The view currently on screen. Falls back to the pinned tab, which by
 *  construction is always present. */
export function activeView(s: UiState): View {
  return (s.tabs.find((t) => t.key === s.activeKey) ?? FLEET_TAB).view
}
