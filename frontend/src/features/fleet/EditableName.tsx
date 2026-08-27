import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useFleet } from '@/stores/fleet'
import { cn } from '@/lib/cn'
import type { AgentInstance } from '@/types'

/**
 * An agent's name, in place and editable (PLAN §10.1).
 *
 * One component for every surface that shows a name — the session header, the
 * rail's details, the fleet card — because a rename that works in one place and
 * not the next is worse than no rename at all: the user learns the gesture and
 * then it fails silently somewhere else.
 *
 * Committing on blur as well as on Enter is deliberate. This lives inside a
 * clickable card and a header full of other controls, so "typed a new name and
 * clicked away" is the common path, not the exception; only Escape discards.
 *
 * A rename is only a rename — whether an agent survives the reaper is
 * `persistent`, and nothing here touches it. An empty name is still refused
 * locally rather than sent: it would leave the agent under a blank label that
 * nothing in the fleet could identify.
 */
export function EditableName({
  instance,
  className,
}: {
  instance: AgentInstance
  /** Type of the name itself — each surface sizes it, this owns the behaviour. */
  className?: string
}) {
  const rename = useFleet((s) => s.rename)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(instance.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function start() {
    setValue(instance.name)
    setError(null)
    setEditing(true)
  }

  function stop() {
    setEditing(false)
    setBusy(false)
  }

  async function commit() {
    const name = value.trim()
    // Unchanged or empty is a cancel, not a failed save: nothing to tell the
    // user about, and nothing worth a round trip to the pod.
    if (!name || name === instance.name) return stop()
    setBusy(true)
    const failure = await rename(instance.id, name)
    setBusy(false)
    // The pod's refusal is shown verbatim and the field stays open with the
    // typed name in it — a rename that vanished along with what you typed is
    // the version of this that loses work.
    if (failure) setError(failure)
    else stop()
  }

  if (editing) {
    return (
      <span className="block">
        <input
          autoFocus
          value={value}
          disabled={busy}
          aria-label="Agent name"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') void commit()
            if (e.key === 'Escape') stop()
          }}
          // Clicks inside the field must not reach a card that would navigate
          // away mid-edit.
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'w-full min-w-0 rounded-control bg-field px-1.5 py-0.5 caret-accent outline-none shadow-btn disabled:opacity-50',
            className,
          )}
        />
        {error && <span className="mt-1 block text-[11px] text-red">{error}</span>}
      </span>
    )
  }

  return (
    <button
      type="button"
      title="Rename"
      onClick={(e) => {
        e.stopPropagation()
        start()
      }}
      className={cn(
        'group/name flex min-w-0 max-w-full items-center gap-1.5 rounded-control px-1.5 py-0.5 text-left hover:bg-hover',
        className,
      )}
    >
      <span className="truncate">{instance.name}</span>
      {/* Only on hover: a pencil beside every name in a fleet of twelve is
          twelve icons competing with the names they annotate. */}
      <Pencil className="h-3 w-3 shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 group-hover/name:opacity-100" />
    </button>
  )
}
