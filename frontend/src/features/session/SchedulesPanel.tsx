import { useEffect, useState } from 'react'
import { Clock, PauseCircle } from 'lucide-react'
import { fleet as fleetRpc } from '@/rpc'
import { useUi } from '@/stores/ui'
import { Empty, Section } from '@/components/ui/Facts'
import type { ScheduledFlow } from '@/types'

/**
 * The Schedules mode (HARNESS_UI_PLAN H3) — what this agent does unattended.
 */
export function SchedulesPanel({ instanceId }: { instanceId: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto w-full max-w-3xl">
        <RunsOnItsOwn instanceId={instanceId} />
      </div>
    </div>
  )
}

/**
 * What this agent does when nobody is talking to it.
 *
 * An agent is not only something you chat with: a schedule fires it on a timer,
 * as itself, and what it does then lands in the same memory. Until this existed
 * the desktop could show an agent's whole history without ever saying it was
 * going to wake up at 8am — the schedules were only visible from the automation
 * side, filed under the flow rather than under whoever runs it.
 */
function RunsOnItsOwn({ instanceId }: { instanceId: string }) {
  const [scheduled, setScheduled] = useState<ScheduledFlow[] | null>(null)
  const go = useUi((s) => s.go)

  useEffect(() => {
    let live = true
    setScheduled(null)
    // A pod too old for the route answers 404. That and "no schedules" both
    // arrive here as an empty list, which is honest for this pane: either way
    // there is nothing this agent is known to do unattended.
    fleetRpc
      .flows(instanceId)
      .then((rows) => live && setScheduled(rows))
      .catch(() => live && setScheduled([]))
    return () => {
      live = false
    }
  }, [instanceId])

  // A mode, not a rail section — so an empty answer gets a sentence rather than
  // nothing. As a section it rendered `null` when empty, which was right when
  // something else always followed it and is wrong now that this *is* the pane:
  // a blank rectangle under a tab you just pressed reads as a broken view.
  if (!scheduled) return <Empty text="Asking the pod what points at this agent…" />
  if (scheduled.length === 0) {
    return (
      <Section title="Runs on its own">
        <Empty text="Nothing runs this agent on a timer. It only acts when you or a channel talk to it." />
      </Section>
    )
  }

  return (
    <Section title="Runs on its own">
      <ul>
        {scheduled.map((s) => (
          <li key={s.id} className="border-b border-line py-1.5 last:border-0">
            <button
              type="button"
              onClick={() => go({ kind: 'automations' })}
              className="flex w-full items-baseline gap-1.5 text-left"
            >
              {s.enabled ? (
                <Clock className="h-3 w-3 shrink-0 translate-y-px text-ink-3" />
              ) : (
                <PauseCircle className="h-3 w-3 shrink-0 translate-y-px text-ink-3" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-ink-2">
                  {/* Absent when the flow is gone: a schedule that can never
                      fire, which should read as broken rather than as fine. */}
                  {s.flow_name ?? `${s.flow_id} — missing`}
                </span>
                {/* The pod's own rendering of the trigger, verbatim, including
                    `Invalid cron …`. */}
                <span className="block truncate text-[10.5px] text-ink-3">
                  {s.enabled ? s.description : `Paused · ${s.description}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}
