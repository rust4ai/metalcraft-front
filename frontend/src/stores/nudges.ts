import { create } from 'zustand'

/**
 * Which setup nudges the user has waved away (UI_PLAN §2, S6).
 *
 * Only the dismissals live here; *which* nudges apply is derived from the fleet,
 * connection and onboarding state at render time. Storing the conditions would
 * mean keeping a second copy of facts three other stores already own, and the
 * copies would drift.
 *
 * A dismissal is cleared when its condition resolves, so a nudge can speak again
 * if the situation recurs — waving away "no agents to spawn from" once should
 * not silence it forever if every pack is later uninstalled.
 */
interface NudgeState {
  dismissed: string[]
  dismiss: (key: string) => void
  /** Called for every nudge whose condition no longer holds. */
  revive: (key: string) => void
}

const KEY = 'mc.nudges'

function load(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

export const useNudges = create<NudgeState>((set, get) => {
  const persist = (dismissed: string[]) => {
    set({ dismissed })
    try {
      localStorage.setItem(KEY, JSON.stringify(dismissed))
    } catch {
      // Losing a dismissal means seeing a nudge again, which is a nuisance and
      // not worth failing a render over.
    }
  }

  return {
    dismissed: load(),
    dismiss: (key) => {
      if (!get().dismissed.includes(key)) persist([...get().dismissed, key])
    },
    revive: (key) => {
      if (get().dismissed.includes(key)) persist(get().dismissed.filter((k) => k !== key))
    },
  }
})
