import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, Clock, Play } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ProjectTask } from '@/types'

/**
 * A project's plan.
 *
 * The pod owns this list, so this renders records rather than parsing a
 * document — which is the point of the plan having become records at all: a
 * client that read the plan out of markdown could disagree with the pod about
 * what the plan said, and the disagreement would be invisible.
 *
 * What it shows beyond the title is what a person actually asks of a stalled
 * project: what is startable right now, what is waiting on what, and — for
 * anything closed — what the evidence was, because "done" without evidence is
 * the failure mode the whole task list exists to prevent.
 */

/** Startable now: nothing left to wait for. Derived here exactly as the pod
 *  derives it — from the deps, never from a stored flag, so the two cannot
 *  drift apart. */
export function isReady(task: ProjectTask, all: ProjectTask[]): boolean {
  if (task.status !== 'todo') return false
  return (task.deps ?? []).every((d) => {
    const dep = all.find((t) => t.id === d)
    return !dep || dep.status === 'done' || dep.status === 'dropped'
  })
}

function look(task: ProjectTask, all: ProjectTask[]) {
  switch (task.status) {
    case 'done':
      return { Icon: CheckCircle2, tone: 'text-green', label: 'done' }
    case 'dropped':
      return { Icon: CircleSlash, tone: 'text-ink-3', label: 'dropped' }
    case 'blocked':
      return { Icon: AlertTriangle, tone: 'text-red', label: 'blocked' }
    case 'waiting':
      return { Icon: Clock, tone: 'text-amber', label: 'waiting' }
    default:
      return isReady(task, all)
        ? { Icon: Play, tone: 'text-blue', label: 'ready' }
        : { Icon: CircleDashed, tone: 'text-ink-3', label: 'todo' }
  }
}

export function TaskList({ tasks }: { tasks: ProjectTask[] }) {
  const live = tasks.filter((t) => t.status !== 'dropped')
  if (live.length === 0) return null
  return (
    <ul className="mt-1.5 space-y-1.5">
      {live.map((task) => {
        const { Icon, tone, label } = look(task, tasks)
        const proof = task.evidence?.at(-1)
        const waitingOn = (task.deps ?? []).filter((d) => {
          const dep = tasks.find((t) => t.id === d)
          return dep && dep.status !== 'done' && dep.status !== 'dropped'
        })
        return (
          <li key={task.id} className="flex gap-1.5 text-sm">
            <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone)} aria-label={label} />
            <div className="min-w-0">
              <span className={cn('min-w-0', task.status === 'done' && 'text-ink-3 line-through')}>
                {task.title}
              </span>
              <div className="flex flex-wrap gap-x-2 text-xs text-ink-3">
                {task.status === 'blocked' && task.blocked_reason && (
                  <span className="text-red">{task.blocked_reason}</span>
                )}
                {waitingOn.length > 0 && <span>after {waitingOn.join(', ')}</span>}
                {task.assignee && <span>{task.assignee}</span>}
                {/* The evidence, not the claim. A task closed on a commit reads
                    differently from one closed on a sentence, and that
                    difference is the one worth surfacing. */}
                {proof && (
                  <span className="truncate">
                    {proof.kind}: {proof.value}
                  </span>
                )}
                {(task.attempts ?? 0) > 0 && task.status !== 'done' && (
                  <span>{task.attempts} attempt{(task.attempts ?? 0) === 1 ? '' : 's'}</span>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
