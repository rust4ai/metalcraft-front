import { useEffect } from 'react'
import { useConnection } from '@/stores/connection'
import { useFleet } from '@/stores/fleet'
import { USAGE_POLL_MS, useUsage } from '@/stores/usage'
import { StatusDot } from '@/components/ui/StatusDot'
import { cn } from '@/lib/cn'

/**
 * The bottom bar (UI_PLAN §2, S5) — Orca's `10% used 2h 14m · 466.9 MB` row.
 *
 * It carries the pod and the account because deleting the title bar left them
 * homeless, and the usage meter because the API surface for it now exists
 * (`account_usage`). What it does *not* do is invent a number: PLAN §12.6's
 * endpoint is unbuilt, so on every hub today `supported` is false and the meter
 * is simply absent. An empty meter would read as "nothing spent", which is a
 * claim we cannot make.
 */
export function StatusBar() {
  const { session, info, pod } = useConnection()
  const live = useFleet((s) => Object.values(s.status).filter((v) => v === 'thinking' || v === 'running').length)
  const { usage, supported, refresh } = useUsage()

  useEffect(() => {
    if (!info) return
    void refresh()
    const t = setInterval(() => void refresh(), USAGE_POLL_MS)
    return () => clearInterval(t)
  }, [info, refresh])

  return (
    <footer className="col-span-full flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-canvas px-3 text-[11px] text-ink-3">
      {info && <StatusDot status="idle" />}
      {pod && <span className="font-mono">{pod.slug}</span>}
      {info?.version && <span className="font-mono">v{info.version}</span>}
      {live > 0 && <span className="tnum text-accent">{live} working</span>}

      {supported && usage && <UsageReadout usage={usage} />}

      <span className="ml-auto">{session?.email}</span>
    </footer>
  )
}

function UsageReadout({ usage }: { usage: NonNullable<ReturnType<typeof useUsage.getState>['usage']> }) {
  const used = typeof usage.used === 'number' ? Math.min(1, Math.max(0, usage.used)) : null
  return (
    <span className="flex items-center gap-2">
      {used !== null && (
        <>
          <Meter fraction={used} />
          <span className="tnum">
            {Math.round(used * 100)}% used
            {usage.window ? ` this ${usage.window}` : ''}
          </span>
        </>
      )}
      {typeof usage.credits === 'number' && (
        <span className="tnum">{usage.credits.toLocaleString()} credits</span>
      )}
    </span>
  )
}

/** Orange past four fifths, red when spent. The colours are the system's outcome
 *  hues (index.css): "you should look at this", then "this stopped working". */
function Meter({ fraction }: { fraction: number }) {
  return (
    <span className="h-1 w-14 overflow-hidden rounded-full bg-hover-2" role="presentation">
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-500',
          fraction >= 1 ? 'bg-red' : fraction >= 0.8 ? 'bg-orange' : 'bg-ink-3',
        )}
        style={{ width: `${fraction * 100}%` }}
      />
    </span>
  )
}
