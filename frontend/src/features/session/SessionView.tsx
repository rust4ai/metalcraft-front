import { useEffect, useRef } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import type { ToolCard, TranscriptItem } from './transcript'
import { useSessions } from '@/stores/sessions'
import { useFleet } from '@/stores/fleet'
import { StatusDot } from '@/components/ui/StatusDot'
import { Trace } from './Trace'
import { Composer } from './Composer'
import { LoadingState } from '@/components/ui/LoadingState'
import { groupIntoBlocks } from './blocks'

/** PLAN §10.2 — one conversation with one agent instance. */
export function SessionView({ instanceId }: { instanceId: string }) {
  const { byInstance, opening, open, send } = useSessions()
  const instance = useFleet((s) => s.instances.find((i) => i.id === instanceId))
  const session = byInstance[instanceId]
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void open(instanceId)
  }, [instanceId, open])

  // Follow the tail as frames land. Cheap and correct while transcripts are
  // short; virtualization comes with the long ones.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [session?.transcript.items.length, session?.transcript.thinking])

  const busy = session?.transcript.busy ?? false

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <StatusDot status={busy ? (session?.transcript.thinking ? 'thinking' : 'running') : 'idle'} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{instance?.name ?? 'Agent'}</div>
          <div className="truncate text-xs text-ink-2">
            {instance ? `${instance.agent_preset} · ${instance.persona}` : ''}
          </div>
        </div>
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
            {groupIntoBlocks(session?.transcript.items ?? []).map((block) =>
              block.kind === 'tools' ? (
                <Trace key={block.id} cards={block.cards} />
              ) : (
                <Item key={block.item.id} item={block.item} />
              ),
            )}
            {/* Only ever one waiting indicator, and never alongside output. */}
            {session?.transcript.thinking && <LoadingState label="Thinking" />}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <Composer busy={busy} onSend={(m) => void send(instanceId, m)} />
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
