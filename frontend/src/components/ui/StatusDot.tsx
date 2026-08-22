import { cn } from '@/lib/cn'

/** What a fleet card says at a glance. `thinking` and `running` are distinct on
 *  purpose: one means the model is deciding, the other means a tool is out in the
 *  world doing something that may take a while. */
export type Status = 'idle' | 'thinking' | 'running' | 'error' | 'offline'

const color: Record<Status, string> = {
  idle: 'bg-ink-faint',
  thinking: 'bg-thinking',
  running: 'bg-live',
  error: 'bg-danger',
  offline: 'bg-ink-faint/40',
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
