import { chats } from '@/rpc'

/**
 * Slash commands for agent chats.
 *
 * These exist because typing `/compact` into a chat used to send the literal text
 * to the model, which spent a turn interpreting it as prose. The commands here
 * never reach the agent: they act on the conversation rather than continue it.
 *
 * **What counts as a command** is the load-bearing decision. Anything starting
 * with `/` would be the obvious rule and the wrong one — people paste absolute
 * paths (`/Users/amy/notes.md`) into chats all the time, and swallowing those as
 * a failed command would be worse than the bug this replaces. So:
 *
 * - matches a known command → run it
 * - *shaped* like a command but unknown (`/foo`, one lowercase token, no second
 *   slash) → say so, rather than quietly spending a turn on it
 * - anything else → an ordinary message, paths included
 */
export interface CommandResult {
  /** A line to show in the transcript. Empty means the command showed nothing. */
  notice: string
  /** The conversation was reset, so the transcript should be emptied with it. */
  cleared?: boolean
}

export interface Command {
  name: string
  /** One line, shown in the menu and by `/help`. */
  summary: string
  /** Absent for commands this client answers by itself. */
  run?: (chatId: string) => Promise<CommandResult>
}

/** `12400` → `12.4k`. Token counts are estimates; four significant digits would
 *  imply a precision the ~4-chars-per-token estimate does not have. */
function compact(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`
}

export const COMMANDS: Command[] = [
  {
    name: 'compact',
    summary: 'Summarize the older half of this conversation to free up context',
    run: async (chatId) => {
      const r = await chats.compact(chatId)
      if (!r.compacted) {
        return { notice: 'Nothing to compact yet — nothing here is old enough to fold up.' }
      }
      const saved = r.tokens_before - r.tokens_after
      return {
        notice:
          `Compacted: ~${compact(r.tokens_before)} → ~${compact(r.tokens_after)} tokens ` +
          `(${r.messages_before} → ${r.messages_after} messages, ~${compact(saved)} freed).`,
      }
    },
  },
  {
    name: 'tokens',
    summary: 'How full this conversation’s context is',
    run: async (chatId) => {
      const c = await chats.context(chatId)
      const pct = Math.round((c.estimated_tokens / c.context_window) * 100)
      const tail = c.would_compact
        ? ' The next turn will compact on its own.'
        : ` Compacts on its own past ~${compact(c.compact_threshold_tokens)}.`
      return {
        notice:
          `~${compact(c.estimated_tokens)} tokens · ${c.message_count} messages · ` +
          `${pct}% of a ${compact(c.context_window)} window.${tail}`,
      }
    },
  },
  {
    name: 'clear',
    summary: 'Forget this conversation, keeping the agent and its memory',
    run: async (chatId) => {
      await chats.clear(chatId)
      // Worth naming what survives: an agent instance's memory is a separate
      // store, and someone clearing a chat should not fear they wiped it.
      return { notice: 'Conversation cleared. The agent keeps its memory.', cleared: true }
    },
  },
  {
    name: 'help',
    summary: 'List these commands',
  },
]

/** `/help`'s output, and the one command answered without touching the pod. */
export function helpText(): string {
  return COMMANDS.map((c) => `/${c.name} — ${c.summary}`).join('\n')
}

/** Command-shaped: a single lowercase token, no second slash. `/Users/amy` is
 *  not, which is the point — see the module note. */
const SHAPED = /^\/[a-z][a-z0-9-]*$/

export type Parsed =
  | { kind: 'command'; command: Command }
  | { kind: 'unknown'; name: string }
  | { kind: 'message' }

/** Decide what `input` is. Pure, so the rule is testable without a pod. */
export function parse(input: string): Parsed {
  const text = input.trim()
  if (!text.startsWith('/')) return { kind: 'message' }
  // Only the first token: `/compact now please` still runs `/compact`.
  const head = text.split(/\s+/)[0]!
  const command = COMMANDS.find((c) => `/${c.name}` === head)
  if (command) return { kind: 'command', command }
  if (SHAPED.test(head)) return { kind: 'unknown', name: head }
  return { kind: 'message' }
}

/** Commands whose name starts with the typed prefix, for the composer menu.
 *  A bare `/` lists everything. */
export function matching(input: string): Command[] {
  // Trailing space is the signal that the command word is finished, so only the
  // leading side may be trimmed — `trim()` would hide it and leave the menu
  // hovering over the arguments.
  const text = input.trimStart()
  if (!text.startsWith('/') || /\s/.test(text)) return []
  const prefix = text.slice(1).toLowerCase()
  return COMMANDS.filter((c) => c.name.startsWith(prefix))
}
