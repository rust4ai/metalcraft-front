import { useEffect, useRef, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { automations as automationsRpc } from '@/rpc'
import { useFleet } from '@/stores/fleet'
import { useSessions } from '@/stores/sessions'
import { keyFor, useUi } from '@/stores/ui'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { AgentInstance } from '@/types'

/**
 * Delete an agent — the one act in the fleet that the pod will not undo.
 *
 * Shared by the fleet card and the rail for the same reason `EditableName` is:
 * the two surfaces show the same agent, and a delete that exists on one and not
 * the other teaches a gesture that then goes missing. Only the trigger differs —
 * an icon on a card that has no room for a word, a labelled button in the rail
 * that does.
 *
 * It asks in a popover rather than a modal. Deleting one agent is not a factory
 * reset (see `DangerZoneCard`, which takes the window because what it destroys
 * cannot be re-made) — it is a small, local act, and the confirm belongs next to
 * the thing it is about. What the popover owes the user is not ceremony but the
 * two facts they cannot see from the card: where the transcripts go, and what
 * was pointing at this agent.
 */
export function DeleteAgent({
  instance,
  compact = false,
  className,
}: {
  instance: AgentInstance
  /** Icon-only trigger, for the fleet card. */
  compact?: boolean
  className?: string
}) {
  const remove = useFleet((s) => s.remove)
  const closeSession = useSessions((s) => s.close)
  const closeTab = useUi((s) => s.close)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Schedules that name this agent. `null` until asked — and "we did not get an
   *  answer" is rendered as silence, never as "nothing points at it". */
  const [armed, setArmed] = useState<number | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // Asked when the confirm opens, not when the card renders: a fleet of twelve
  // would otherwise cost twelve requests to draw. Straight to the RPC rather
  // than through the automations store, because this must not leave a loading
  // flag or an old-pod error behind in a view the user never opened.
  useEffect(() => {
    if (!asking) return
    let live = true
    void automationsRpc
      .scheduled()
      .then((all) => {
        if (live) setArmed(all.filter((s) => s.instance_id === instance.id).length)
      })
      .catch(() => {
        // A pod too old for scheduled flows, or one that would not answer. The
        // delete is still offered; it just goes without the warning.
      })
    return () => {
      live = false
    }
  }, [asking, instance.id])

  useEffect(() => {
    if (!asking) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setAsking(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAsking(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [asking])

  async function confirm() {
    setBusy(true)
    setError(null)
    const failure = await remove(instance.id)
    setBusy(false)
    // The refusal stays on screen with the confirm still open: a delete that
    // failed and closed looks exactly like one that worked.
    if (failure) return setError(failure)
    // Only now, and in this order. The tab would be pruned anyway once the fleet
    // list changes (see `Shell`), but that happens an effect later — long enough
    // to paint the rail's "no longer on the pod" over the agent the user just
    // deleted, which reads as an error rather than as the thing they asked for.
    closeSession(instance.id)
    closeTab(keyFor({ kind: 'session', instanceId: instance.id }))
  }

  return (
    // The fleet card opens the session on click, so nothing in here may reach it.
    <div ref={root} className={cn('relative', className)} onClick={(e) => e.stopPropagation()}>
      {compact ? (
        <button
          type="button"
          title="Delete agent"
          aria-label={`Delete ${instance.name}`}
          onClick={() => setAsking((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={asking}
          // Hidden until the card is hovered, and until this is focused —
          // otherwise the only way to reach it is a mouse. Forced visible while
          // the confirm is open, or the button vanishes from under the popover.
          className={cn(
            'rounded-control p-1 text-ink-3 opacity-0 transition-opacity duration-150 hover:bg-hover hover:text-red focus-visible:opacity-100 group-hover:opacity-100',
            asking && 'opacity-100',
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Button
          size="sm"
          variant="danger"
          className="w-full"
          onClick={() => setAsking((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={asking}
        >
          <Trash2 className="h-4 w-4" />
          Delete agent
        </Button>
      )}

      {asking && (
        <div
          role="dialog"
          aria-label={`Delete ${instance.name}`}
          className={cn(
            'rounded-card border border-line bg-surface p-3 text-left',
            // Floating over the card, which has no room for it — but *in flow*
            // in the rail, which is a scroll container: an absolute panel at the
            // bottom of one is a panel with its buttons cut off.
            compact
              ? 'absolute right-0 top-full z-20 mt-1.5 w-72 shadow-overlay'
              : 'mt-2 w-full',
          )}
        >
          <p className="text-[12.5px] font-medium text-ink">Delete {instance.name}?</p>
          <p className="mt-1 text-[11.5px] text-ink-2">
            The agent and its memory go. Its transcripts stay on the pod, but nothing here lists
            them once the agent they belong to is gone.
          </p>
          {/* Only when there are some. "0 scheduled flows" is a sentence that
              makes somebody stop and read a warning about nothing. */}
          {armed !== null && armed > 0 && (
            <p className="mt-2 rounded-chip bg-orange-tint px-2 py-1.5 text-[11.5px] text-ink-2">
              {armed === 1 ? '1 scheduled flow runs' : `${armed} scheduled flows run`} as this
              agent. They stay, without one.
            </p>
          )}
          {error && <p className="mt-2 text-[11.5px] text-red">{error}</p>}
          <div className="mt-3 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={() => void confirm()} disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
