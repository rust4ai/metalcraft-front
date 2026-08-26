import { usePacks } from '@/stores/packs'
import { pendingUpdates, updateAvailable } from './registryState'
import type { SearchHit } from '@/types'

/**
 * Who knows an update exists, in one place.
 *
 * The registry browser is where updates are *found*, but it is not the only
 * place they are worth saying: the sidebar counts them, and the Library — the
 * screen that answers "what is on this pod" — is where someone looks at a pack
 * without any intention of going shopping. Each of those reading the packs store
 * directly would mean three slightly different notions of "has an update", and
 * the first time they disagreed the badge would point at a row that was not
 * there.
 *
 * The store is populated by the sweep that runs when a registry opens, which the
 * shell kicks off as soon as there is a pod. Nothing here fetches; these are
 * views onto what that already found.
 */

/** Every hit that updates something installed, from both the browsed page and
 *  the per-pack sweep. */
function useCandidates(): { hits: SearchHit[]; installed: ReturnType<typeof usePacks.getState>['installed']; aliases: Record<string, string> } {
  const results = usePacks((s) => s.results)
  const extraHits = usePacks((s) => s.extraHits)
  const installed = usePacks((s) => s.installed)
  const aliases = usePacks((s) => s.packIds)
  return { hits: [...results, ...extraHits], installed, aliases }
}

/** How many installed packs have a newer version waiting. */
export function usePackUpdateCount(): number {
  const { hits, installed, aliases } = useCandidates()
  // Derived outside any selector: returning a fresh array from a zustand
  // selector re-renders on every store touch, which is a lot of touches for a
  // sidebar that is always mounted.
  return pendingUpdates(hits, installed, aliases).length
}

/**
 * The update waiting for one installed pack, by the id the **pod** files it
 * under — which is what every screen outside the registry browser knows it as.
 */
export function usePackUpdate(packId: string | null | undefined): {
  hit: SearchHit
  from: string
  to: string
} | null {
  const { hits, installed, aliases } = useCandidates()
  if (!packId) return null
  for (const hit of hits) {
    const upgrade = updateAvailable(hit, installed, aliases)
    if (upgrade?.id === packId) return { hit, from: upgrade.from, to: upgrade.to }
  }
  return null
}
