import { useState, type KeyboardEvent } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Enter sends, shift+enter newlines. The draft survives a send failure — the pod
 * rejects a second concurrent turn on the same chat, and losing what you typed to
 * a 409 would be the wrong lesson to teach.
 */
export function Composer({
  busy,
  onSend,
  placeholder = 'Ask this agent to do something…',
}: {
  busy: boolean
  onSend: (message: string) => void
  placeholder?: string
}) {
  const [value, setValue] = useState('')
  const canSend = value.trim().length > 0 && !busy

  function submit() {
    if (!canSend) return
    onSend(value.trim())
    setValue('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-line bg-surface/60 p-3">
      <div className="flex items-end gap-2 rounded-card border border-line bg-raised p-2 focus-within:border-accent">
        <textarea
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? 'The agent is working…' : placeholder}
          className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-ink-faint"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label="Send"
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors',
            canSend ? 'bg-accent text-accent-ink' : 'bg-surface text-ink-faint',
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
