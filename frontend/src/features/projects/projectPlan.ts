/**
 * Reading a project's scratchpad, for display only.
 *
 * The pod already derives everything a *list* needs (`progress`), so this is
 * used on one screen: the detail view, which shows the plan as a checklist
 * because that is the shape a person can actually read a project's state from.
 *
 * Nothing here writes. The scratchpad belongs to the agent, and a client that
 * quietly reformatted it would be editing the only memory a project has.
 */

export interface PlanStep {
  done: boolean
  text: string
}

/** The body of one `## Section`, or `''`.
 *
 *  Headings are matched at the start of a line only, and the scan stops at the
 *  next `## ` — the same rule the pod uses, so the two cannot disagree about
 *  where a section ends. */
export function section(markdown: string, name: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((l) => l.trimEnd() === `## ${name}`)
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

/** The plan as checkboxes. Anything that is not a checkbox line is not a step —
 *  a note under the plan is prose, not work. */
export function planSteps(markdown: string): PlanStep[] {
  return section(markdown, 'Plan')
    .split('\n')
    .map((line) => /^-\s\[( |x|X)\]\s*(.*)$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ done: (m[1] ?? '').toLowerCase() === 'x', text: (m[2] ?? '').trim() }))
}

/** Placeholder bodies the agent writes to say "nothing here" — shown as empty
 *  rather than as content, so a detail screen does not present "(none)" as a
 *  blocker. */
export function isEmptySection(body: string): boolean {
  const t = body.trim()
  return t === '' || t === '(none)' || t === '(nothing yet)'
}
