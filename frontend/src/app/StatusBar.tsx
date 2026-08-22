import { useEffect } from 'react'
import { useConnection } from '@/stores/connection'
import { useFleet } from '@/stores/fleet'
import { CREDITS_POLL_MS, useCredits } from '@/stores/credits'
import { StatusDot } from '@/components/ui/StatusDot'

/**
 * The bottom bar (UI_PLAN §2, S5) — Orca's `10% used 2h 14m · 466.9 MB` row.
 *
 * It carries the pod and the account because deleting the title bar left them
 * homeless, and the balance because Metalcraft ID's `/credits/balance` is the
 * same ledger the next turn will authorize against.
 *
 * It shows `available` rather than the raw balance: a turn in flight has already
 * reserved against the total and not settled, so the larger number would be
 * optimistic in exactly the place someone is checking whether they can afford
 * to keep going. A deployment that does not report credits gets no readout at
 * all rather than a zero.
 */
export function StatusBar() {
  const { session, info, pod } = useConnection()
  const live = useFleet((s) => Object.values(s.status).filter((v) => v === 'thinking' || v === 'running').length)
  const { credits, supported, refresh } = useCredits()

  useEffect(() => {
    if (!info) return
    void refresh()
    const t = setInterval(() => void refresh(), CREDITS_POLL_MS)
    return () => clearInterval(t)
  }, [info, refresh])

  return (
    <footer className="col-span-full flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-canvas px-3 text-[11px] text-ink-3">
      {info && <StatusDot status="idle" />}
      {pod && <span className="font-mono">{pod.slug}</span>}
      {info?.version && <span className="font-mono">v{info.version}</span>}
      {live > 0 && <span className="tnum text-accent">{live} working</span>}

      {supported && credits && <CreditsReadout credits={credits} />}

      <span className="ml-auto">{session?.email}</span>
    </footer>
  )
}

function CreditsReadout({ credits }: { credits: NonNullable<ReturnType<typeof useCredits.getState>['credits']> }) {
  const held = credits.credits - credits.available
  return (
    <span className="tnum" title={held > 0 ? `${held.toLocaleString()} held by turns in flight` : undefined}>
      {credits.available.toLocaleString()} credits
      {/* Only worth saying when it is true, and then it explains a number that
          would otherwise look wrong against the account page. */}
      {held > 0 && <span className="text-ink-3"> · {held.toLocaleString()} held</span>}
    </span>
  )
}
