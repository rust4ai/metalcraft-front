import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * Beautiful UI's Loading State: a 3×3 pixel grid, a shimmering phase label, and
 * a monospaced elapsed counter.
 *
 * The counter is the point. Latency is content, not an error — an agent turn can
 * run for minutes, and the difference between "working, 12.4s" and an
 * undifferentiated spinner is the difference between waiting and wondering
 * whether the thing has hung.
 *
 * Mount it when work starts; it times itself from mount. Unmount it the moment
 * real output arrives — never run this and streaming output at once.
 */
export function LoadingState({ label = 'Working', className }: { label?: string; className?: string }) {
  const elapsed = useElapsed()
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <PixelGrid />
      <span
        className="animate-shimmer-text bg-[length:200%_auto] bg-clip-text text-[13px] font-medium text-transparent"
        style={{
          backgroundImage:
            'linear-gradient(90deg, var(--color-ink-3) 0%, var(--color-ink) 45%, var(--color-ink-3) 90%)',
        }}
      >
        {label}
      </span>
      <span className="tnum font-mono text-[11.5px] text-ink-3">{format(elapsed)}</span>
    </div>
  )
}

/** Nine cells on a diagonal delay wave — `(col + |row−1|) × 90ms`. */
function PixelGrid() {
  return (
    <div aria-hidden className="grid grid-cols-3 gap-[1.5px]">
      {Array.from({ length: 9 }, (_, i) => {
        const row = Math.floor(i / 3)
        const col = i % 3
        return (
          <span
            key={i}
            className="animate-pixel-on h-[4px] w-[4px] rounded-[1px] bg-ink"
            style={{ animationDelay: `${(col + Math.abs(row - 1)) * 90}ms` }}
          />
        )
      })}
    </div>
  )
}

/** Tenths under a minute, then `1m 4.2s`. Ticks at 100ms, like the spec. */
export function format(ms: number): string {
  const secs = ms / 1000
  if (secs < 60) return `${secs.toFixed(1)}s`
  const mins = Math.floor(secs / 60)
  return `${mins}m ${(secs - mins * 60).toFixed(1)}s`
}

function useElapsed(): number {
  const start = useRef(Date.now())
  const [ms, setMs] = useState(0)
  useEffect(() => {
    const started = start.current
    const id = setInterval(() => setMs(Date.now() - started), 100)
    return () => clearInterval(id)
  }, [])
  return ms
}
