import { cn } from '@/lib/cn'

/**
 * Label/value rows and the headings above them.
 *
 * Lifted out of `RightRail` when the memory and schedule panels moved to session
 * modes (HARNESS_UI_PLAN H2/H3): the rail and the panels are the same kind of
 * reading — a column of facts about one agent — and two private copies of these
 * three components would drift the moment either side was tuned.
 */

/** A label/value pair. `mono` marks machine-owned values, per index.css: ids,
 *  paths, versions, model names — anything the user did not phrase. */
export function Row({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  // An absent value renders nothing at all rather than an empty row. A rail of
  // labels with blanks beside them reads as a failed load.
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[11px] text-ink-3">{label}</span>
      <span
        className={cn(
          'min-w-0 truncate text-right text-[11.5px] text-ink-2',
          mono && 'font-mono text-[11px]',
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-3">
      <h2 className="pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">{title}</h2>
      {children}
    </section>
  )
}

/** Nothing to show, said in a sentence. Never an empty box — a blank pane is
 *  indistinguishable from a broken one. */
export function Empty({ text }: { text: string }) {
  if (!text) return null
  return <p className="px-0.5 py-3 text-[11.5px] leading-relaxed text-ink-3">{text}</p>
}
