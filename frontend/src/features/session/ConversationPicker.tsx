import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useSessions } from '@/stores/sessions'

/**
 * The conversations one agent has had.
 *
 * This exists because an agent is not a chat. A gateway sender's next message
 * opens a new conversation after a quiet gap and a flow opens one per firing, so
 * an agent quietly accumulates them — and until this list existed the only one
 * reachable was whichever ranked newest, which made every earlier one look
 * deleted.
 *
 * A popover rather than a pane: picking a conversation is a detour from reading
 * one, and it should end where it started.
 */
export function ConversationPicker({ instanceId }: { instanceId: string }) {
  const { byInstance, conversations, loadingConversations, loadConversations, resume, startConversation, deleteConversation } =
    useSessions()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const current = byInstance[instanceId]?.chatId
  const mine = conversations[instanceId] ?? []
  const loading = loadingConversations[instanceId] ?? false

  // Re-read on every open. A conversation's preview and last-activity change
  // with every turn, and a list cached from the last time it was opened would
  // quietly show the agent as idle since then.
  useEffect(() => {
    if (open) void loadConversations(instanceId)
  }, [open, instanceId, loadConversations])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Conversations"
        className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent hover:text-ink"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Conversations
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1.5 max-h-[26rem] w-96 overflow-y-auto rounded-card border border-line bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[11px] uppercase tracking-wide text-ink-3">
              {mine.length === 1 ? '1 conversation' : `${mine.length} conversations`}
            </span>
            <button
              type="button"
              onClick={async () => {
                await startConversation(instanceId)
                setOpen(false)
              }}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[11.5px] text-ink-2 transition-colors hover:text-accent"
            >
              <Plus className="h-3.5 w-3.5" /> New
            </button>
          </div>

          {loading && mine.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-ink-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading conversations…
            </div>
          )}
          {!loading && mine.length === 0 && (
            <p className="px-3 py-4 text-xs text-ink-3">This agent has not been spoken to yet.</p>
          )}

          {mine.map((c) => (
            <div
              key={c.id}
              className="group flex items-start gap-2 border-b border-line/50 px-3 py-2 last:border-b-0 hover:bg-line/20"
            >
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  await resume(instanceId, c.id)
                  setOpen(false)
                }}
                className="min-w-0 flex-1 text-left"
              >
                <div className={`truncate text-[12.5px] ${c.preview ? 'text-ink' : 'text-ink-3 italic'}`}>
                  {c.preview ?? 'Nothing said yet'}
                </div>
                <div className="mt-0.5 text-[11px] text-ink-3">
                  {when(c.updated_at ?? c.created_at)} · {c.turn_count === 1 ? '1 turn' : `${c.turn_count} turns`}
                </div>
              </button>
              {c.id === current ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-label="Currently open" />
              ) : (
                // Absent on the open one: deleting what you are reading would
                // leave the pane pointing at nothing.
                <button
                  type="button"
                  onClick={() => void deleteConversation(instanceId, c.id)}
                  title="Delete this conversation"
                  className="mt-0.5 shrink-0 text-ink-3 opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** A timestamp as something readable — "3:40 PM" today, the date before that. */
function when(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  const today = new Date()
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate()
  return sameDay
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
