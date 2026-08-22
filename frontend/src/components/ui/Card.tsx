import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Resting elevation is `shadow-card`; hover lifts to `shadow-raised`. Both are a
 *  1px ring plus a multi-stop drop — the ring is what keeps it crisp at this size. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-card bg-surface p-4 shadow-card transition-shadow duration-150 hover:shadow-raised',
        className,
      )}
      {...props}
    />
  )
}
