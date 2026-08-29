import { create } from 'zustand'
import { fleet } from '@/rpc'
import type { DreamReport, InstanceMemory } from '@/types'

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
  /** Agents with a dream in flight. Its own map rather than a flag on `loading`:
   *  a dream takes minutes and a read takes milliseconds, and the pane says
   *  different things about each. */
  dreaming: Record<string, boolean>
  /** What the last dream this client started did, until the pane is closed. */
  lastDream: Record<string, DreamReport>
  load: (instanceId: string, force?: boolean) => Promise<void>
  dream: (instanceId: string) => Promise<void>
}

export const useMemory = create<MemoryState>((set, get) => ({
  byInstance: {},
  loading: {},
  error: {},
  dreaming: {},
  lastDream: {},

  load: async (instanceId, force = false) => {
    if (get().loading[instanceId]) return
    // A dream changes every number in this view, so the caller that just ran one
    // asks for a real re-read rather than the cached copy.
    if (!force && get().byInstance[instanceId]) return
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

  /**
   * Consolidate now.
   *
   * Minutes, not milliseconds — so `dreaming` is set for the whole call and the
   * pane shows it. The view is re-read afterwards because a dream moves every
   * count in it: episodes become durable memories, duplicates collapse, unused
   * ones archive.
   *
   * A failed dream reports itself the same way a failed read does. The pod
   * answers 200 with a report even when a stage failed, so the throwing case is
   * a pod that could not be reached at all — or one too old to have the route.
   */
  dream: async (instanceId) => {
    if (get().dreaming[instanceId]) return
    set({ dreaming: { ...get().dreaming, [instanceId]: true }, error: { ...get().error, [instanceId]: '' } })
    try {
      const report = await fleet.dream(instanceId)
      set({
        dreaming: { ...get().dreaming, [instanceId]: false },
        lastDream: { ...get().lastDream, [instanceId]: report },
      })
      await get().load(instanceId, true)
    } catch (e) {
      set({
        dreaming: { ...get().dreaming, [instanceId]: false },
        error: { ...get().error, [instanceId]: String(e) },
      })
    }
  },
}))
