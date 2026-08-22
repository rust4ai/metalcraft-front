import { useCallback, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * A draggable column edge.
 *
 * Pointer capture rather than window listeners: the pointer stays bound to this
 * element for the whole drag, so releasing outside the window (or over the
 * transcript, which has its own handlers) still ends the drag cleanly.
 *
 * The hit area is 9px wide and straddles the border; the *visible* line is 1px
 * and only paints while hovered or dragging. A permanently visible grabber
 * would read as a divider that does something, which every other border here
 * does not.
 */
export function Resizer({
  side,
  width,
  onResize,
}: {
  /** Which side of the pane the handle sits on — decides the drag's sign. */
  side: 'left' | 'right'
  width: number
  onResize: (px: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, width: 0 })

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      start.current = { x: e.clientX, width }
      setDragging(true)
    },
    [width],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      const delta = e.clientX - start.current.x
      onResize(start.current.width + (side === 'right' ? delta : -delta))
    },
    [dragging, onResize, side],
  )

  const end = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      className={cn(
        'group absolute inset-y-0 z-20 w-[9px] cursor-col-resize',
        side === 'right' ? '-right-[4px]' : '-left-[4px]',
      )}
    >
      <div
        className={cn(
          'mx-auto h-full w-px transition-colors duration-150',
          dragging ? 'bg-accent' : 'bg-transparent group-hover:bg-line-strong',
        )}
      />
    </div>
  )
}
