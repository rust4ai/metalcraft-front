import { useEffect, useMemo } from 'react'
import { KeyRound, Plus, Store, X } from 'lucide-react'
import { useConnection } from '@/stores/connection'
import { useFleet } from '@/stores/fleet'
import { useNudges } from '@/stores/nudges'
import { useUi } from '@/stores/ui'
import { Button } from '@/components/ui/Button'

interface Nudge {
  key: string
  icon: typeof KeyRound
  title: string
  body: string
  action: string
  run: () => void
}

/**
 * Orca's bottom-left setup card (UI_PLAN §2, S6).
 *
 * These are the optional steps of PLAN §9 — the ones that make the app
 * *interesting* rather than merely functional — moved out of the onboarding
 * corridor. A pod that already works should not be marched through a wizard to
 * discover it can install packs; it should be told, once, in the corner, and be
 * able to wave it away.
 *
 * **One card, not a stack.** The spec said stack; a queue of setup nags in the
 * corner of a working app is noise, and the second-most-urgent thing can wait
 * until the first is handled or dismissed.
 *
 * Nothing here nudges toward Octaweave (PLAN §9.3 / P7): it is not built, and a
 * card offering a button that goes nowhere is worse than silence.
 */
export function Nudges() {
  const info = useConnection((s) => s.info)
  const { instances, presets, loading } = useFleet()
  const { sourceBound, go, setNewAgentOpen } = useUi()
  const { dismissed, dismiss, revive } = useNudges()

  const applicable = useMemo<Nudge[]>(() => {
    const out: Nudge[] = []
    if (sourceBound === false) {
      out.push({
        key: 'source',
        icon: KeyRound,
        title: 'This pod cannot think yet',
        body: 'An interface source is where completions come from. Without one, an agent can be spawned but not talked to.',
        action: 'Bind a source',
        run: () => go({ kind: 'source' }),
      })
    }
    if (presets.length === 0) {
      out.push({
        key: 'no-presets',
        icon: Store,
        title: 'No agents to spawn from',
        body: 'Agent packs bring the presets and personas you spawn instances from. Axoniac Prime is the default host.',
        action: 'Browse agents',
        run: () => go({ kind: 'packs' }),
      })
    } else if (instances.length === 0) {
      out.push({
        key: 'no-instances',
        icon: Plus,
        title: 'Spawn your first agent',
        body: `You have ${presets.length} preset${presets.length === 1 ? '' : 's'} installed. An instance is one agent with its own memory and conversations.`,
        action: 'New agent',
        run: () => setNewAgentOpen(true),
      })
    }
    return out
  }, [go, instances.length, presets.length, setNewAgentOpen, sourceBound])

  // A dismissal only lasts as long as the thing it dismissed. Once a condition
  // resolves, forget that it was waved away, so it can speak again if it recurs.
  useEffect(() => {
    const live = new Set(applicable.map((n) => n.key))
    for (const key of dismissed) if (!live.has(key)) revive(key)
  }, [applicable, dismissed, revive])

  // Never while the fleet is still loading: every condition here is "you have
  // none of X", and an empty list mid-fetch is indistinguishable from an empty
  // pod. Nudging on that would flash a wrong card on every launch.
  if (!info || loading) return null

  const nudge = applicable.find((n) => !dismissed.includes(n.key))
  if (!nudge) return null

  return (
    <div className="animate-fade-up pointer-events-auto absolute bottom-10 left-4 z-30 w-[min(20rem,calc(100vw-2rem))] rounded-card bg-surface p-4 shadow-overlay">
      <div className="flex items-start gap-2">
        <nudge.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
        <h2 className="flex-1 text-[13.5px] font-semibold">{nudge.title}</h2>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismiss(nudge.key)}
          className="rounded-chip p-0.5 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{nudge.body}</p>
      <Button size="sm" variant="outline" className="mt-3 w-full" onClick={nudge.run}>
        {nudge.action}
      </Button>
    </div>
  )
}
