import { useEffect, useState } from 'react'
import { AlertCircle, Clock, Loader2, X } from 'lucide-react'
import { chats } from '@/rpc'
import { useSessions } from '@/stores/sessions'
import type { ScheduledTask } from '@/types'

/**
 * What this chat will do **after the turn ends** — the receipt for a promise the
 * agent made and then stopped talking.
 *
 * A turn is synchronous, so an agent cannot wait three minutes and look again.
 * When it wants to, it arms a `schedule_followup` on the pod and ends the turn
 * saying "I'll check back". Until that armed job had a surface here, a real
 * promise and an invented one read identically from the chat, and the only way
 * to tell them apart was to wait and see whether anything arrived. This strip is
 * that distinction, made visible: a countdown means the pod is holding the job,
 * and no countdown means nothing is coming.
 *
 * Placed above the composer rather than in the transcript on purpose. A pending
 * follow-up is not something that *happened* — it is a standing state of the
 * conversation, and it changes (ticks down, fires, is cancelled) after the
 * message that armed it has scrolled away.
 */
export function Followups({ instanceId }: { instanceId: string }) {
  const session = useSessions((s) => s.byInstance[instanceId])
  const refresh = useSessions((s) => s.refreshFollowups)
  const [now, setNow] = useState(() => Date.now())
  const [cancelling, setCancelling] = useState<string[]>([])

  const rows = (session?.followups ?? []).filter((t) => t.status !== 'failed' || isRecent(t, now))
  const anyPending = rows.some((t) => t.status === 'pending' || t.status === 'running')

  // One second, so the countdown is a countdown. Only while there is something
  // to count: an idle chat must not hold a timer open for nothing.
  useEffect(() => {
    if (!anyPending) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [anyPending])

  // The daemon fires a due job on its next poll tick and delivery arrives as a
  // turn, which already refreshes this. Re-asking anyway covers the case that
  // turn never comes — a job that failed, or fired against another device.
  useEffect(() => {
    if (!anyPending) return
    const id = setInterval(() => void refresh(instanceId), POLL_MS)
    return () => clearInterval(id)
  }, [anyPending, instanceId, refresh])

  if (rows.length === 0) return null

  async function cancel(id: string) {
    setCancelling((ids) => [...ids, id])
    try {
      await chats.cancelFollowup(id)
    } finally {
      // Refresh either way. A cancel that raced the daemon's tick lost, and the
      // pod's answer is the one worth showing.
      await refresh(instanceId)
      setCancelling((ids) => ids.filter((i) => i !== id))
    }
  }

  return (
    <ul className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-3 pb-1">
      {rows.map((task) => (
        <li
          key={task.id}
          className="animate-fade-up flex items-center gap-2.5 rounded-card border border-line bg-surface px-3 py-2 text-[12.5px] shadow-card"
        >
          {task.status === 'failed' ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red" />
          ) : task.status === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-2" />
          ) : (
            <Clock className="h-3.5 w-3.5 shrink-0 text-ink-2" />
          )}

          <div className="min-w-0 flex-1">
            <span className={task.status === 'failed' ? 'text-red' : 'font-medium'}>{lead(task, now)}</span>
            <span className="text-ink-2"> · </span>
            <span className="text-ink-2">{task.task}</span>
          </div>

          {task.status === 'pending' && (
            <button
              type="button"
              onClick={() => void cancel(task.id)}
              disabled={cancelling.includes(task.id)}
              aria-label="Cancel this follow-up"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink disabled:opacity-50"
            >
              {cancelling.includes(task.id) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** How often to re-ask the pod while something is pending. */
const POLL_MS = 15_000

/**
 * How long a failed follow-up stays on screen. It is news to someone still
 * waiting on the promise; an hour later the conversation has moved on and a
 * permanent red line in every chat that ever lost one is just noise. The pod
 * keeps them forever, so somebody has to draw this line.
 */
const FAILED_WINDOW_MS = 60 * 60 * 1000

function isRecent(task: ScheduledTask, now: number): boolean {
  const at = Date.parse(task.run_at)
  return Number.isFinite(at) && now - at < FAILED_WINDOW_MS
}

/** The bold half of the row: what the pod is doing about this job right now. */
function lead(task: ScheduledTask, now: number): string {
  if (task.status === 'failed') return 'Follow-up failed'
  if (task.status === 'running') return 'Following up now'
  const left = Date.parse(task.run_at) - now
  // `run_at` is a floor, not an appointment: the daemon claims due jobs on its
  // next poll tick. Counting into negative seconds would promise a precision
  // the pod does not have.
  if (!Number.isFinite(left) || left <= 0) return 'Following up any moment'
  return `Follows up in ${countdown(left)}`
}

/** `m:ss` under an hour, `Hh MMm` above — the shape you can read at a glance. */
export function countdown(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const minutes = Math.floor(total / 60)
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}
