import { chats, fleet } from '@/rpc'

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

}

/**
 * What a command acts on.
 *
 * Both ids, because they are not interchangeable: `/compact` and `/clear` act on
 * one conversation, while `/dream` acts on the **agent** — its memory outlives
 * any single chat, and consolidating it from inside one is still a fleet-level
 * operation.
 */
export interface CommandTarget {
  chatId: string
  instanceId: string
}

export interface Command {
  name: string
  /** One line, shown in the menu and by `/help`. */
  summary: string
  /** Absent for commands this client answers by itself. */
  run?: (target: CommandTarget) => Promise<CommandResult>
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
    run: async ({ chatId }) => {
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
    run: async ({ chatId }) => {
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
    summary: 'Start the agent fresh here, keeping the conversation and its memory',
    run: async ({ chatId }) => {
      await chats.clear(chatId)
      // Deliberately leaves the transcript alone. This used to empty it, which
      // matched a pod that really did delete the history — it does not any more,
      // so emptying would show a conversation as gone while it sat intact on the
      // pod, waiting to reappear on the next open. The divider marking the reset
      // arrives on the event stream, the same way a flow's 3am reset does.
      return { notice: 'The agent is starting fresh here. Nothing was deleted.' }
    },
  },
  {
    name: 'dream',
    summary: 'Consolidate what this agent remembers now, instead of waiting for tonight',
    run: async ({ instanceId }) => {
      // Minutes, not milliseconds. The composer is already locked for the whole
      // call (see `useSessions.submit`), which is the only progress signal there
      // is — the pod runs the stages as a handful of long model calls, so there
      // is nothing finer-grained to stream.
      const r = await fleet.dream(instanceId)
      if (r.error) return { notice: `The dream could not finish: ${r.error}` }

      const drained = r.captures_pending_before - r.captures_pending_after
      const gained = r.memories_after - r.memories_before
      if (drained === 0 && gained === 0) {
        return {
          notice:
            'Nothing new to distil — everything said since the last dream is already ' +
            'part of what I know.',
        }
      }
      const secs = Math.round(
        (Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000,
      )
      const change =
        gained > 0
          ? `${gained} memories added`
          : gained < 0
            ? `${-gained} merged away or faded`
            : 'nothing added'
      return {
        notice: `Dreamt for ${secs}s: ${drained} captured turn(s) distilled, ${change}.`,
      }
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

/**
 * Turn a failed command into something a person can act on.
 *
 * These endpoints are newer than the chat surface itself, so the failure that
 * matters is a pod that predates them: it serves the chat perfectly well and then
 * 404s the command. Told raw, that reads as "your conversation is broken".
 *
 * Same discrimination as `describeRegistryError`: the pod's own 404 (no such
 * chat) carries `{"error": …}`, which reaches us as the detail after the path,
 * while axum answers an unmatched route with an empty body. No version is named
 * because the agent's tags do not track its Cargo version, and a number that
 * turned out to be wrong is worse than "update the pod".
 *
 * Anything else is returned untouched — the pod's account of its own trouble
 * beats one written here.
 */
export function describeCommandError(error: unknown, command: string): string {
  const message = String(error).replace(/^Error:\s*/, '')
  if (!isMissingRoute(message)) return message
  return `This pod is too old for /${command} — update it and try again.`
}

function isMissingRoute(message: string): boolean {
  if (!/^404\b/.test(message)) return false
  // Any route, not only `/chats/…`: `/dream` reaches the agent's memory under
  // `/agents/instances/…`, and pinning the prefix here would have made an old
  // pod's 404 on that route read as the pod's own words.
  const at = message.indexOf(' /')
  if (at === -1) return false
  // Everything after the path is the pod's own words. A route miss has none.
  const detail = message.slice(at).split(':').slice(1).join(':')
  return detail.trim() === ''
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
