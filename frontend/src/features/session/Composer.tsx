import { useMemo, useState, type KeyboardEvent } from 'react'
import { ArrowUp, Bot, Loader2, Lock, Square } from 'lucide-react'
import { useFleet } from '@/stores/fleet'
import { useSessions } from '@/stores/sessions'
import { UsageRing } from '@/components/ui/Usage'
import { PersonaSwitcher } from './PersonaSwitcher'
import { cn } from '@/lib/cn'
import { matching } from './commands'

/**
 * Enter sends, shift+enter newlines. The draft survives a send failure — the pod
 * rejects a second concurrent turn on the same chat, and losing what you typed to
 * a 409 would be the wrong lesson to teach.
 *
 * Typing `/` opens the command menu. It is a *hint*, not a mode: the text is an
 * ordinary draft throughout, arrow keys only steer the menu while it is open, and
 * what actually runs is decided by `commands.parse` on submit. So a pasted path
 * that happens to start with `/` types and sends like any other message.
 *
 * The send button becomes a stop button for as long as the agent is working —
 * one button, because at any moment there is exactly one thing to do with a
 * turn. `onStop` is optional: without it the button waits out the turn as it
 * always did, which is what the fleet card and any other read-only mount want.
 *
 * **The chip rail** (HARNESS_UI_PLAN §4, H6) names what the next turn will
 * actually use — which agent, speaking as whom, on which model, against a
 * context this full. All four were already on screen somewhere; the point of
 * putting them here is that this is the moment they matter, and the rail they
 * lived in can be closed.
 *
 * The reference also has `@`, an attach button and a mic. None of them exist on
 * a pod — no mentions, no upload endpoint, no voice — so none of them are drawn.
 * A dead paperclip would cost more than the missing feature does (§0).
 *
 * `instanceId` is optional because the dev gallery mounts this with no agent
 * behind it. Without one there are no chips, which is the honest rendering
 * rather than a special case.
 */
export function Composer({
  instanceId,
  busy,
  stopping = false,
  onSend,
  onStop,
  placeholder = 'Ask this agent to do something…',
}: {
  /** The agent this composer talks to, when there is one. */
  instanceId?: string
  busy: boolean
  /** Stop has been pressed and the turn has not ended yet. */
  stopping?: boolean
  onSend: (message: string) => void
  onStop?: () => void
  placeholder?: string
}) {
  const [value, setValue] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  // A slash command still needs an idle chat — `/compact` rewrites the very
  // message list a running turn is reading. An ordinary message does not: the
  // pod queues it and takes it up at the next safe boundary, so making the
  // person wait for a delegation chain to finish before they can say "actually,
  // do X instead" is exactly the wait this composer used to force.
  const isCommand = value.trim().startsWith('/')
  const canSend = value.trim().length > 0 && !(busy && isCommand)
  /** A turn to stop, and somewhere to send the ask. */
  const canStop = busy && Boolean(onStop)

  const menu = useMemo(() => (busy ? [] : matching(value)), [busy, value])
  const open = menu.length > 0
  // Clamp rather than reset on every keystroke: narrowing the list must not
  // silently move the selection onto a command the user did not aim at.
  const index = Math.min(highlighted, menu.length - 1)

  function submit(text = value) {
    const trimmed = text.trim()
    if (!trimmed || (busy && trimmed.startsWith('/'))) return
    onSend(trimmed)
    setValue('')
    setHighlighted(0)
  }

  /** Complete to `/name ` and leave the caret there — running it still takes an
   *  explicit Enter, so Tab can never fire something by itself. */
  function complete() {
    const picked = menu[index]
    if (!picked) return
    setValue(`/${picked.name} `)
    setHighlighted(0)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted((i) => (Math.min(i, menu.length - 1) + 1) % menu.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted((i) => (Math.min(i, menu.length - 1) + menu.length - 1) % menu.length)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        complete()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        // Dismiss by clearing the fragment that opened it; there is nothing else
        // in the draft yet, since the menu only shows for a bare `/token`.
        setValue('')
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const picked = menu[index]
        submit(picked ? `/${picked.name}` : value)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-line bg-page/80 p-3 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        {open && (
          <ul
            role="listbox"
            aria-label="Commands"
            className="animate-fade-up mb-2 overflow-hidden rounded-card bg-surface py-1 shadow-overlay"
          >
            {menu.map((c, i) => (
              <li key={c.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  onMouseEnter={() => setHighlighted(i)}
                  onClick={() => submit(`/${c.name}`)}
                  className={cn(
                    'flex w-full items-baseline gap-2.5 px-3 py-1.5 text-left',
                    i === index ? 'bg-hover' : 'hover:bg-hover',
                  )}
                >
                  <span className="font-mono text-[12.5px] font-medium">/{c.name}</span>
                  <span className="truncate text-[12px] text-ink-2">{c.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-card bg-field shadow-card transition-shadow duration-150 focus-within:shadow-raised">
          <textarea
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={busy ? 'The agent is working — send anyway to queue it' : placeholder}
            className="max-h-40 min-h-[1.5rem] w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] caret-accent outline-none placeholder:text-ink-3"
          />

          {/* Inside the card, under the text: these describe the message above
              them, not the pane. */}
          <div className="flex items-center gap-1 px-2 pb-2">
            {instanceId && <Chips instanceId={instanceId} />}

            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {instanceId && <UsageRing instanceId={instanceId} />}
              {/* The shortcut, named where it is used. Hidden while a turn is
                  running, because then the button is Stop and Enter queues. */}
              {!canStop && (
                <span className="hidden items-center gap-1 text-[11px] text-ink-3 sm:flex">
                  <kbd className="rounded-chip bg-hover-2 px-1 py-px font-mono text-[10px]">↵</kbd>
                  send
                </span>
              )}
              {canStop ? (
                <button
                  type="button"
                  onClick={onStop}
                  disabled={stopping}
                  // The label is the promise. Stop is instant to *ask* and not
                  // instant to happen — the pod ends the turn at the executor's
                  // next step boundary — so once it is asked the button says
                  // "Stopping", not "Stopped".
                  aria-label={stopping ? 'Stopping' : 'Stop'}
                  title={stopping ? 'Stopping…' : 'Stop this turn'}
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-control transition-colors duration-150',
                    stopping ? 'bg-hover-2 text-ink-3' : 'bg-ink text-page shadow-btn hover:bg-ink-2',
                  )}
                >
                  {stopping ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Square className="h-2.5 w-2.5 fill-current" />
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => submit()}
                  disabled={!canSend}
                  aria-label="Send"
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-control transition-colors duration-150',
                    canSend ? 'bg-accent text-accent-ink shadow-btn' : 'bg-hover-2 text-ink-3',
                  )}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowUp className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </span>
          </div>
        </div>

        {/* Under the card, outside it — a standing caveat about the thing, not a
            property of the message being written. Warranted here in a way it is
            not in a chat toy: these agents run tools, send messages and fire on
            timers. */}
        <p className="px-1 pt-1.5 text-center text-[10.5px] text-ink-3">
          Agents can make mistakes, and they act on what they decide. Check anything that matters.
        </p>
      </div>
    </div>
  )
}

/**
 * What the next turn will use: this agent, speaking as this persona, on this
 * model.
 *
 * All three were already visible in the Inspector, and that is exactly the
 * problem — the Inspector closes (⌘J), and these are the facts you want while
 * writing rather than while inspecting. The persona is a live control here for
 * the same reason: "actually, ask this as the other voice" is a thought you have
 * with the message half-typed, not one that sends you to a panel.
 *
 * The model carries a lock because it genuinely is fixed: a model is chosen when
 * a conversation is created and the pod has no endpoint to change it afterwards.
 * The glyph is honest here in a way it usually is not.
 */
function Chips({ instanceId }: { instanceId: string }) {
  const instance = useFleet((s) => s.instances.find((i) => i.id === instanceId))
  const model = useSessions((s) => s.byInstance[instanceId]?.modelName)
  if (!instance) return null

  return (
    <span className="flex min-w-0 items-center gap-0.5 text-[11px] text-ink-3">
      <span className="flex min-w-0 shrink items-center gap-1 rounded-chip px-1.5 py-1">
        <Bot className="h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate text-ink-2">{instance.name}</span>
      </span>

      <span className="hidden shrink-0 items-center rounded-chip px-1 py-1 sm:flex">
        <PersonaSwitcher instance={instance} />
      </span>

      {model && (
        <span
          className="hidden min-w-0 shrink items-center gap-1 rounded-chip px-1.5 py-1 md:flex"
          title="The model is fixed for the life of a conversation — the pod chooses it when the chat is created and has no way to change it after."
        >
          <span className="min-w-0 truncate font-mono text-[10.5px] text-ink-2">{model}</span>
          <Lock className="h-2.5 w-2.5 shrink-0" />
        </span>
      )}
    </span>
  )
}
