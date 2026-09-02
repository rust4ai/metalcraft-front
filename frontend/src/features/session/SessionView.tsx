import { useEffect, useRef } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { phaseLabel, type ToolCard, type TranscriptItem } from './transcript'
import { useSessions } from '@/stores/sessions'
import { useUi } from '@/stores/ui'
import { Trace } from './Trace'
import { Composer } from './Composer'
import { Followups } from './Followups'
import { ModeTabs } from './ModeTabs'
import { RunsPanel } from './RunsPanel'
import { MemoryPanel } from './MemoryPanel'
import { SchedulesPanel } from './SchedulesPanel'
import { LoadingState } from '@/components/ui/LoadingState'
import { Linkified } from '@/components/ui/Linkified'
import { groupIntoBlocks } from './blocks'
import { cn } from '@/lib/cn'
import type { PlanStep } from '@/types'

/** PLAN §10.2 — one conversation with one agent instance. */
export function SessionView({ instanceId }: { instanceId: string }) {
  const { byInstance, open, submit, stop } = useSessions()
  const mode = useUi((s) => s.sessionMode[instanceId] ?? 'chat')
  const session = byInstance[instanceId]

  // Opened on mount, and again whenever the session is *missing* — not only the
  // first time. A mount-only open has no way back: the transcript lives in the
  // store, so anything that drops the entry (a close, a reset, a hot reload in
  // dev) left this pane rendering an empty list for ever, while the agent went
  // on running turns nobody could see. `open` is a no-op when a session is
  // already there or already on its way, so this cannot loop.
  const missing = !session
  useEffect(() => {
    if (missing) void open(instanceId)
  }, [instanceId, missing, open])

  return (
    <div className="flex h-full flex-col">
      <ModeTabs instanceId={instanceId} />

      {/* The session is opened, and its stream kept alive, whichever mode is on
          screen: a turn that lands while you are reading the trace must still be
          in the transcript when you come back to it. Only the *view* switches. */}
      {mode === 'runs' ? (
        <RunsPanel instanceId={instanceId} />
      ) : mode === 'memory' ? (
        <MemoryPanel instanceId={instanceId} />
      ) : mode === 'schedules' ? (
        <SchedulesPanel instanceId={instanceId} />
      ) : (
        <Chat
          instanceId={instanceId}
          onSend={(m) => void submit(instanceId, m)}
          onStop={() => void stop(instanceId)}
        />
      )}
    </div>
  )
}

/** The conversation itself — the `chat` mode, and what this view was before the
 *  others were pulled out of the rail and the debug drawer. */
function Chat({
  instanceId,
  onSend,
  onStop,
}: {
  instanceId: string
  onSend: (message: string) => void
  onStop: () => void
}) {
  const { byInstance, opening } = useSessions()
  const session = byInstance[instanceId]
  const bottom = useRef<HTMLDivElement>(null)

  // Follow the tail as frames land. Cheap and correct while transcripts are
  // short; virtualization comes with the long ones.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [session?.transcript.items.length, session?.transcript.thinking])

  const busy = session?.transcript.busy ?? false
  const stopping = session?.stopping ?? false
  const phase = session?.transcript.phase
  const items = session?.transcript.items ?? []
  const lastItemId = items.at(-1)?.id

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {opening[instanceId] && !session ? (
          <div className="flex items-center gap-2 text-sm text-ink-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening the conversation…
          </div>
        ) : session?.error ? (
          <Problem message={session.error} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {/* Never nothing. An empty pane with no sentence in it is
                indistinguishable from a broken one — which is exactly how this
                view failed before: a dropped session rendered as blank forever,
                with a perfectly healthy agent behind it. */}
            {!busy && (session?.transcript.items.length ?? 0) === 0 && (
              <p className="mx-auto max-w-[85%] text-center text-[12px] leading-relaxed text-ink-3">
                {session
                  ? 'Nothing in this conversation yet. Send a message to start it.'
                  : 'Reconnecting to this conversation…'}
              </p>
            )}
            {groupIntoBlocks(session?.transcript.items ?? []).map((block) =>
              block.kind === 'tools' ? (
                <Trace key={block.id} cards={block.cards} />
              ) : (
                <Item
                  key={block.item.id}
                  item={block.item}
                  /* Only the newest question is still open. Chips on an
                     answered one would offer to re-answer something the
                     conversation has already moved past. */
                  live={block.item.id === lastItemId && !busy}
                  onAnswer={onSend}
                />
              ),
            )}
            {/* Only ever one waiting indicator, and never alongside output.
                Keyed by phase so the counter restarts with each one: "Compacting
                context 40.2s" is the sentence that explains a long turn, and a
                counter that keeps running across phases cannot say it.

                Shown while stopping even when the agent is inside a tool call,
                where there is otherwise no waiting indicator at all: a press
                that leaves the screen exactly as it was is indistinguishable
                from a button that does nothing, which is how this read for the
                whole time a delegated sub-agent kept working through it. */}
            {/* The plan, above the waiting indicator: it answers "what is it
                doing" at a coarser grain than the spinner, and it is only ever
                the current turn's. */}
            {(session?.transcript.plan.length ?? 0) > 0 && (
              <PlanList steps={session!.transcript.plan} />
            )}
            {/* Sent, not started. After everything else, because that is where
                it will land once the pod takes it up. */}
            {(session?.transcript.queued ?? []).map((message, i) => (
              <QueuedMessage key={`q${i}-${message}`} content={message} />
            ))}
            {(session?.transcript.thinking || stopping) && (
              <LoadingState key={phase ?? 'busy'} label={stopping ? 'Stopping' : phaseLabel(phase)} />
            )}
            <div ref={bottom} />
          </div>
        )}
      </div>

      {/* Above the composer, outside the scroller: a pending follow-up is a
          standing state of the conversation, not something that happened at a
          point in the transcript. */}
      <Followups instanceId={instanceId} />
      <Composer
        instanceId={instanceId}
        busy={busy}
        stopping={stopping}
        onSend={onSend}
        onStop={onStop}
      />
    </>
  )
}

function Item({
  item,
  live,
  onAnswer,
}: {
  item: Exclude<TranscriptItem, ToolCard>
  /** This is the last thing in the transcript and no turn is running — so a
   *  question here is the one actually waiting on the user. */
  live?: boolean
  onAnswer?: (message: string) => void
}) {
  if (item.kind === 'user') {
    return (
      // Quiet, and deliberately. The agent's answer is the page; the user's
      // line is the prompt for it. A saturated accent bubble made the thing you
      // already know the loudest object in the transcript, and pushed the reply
      // you are actually reading into second place.
      <div className="animate-fade-up max-w-[80%] self-end whitespace-pre-wrap rounded-card rounded-br-chip bg-hover-2 px-3 py-1.5 text-[13px] text-ink">
        <Linkified text={item.content} linkClassName="underline" />
      </div>
    )
  }
  if (item.kind === 'notice') {
    // This client talking, not the agent — centred and quiet, so it never reads
    // as something the agent said.
    return (
      <div className="animate-fade-up mx-auto max-w-[85%] whitespace-pre-wrap text-center text-[12px] leading-relaxed text-ink-3">
        <Linkified text={item.content} />
      </div>
    )
  }
  if (item.kind === 'reply') {
    // Markdown rendering lands with the rest of the P4 polish; the text is the
    // agent's actual reply either way, so it ships readable rather than pending.
    // Bare URLs are the exception, because a reply that ends "preview:
    // https://…" is *only* useful if that is something you can click.
    const choices = live && item.options?.length ? item.options : []
    return (
      <div className="animate-stream-in flex flex-col gap-2.5">
        {/* `leading-relaxed` stays while everything around it tightens: density
            must not be bought from the one surface people actually read. */}
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
          <Linkified text={item.content} />
        </div>
        {choices.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {choices.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => onAnswer?.(choice)}
                className="rounded-full border border-line px-3 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-ink"
              >
                {choice}
              </button>
            ))}
          </div>
        )}
        {/* The options are a shortcut, never the whole answer space — say so,
            or a question with chips reads as multiple-choice. */}
        {choices.length > 0 && (
          <p className="text-[11.5px] text-ink-3">Or answer in your own words below.</p>
        )}
      </div>
    )
  }
  if (item.kind === 'reset') {
    return <ResetDivider at={item.at} reason={item.reason} />
  }
  if (item.kind === 'turnEnd') {
    return <TurnReceipt tools={item.tools} elapsedMs={item.elapsedMs} />
  }
  return <Problem message={item.message} code={item.code} retryable={item.retryable} />
}

/**
 * What the turn cost, under the reply it paid for.
 *
 * The reference reads `7.8k in · 155 out · 35.8s · 3 tool calls`. The token
 * halves are absent here and that is not an oversight: the chat stream carries
 * no token counts — they exist only in the pod's OTLP trace, which the Runs mode
 * reads. Printing a number this client does not have would be the exact lie the
 * plan's §0 is about, so the receipt says the two things it can stand behind.
 *
 * The elapsed time is wall clock between the turn's first and last frame — what
 * the person actually waited — not the sum of the pod's traced durations, which
 * would report twelve seconds for a turn that spent thirty of them compacting.
 * Where those thirty went is a question Runs answers.
 */
function TurnReceipt({ tools, elapsedMs }: { tools: number; elapsedMs: number }) {
  const secs = elapsedMs / 1000
  const time = secs < 60 ? `${secs.toFixed(1)}s` : `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`
  return (
    <p className="tnum -mt-1 text-[10.5px] text-ink-3">
      {tools > 0 && <>{tools} tool{tools === 1 ? '' : 's'} · </>}
      {time}
    </p>
  )
}

/**
 * The line where the agent's context ended.
 *
 * A rule rather than a bubble, because it is not something anyone said — it is a
 * fact about the conversation, and drawing it as a message would put words in
 * the agent's mouth. Everything above it stays readable; the agent simply cannot
 * see any of it any more, and this is the only place that is stated.
 */
/** A message the pod has taken but not started.
 *
 *  Deliberately the user bubble's shape, dimmed and dashed rather than a
 *  different kind of thing: it *is* their message, and it is about to be exactly
 *  that. Anything more decorative would read as an error. */
function QueuedMessage({ content }: { content: string }) {
  return (
    <div className="animate-fade-up flex max-w-[85%] flex-col items-end gap-1 self-end">
      <div className="whitespace-pre-wrap rounded-card rounded-br-sm border border-dashed border-line px-3.5 py-2 text-[13.5px] text-ink-3">
        {content}
      </div>
      <span className="text-[11px] text-ink-3">Queued — the agent is still working</span>
    </div>
  )
}

/** The agent's plan for this turn, as a checklist.
 *
 *  The one part of an agent's reasoning that is already structured, so the one
 *  part worth drawing rather than paraphrasing: "on step 3 of 5" is a different
 *  experience from a spinner. */
function PlanList({ steps }: { steps: PlanStep[] }) {
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const marker = (status: PlanStep['status']) =>
    status === 'done' ? '✓' : status === 'skipped' ? '–' : status === 'in_progress' ? '▸' : '○'
  return (
    <div className="rounded-card border border-line px-3.5 py-3 text-[13px]">
      <div className="mb-2 text-[11.5px] uppercase tracking-wide text-ink-3">
        Plan · {done}/{steps.length}
      </div>
      <ol className="flex flex-col gap-1.5">
        {steps.map((step, i) => (
          <li key={`${i}-${step.step}`} className="flex gap-2">
            <span className="mt-[1px] shrink-0 text-ink-3">{marker(step.status)}</span>
            <span
              className={cn(
                'min-w-0',
                (step.status === 'done' || step.status === 'skipped') && 'text-ink-3 line-through',
                step.status === 'in_progress' && 'text-ink',
                step.status === 'pending' && 'text-ink-2',
              )}
            >
              {step.step}
              {step.persona && <span className="text-ink-3"> · {step.persona}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ResetDivider({ at, reason }: { at: string; reason: string }) {
  const when = new Date(at)
  // The timestamp is the useful half when scrolling back through a long thread,
  // so it is kept when the string parses and dropped silently when it does not.
  const label = Number.isNaN(when.getTime())
    ? reason
    : `${reason} · ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  return (
    <div className="animate-fade-up flex items-center gap-2.5 py-0.5" role="separator" aria-label={`Context reset ${label}`}>
      <span className="h-px flex-1 bg-accent/35" />
      <span className="shrink-0 text-[11px] font-medium text-accent">{label}</span>
      <span className="h-px flex-1 bg-accent/35" />
    </div>
  )
}

/**
 * A turn failure, rendered as itself. The agent classifies these (out of
 * credits, not premium, provider refusal), so the user gets the sentence that
 * was written for them rather than a provider error chain.
 */
function Problem({ message, code, retryable }: { message: string; code?: string; retryable?: boolean }) {
  return (
    <div className="flex gap-2.5 rounded-card border border-red/30 bg-red/5 px-3.5 py-3 text-sm">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red" />
      <div className="min-w-0">
        <p className="text-ink">{message}</p>
        {code && (
          <p className="mt-1 text-xs text-ink-3">
            {code}
            {retryable ? ' · worth trying again' : ''}
          </p>
        )}
      </div>
    </div>
  )
}
