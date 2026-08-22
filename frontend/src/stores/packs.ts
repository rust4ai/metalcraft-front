import { create } from 'zustand'
import { packs } from '@/rpc'
import type { InstalledPack, Registries, RegistryConnection, SearchHit } from '@/types'

/**
 * Registry browsing state.
 *
 * The registry list comes from the **pod**, not from a hardcoded roster: the pod
 * is what decides which origins it will fetch from, so a host it would refuse
 * should never appear here with an install button.
 */
interface PacksState {
  registries: Registries | null
  active: string | null
  connection: RegistryConnection | null
  results: SearchHit[]
  installed: InstalledPack[]
  query: string
  loading: boolean
  installing: Record<string, boolean>
  error: string | null

  load: () => Promise<void>
  select: (name: string) => Promise<void>
  search: (query: string) => Promise<void>
  connect: () => Promise<void>
  install: (hit: SearchHit, allowUnverified?: boolean) => Promise<boolean>
}

export const usePacks = create<PacksState>((set, get) => ({
  registries: null,
  active: null,
  connection: null,
  results: [],
  installed: [],
  query: '',
  loading: false,
  installing: {},
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const [registries, installed] = await Promise.all([packs.registries(), packs.installed()])
      set({ registries, installed })
      const first = registries.registries.find((r) => r.is_default) ?? registries.registries[0]
      if (first) await get().select(first.name)
      else set({ loading: false })
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  select: async (name) => {
    set({ active: name, loading: true, results: [], connection: null, error: null })
    // Status and the catalogue are independent: browsing does not wait on an
    // identity check, and a host with no identity endpoint still lists packs.
    const [status, results] = await Promise.allSettled([
      packs.status(name),
      packs.search(name, get().query),
    ])
    set({
      connection: status.status === 'fulfilled' ? status.value : null,
      results: results.status === 'fulfilled' ? results.value : [],
      error: results.status === 'rejected' ? String(results.reason) : null,
      loading: false,
    })
  },

  search: async (query) => {
    set({ query })
    const name = get().active
    if (!name) return
    set({ loading: true })
    try {
      set({ results: await packs.search(name, query), loading: false, error: null })
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  connect: async () => {
    const name = get().active
    if (!name) return
    try {
      set({ connection: await packs.connect(name), error: null })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  install: async (hit, allowUnverified = false) => {
    set({ installing: { ...get().installing, [hit.reference]: true }, error: null })
    try {
      await packs.install(hit.reference, allowUnverified)
      // Re-read rather than assume: the pod is the authority on what it now has,
      // and an install can resolve to a different version than the hit showed.
      set({ installed: await packs.installed() })
      return true
    } catch (e) {
      set({ error: String(e) })
      return false
    } finally {
      const { [hit.reference]: _, ...rest } = get().installing
      set({ installing: rest })
    }
  },
}))
