import { useEffect, useRef } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { phaseLabel, type ToolCard, type TranscriptItem } from './transcript'
import { useSessions } from '@/stores/sessions'
import { useFleet } from '@/stores/fleet'
import { StatusDot } from '@/components/ui/StatusDot'
import { Trace } from './Trace'
import { Composer } from './Composer'
import { Followups } from './Followups'
import { DebugButton, DebugDrawer } from './DebugDrawer'
import { LoadingState } from '@/components/ui/LoadingState'
import { groupIntoBlocks } from './blocks'
import { EditableName } from '@/features/fleet/EditableName'

/** PLAN §10.2 — one conversation with one agent instance. */
export function SessionView({ instanceId }: { instanceId: string }) {
  const { byInstance, opening, open, submit, stop } = useSessions()
  const instance = useFleet((s) => s.instances.find((i) => i.id === instanceId))
  const session = byInstance[instanceId]
  const bottom = useRef<HTMLDivElement>(null)

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

  // Follow the tail as frames land. Cheap and correct while transcripts are
  // short; virtualization comes with the long ones.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [session?.transcript.items.length, session?.transcript.thinking])

  const busy = session?.transcript.busy ?? false
  const stopping = session?.stopping ?? false
  const phase = session?.transcript.phase

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <StatusDot status={busy ? (session?.transcript.thinking ? 'thinking' : 'running') : 'idle'} />
        <div className="min-w-0 flex-1">
          {/* The name is the user's to set, and this is where they are looking
              when they decide the agent deserves a better one. */}
          {instance ? (
            <EditableName instance={instance} className="-ml-1.5 text-sm font-medium" />
          ) : (
            <div className="truncate text-sm font-medium">Agent</div>
          )}
          <div className="truncate text-xs text-ink-2">
            {instance ? `${instance.agent_preset} · ${instance.persona}` : ''}
          </div>
        </div>
        {/* Opened against the live turn when there is one, and against this
            agent's last recorded run when there is not — which is when someone
            comes looking, after something already took too long. */}
        <DebugButton instanceId={instanceId} sessionId={session?.transcript.sessionId} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
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
                <Item key={block.item.id} item={block.item} />
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
      <DebugDrawer />
      <Composer
        busy={busy}
        stopping={stopping}
        onSend={(m) => void submit(instanceId, m)}
        onStop={() => void stop(instanceId)}
      />
    </div>
  )
}

function Item({ item }: { item: Exclude<TranscriptItem, ToolCard> }) {
  if (item.kind === 'user') {
    return (
      <div className="animate-fade-up max-w-[85%] self-end whitespace-pre-wrap rounded-card rounded-br-sm bg-accent px-3.5 py-2 text-[13.5px] text-accent-ink">
        {item.content}
      </div>
    )
  }
  if (item.kind === 'notice') {
    // This client talking, not the agent — centred and quiet, so it never reads
    // as something the agent said.
    return (
      <div className="animate-fade-up mx-auto max-w-[85%] whitespace-pre-wrap text-center text-[12px] leading-relaxed text-ink-3">
        {item.content}
      </div>
    )
  }
  if (item.kind === 'reply') {
    // Markdown rendering lands with the rest of the P4 polish; the text is the
    // agent's actual reply either way, so it ships readable rather than pending.
    return (
      <div className="animate-stream-in whitespace-pre-wrap text-[13.5px] leading-relaxed">{item.content}</div>
    )
  }
  return <Problem message={item.message} code={item.code} retryable={item.retryable} />
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
