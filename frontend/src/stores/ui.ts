import { create } from 'zustand'
import { keys } from '@/rpc'

/**
 * Where the user is, plus the one onboarding fact the shell has to know: whether
 * this pod has an interface source bound. A tab model comes at P2; this stays in
 * its own store so the fleet and session stores never import each other.
 */
export type View =
  | { kind: 'fleet' }
  | { kind: 'session'; instanceId: string }
  | { kind: 'source' }
  | { kind: 'packs' }

interface UiState {
  view: View
  newAgentOpen: boolean
  /** null until checked — the UI must not flash the setup step at someone who is
   *  already set up. */
  sourceBound: boolean | null

  go: (view: View) => void
  setNewAgentOpen: (open: boolean) => void
  /** Ask the pod whether a provider key exists; routes to setup if not. */
  checkSource: () => Promise<void>
  markSourceBound: () => void
}

export const useUi = create<UiState>((set) => ({
  view: { kind: 'fleet' },
  newAgentOpen: false,
  sourceBound: null,

  go: (view) => set({ view }),
  setNewAgentOpen: (newAgentOpen) => set({ newAgentOpen }),

  checkSource: async () => {
    try {
      const stored = await keys.list()
      const bound = stored.some((k) => k.name === 'OPENAI_API_KEY')
      set({ sourceBound: bound })
      if (!bound) set({ view: { kind: 'source' } })
    } catch {
      // A pod that will not answer its key store is a connection problem, not an
      // onboarding one — leave the user on the fleet and let that error surface.
      set({ sourceBound: true })
    }
  },

  markSourceBound: () => set({ sourceBound: true, view: { kind: 'fleet' } }),
}))
