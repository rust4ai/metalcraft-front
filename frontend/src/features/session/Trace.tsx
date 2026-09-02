import { useState } from 'react'
import { Check, ChevronRight, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { describeTool, truncateTarget } from './describeTool'
import type { ToolCard } from './transcript'

/**
 * Beautiful UI's Thinking primitive, `Coding` variant: a turn's tool calls as one
 * collapsible trace rather than a stack of cards.
 *
 * This is the tension the primitive exists to resolve — users want to audit what
 * the agent did, and do not want a wall of it in their reading path. So the
 * settled state is one past-tense line ("Ran 3 tools") and the detail is one
 * click away.
 *
 * Labels follow the rule that matters most: **present participle while running,
 * past tense once settled**. A finished trace still saying "Running tools" is the
 * single most common way agent UI looks broken.
 */
export function Trace({ cards }: { cards: ToolCard[] }) {
  const running = cards.some((c) => c.status === 'running')
  const [open, setOpen] = useState(false)

  const label = running
    ? 'Running tools'
    : `Ran ${cards.length} tool${cards.length === 1 ? '' : 's'}`

  return (
    // Boxed only while expanded. Collapsed, this is one line in a reading flow
    // and a bordered card around it made every turn look like a stack of
    // cards with a paragraph wedged between them — the disclosure should
    // recede until it is opened, which is the whole point of collapsing it.
    <div
      className={cn(
        'animate-stream-in',
        open && 'rounded-card border border-line bg-inset/60',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-1.5 text-left text-ink-3 transition-colors duration-150 hover:text-ink-2',
          open ? 'px-3 py-2' : 'py-0.5',
        )}
      >
        {/* Chevron first, the way a disclosure reads: the control comes before
            the thing it discloses. */}
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', running ? 'bg-accent' : 'bg-green')}
        />
        <span className="text-[12px] font-medium">{label}</span>
      </button>

      {/* `flex-wrap` only in the collapsed row. Wrapping a *column* makes each
          flex line size its cross-axis — the width — to its contents, so an
          expanded chip stretched to its widest JSON line and pushed the whole
          transcript into a horizontal scroll. Down this axis the payload's own
          box is the only thing allowed to scroll sideways. */}
      {/* Visible while the turn is running, hidden once it has settled.
          Mid-turn the chips are the answer to "what is it doing right now",
          which a count cannot give and which is worth more than the tidier
          line. Settled, "Ran 3 tools" says everything the collapsed chips did
          and the detail is one click away.

          `flex-wrap` only in that collapsed running row. Wrapping a *column*
          makes each flex line size its cross-axis — the width — to its
          contents, so an expanded chip stretched to its widest JSON line and
          pushed the whole transcript into a horizontal scroll. Down this axis
          the payload's own box is the only thing allowed to scroll sideways. */}
      {(open || running) && (
        <ul
          className={cn(
            'flex gap-1.5 pb-2.5',
            open ? 'flex-col px-3' : 'flex-wrap pl-6 pr-3',
          )}
        >
          {cards.map((card) => (
            <li key={card.id} className="min-w-0">
              <Chip card={card} expanded={open} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One call: verb, mono target, status glyph. Never colour alone — the glyph
 *  carries the status too. */
function Chip({ card, expanded }: { card: ToolCard; expanded: boolean }) {
  const { verb, target } = describeTool(card.name, card.args)
  const failed = card.status === 'done' && looksFailed(card.result)
  const running = card.status === 'running'

  return (
    <div
      className={cn(
        'w-full rounded-chip border border-line/70 bg-surface px-2 py-1',
        failed && 'border-red/30 bg-red-tint',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11.5px]">
        {running ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-ink-2" />
        ) : failed ? (
          <X className="h-3 w-3 shrink-0 text-red" />
        ) : (
          <Check className="h-3 w-3 shrink-0 text-green" />
        )}
        <span className={cn('shrink-0 font-medium', running ? 'text-ink-2' : 'text-ink')}>{verb}</span>
        {target && (
          <span className="min-w-0 truncate font-mono text-ink-2">{truncateTarget(target)}</span>
        )}
        {card.durationMs !== undefined && (
          <span className="tnum ml-auto shrink-0 font-mono text-[10.5px] text-ink-3">
            {card.durationMs}ms
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-1.5 space-y-1.5 border-t border-line/70 pt-1.5">
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
      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
      <pre className="max-h-64 overflow-auto overscroll-contain whitespace-pre-wrap break-words rounded-chip bg-page p-2 font-mono text-[11px] text-ink-2">
        {value}
      </pre>
    </div>
  )
}

/**
 * The agent returns tool errors as ordinary result strings, so a failed call is
 * not distinguishable structurally. Keep the summary honest anyway — burying a
 * failure inside a chip nobody expands is exactly what the guidance warns about.
 */
export function looksFailed(result: string | undefined): boolean {
  if (!result) return false
  return /^\s*(error|failed|denied|refused)\b/i.test(result)
}
