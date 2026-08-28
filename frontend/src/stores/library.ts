import { create } from 'zustand'
import { keys, library, packs } from '@/rpc'
import { refKey, sameRef, type Ref } from '@/features/library/refs'
import type {
  FlowTemplateSummary,
  Integration,
  IntegrationDetail,
  InstalledPack,
  PersonaDetail,
  PodSnapshot,
  PresetDetail,
  SkillDetail,
} from '@/types'

/**
 * The library: what is installed on this pod, and where you are inside it.
 *
 * Two halves that behave differently on purpose.
 *
 * **The index is one fetch.** `GET /snapshot` carries presets, personas, skills,
 * api-tools and the default preset together. It used to be the only way to know
 * personas and skills existed at all; the pod publishes `/personas` and
 * `/skills` now, but they return the same summaries the snapshot already holds,
 * so reading them would be two more round trips for the same answer.
 * Integrations, packs and flow templates come from three list routes the
 * snapshot leaves out, fetched alongside it and settled independently: a pod
 * that will not answer one of them still has a library worth showing.
 *
 * **The trail is a stack, not a route.** Opening an artifact pushes; the
 * breadcrumb pops. It lives here rather than in `ui.ts` because it is state
 * *inside* one tab — sub-linking six levels into a preset must not put six tabs
 * in the tab strip, and the tab's identity has to stay `library` for `keyFor`
 * to keep working.
 *
 * Details are cached per ref and never invalidated by navigation. Walking back
 * up a trail you just walked down is the common motion, and re-fetching a skill
 * because you pressed back is a spinner where the answer already is.
 */
export interface LibraryState {
  snapshot: PodSnapshot | null
  /** The pod is too old to have `/snapshot`, so the index cannot be built. A
   *  different screen from an empty library, and it says which. */
  unsupported: boolean
  integrations: Integration[]
  installedPacks: InstalledPack[]
  templates: FlowTemplateSummary[]
  /** The names in this pod's key store — never the values (PLAN §2). Held here
   *  so a preset's `requires_env` can be a checklist against what this pod
   *  actually has rather than a list of strings nobody can act on. */
  podKeys: string[]
  loading: boolean
  /** A load has finished, whatever it answered.
   *
   *  Distinct from `snapshot !== null`, and the distinction is load-bearing: a
   *  pod too old to have `/snapshot` answers `null` *successfully*, so a view
   *  that asked "no snapshot and not loading? then load" would fire again on
   *  every render of that pod, forever. Ask whether the question has been put,
   *  not whether the answer was interesting. */
  loaded: boolean
  /** The index's own failure. A detail's failure is in `errors`, keyed by ref,
   *  so one dead artifact never blanks the library behind it. */
  error: string | null

  /** Where you are. Empty is the index; the last entry is what is on screen. */
  trail: Ref[]

  presetDetails: Record<string, PresetDetail>
  personaDetails: Record<string, PersonaDetail>
  skillDetails: Record<string, SkillDetail>
  integrationDetails: Record<string, IntegrationDetail>
  /** Untyped by design — a tool config, a pack manifest and a flow graph are all
   *  documents this app displays rather than shapes it owns. */
  rawDetails: Record<string, Record<string, unknown>>
  /** refKey → the pod's own words. */
  errors: Record<string, string>
  /** refKey → in flight. */
  fetching: Record<string, boolean>

  load: () => Promise<void>
  /** Push an artifact onto the trail and fetch it if it is not already cached. */
  open: (ref: Ref) => Promise<void>
  /** Truncate the trail to `depth` entries — 0 is the index. */
  back: (depth: number) => void
}

export const useLibrary = create<LibraryState>((set, get) => ({
  snapshot: null,
  unsupported: false,
  integrations: [],
  installedPacks: [],
  templates: [],
  podKeys: [],
  loading: false,
  loaded: false,
  error: null,
  trail: [],
  presetDetails: {},
  personaDetails: {},
  skillDetails: {},
  integrationDetails: {},
  rawDetails: {},
  errors: {},
  fetching: {},

  load: async () => {
    set({ loading: true, error: null })
    // `allSettled`, not `all`: only the snapshot is load-bearing. A pod that
    // refuses to list its flow templates still has presets, personas and skills
    // worth reading, and failing the whole screen over the least important of
    // the four would be the library's version of the bug the error log exists
    // to catch.
    const [snapshot, integrations, installedPacks, templates, stored] = await Promise.allSettled([
      library.snapshot(),
      library.integrations(),
      packs.installed(),
      library.flowTemplates(),
      keys.list(),
    ])

    if (snapshot.status === 'rejected') {
      set({ loading: false, loaded: true, error: String(snapshot.reason) })
      return
    }
    set({
      loading: false,
      loaded: true,
      // `null` from the RPC is the pod saying it cannot answer, which is not the
      // same as answering with nothing — the index says so rather than showing
      // an empty library and letting someone conclude their pod is bare.
      unsupported: snapshot.value === null,
      snapshot: snapshot.value,
      integrations: integrations.status === 'fulfilled' ? integrations.value : [],
      installedPacks: installedPacks.status === 'fulfilled' ? installedPacks.value : [],
      templates: templates.status === 'fulfilled' ? templates.value : [],
      podKeys: stored.status === 'fulfilled' ? stored.value.map((k) => k.name) : [],
    })
  },

  open: async (ref) => {
    const { trail } = get()
    // Re-opening what is already on screen is a no-op rather than a second
    // identical breadcrumb: a persona that lists a skill which lists it back is
    // a real shape, and it must not grow the trail forever.
    const here = trail[trail.length - 1]
    if (here && sameRef(here, ref)) return
    set({ trail: [...trail, ref] })

    const key = refKey(ref)
    const s = get()
    if (s.fetching[key] || cached(s, ref)) return
    set({ fetching: { ...s.fetching, [key]: true }, errors: omit(s.errors, key) })

    try {
      await fetchInto(ref, set)
    } catch (e) {
      set((prev) => ({ errors: { ...prev.errors, [key]: String(e) } }))
    } finally {
      set((prev) => ({ fetching: omit(prev.fetching, key) }))
    }
  },

  back: (depth) => set({ trail: get().trail.slice(0, Math.max(0, depth)) }),
}))

/** Whether this ref's detail is already in hand. */
function cached(s: LibraryState, ref: Ref): boolean {
  const { kind, id } = ref
  if (kind === 'preset') return id in s.presetDetails
  if (kind === 'persona') return id in s.personaDetails
  if (kind === 'skill') return id in s.skillDetails
  if (kind === 'integration') return id in s.integrationDetails
  return refKey(ref) in s.rawDetails
}

type Set = (
  patch: Partial<LibraryState> | ((prev: LibraryState) => Partial<LibraryState>),
) => void

/**
 * Fetch one artifact into the cache its kind belongs in.
 *
 * The typed kinds get their own map so a show page reads a `PresetDetail` and
 * not an `unknown` it has to narrow. The three untyped ones share `rawDetails`,
 * keyed by the full ref rather than the bare id — a pack and an integration can
 * legitimately answer to the same string (`octaweave` is both), and a single
 * id-keyed map would serve one of them the other's document.
 */
async function fetchInto(ref: Ref, set: Set): Promise<void> {
  const { kind, id } = ref
  const key = refKey(ref)
  switch (kind) {
    case 'preset': {
      const data = await library.preset(id)
      return set((p) => ({ presetDetails: { ...p.presetDetails, [id]: data } }))
    }
    case 'persona': {
      const data = await library.persona(id)
      return set((p) => ({ personaDetails: { ...p.personaDetails, [id]: data } }))
    }
    case 'skill': {
      const data = await library.skill(id)
      return set((p) => ({ skillDetails: { ...p.skillDetails, [id]: data } }))
    }
    case 'integration': {
      const data = await library.integration(id)
      return set((p) => ({ integrationDetails: { ...p.integrationDetails, [id]: data } }))
    }
    case 'tool': {
      const data = await library.apiTool(id)
      return set((p) => ({ rawDetails: { ...p.rawDetails, [key]: data } }))
    }
    case 'pack': {
      const data = await library.pack(id)
      return set((p) => ({ rawDetails: { ...p.rawDetails, [key]: data } }))
    }
    case 'template': {
      const data = await library.flowTemplate(id)
      return set((p) => ({ rawDetails: { ...p.rawDetails, [key]: data } }))
    }
  }
}

function omit<T>(map: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _dropped, ...rest } = map
  return rest
}
