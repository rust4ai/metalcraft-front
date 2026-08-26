import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * A wide panel anchored to the right edge, for content you read *against* the
 * thing you were already looking at.
 *
 * Distinct from [`Modal`](./Modal.tsx), which is a small centred box for a
 * decision. A drawer is for a body of material — a timeline, a payload — where
 * the conversation behind it is half the context, so it takes the side of the
 * screen rather than the middle of it. Same Radix primitives underneath: focus
 * trap, escape and scroll lock are not things to hand-roll.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed inset-y-0 right-0 flex w-[min(46rem,100vw)] flex-col border-l border-line bg-surface shadow-2xl">
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-0.5 truncate font-mono text-[11.5px] text-ink-3">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {/* The panel scrolls, not the page behind it. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
