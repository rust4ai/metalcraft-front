import { useEffect } from 'react'
import { AlertTriangle, CircleAlert, RotateCw, Trash2 } from 'lucide-react'
import { useDiagnostics, DIAG_POLL_MS } from '@/stores/diagnostics'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { Diagnostic } from '@/types'

/**
 * The error log.
 *
 * Everything that failed or quietly degraded this session, in one column,
 * newest first — including the failures that never reached the screen because
 * some pane caught them to stay alive.
 *
 * Two decisions carry the surface:
 *
 * **The message is the consequence, the detail is the exception.** A line reads
 * "the pod would not list its integrations, so Octaweave shows as not-installed"
 * and the `error decoding response body` sits folded underneath. The first is
 * what someone can act on; the second is what they paste into an issue.
 *
 * **Where it happened is shown, not hidden.** The source is the command name in
 * mono, because that is the string you grep the source for, and core entries say
 * so — "the app never heard about this" and "the core decided not to tell you"
 * are different bugs with the same symptom.
 */
export function ErrorLogView() {
  const { entries, loading, load, clear, markSeen } = useDiagnostics()

  // Opening the log is the moment its contents stop being news. Marking on
  // arrival rather than on the way out means the badge clears when you look,
  // which is what a badge is for.
  useEffect(() => {
    void load().then(markSeen)
  }, [load, markSeen])

  // Kept fresh while it is the thing on screen. The store polls slowly in the
  // background for the badge; a log someone is watching should not be that far
  // behind the core.
  useEffect(() => {
    const t = setInterval(() => void load().then(markSeen), DIAG_POLL_MS)
    return () => clearInterval(t)
  }, [load, markSeen])

  const errors = entries.filter((d) => d.level === 'error').length

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-baseline gap-3 px-8 pb-4 pt-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Error log</h1>
          <p className="text-sm text-ink-2">
            What failed, and what quietly worked around a failure, since this window opened.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
          <RotateCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void clear()} disabled={entries.length === 0}>
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>
      </header>

      {entries.length > 0 && (
        <p className="shrink-0 px-8 pb-3 text-[11.5px] text-ink-3">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          {errors > 0 && <span className="text-red"> · {errors} failed outright</span>}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {entries.length === 0 ? (
          <Empty />
        ) : (
          <ul className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {entries.map((d) => (
              <Entry key={d.id} diagnostic={d} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * Empty is the good state, and says so.
 *
 * A neutral "no entries" would leave someone wondering whether the log works.
 * The second line is the one that answers it.
 */
function Empty() {
  return (
    <div className="mx-auto max-w-3xl rounded-card bg-surface p-8 text-center shadow-card">
      <p className="text-[13px] text-ink-2">Nothing has gone wrong this session.</p>
      <p className="mt-1 text-[12px] text-ink-3">
        Failed commands land here on their own, along with anything the core worked around
        instead of reporting.
      </p>
    </div>
  )
}

function Entry({ diagnostic: d }: { diagnostic: Diagnostic }) {
  const bad = d.level === 'error'
  const Icon = bad ? CircleAlert : AlertTriangle

  return (
    <li className="rounded-card bg-surface px-3.5 py-3 shadow-hairline">
      <div className="flex items-start gap-2.5">
        <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', bad ? 'text-red' : 'text-orange')} />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-ink">{d.message}</p>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
            <span className="font-mono">{d.source}</span>
            {/* Silent about the common case: a "1" on every line is a column of
                noise that means nothing. */}
            {d.count > 1 && (
              <span className="tnum rounded-chip bg-inset px-1.5 py-px" title="times this happened">
                ×{d.count}
              </span>
            )}
            {d.origin === 'core' && (
              <span
                className="rounded-chip bg-inset px-1.5 py-px"
                title="recorded by the core — it handled this rather than returning it"
              >
                core
              </span>
            )}
            <span className="tnum ml-auto" title={new Date(d.at).toLocaleString()}>
              {new Date(d.at).toLocaleTimeString()}
            </span>
          </div>

          {/* Folded, because the exception is for the second question. Native
              <details> so it is keyboard-reachable and text-selectable without
              this component owning any open/closed state. */}
          {d.detail && (
            <details className="group mt-1.5">
              <summary className="cursor-pointer list-none text-[11px] text-ink-3 hover:text-ink-2">
                <span className="group-open:hidden">Show detail</span>
                <span className="hidden group-open:inline">Hide detail</span>
              </summary>
              <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words rounded-chip bg-inset px-2.5 py-2 font-mono text-[11px] text-ink-2">
                {d.detail}
              </pre>
            </details>
          )}
        </div>
      </div>
    </li>
  )
}
