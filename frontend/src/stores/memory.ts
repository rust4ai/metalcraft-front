import { create } from 'zustand'
import { fleet } from '@/rpc'
import type { InstanceMemory } from '@/types'

/**
 * What each agent knows (`GET /agents/instances/{id}/memory`).
 *
 * Fetched lazily and only when the rail's Memory tab is actually looking at it:
 * an agent's memory is not needed to hold a conversation, and paying for it on
 * every session open would make opening a session slower for the majority of
 * users who never open the tab.
 *
 * The read is side-effect-free on the pod — looking at what an agent knows does
 * not touch its access counts or decay curve — so re-fetching is always safe.
 */
interface MemoryState {
  byInstance: Record<string, InstanceMemory>
  loading: Record<string, boolean>
  error: Record<string, string>
  load: (instanceId: string) => Promise<void>
}

export const useMemory = create<MemoryState>((set, get) => ({
  byInstance: {},
  loading: {},
  error: {},

  load: async (instanceId) => {
    if (get().loading[instanceId]) return
    set({ loading: { ...get().loading, [instanceId]: true } })
    try {
      const view = await fleet.memory(instanceId)
      set({
        byInstance: { ...get().byInstance, [instanceId]: view },
        loading: { ...get().loading, [instanceId]: false },
        error: { ...get().error, [instanceId]: '' },
      })
    } catch (e) {
      set({
        loading: { ...get().loading, [instanceId]: false },
        error: { ...get().error, [instanceId]: String(e) },
      })
    }
  },
}))
