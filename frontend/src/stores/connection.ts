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
  ready: boolean
  session: Session | null
  pods: Pod[]
  connecting: boolean
  /** The pod is up but its API has not answered yet — it may be waking. */
  waking: boolean
  info: AgentInfo | null
  /** Which pod we ended up on — shown in the title bar instead of a switcher. */
  pod: ActivePod | null
  error: string | null

  boot: () => Promise<void>
  refreshPods: () => Promise<void>
  connect: (podId?: string) => Promise<void>
  signOut: () => Promise<void>
  setSession: (s: Session) => void
}

export const useConnection = create<ConnectionState>((set, get) => ({
  ready: false,
  session: null,
  pods: [],
  connecting: false,
  waking: false,
  info: null,
  pod: null,
  error: null,

  boot: async () => {
    // `ready` flips either way: a core that cannot answer should show the login
    // screen with an error, never an empty window.
    try {
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

  refreshPods: async () => {
    try {
      set({ pods: await pods.list(), error: null })
    } catch (e) {
      set({ error: String(e) })
    }
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

  signOut: async () => {
    await auth.logout()
    set({ session: null, pods: [], info: null, pod: null })
  },

  setSession: (session) => {
    set({ session })
    void get().refreshPods()
  },
}))
