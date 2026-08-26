import { create } from 'zustand'
import { auth, pods } from '@/rpc'
import type { ActivePod, AgentInfo, Pod, Session } from '@/types'

/**
 * Sign-in and pod connection.
 *
 * One pod per account today, so `connect()` auto-picks when the list has exactly
 * one entry — a picker for a list of one is a speed bump, not a feature. The
 * store still models a list, because the connection layer already does (PLAN §7).
 */
interface ConnectionState {
  /** The core has been asked what it is already connected to and who we are.
   *  Until it flips, this window knows *nothing* — not that there is no pod, only
   *  that it has not looked. */
  ready: boolean
  session: Session | null
  pods: Pod[]
  /** The pod list has been answered at least once. Distinct from `pods.length`:
   *  an empty list before the first answer means "we have not looked yet", and
   *  that is a different sentence — and a different screen — from "there is no
   *  pod on this account". */
  podsLoaded: boolean
  /** A list is in flight. True for the first one *and* for `Check again`. */
  podsLoading: boolean
  connecting: boolean
  /** The pod is up but its API has not answered yet — it may be waking. */
  waking: boolean
  info: AgentInfo | null
  /** Which pod we ended up on — shown in the title bar instead of a switcher. */
  pod: ActivePod | null
  /** A failure to *connect*. Shown as a banner over the whole Launchpad. */
  error: string | null
  /** A failure to *list*, which is a different fact about a different thing and
   *  belongs beside the list rather than in a banner about connecting. */
  podsError: string | null

  boot: () => Promise<void>
  /** List the account's pods. `quiet` suppresses `podsLoading` — for a poll
   *  nobody asked for, which should not make the refresh button flicker and
   *  disable itself under the cursor of somebody about to press it. */
  refreshPods: (quiet?: boolean) => Promise<void>
  /** Re-read the account *and* its pods — what "check again" means to a person
   *  who just paid in a browser this window cannot see. */
  recheck: () => Promise<void>
  connect: (podId?: string) => Promise<void>
  /** Connect to a self-run pod by URL + key. Returns an error string, or null
   *  on success — the form shows it inline rather than as a global banner. */
  connectDirect: (url: string, key: string) => Promise<string | null>
  signOut: () => Promise<void>
  setSession: (s: Session) => void
}

export const useConnection = create<ConnectionState>((set, get) => ({
  ready: false,
  session: null,
  pods: [],
  podsLoaded: false,
  podsLoading: false,
  connecting: false,
  waking: false,
  info: null,
  pod: null,
  error: null,
  podsError: null,

  boot: async () => {
    // `ready` flips either way: a core that cannot answer should show the login
    // screen with an error, never an empty window.
    try {
      // Ask the core what it is already connected to, before asking who we are.
      // The renderer's `info` is per-window state and the core's connection is
      // not: reloading the window (or opening a second one) used to land on the
      // sign-in screen while the core still held a live pod. It also means a
      // directly-connected pod survives a refresh without retyping its key.
      const active = await pods.active().catch(() => null)
      if (active) {
        const info = await pods.info().catch(() => null)
        if (info) set({ info, pod: active })
      }
      const session = await auth.session()
      set({ session, ready: true })
      if (session) {
        // Before the pods, because `premium` gates whether a pod's turns can bill
        // the gateway and the cached copy is a sign-in-time snapshot: an upgrade
        // since then would otherwise read as "this pod cannot think". Best-effort
        // in the core — it returns the cached session rather than failing.
        // Swallowed, not awaited into the failure path: this is an optimisation
        // on a cached value we already have, and a core too old to know the
        // command must not cost the user their pod list.
        const fresh = await auth.refresh().catch(() => null)
        if (fresh) set({ session: fresh })
        await get().refreshPods()
      }
    } catch (e) {
      set({ ready: true, error: String(e) })
    }
  },

  refreshPods: async (quiet) => {
    if (!quiet) set({ podsLoading: true })
    try {
      set({ pods: await pods.list(), podsError: null })
    } catch (e) {
      set({ podsError: String(e) })
    } finally {
      // Set either way. A list that failed is still an *answer* — something to
      // show and retry — and leaving `podsLoaded` false would spin forever on a
      // question the core has already refused to answer.
      set({ podsLoading: false, podsLoaded: true })
    }
  },

  recheck: async () => {
    // `refreshPods` alone lists pods against a `premium` flag snapshotted at
    // sign-in, so an upgrade that landed a minute ago stays invisible to every
    // screen that gates on it — including the one offering to sell it again.
    // Both halves of "did anything change" have to move together.
    const fresh = await auth.refresh().catch(() => null)
    if (fresh) set({ session: fresh })
    await get().refreshPods()
  },

  connect: async (podId) => {
    const id = podId ?? get().pods[0]?.id
    if (!id) {
      set({ error: 'no pod on this account yet' })
      return
    }
    set({ connecting: true, waking: true, error: null })
    try {
      const info = await pods.connect(id)
      set({ info, pod: await pods.active(), connecting: false, waking: false })
    } catch (e) {
      set({ connecting: false, waking: false, error: String(e) })
    }
  },

  connectDirect: async (url, key) => {
    set({ connecting: true, error: null })
    try {
      const info = await pods.connectUrl(url, key)
      set({ info, pod: await pods.active(), connecting: false })
      return null
    } catch (e) {
      set({ connecting: false })
      // Returned rather than stored: a typo in a URL belongs next to the field
      // that has the typo.
      return String(e)
    }
  },

  signOut: async () => {
    await auth.logout()
    // `podsLoaded` goes back with the pods it described: the next account's list
    // is unknown again, and an empty one left marked "loaded" would tell the
    // person who just signed in that they have no pod before anyone had looked.
    set({ session: null, pods: [], podsLoaded: false, info: null, pod: null, podsError: null })
  },

  setSession: (session) => {
    set({ session, pods: [], podsLoaded: false, podsError: null })
    void get().refreshPods()
  },
}))
