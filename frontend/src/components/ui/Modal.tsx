import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'

/** Radix under the hood: focus trap, escape, and scroll lock are not things to
 *  hand-roll in an app people keep open all day. */
export function Modal({
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
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-raised p-5 shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          {description && <Dialog.Description className="mt-1 text-sm text-ink-dim">{description}</Dialog.Description>}
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
