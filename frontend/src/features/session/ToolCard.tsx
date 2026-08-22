import { useState } from 'react'
import { ChevronRight, Loader2, Terminal } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ToolCard as Card } from './transcript'

/**
 * One tool call, collapsed by default.
 *
 * A turn can make a dozen of these and almost none of them are worth reading —
 * but the one that failed always is, so the card shows what ran and how long it
 * took, and hides the payload behind a disclosure rather than dropping it.
 */
export function ToolCard({ card }: { card: Card }) {
  const [open, setOpen] = useState(false)
  const running = card.status === 'running'

  return (
    <div className="rounded-lg border border-line bg-surface/60 text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform', open && 'rotate-90')} />
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-thinking" />
        ) : (
          <Terminal className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        )}
        <span className="font-mono text-xs">{card.name}</span>
        <span className="ml-auto text-xs text-ink-faint">
          {running ? 'running…' : card.durationMs !== undefined ? `${card.durationMs}ms` : ''}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2">
          <Payload label="args" value={JSON.stringify(card.args, null, 2)} />
          {card.result !== undefined && <Payload label="result" value={card.result} />}
        </div>
      )}
    </div>
  )
}

function Payload({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-ground p-2 font-mono text-xs text-ink-dim">
        {value}
      </pre>
    </div>
  )
}
