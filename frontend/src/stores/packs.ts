import { create } from 'zustand'
import { keys, packs } from '@/rpc'
import { describeRegistryError } from '@/features/packs/registryState'
import type { InstalledPack, KeyEntry, PackManifest, Registries, RegistryConnection, SearchHit } from '@/types'

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

  /** The pack the detail sheet is showing, if any. */
  viewing: SearchHit | null
  manifests: Record<string, PackManifest>
  /** `reference` → the id the pack calls itself, which is the id the pod files it
   *  under. Not the same string as the reference's handle for every pack, and
   *  where they differ nothing else can tell that a pack is installed — see
   *  `findInstalled`. Learned from a manifest or an install report; both are the
   *  pod quoting the pack rather than the host naming it. */
  packIds: Record<string, string>
  manifestError: Record<string, string>
  /** The pod's key names, for the requirements checklist. Names only — a value
   *  never crosses into the webview (PLAN §2). */
  podKeys: string[]
  view: (hit: SearchHit | null) => Promise<void>
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
  viewing: null,
  manifests: {},
  manifestError: {},
  packIds: {},
  podKeys: [],

  /**
   * Open the detail sheet, fetching the manifest and the pod's key names.
   *
   * Both are needed together: a requirements list is only useful next to what
   * this pod already has, and PLAN §9.4's whole point is that an unmet
   * requirement should be a checklist item *before* installing rather than a
   * runtime failure afterwards.
   */
  view: async (hit) => {
    set({ viewing: hit })
    if (!hit) return
    const registry = get().active
    if (!registry || get().manifests[hit.reference]) return
    try {
      const [manifest, stored] = await Promise.all([
        packs.manifest(registry, hit.id),
        keys.list().catch((): KeyEntry[] => []),
      ])
      set({
        manifests: { ...get().manifests, [hit.reference]: manifest },
        packIds: manifest.id ? { ...get().packIds, [hit.reference]: manifest.id } : get().packIds,
        podKeys: stored.map((k) => k.name),
      })
    } catch (e) {
      set({
        manifestError: {
          ...get().manifestError,
          [hit.reference]: describeRegistryError(e, registry),
        },
      })
    }
  },

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
      error: results.status === 'rejected' ? describeRegistryError(results.reason, name) : null,
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
      set({ loading: false, error: describeRegistryError(e, name) })
    }
  },

  connect: async () => {
    const name = get().active
    if (!name) return
    try {
      set({ connection: await packs.connect(name), error: null })
    } catch (e) {
      set({ error: describeRegistryError(e, name) })
    }
  },

  install: async (hit, allowUnverified = false) => {
    set({ installing: { ...get().installing, [hit.reference]: true }, error: null })
    try {
      // The pod's install report names the id it filed the pack under. Keeping it
      // is what lets the button flip to "Installed" for a pack whose handle on the
      // host is not the id in its own manifest.
      const report = await packs.install(hit.reference, allowUnverified)
      const id = (report as { id?: unknown } | null)?.id
      // Re-read rather than assume: the pod is the authority on what it now has,
      // and an install can resolve to a different version than the hit showed.
      const installed = await packs.installed()
      set({
        installed,
        packIds: typeof id === 'string' && id ? { ...get().packIds, [hit.reference]: id } : get().packIds,
      })
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
