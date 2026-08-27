import { create } from 'zustand'
import { fleet } from '@/rpc'
import type { AgentInstance, AgentPreset, RosterPersona } from '@/types'
import type { Status } from '@/components/ui/StatusDot'

/**
 * The fleet: every agent instance on the connected pod.
 *
 * `status` is held beside the instance rather than on it, because the pod does
 * not report busy-ness yet (PLAN §12.5) — today it is driven by live chat
 * subscriptions, and when the endpoint lands it seeds from there instead.
 */
interface FleetState {
  instances: AgentInstance[]
  presets: AgentPreset[]
  status: Record<string, Status>
  loading: boolean
  /** A load has completed at least once. Distinct from `!loading`, which is also
   *  true before the first one — and "no agents" and "not asked yet" must not
   *  look the same to anything that acts on emptiness. */
  loaded: boolean
  error: string | null

  load: () => Promise<void>
  spawn: (preset: string, name?: string) => Promise<AgentInstance | null>
  /** Delete an agent. Returns the pod's message on refusal, `null` on success —
   *  the same shape as `rename`, because the surface that asks first has to be
   *  able to tell "gone" from "the pod said no". */
  remove: (id: string) => Promise<string | null>
  /** Rename an agent. Returns the pod's message on refusal, `null` on success —
   *  the same shape as `setPersona`, so the surfaces share one error path. */
  rename: (id: string, name: string) => Promise<string | null>
  setStatus: (instanceId: string, status: Status) => void

  /** The roster for a preset, cached — the rail asks on every session open and
   *  a preset's personas do not change without a pack update. */
  personas: Record<string, RosterPersona[]>
  loadPersonas: (preset: string) => Promise<void>
  /** Switch an instance's persona. Returns the pod's message on refusal, which
   *  names the roster and is worth showing verbatim. */
  setPersona: (id: string, persona: string) => Promise<string | null>
}

export const useFleet = create<FleetState>((set, get) => ({
  instances: [],
  presets: [],
  status: {},
  loading: false,
  loaded: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const [instances, presets] = await Promise.all([fleet.instances(), fleet.presets()])
      set({ instances, presets, loading: false, loaded: true })
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  spawn: async (preset, name) => {
    try {
      const instance = await fleet.create(preset, name)
      set({ instances: [...get().instances, instance] })
      return instance
    } catch (e) {
      set({ error: String(e) })
      return null
    }
  },

  remove: async (id) => {
    try {
      await fleet.remove(id)
      // Spliced out rather than reloaded: the list is the only thing that
      // changed, and a refetch here would blank the fleet for a frame on a pod
      // that answers slowly.
      set({ instances: get().instances.filter((i) => i.id !== id) })
      return null
    } catch (e) {
      // Not put in `error`, which the fleet header renders: this one belongs
      // beside the button that asked, next to the agent that is still there.
      return String(e)
    }
  },

  rename: async (id, name) => {
    try {
      // The pod's answer is the whole instance, so it is spliced in rather than
      // the name patched locally: the same request also touches `last_active_at`,
      // which is what the fleet sorts the history fold by.
      const updated = await fleet.rename(id, name)
      set({ instances: get().instances.map((i) => (i.id === id ? updated : i)) })
      return null
    } catch (e) {
      return String(e)
    }
  },

  setStatus: (instanceId, status) => set({ status: { ...get().status, [instanceId]: status } }),

  personas: {},

  loadPersonas: async (preset) => {
    if (get().personas[preset]) return
    try {
      set({ personas: { ...get().personas, [preset]: await fleet.personas(preset) } })
    } catch {
      // A roster we cannot fetch just means no switcher; the session still works.
    }
  },

  setPersona: async (id, persona) => {
    try {
      const updated = await fleet.setPersona(id, persona)
      set({ instances: get().instances.map((i) => (i.id === id ? updated : i)) })
      return null
    } catch (e) {
      return String(e)
    }
  },
}))

/**
 * The presets an agent can actually be started as.
 *
 * Some presets are libraries: a pack ships one to carry its personas and skills
 * onto the pod, and the pod refuses to mint an instance from it. Offering one in
 * a picker is offering a button that returns 400, so every surface that spawns
 * reads the fleet through here rather than through `presets` — which stays the
 * full list, because the library view is a browser and a library preset is a
 * real thing to browse.
 *
 * A pod older than the flag omits it, and an absent flag is `false`: everything
 * stays startable, exactly as before.
 */
export function startablePresets(presets: AgentPreset[]): AgentPreset[] {
  return presets.filter((p) => !p.library)
}
