import { cn } from '@/lib/cn'

/** What a fleet card says at a glance. `thinking` and `running` are distinct on
 *  purpose: one means the model is deciding, the other means a tool is out in the
 *  world doing something that may take a while. */
export type Status = 'idle' | 'thinking' | 'running' | 'error' | 'offline'

/**
 * Agent-initiated activity is the accent; the outcome colours are reserved for
 * outcomes. That is why "thinking" is blue rather than orange — orange in this
 * system means *needs review*, and a model doing its job does not.
 */
const color: Record<Status, string> = {
  idle: 'bg-ink-3',
  thinking: 'bg-accent',
  running: 'bg-accent',
  error: 'bg-red',
  offline: 'bg-ink-3/40',
}

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  const live = status === 'thinking' || status === 'running'
  return (
    <span className={cn('relative inline-flex h-2 w-2', className)}>
      {live && (
        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', color[status])} />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', color[status])} />
    </span>
  )
}
