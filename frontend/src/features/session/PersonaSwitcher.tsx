import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useFleet } from '@/stores/fleet'
import { cn } from '@/lib/cn'
import type { AgentInstance } from '@/types'

/**
 * Switch which persona an agent speaks as (PLAN §10.2).
 *
 * The roster comes from the pod, which resolves it server-side and marks the
 * personas it cannot find rather than dropping them. Those stay in the list,
 * disabled and labelled: a pack naming a persona this pod does not have is the
 * explanation for why an expected voice is missing, and hiding the row turns a
 * legible problem into a mystery.
 *
 * A roster of one is not a choice, so it renders as plain text — a dropdown that
 * can only pick what is already picked is furniture.
 */
export function PersonaSwitcher({ instance }: { instance: AgentInstance }) {
  const roster = useFleet((s) => s.personas[instance.agent_preset])
  const loadPersonas = useFleet((s) => s.loadPersonas)
  const setPersona = useFleet((s) => s.setPersona)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    void loadPersonas(instance.agent_preset)
  }, [instance.agent_preset, loadPersonas])

  const choose = async (slug: string) => {
    setOpen(false)
    if (slug === instance.persona) return
    setPending(slug)
    // The pod's refusal names the roster it validated against, so it is shown
    // verbatim rather than replaced with "could not update".
    setError(await setPersona(instance.id, slug))
    setPending(null)
  }

  if (!roster || roster.length <= 1) {
    return <span className="font-mono text-[11px]">{instance.persona}</span>
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending !== null}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-chip px-1 py-0.5 font-mono text-[11px] text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
      >
        {pending ?? instance.persona}
        <ChevronDown className="h-3 w-3 text-ink-3" />
      </button>

      {open && (
        <ul
          role="listbox"
          className="animate-pop-in absolute right-0 z-30 mt-1 w-56 rounded-card bg-surface p-1 shadow-overlay"
        >
          {roster.map((p) => (
            <li key={p.slug}>
              <button
                type="button"
                role="option"
                aria-selected={p.slug === instance.persona}
                disabled={!p.installed}
                onClick={() => void choose(p.slug)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left',
                  p.installed ? 'hover:bg-hover' : 'cursor-not-allowed opacity-60',
                )}
              >
                <Check
                  className={cn(
                    'mt-0.5 h-3.5 w-3.5 shrink-0',
                    p.slug === instance.persona ? 'text-accent' : 'invisible',
                  )}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-ink">{p.name || p.slug}</span>
                  <span className="block truncate text-[11px] text-ink-3">
                    {p.installed ? p.description || p.slug : 'not installed on this pod'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <span className="mt-1 block text-[11px] text-red">{error}</span>}
    </span>
  )
}
