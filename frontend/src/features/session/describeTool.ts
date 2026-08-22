/**
 * Turn a raw tool call into the two things a chip needs: a **verb** and a
 * **target**.
 *
 * "Edit ChurnSchedule.tsx" reads at a glance; "edit_file" with a JSON blob does
 * not. The agent's tool names are already verb-shaped, so this is mostly
 * humanizing them and finding the one argument a person would recognize.
 */
export interface ToolDescription {
  verb: string
  target?: string
}

/** Argument keys that carry the recognizable thing, most specific first. */
const TARGET_KEYS = ['path', 'file_path', 'file', 'command', 'cmd', 'query', 'url', 'name', 'pattern']

const VERBS: Record<string, string> = {
  read_file: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  list_files: 'List',
  find_files: 'Find',
  grep: 'Search',
  bash: 'Run',
  web_fetch: 'Fetch',
  say_to_user: 'Reply',
  sub_agent: 'Delegate',
  load_skill: 'Load skill',
}

export function describeTool(name: string, args: unknown): ToolDescription {
  const verb = VERBS[name] ?? humanize(name)
  return { verb, target: findTarget(args) }
}

function humanize(name: string): string {
  // Pack tools are prefixed (`mdrv_upload`, `octaweave_note_create`); the prefix
  // is the pack, which the chip already implies, so lead with the action.
  const withoutPrefix = name.includes('_') ? name.slice(name.indexOf('_') + 1) : name
  const words = withoutPrefix.replaceAll('_', ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function findTarget(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  for (const key of TARGET_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

/**
 * Truncate a path from the **left**, keeping the filename — the part a person
 * recognizes. Non-paths truncate from the right as usual.
 */
export function truncateTarget(target: string, max = 42): string {
  if (target.length <= max) return target
  if (target.includes('/')) return `…${target.slice(-(max - 1))}`
  return `${target.slice(0, max - 1)}…`
}
