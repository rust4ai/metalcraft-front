import { AlertTriangle, ArrowRight, Check, Snowflake } from 'lucide-react'
import { usePacks } from '@/stores/packs'
import { Button } from '@/components/ui/Button'
import type { PackUpdateReport } from '@/types'

/**
 * What an update did to the agents already made from a pack.
 *
 * The pod reconciles them — an agent whose persona the new version withdrew is
 * moved to the preset's default, one whose preset was withdrawn keeps running
 * from a frozen copy — and reports every one it touched. Nothing in the desktop
 * had ever read that report, so the reconciliation was real and invisible: the
 * agent you talk to every day could change persona and the only evidence was in
 * an HTTP response nobody kept.
 *
 * Shown only when there is something to say. An update that touched no live agent
 * gets no dialog, because a modal that is usually empty is one people learn to
 * dismiss unread — including the time it was not empty.
 */
export function UpdateReportDialog() {
  const { report, dismissReport } = usePacks()
  if (!report) return null

  return (
    <>
      {/* eslint-disable-next-line */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
        onClick={dismissReport}
        role="presentation"
      />
      <div
        role="dialog"
        aria-label={`${report.id} updated`}
        className="animate-fade-up fixed left-1/2 top-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-page shadow-overlay"
      >
        <header className="border-b border-line px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Check className="h-4 w-4 text-green" />
            {report.id} updated
          </div>
          <p className="mt-1 tnum text-[11.5px] text-ink-3">
            v{report.from_version} <ArrowRight className="inline h-3 w-3" /> v{report.to_version}
          </p>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <p className="text-[12.5px] text-ink-2">
            {summarize(report)} Learned memory and conversations are untouched.
          </p>

          {report.personas_fell_back.length > 0 && (
            <section className="mt-4">
              <h3 className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
                <AlertTriangle className="h-3.5 w-3.5 text-orange" />
                Persona withdrawn
              </h3>
              <ul className="mt-2 space-y-1.5">
                {report.personas_fell_back.map((f) => (
                  <li key={f.instance} className="rounded-chip bg-inset px-2.5 py-2 text-[12px]">
                    <span className="font-medium">{f.name || f.instance}</span>
                    <span className="ml-2 font-mono text-[11px] text-ink-3">
                      {f.from} <ArrowRight className="inline h-3 w-3" /> {f.to}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.orphaned.length > 0 && (
            <section className="mt-4">
              <h3 className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
                <Snowflake className="h-3.5 w-3.5 text-accent" />
                Preset withdrawn — kept as your own copy
              </h3>
              <ul className="mt-2 space-y-1.5">
                {report.orphaned.map((o) => (
                  <li key={o.instance} className="rounded-chip bg-inset px-2.5 py-2 text-[12px]">
                    <span className="font-medium">{o.name || o.instance}</span>
                    <span className="ml-2 font-mono text-[11px] text-ink-3">{o.agent_preset}</span>
                    {o.frozen.length > 0 && (
                      <p className="mt-1 text-[11px] text-ink-3">
                        Frozen so it still runs: {o.frozen.join(', ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="flex justify-end border-t border-line px-5 py-3">
          <Button size="sm" onClick={dismissReport}>
            Got it
          </Button>
        </footer>
      </div>
    </>
  )
}

/** One sentence naming the scale of what changed, in agents rather than in rows. */
function summarize(report: PackUpdateReport): string {
  const parts: string[] = []
  const fell = report.personas_fell_back.length
  const orphans = report.orphaned.length
  if (fell) parts.push(`${fell} agent${fell === 1 ? '' : 's'} moved to a different persona`)
  if (orphans) parts.push(`${orphans} kept a preset this version no longer ships`)
  if (parts.length === 0) return 'No live agent was affected.'
  return `${parts.join(', and ')}.`
}
