import { useState } from 'react'
import { Activity, ChevronRight, Cpu, Hourglass, Loader2, Wrench } from 'lucide-react'
import { Drawer } from '@/components/ui/Drawer'
import { cn } from '@/lib/cn'
import { useTurnDebug } from '@/stores/turnDebug'
import { formatDuration, formatTokens, type TurnStep, type TurnTrace } from './turnTrace'
import type { PodSessionEvent } from '@/types'

/**
 * Where a turn's time went, and what was actually sent.
 *
 * The question this answers is the one the transcript cannot: a turn shows a
 * reply and a few tool cards, and says nothing about the four minutes between
 * them. Every number here is the pod's own measurement — its OTLP trace — not
 * something this client timed from the frames it happened to receive.
 *
 * Leads with the timeline because that is what a slow turn needs, and keeps the
 * raw session files below it for when the durations raise a question only a
 * payload can answer.
 */
export function DebugDrawer() {
  const { open, hide, loading, sessionId, turns, detail, notice } = useTurnDebug()

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && hide()}
      title="What the agent did"
      description={sessionId ?? undefined}
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the pod's record…
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {notice && (
            <p className="rounded-card bg-hover px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
              {notice}
            </p>
          )}
          {turns?.map((turn) => <Turn key={turn.id} turn={turn} />)}
          {detail && <RawFiles detail={detail} />}
        </div>
      )}
    </Drawer>
  )
}

function Turn({ turn }: { turn: TurnTrace }) {
  return (
    <section className="rounded-card border border-line">
      <header className="flex items-baseline gap-2.5 border-b border-line px-3.5 py-2.5">
        <span className="text-[12px] font-medium text-ink-3">Turn {turn.index}</span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{turn.message ?? ''}</span>
        <span
          className={cn(
            'tnum shrink-0 font-mono text-[12px]',
            turn.failed ? 'text-red' : 'text-ink-2',
          )}
        >
          {formatDuration(turn.durationMs)}
        </span>
      </header>

      <ol className="flex flex-col">
        {/* The prelude is first because it is the part with no span of its own:
            compaction, memory recall and prompt building, visible only as the gap
            before the first traced step. Naming it is the difference between a
            turn that "spent six minutes" and one that spent them compacting. */}
        <Row
          icon={<Hourglass className="h-3.5 w-3.5" />}
          label="Before the first model call"
          hint="compaction, memory recall, building the prompt"
          durationMs={turn.preludeMs}
          share={shareOf(turn.preludeMs, turn.durationMs)}
        />
        {turn.steps.map((step) => (
          <Step key={step.id} step={step} total={turn.durationMs} />
        ))}
      </ol>
    </section>
  )
}

function Step({ step, total }: { step: TurnStep; total: number }) {
  const tokens = step.tokens
  const hint = [
    tokens?.input !== undefined ? `${formatTokens(tokens.input)} in` : undefined,
    tokens?.output !== undefined ? `${formatTokens(tokens.output)} out` : undefined,
    tokens?.reasoning ? `${formatTokens(tokens.reasoning)} reasoning` : undefined,
    tokens?.cached ? `${formatTokens(tokens.cached)} cached` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Row
      icon={
        step.kind === 'tool' ? <Wrench className="h-3.5 w-3.5" /> : <Cpu className="h-3.5 w-3.5" />
      }
      label={step.label}
      hint={hint || undefined}
      detail={step.detail}
      durationMs={step.durationMs}
      share={shareOf(step.durationMs, total)}
      failed={step.failed}
    />
  )
}

/**
 * One line of the timeline: what it was, how long, and how much of the turn.
 *
 * The bar is proportional to the turn rather than to the longest step, so a
 * glance answers "what ate this turn" instead of "which of these was biggest" —
 * a turn with one dominant step should look like one dominant step.
 */
function Row({
  icon,
  label,
  hint,
  detail,
  durationMs,
  share,
  failed,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  detail?: string
  durationMs: number
  share: number
  failed?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const body = (
    <>
      <span className={cn('shrink-0', failed ? 'text-red' : 'text-ink-3')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[13px]">{label}</span>
          {hint && <span className="truncate font-mono text-[11px] text-ink-3">{hint}</span>}
        </span>
        <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-hover-2">
          <span
            className={cn('block h-full rounded-full', failed ? 'bg-red' : 'bg-accent')}
            style={{ width: `${Math.max(share * 100, 1)}%` }}
          />
        </span>
      </span>
      <span className="tnum shrink-0 self-start font-mono text-[12px] text-ink-2">
        {formatDuration(durationMs)}
      </span>
    </>
  )

  if (!detail) {
    return (
      <li className="flex items-start gap-2.5 px-3.5 py-2.5">
        <span className="w-3.5 shrink-0" />
        {body}
      </li>
    )
  }

  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-hover"
      >
        <ChevronRight
          className={cn(
            'mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        {body}
      </button>
      {expanded && <Payload text={detail} />}
    </li>
  )
}

/** Raw text from the pod, shown as it is — never parsed into a nicer shape that
 *  could be wrong about what was really sent. */
function Payload({ text }: { text: string }) {
  return (
    <pre className="mx-3.5 mb-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-card bg-field px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-2">
      {text}
    </pre>
  )
}

/**
 * The session's own files, under the timeline.
 *
 * Kept separate rather than folded into the turns above, because they do not
 * line up: the trace counts *user turns*, and these are written once per
 * executor step. Pretending a mapping that does not exist would put the wrong
 * prompt under the right heading, which is worse than a second list.
 */
function RawFiles({ detail }: { detail: { session_info?: unknown; timeline: PodSessionEvent[] } }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-card border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left hover:bg-hover"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <span className="text-[13px] font-medium">What was sent</span>
        <span className="text-[12px] text-ink-3">
          {detail.timeline.length} {detail.timeline.length === 1 ? 'file' : 'files'}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3.5 pb-3">
          {detail.session_info != null && (
            <File name="session_info.json" kind="config" data={detail.session_info} />
          )}
          {detail.timeline.map((event) => (
            <File key={event.file} name={event.file} kind={event.kind} data={event.data} />
          ))}
        </div>
      )}
    </section>
  )
}

function File({ name, kind, data }: { name: string; kind: string; data: unknown }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline gap-2 rounded-control py-1 text-left hover:bg-hover"
      >
        <span className="font-mono text-[11.5px]">{name}</span>
        <span className="text-[11px] text-ink-3">{kind}</span>
      </button>
      {open && <Payload text={JSON.stringify(data, null, 2)} />}
    </div>
  )
}

/** A step's share of its turn, clamped — a step can outlast a turn's own span by
 *  a hair when the turn is still open, and a bar past 100% reads as a bug. */
function shareOf(part: number, whole: number): number {
  if (!(whole > 0)) return 0
  return Math.min(part / whole, 1)
}

/** Exported for the header button: the drawer is worth opening for any agent. */
export function DebugButton({ instanceId, sessionId }: { instanceId: string; sessionId?: string }) {
  const show = useTurnDebug((s) => s.show)
  return (
    <button
      type="button"
      onClick={() => void show(instanceId, sessionId)}
      aria-label="What the agent did"
      title="What the agent did — timings, tokens, and what was sent"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink"
    >
      <Activity className="h-4 w-4" />
    </button>
  )
}
