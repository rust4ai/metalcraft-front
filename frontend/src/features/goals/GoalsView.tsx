import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Target,
  Trash2,
} from 'lucide-react'
import { useGoals } from '@/stores/goals'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { relative } from '@/features/fleet/FleetView'
import { cn } from '@/lib/cn'
import { NewGoalDialog } from './NewGoalDialog'
import { isEmptySection, planSteps, section } from './goalPlan'
import type { Goal, GoalJournalEntry } from '@/types'

/**
 * What this pod is working towards on its own.
 *
 * The screen is arranged around one fact: a **blocked** goal is the only thing
 * here that is waiting on a person, and its heartbeat has stopped — so nothing
 * else will ever raise it again. It sorts first, it is the loudest thing on the
 * card, and answering it is a text box in the detail rather than a place to
 * navigate to.
 *
 * Everything else is a progress report you can ignore safely, which is the
 * point of setting a goal in the first place.
 */
export function GoalsView() {
  const { goals, loading, error, load, open, select, close, maxActive, active } = useGoals()
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">Goals</h1>
            <p className="text-sm text-ink-2">
              {goals.length === 0
                ? 'Nothing running.'
                : `${active} of ${maxActive} running.`}
            </p>
          </div>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => void load()} aria-label="Refresh">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Set a goal
            </Button>
          </div>
        </header>

        {error && <p className="mb-3 text-sm text-red">{error}</p>}

        {goals.length === 0 && !loading ? (
          <Card className="text-sm text-ink-2">
            <Target className="mb-2 h-5 w-5 text-ink-3" />
            <p className="font-medium text-ink">Nothing on the go.</p>
            <p className="mt-1">
              A goal works on its own — waking on a heartbeat, doing one slice at a time, and
              telling you when it is done or stuck.
            </p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {goals.map((g) => (
              <li key={g.id}>
                <GoalCard goal={g} selected={open?.id === g.id} onOpen={() => void select(g.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && (
        <aside className="flex w-[26rem] min-w-0 shrink-0 flex-col overflow-y-auto border-l border-line p-4">
          <GoalDetailPanel onClose={close} />
        </aside>
      )}

      <NewGoalDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

/** Colour and words for a status, in one place so the card and the detail cannot
 *  describe the same goal differently. */
function statusOf(g: Goal): { tone: string; label: string } {
  switch (g.status) {
    case 'blocked':
      return { tone: 'text-red', label: 'Needs you' }
    case 'active':
      return { tone: 'text-green', label: 'Working' }
    case 'paused':
      return { tone: 'text-ink-3', label: 'Paused' }
    case 'done':
      return { tone: 'text-ink-2', label: 'Done' }
    default:
      return { tone: 'text-red', label: 'Failed' }
  }
}

function GoalCard({ goal, selected, onOpen }: { goal: Goal; selected: boolean; onOpen: () => void }) {
  const { tone, label } = statusOf(goal)
  const { done, total } = goal.progress
  return (
    <Card
      className={cn('cursor-pointer', selected && 'ring-1 ring-accent')}
      onClick={onOpen}
      role="button"
      aria-pressed={selected}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{goal.title}</span>
            <span className={cn('shrink-0 text-xs font-medium', tone)}>{label}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{goal.goal}</p>
        </div>
        {total > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-ink-3">
            {done}/{total}
          </span>
        )}
      </div>

      {/* The blocked question, on the card. Making someone open a goal to find
          out what it wants would be one click between them and the only thing
          that restarts it. */}
      {goal.blocked_reason && (
        <p className="mt-2 flex gap-1.5 rounded-control bg-red/10 p-2 text-sm text-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{goal.blocked_reason}</span>
        </p>
      )}

      {total > 0 && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-field">
          <div
            className="h-full bg-accent transition-[width] duration-300"
            style={{ width: `${Math.round((done / total) * 100)}%` }}
          />
        </div>
      )}

      <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
        <Clock className="h-3 w-3" />
        {goal.ticks} tick{goal.ticks === 1 ? '' : 's'}
        {goal.last_tick_at && <> · last {relative(goal.last_tick_at)}</>}
        {goal.next_tick_at && goal.status === 'active' && <> · next {relative(goal.next_tick_at)}</>}
      </p>
    </Card>
  )
}

/** One goal: its plan, what it wants, and what it has been doing. */
function GoalDetailPanel({ onClose }: { onClose: () => void }) {
  const { open, journal, openLoading, update, remove, busy } = useGoals()
  const [answer, setAnswer] = useState('')

  if (!open) return null
  const steps = planSteps(open.scratchpad)
  const state = section(open.scratchpad, 'State')
  const working = busy[open.id]

  return (
    <>
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{open.title}</h2>
          <p className="text-xs text-ink-3">
            {open.kind} · every {open.every_minutes}m · {open.ticks} ticks
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </header>

      {openLoading && <Loader2 className="h-4 w-4 animate-spin text-ink-3" />}

      <p className="whitespace-pre-wrap text-sm text-ink-2">{open.goal}</p>

      {/* Answering is the whole reason this panel is reachable in one click from
          a blocked card: replying *is* saying carry on, so it un-blocks by
          itself rather than making someone also flip a switch. */}
      {open.status === 'blocked' && (
        <section className="mt-3 rounded-card bg-red/10 p-3">
          <p className="flex gap-1.5 text-sm text-red">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{open.blocked_reason ?? 'It stopped and did not say why.'}</span>
          </p>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
            placeholder="Answer it…"
            aria-label="Answer"
            className="mt-2 w-full resize-y rounded-control bg-field p-2 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-accent"
          />
          <Button
            size="sm"
            className="mt-2"
            disabled={!answer.trim() || working}
            onClick={async () => {
              await update(open.id, { answer: answer.trim() })
              setAnswer('')
            }}
          >
            Answer and carry on
          </Button>
        </section>
      )}

      {steps.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-3">Plan</h3>
          <ul className="mt-1.5 space-y-1">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-1.5 text-sm">
                {s.done ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green" />
                ) : (
                  <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" />
                )}
                <span className={cn('min-w-0', s.done && 'text-ink-3 line-through')}>{s.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isEmptySection(state) && (
        <section className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-3">Where it stands</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{state}</p>
        </section>
      )}

      <section className="mt-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-3">Journal</h3>
        {journal.length === 0 ? (
          <p className="mt-1 text-sm text-ink-3">It has not woken yet.</p>
        ) : (
          <ul className="mt-1.5 space-y-2">
            {[...journal].reverse().map((e, i) => (
              <JournalRow key={`${e.tick}-${i}`} entry={e} />
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-4 flex gap-1.5 border-t border-line pt-3">
        {open.status === 'active' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={working}
            onClick={() => void update(open.id, { status: 'paused' })}
          >
            <Pause className="h-4 w-4" /> Pause
          </Button>
        ) : open.status === 'paused' || open.status === 'blocked' ? (
          <Button size="sm" disabled={working} onClick={() => void update(open.id, { status: 'active' })}>
            <Play className="h-4 w-4" /> Resume
          </Button>
        ) : null}
        <Button
          variant="danger"
          size="sm"
          disabled={working}
          onClick={() => void remove(open.id)}
          aria-label="Delete goal"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </footer>
    </>
  )
}

/** One tick.
 *
 *  A tick that changed nothing is marked, because a run of them is exactly what
 *  the pod's own no-progress rail is counting — and it is the difference between
 *  a goal working slowly and a goal stuck. */
function JournalRow({ entry }: { entry: GoalJournalEntry }) {
  return (
    <li className="text-sm">
      <p className="flex items-center gap-1.5 text-xs text-ink-3">
        <span className="tabular-nums">#{entry.tick}</span>
        <span className="capitalize">{entry.kind}</span>
        <span>{relative(entry.at)}</span>
        {!entry.progressed && <span className="text-amber">no change</span>}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap text-ink-2">{entry.summary}</p>
    </li>
  )
}
