import {
  AlertTriangle,
  Bot,
  GraduationCap,
  Loader2,
  Lock,
  Package,
  Puzzle,
  UserRound,
  Workflow,
  Wrench,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useLibrary } from '@/stores/library'
import { cn } from '@/lib/cn'
import { KIND_LABEL, refKey, type ArtifactKind, type Ref } from './refs'

/** One glyph per artifact kind, used by the index, the breadcrumb and every
 *  chip — so a persona looks like a persona wherever it turns up. */
export function KindIcon({ kind, className }: { kind: ArtifactKind; className?: string }) {
  const cls = cn('h-4 w-4', className)
  switch (kind) {
    case 'preset':
      return <Bot className={cls} />
    case 'persona':
      return <UserRound className={cls} />
    case 'skill':
      return <GraduationCap className={cls} />
    case 'integration':
      return <Puzzle className={cls} />
    case 'tool':
      return <Wrench className={cls} />
    case 'pack':
      return <Package className={cls} />
    case 'template':
      return <Workflow className={cls} />
  }
}

/**
 * A reference to another artifact, rendered as something you can press.
 *
 * This component is the library. Everywhere else in the app a preset's skill
 * list is six grey chips; here each one is the address of a page, and the only
 * difference is that something knew what kind of thing the string named.
 *
 * `missing` is not a disabled state. A preset can name a persona this pod does
 * not have, and the chip still opens — onto the pod's own 404, which says which
 * artifact is absent. Greying it out would hide the more useful half: *why*.
 */
export function RefChip({
  to,
  label,
  missing,
  className,
}: {
  to: Ref
  label?: string
  missing?: boolean
  className?: string
}) {
  const open = useLibrary((s) => s.open)
  return (
    <button
      type="button"
      onClick={() => void open(to)}
      // The visible text is a bare slug. Read aloud, "plan-a-menu" says nothing
      // about what pressing it does — the kind is the half that makes it a link
      // rather than a word, so it goes in the accessible name and not only in
      // the tooltip.
      aria-label={`${KIND_LABEL[to.kind].one} · ${to.id}${missing ? ' — not on this pod' : ''}`}
      title={`${KIND_LABEL[to.kind].one} · ${to.id}`}
      className={cn(
        'group inline-flex max-w-full items-center gap-1.5 rounded-chip px-2 py-1 text-[11.5px] transition-colors duration-150',
        missing
          ? 'bg-orange-tint text-ink-2 hover:brightness-95'
          : 'bg-inset text-ink-2 hover:bg-hover-2 hover:text-ink',
        className,
      )}
    >
      <KindIcon kind={to.kind} className="h-3.5 w-3.5 shrink-0 text-ink-3 group-hover:text-ink-2" />
      <span className="truncate font-mono text-[11px]">{label ?? to.id}</span>
      {missing && <AlertTriangle className="h-3 w-3 shrink-0 text-orange" />}
    </button>
  )
}

/** A row of references of one kind. Renders nothing when the list is empty —
 *  except when `empty` gives it something worth saying instead. */
export function RefChips({
  kind,
  ids,
  title,
  hint,
  empty,
  missing,
}: {
  kind: ArtifactKind
  ids?: string[] | null
  title?: string
  hint?: ReactNode
  empty?: string
  /** Ids this pod could not resolve — marked, never hidden. */
  missing?: Set<string>
}) {
  const list = ids ?? []
  if (list.length === 0 && !empty) return null
  return (
    <Section title={title ?? KIND_LABEL[kind].many} count={list.length} hint={hint}>
      {list.length === 0 ? (
        <p className="text-[12.5px] text-ink-3">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map((id) => (
            <RefChip key={id} to={{ kind, id }} missing={missing?.has(id)} />
          ))}
        </div>
      )}
    </Section>
  )
}

export function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string
  count?: number
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="pt-5">
      <div className="flex items-baseline gap-2 pb-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{title}</h3>
        {count !== undefined && count > 0 && (
          <span className="tnum text-[11px] text-ink-3">{count}</span>
        )}
        {hint && <span className="ml-auto text-[11px] text-ink-3">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

/** A labelled fact. Values are mono because most of them are identifiers. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10.5px] uppercase tracking-wide text-ink-3">{label}</span>
      <span className="truncate text-[12.5px] text-ink">{children}</span>
    </div>
  )
}

/** Facts laid out in a row that wraps. */
export function Facts({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-card bg-inset px-4 py-3">{children}</div>
}

/**
 * Where an artifact came from.
 *
 * `pack_id` present means an integration or an agent pack shipped it and the pod
 * will refuse to edit it; absent means somebody wrote it here. Worth saying on
 * every show page, because it is the difference between "change this" and
 * "update the pack that provides it".
 */
export function Provenance({ packId, readOnly }: { packId?: string | null; readOnly?: boolean }) {
  if (!packId) {
    return (
      <span className="text-[11.5px] text-ink-3">
        Authored on this pod{readOnly ? '' : ' · editable'}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
      Provided by
      <RefChip to={{ kind: 'integration', id: packId }} />
      {readOnly && (
        <span className="flex items-center gap-1" title="Pack-provided; the pod refuses writes">
          <Lock className="h-3 w-3" /> read-only
        </span>
      )}
    </span>
  )
}

/**
 * The state a show page is in before it has anything to show.
 *
 * The error branch prints the pod's own message rather than "not found",
 * because the interesting case here is a *dangling reference* — a preset naming
 * a persona nobody installed — and the pod's sentence names the artifact while
 * a generic one would leave the reader wondering which link was broken.
 */
export function DetailState({ refTo }: { refTo: Ref }) {
  const error = useLibrary((s) => s.errors[refKey(refTo)])
  if (error) {
    return (
      <div className="mx-auto mt-6 flex max-w-3xl gap-2 rounded-card bg-red-tint px-4 py-3 text-[12.5px] text-ink-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red" />
        <div className="min-w-0">
          <p className="font-medium text-ink">
            This pod has no {KIND_LABEL[refTo.kind].one.toLowerCase()} called{' '}
            <span className="font-mono">{refTo.id}</span>.
          </p>
          <p className="mt-1 break-words text-ink-3">{error}</p>
        </div>
      </div>
    )
  }
  return (
    <p className="flex items-center gap-2 px-8 py-10 text-[13px] text-ink-3">
      <Loader2 className="h-4 w-4 animate-spin" /> Reading {refTo.id}…
    </p>
  )
}

/** A document this app displays but does not own — a tool's request template, a
 *  pack's manifest, a flow's graph. Shown as what it is rather than flattened
 *  into fields that would go stale the moment the pod adds one. */
export function Json({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-card bg-inset px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function Note({ tone, children }: { tone: 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex gap-2 rounded-chip px-2.5 py-2 text-[11.5px] text-ink-2',
        tone === 'warn' && 'bg-orange-tint',
        tone === 'bad' && 'bg-red-tint',
        tone === 'info' && 'bg-inset',
      )}
    >
      {tone !== 'info' && (
        <AlertTriangle
          className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone === 'warn' ? 'text-orange' : 'text-red')}
        />
      )}
      <span className="min-w-0">{children}</span>
    </div>
  )
}

/** The masthead every show page opens with. */
export function ShowHeader({
  kind,
  title,
  subtitle,
  badges,
  children,
}: {
  kind: ArtifactKind
  title: string
  subtitle?: ReactNode
  badges?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="flex items-start gap-3.5">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-card bg-inset text-ink-2">
        <KindIcon kind={kind} className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          {badges}
        </div>
        {subtitle && <div className="mt-0.5 text-[12.5px] text-ink-2">{subtitle}</div>}
        {children}
      </div>
    </header>
  )
}

/** A small pill for a fact that is not a link — a version, a role, a state. */
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'accent'
}) {
  return (
    <span
      className={cn(
        'rounded-chip px-1.5 py-0.5 text-[10.5px]',
        tone === 'neutral' && 'bg-inset text-ink-3',
        tone === 'good' && 'bg-green-tint text-green',
        tone === 'warn' && 'bg-orange-tint text-orange',
        tone === 'accent' && 'bg-accent-tint text-ink-2',
      )}
    >
      {children}
    </span>
  )
}
