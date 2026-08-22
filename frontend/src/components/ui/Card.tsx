import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-raised p-4 transition-colors hover:border-ink-faint/40',
        className,
      )}
      {...props}
    />
  )
}
