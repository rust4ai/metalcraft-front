import { useEffect } from 'react'
import { useSessions } from '@/stores/sessions'
import { fillOf, percentLabel, thresholdOf, useUsage } from '@/stores/usage'
import { cn } from '@/lib/cn'
import type { ChatContext } from '@/types'

/**
 * The context readout (HARNESS_UI_PLAN §4, H5), at two sizes.
 *
 * The reference puts a `<1%` ring in its window bar and again in its composer.
 * Here it means what the same glyph means there — how full the open
 * conversation's context is — and the account's credits stay in the status bar,
 * because "can this conversation keep going" and "can this account afford it"
 * are different questions and one ring cannot answer both.
 */

/**
 * Read the open chat's context, and re-read it when a turn ends.
 *
 * Not on a timer: nothing changes the size of a conversation except a turn, so
 * polling would be a request per interval to learn nothing. `busy` going false
 * is the exact edge where the number is stale.
 */
function useChatUsage(instanceId: string | undefined) {
  const session = useSessions((s) => (instanceId ? s.byInstance[instanceId] : undefined))
  const chatId = session?.chatId
  const busy = session?.transcript.busy ?? false
  const load = useUsage((s) => s.load)
  const context = useUsage((s) => (chatId ? s.byChat[chatId] : undefined))
  const failed = useUsage((s) => (chatId ? s.failed[chatId] : undefined))

  useEffect(() => {
    // The dependency on `busy` is the point: false on mount reads once, and
    // every later true→false transition re-reads.
    if (chatId && !busy) void load(chatId)
  }, [chatId, busy, load])

  return { context, failed: Boolean(failed) }
}

/**
 * A donut, sized by its container's font.
 *
 * Silent when there is no number — a pod too old for `chat_context`, or a view
 * with no conversation behind it, shows nothing rather than an empty ring. An
 * empty ring is a claim that the conversation is empty.
 */
export function UsageRing({ instanceId, className }: { instanceId?: string; className?: string }) {
  const { context, failed } = useChatUsage(instanceId)
  const fill = fillOf(context)
  if (failed || fill === null || !context) return null

  const past = thresholdOf(context)
  const hot = past !== null && fill >= past

  // 2πr for r = 7, so the dash length can be written as a fraction of it.
  const C = 43.98
  return (
    <span
      className={cn('flex shrink-0 items-center gap-1 text-[11px] text-ink-3', className)}
      title={describe(context)}
    >
      <svg viewBox="0 0 18 18" className="h-3.5 w-3.5 -rotate-90" aria-hidden>
        <circle cx="9" cy="9" r="7" fill="none" strokeWidth="2.5" className="stroke-hover-2" />
        <circle
          cx="9"
          cy="9"
          r="7"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${(fill * C).toFixed(2)} ${C}`}
          className={cn(hot ? 'stroke-orange' : 'stroke-ink-2')}
        />
      </svg>
      <span className="tnum">{percentLabel(fill)}</span>
    </span>
  )
}

/**
 * The Inspector's version: a bar with the compaction point marked, and the facts
 * under it.
 *
 * Marking the threshold is most of the value. A bar at 48% means nothing on its
 * own; a bar at 48% with a tick at 60% says "two more exchanges and this gets
 * summarized", which is the thing someone can actually act on.
 */
export function UsageMeter({ instanceId }: { instanceId: string }) {
  const { context, failed } = useChatUsage(instanceId)
  const fill = fillOf(context)

  if (failed) return <Note text="This pod does not report what a conversation costs." />
  if (fill === null || !context) return <Note text="No conversation open yet." />

  const past = thresholdOf(context)
  const hot = past !== null && fill >= past

  return (
    <>
      <div className="relative mb-2 h-1.5 w-full overflow-hidden rounded-full bg-hover-2">
        <div
          className={cn('h-full rounded-full', hot ? 'bg-orange' : 'bg-ink-2')}
          style={{ width: `${(fill * 100).toFixed(1)}%` }}
        />
        {past !== null && past < 1 && (
          <span
            className="absolute top-0 h-full w-px bg-ink-3"
            style={{ left: `${(past * 100).toFixed(1)}%` }}
            aria-hidden
          />
        )}
      </div>

      <Fact label="Used" value={`${percentLabel(fill)} of the window`} />
      <Fact label="Estimated" value={`~${compact(context.estimated_tokens)} tokens`} />
      <Fact label="Window" value={compact(context.context_window)} />
      <Fact label="Messages" value={String(context.message_count)} />
      <Fact
        label="Compacts at"
        value={past === null ? '—' : `${percentLabel(past)}${context.would_compact ? ' · next turn' : ''}`}
      />

      {/* Said plainly rather than hidden in a tooltip: every number above is
          derived from the pod's ~4-chars-per-token estimate, and someone
          reconciling this against a provider bill needs to know that. */}
      <p className="pt-2 text-[10.5px] leading-relaxed text-ink-3">
        Estimated by the pod at roughly four characters per token — the same
        figure its automatic compaction uses, not a billed count.
      </p>
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[11px] text-ink-3">{label}</span>
      <span className="tnum min-w-0 truncate text-right text-[11.5px] text-ink-2">{value}</span>
    </div>
  )
}

function Note({ text }: { text: string }) {
  return <p className="py-1 text-[11.5px] leading-relaxed text-ink-3">{text}</p>
}

/** `1.2k`, `128k` — these are read for magnitude, never for their last digit. */
function compact(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`
}

function describe(context: ChatContext): string {
  const fill = fillOf(context)
  const pct = fill === null ? '—' : percentLabel(fill)
  return `Context ${pct} full — about ${compact(context.estimated_tokens)} of ${compact(
    context.context_window,
  )} tokens, estimated. ${context.would_compact ? 'Will compact on the next turn.' : ''}`.trim()
}
