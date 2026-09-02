import { ChevronRight } from 'lucide-react'
import { useLayout } from '@/stores/layout'
import { cn } from '@/lib/cn'

/**
 * One folding section of the Inspector (HARNESS_UI_PLAN §4, H4).
 *
 * The rail used to be three icon tabs, which made its contents mutually
 * exclusive for no reason — an agent's identity and the state of its credentials
 * are not alternatives, they are two things you read one after the other. A
 * single scroll of folds says that, and lets someone keep open exactly the two
 * they care about.
 *
 * Open/closed lives in the layout store rather than local state, for the same
 * reason the widths do: it is a property of how this person has arranged the
 * window, and re-collapsing everything on every navigation would make the folds
 * worse than no folds.
 *
 * `badge` is for a section whose *collapsed* state still needs to speak — Checks
 * is the case, because everything in it is invisible until it breaks.
 */
export function Collapsible({
  id,
  title,
  icon,
  badge,
  defaultOpen = true,
  children,
}: {
  /** Stable key for the persisted open/closed state. */
  id: string
  title: string
  icon?: React.ReactNode
  badge?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const open = useLayout((s) => s.railSections[id] ?? defaultOpen)
  const toggle = useLayout((s) => s.toggleRailSection)

  return (
    <section className="border-b border-line last:border-0">
      <h2>
        <button
          type="button"
          onClick={() => toggle(id, !open)}
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 py-2 text-left text-ink-3 transition-colors duration-150 hover:text-ink-2"
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
              open && 'rotate-90',
            )}
          />
          {icon && <span className="shrink-0">{icon}</span>}
          <span className="text-[11px] font-medium uppercase tracking-wide">{title}</span>
          {/* Right of the title, so it reads as belonging to the section rather
              than to the last row of whatever is above it. */}
          {badge && <span className="ml-auto shrink-0">{badge}</span>}
        </button>
      </h2>
      {open && <div className="pb-3">{children}</div>}
    </section>
  )
}
