import { create } from 'zustand'
import { account } from '@/rpc'
import type { Usage } from '@/types'

/**
 * The account's allowance, polled for the status bar (UI_PLAN §2, S5).
 *
 * Three states, and keeping them apart is the whole job:
 *   `supported: null`  — not asked yet
 *   `supported: false` — this hub does not report usage (PLAN §12.6). Render
 *                        nothing. Never a zero: an empty meter and an unknown
 *                        meter look identical and mean opposite things.
 *   `supported: true`  — `usage` is real and the meter is honest.
 *
 * A failed poll leaves the last good reading in place rather than blanking the
 * bar; a stale balance is more useful than no balance, and the bar is not where
 * a transient network blip should announce itself.
 */
interface UsageState {
  usage: Usage | null
  supported: boolean | null
  refresh: () => Promise<void>
}

export const useUsage = create<UsageState>((set) => ({
  usage: null,
  supported: null,

  refresh: async () => {
    try {
      const usage = await account.usage()
      set(usage ? { usage, supported: true } : { supported: false })
    } catch {
      // Keep whatever we last knew.
    }
  },
}))

/** Long enough that it is invisible, short enough that a spend registers before
 *  the user goes looking for it elsewhere. */
export const USAGE_POLL_MS = 5 * 60 * 1000
