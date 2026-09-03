import { create } from 'zustand'
import { keys } from '@/rpc'
import { useConnection } from '@/stores/connection'
import type { InferenceStatus } from '@/types'

/**
 * Where the user is, plus the one onboarding fact the shell has to know: whether
 * this pod has an interface source of its own. Kept in its own store so the fleet
 * and session stores never import each other.
 */
export type View =
  | { kind: 'fleet' }
  | { kind: 'session'; instanceId: string }
  | { kind: 'source' }
  | { kind: 'pods' }
  | { kind: 'packs' }
  | { kind: 'library' }
  | { kind: 'automations' }
  | { kind: 'projects' }
  | { kind: 'settings' }
  | { kind: 'errors' }

/**
 * Which room of one agent is on screen (HARNESS_UI_PLAN H2).
 *
 * Distinct from a tab, and deliberately so. A tab is an open *document* — Home,
 * Settings, three different agents — and the strip holds several at once. A mode
 * is one facet of the single agent a session tab is already showing. Collapsing
 * the two would mean losing the ability to have two agents open, which is the
 * one thing the tab strip is for.
 */
export type SessionMode = 'chat' | 'runs' | 'memory' | 'schedules'

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
  /** Per instance, not global: switching to another agent and back should not
   *  drop you into the mode you left a *different* agent in. Not persisted —
   *  a session is opened to be talked to, so a relaunch starts on the chat. */
  sessionMode: Record<string, SessionMode>
  /** The ⌘K palette. Here rather than in `Shell`'s local state because the top
   *  bar's search field opens the same thing the shortcut does, and two owners
   *  of one dialog is how a field ends up unable to close what it opened. */
  paletteOpen: boolean
  /** Whether a *user-supplied* provider key is stored on this pod — an override,
   *  not a requirement. null until checked: the UI must not flash the setup step
   *  at someone who is already set up. See `canThink`. */
  ownSource: boolean | null
  /** The pod's own account of what it will authenticate with. null when it has
   *  not answered yet, or is too old to have the endpoint. */
  inference: InferenceStatus | null

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
  setPaletteOpen: (open: boolean) => void
  setSessionMode: (instanceId: string, mode: SessionMode) => void
  /** Ask the pod whether a user key is stored; routes to setup only if the pod
   *  genuinely cannot think without one. */
  checkOwnSource: () => Promise<void>
  markOwnSource: () => void
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
    paletteOpen: false,
    sessionMode: {},
    ownSource: null,
    inference: null,

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
      // Before the early return, not after it: an agent deleted while its tab
      // was closed changes no tab at all, and gating this on the tab list would
      // leave its mode in the map for the life of the window — where a re-used
      // id would inherit a room the user never chose for it.
      const sessionMode = Object.fromEntries(
        Object.entries(get().sessionMode).filter(([id]) => live.has(id)),
      )
      set({ sessionMode })

      const next = tabs.filter((t) => t.view.kind !== 'session' || live.has(t.view.instanceId))
      if (next.length === tabs.length) return
      commit({ tabs: next, activeKey: next.some((t) => t.key === activeKey) ? activeKey : FLEET_TAB.key })
    },

    setNewAgentOpen: (newAgentOpen) => set({ newAgentOpen }),

    // Not persisted, and deliberately: a dialog that survives a relaunch is a
    // dialog nobody asked for.
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

    setSessionMode: (instanceId, mode) =>
      set({ sessionMode: { ...get().sessionMode, [instanceId]: mode } }),

    checkOwnSource: async () => {
      try {
        // Both, because they answer different questions: `inference` is whether a
        // turn can run, `list_keys` is whether the *user* bound the key — which is
        // what the settings row and its Bind/Change button are about. The pod's
        // answer is authoritative where they overlap.
        const [inference, stored] = await Promise.all([
          keys.inference().catch(() => null),
          keys.list(),
        ])
        const own = inference
          ? inference.credential === 'stored'
          : stored.some((k) => k.name === 'OPENAI_API_KEY')
        set({ inference, ownSource: own })
        // Only a pod that actually cannot think is worth interrupting for.
        if (canThink(get(), useConnection.getState().session?.premium ?? false) === false) {
          get().go({ kind: 'source' })
        }
      } catch {
        // A pod that will not answer its key store is a connection problem, not an
        // onboarding one — leave the user on the fleet and let that error surface.
        set({ ownSource: true })
      }
    },

    markOwnSource: () => {
      set({ ownSource: true, inference: null })
      get().close('source')
    },
  }
})

/**
 * Whether this pod can actually run a turn.
 *
 * The question needs both halves, because neither side can answer it alone:
 *
 * - **The pod** knows which credential resolves, and it is the only thing that
 *   does. The one a provisioned pod runs on is injected as container env and never
 *   appears in `keys.json`, so a client reading the key store sees an empty list
 *   on a perfectly healthy pod — which is exactly how this app came to tell people
 *   their working pod was dead. `GET /api/v1/inference` is the pod answering with
 *   the same function the turn will use.
 * - **The account** knows whether that credential is allowed to spend. At the
 *   gateway the bill lands on the account, and a non-premium one is refused
 *   (`not_premium`) however good the pod's credential is. Off the gateway the user
 *   pays their own provider and premium is irrelevant.
 *
 * When the pod is too old to have the endpoint we fall back to the weaker rule:
 * premium settles it, otherwise a key of the user's own does.
 *
 * `null` means not yet known — and unknown is never reported as "no".
 */
export function canThink(
  s: Pick<UiState, 'inference' | 'ownSource'>,
  premium: boolean,
): boolean | null {
  if (s.inference) {
    if (!s.inference.ready) return false
    return s.inference.gateway ? premium : true
  }
  if (premium) return true
  return s.ownSource
}

/** The view currently on screen. Falls back to the pinned tab, which by
 *  construction is always present. */
export function activeView(s: UiState): View {
  return (s.tabs.find((t) => t.key === s.activeKey) ?? FLEET_TAB).view
}
