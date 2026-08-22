import { create } from 'zustand'
import { account } from '@/rpc'
import type { Credits } from '@/types'

/**
 * The account's credit balance, polled for the status bar (UI_PLAN §2, S5).
 *
 * Three states, and keeping them apart is the whole job:
 *   `supported: null`  — not asked yet
 *   `supported: false` — this deployment does not report credits. Render nothing.
 *                        Never a zero: "0 credits" and "we don't know" look
 *                        identical on a readout and mean opposite things.
 *   `supported: true`  — the balance is real.
 *
 * A failed poll keeps the last good reading rather than blanking the bar; a
 * stale balance beats none, and the status bar is not where a network blip
 * should announce itself.
 */
interface CreditsState {
  credits: Credits | null
  supported: boolean | null
  refresh: () => Promise<void>
}

export const useCredits = create<CreditsState>((set) => ({
  credits: null,
  supported: null,

  refresh: async () => {
    try {
      const credits = await account.credits()
      set(credits ? { credits, supported: true } : { supported: false })
    } catch {
      // Keep whatever we last knew.
    }
  },
}))

/** Long enough to be invisible, short enough that a spend registers before the
 *  user goes looking for it elsewhere. */
export const CREDITS_POLL_MS = 5 * 60 * 1000
