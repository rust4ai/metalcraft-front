import { create } from 'zustand'
import { keys, packs } from '@/rpc'
import { describeRegistryError, updateAvailable } from '@/features/packs/registryState'
import type { AgentPackPreview, InstalledPack, KeyEntry, PackManifest, PackUpdateReport, Registries, RegistryConnection, SearchHit } from '@/types'

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
  /**
   * Put this pack on the pod — installing it, or updating it if the pod already
   * has an older version.
   *
   * One entry point on purpose. The two are different pod endpoints with
   * different consequences, and when the choice lived in the view the view got
   * it wrong: the button said "Update" and sent an install, so the pod replaced
   * the files and never reconciled the agents already made from them. Deciding
   * here means the button and the call cannot disagree.
   */
  apply: (hit: SearchHit, allowUnverified?: boolean) => Promise<boolean>

  /** The last update's report, until it is dismissed. Not an error and not a
   *  toast: it can name agents that changed, which is worth reading. */
  report: PackUpdateReport | null
  dismissReport: () => void

  /**
   * Hits the update check found that the current search did not show.
   *
   * Browsing lists a page of the catalogue; an installed pack outside that page
   * was invisible, so an update to it was too. Checking asks the host about each
   * installed pack by name instead of hoping it is on screen.
   */
  extraHits: SearchHit[]
  checking: boolean
  checkUpdates: () => Promise<void>

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
  /** The pod's own reading of each inspected pack, keyed by reference. Absent
   *  when the pod would not or could not open the archive. */
  previews: Record<string, AgentPackPreview>
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
  previews: {},
  report: null,
  extraHits: [],
  checking: false,

  dismissReport: () => set({ report: null }),

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
      // Three questions, three sources. The registry describes the pack, the key
      // store says what this pod holds, and `inspect` is the pod opening the
      // archive it would actually install — the only one that can see a preset
      // collision, and the only account of `missing_env` that is not this app's
      // own arithmetic. The inspection is optional: a pod that refuses it (a
      // `verified-only` host declines an unvouched pack at inspect too) must
      // still show the manifest rather than an empty sheet.
      const [manifest, stored, preview] = await Promise.all([
        packs.manifest(registry, hit.id),
        keys.list().catch((): KeyEntry[] => []),
        packs.inspect(hit.reference).catch(() => null),
      ])
      set({
        manifests: { ...get().manifests, [hit.reference]: manifest },
        packIds: manifest.id ? { ...get().packIds, [hit.reference]: manifest.id } : get().packIds,
        podKeys: stored.map((k) => k.name),
        previews: preview ? { ...get().previews, [hit.reference]: preview } : get().previews,
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
    // `extraHits` belong to the host that was being browsed; carrying them across
    // would offer an update from a registry the user just navigated away from.
    set({ active: name, loading: true, results: [], extraHits: [], connection: null, error: null })
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
    // Look for updates without being asked. Detecting is not applying: the pod's
    // rule is that nothing changes under a running agent because somebody
    // published, and that rule is about the *update*, not about knowing one
    // exists. Left behind a button, a pack you already run could go a year out of
    // date because nobody thought to press it.
    if (results.status === 'fulfilled') void get().checkUpdates()
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

  apply: async (hit, allowUnverified = false) => {
    const upgrade = updateAvailable(hit, get().installed, get().packIds)
    set({ installing: { ...get().installing, [hit.reference]: true }, error: null })
    try {
      let filedAs: unknown
      let report: PackUpdateReport | null = null
      if (upgrade) {
        // `upgrade.id` is the id the *pod* files this pack under, which is what
        // the endpoint is keyed on — not the host's handle, which differs for
        // real packs (`@buildrspace` vs `buildr-space`).
        report = await packs.update(upgrade.id, hit.reference, allowUnverified)
        filedAs = report?.id
      } else {
        // The pod's install report names the id it filed the pack under. Keeping
        // it is what lets the button flip to "Installed" for a pack whose handle
        // on the host is not the id in its own manifest.
        filedAs = (await packs.install(hit.reference, allowUnverified) as { id?: unknown } | null)?.id
      }
      // Re-read rather than assume: the pod is the authority on what it now has,
      // and an install can resolve to a different version than the hit showed.
      const installed = await packs.installed()
      set({
        installed,
        // A report with nothing to say is not worth a dialog. `install` is always
        // present, so emptiness here means no live agent was affected.
        report:
          report && (report.personas_fell_back.length || report.orphaned.length) ? report : null,
        packIds:
          typeof filedAs === 'string' && filedAs
            ? { ...get().packIds, [hit.reference]: filedAs }
            : get().packIds,
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

  /**
   * Ask the active host about every installed pack, so an update is found
   * whether or not the pack happens to be on screen.
   *
   * One search per pack, four at a time — a registry is somebody's server, and a
   * pod with twenty packs should not arrive as twenty simultaneous requests. A
   * search that fails is skipped rather than failing the sweep: one unreachable
   * pack must not hide the updates to the others.
   */
  checkUpdates: async () => {
    const registry = get().active
    // Re-entrancy matters: this runs on its own when a registry opens *and* from
    // the button, and two sweeps racing would double every request to the host.
    if (!registry || get().checking) return
    const installed = get().installed
    if (installed.length === 0) return
    set({ checking: true })
    const found: SearchHit[] = []
    const queue = [...installed]
    const worker = async () => {
      for (let pack = queue.shift(); pack; pack = queue.shift()) {
        const hits = await packs.search(registry, pack.id).catch((): SearchHit[] => [])
        found.push(...hits)
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    // Searching per pack returns overlapping pages, and anything already on
    // screen is not "extra" — both would otherwise render the same card twice.
    const seen = new Set(get().results.map((h) => h.reference))
    const extraHits: SearchHit[] = []
    for (const hit of found) {
      if (seen.has(hit.reference)) continue
      seen.add(hit.reference)
      extraHits.push(hit)
    }
    set({ extraHits, checking: false })
  },
}))
