import { create } from 'zustand'
import { fleet } from '@/rpc'
import type { AgentInstance, AgentPreset } from '@/types'
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
  error: string | null

  load: () => Promise<void>
  spawn: (preset: string, name?: string) => Promise<AgentInstance | null>
  remove: (id: string) => Promise<void>
  setStatus: (instanceId: string, status: Status) => void
}

export const useFleet = create<FleetState>((set, get) => ({
  instances: [],
  presets: [],
  status: {},
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const [instances, presets] = await Promise.all([fleet.instances(), fleet.presets()])
      set({ instances, presets, loading: false })
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
    await fleet.remove(id)
    set({ instances: get().instances.filter((i) => i.id !== id) })
  },

  setStatus: (instanceId, status) => set({ status: { ...get().status, [instanceId]: status } }),
}))
