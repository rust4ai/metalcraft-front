/**
 * What each node type's `data` holds, as a table.
 *
 * A table rather than thirteen bespoke forms. The forms would all be the same
 * four controls in different orders, and the version that is thirteen components
 * is the version where one of them quietly stops matching the spec because
 * nobody edits a file they have no reason to open.
 *
 * Fields listed here get a typed control. **Anything not listed is still
 * editable** — the inspector shows the rest of `data` as JSON — because this
 * table can only ever describe the spec as of this build, and the pod is rolled
 * independently of it. A node type nobody here has heard of is all JSON, which
 * is exactly right: this build has no standing to put a label on a vendor's
 * field.
 */
export interface Field {
  key: string
  label: string
  kind: 'text' | 'multiline' | 'number' | 'select'
  /** Placeholder or hint, shown under the control. */
  hint?: string
  options?: string[]
}

/** Fields that take `{{path}}` interpolation against the run's variables. */
export const INTERPOLATES = new Set([
  'prompt',
  'task',
  'message',
  'url',
  'body',
  'value',
  'query',
  'list',
  'until',
])

export const NODE_FIELDS: Record<string, Field[]> = {
  entry: [],
  prompt: [
    { key: 'prompt', label: 'Prompt', kind: 'multiline', hint: 'What to ask the model.' },
    { key: 'persona', label: 'Persona', kind: 'text' },
    { key: 'model', label: 'Model', kind: 'text' },
    {
      key: 'output_var',
      label: 'Store answer as',
      kind: 'text',
      hint: 'A variable later steps can read with {{name}}.',
    },
  ],
  conditional: [
    {
      key: 'default_handle',
      label: 'Default handle',
      kind: 'text',
      hint: 'Taken when no condition matches.',
    },
  ],
  branch: [
    { key: 'query', label: 'Question', kind: 'multiline', hint: 'What the model decides.' },
    { key: 'persona', label: 'Persona', kind: 'text' },
    { key: 'default_handle', label: 'Default handle', kind: 'text' },
    { key: 'timeout', label: 'Timeout (seconds)', kind: 'number' },
  ],
  set_variable: [
    { key: 'variable', label: 'Variable', kind: 'text' },
    { key: 'value', label: 'Value', kind: 'multiline', hint: 'A literal, or a {{template}}.' },
    { key: 'from', label: 'Or copy from', kind: 'text', hint: 'A dotted path into _last.' },
  ],
  tool: [
    { key: 'tool_name', label: 'Tool', kind: 'text' },
    { key: 'output_var', label: 'Store result as', kind: 'text' },
  ],
  http: [
    {
      key: 'method',
      label: 'Method',
      kind: 'select',
      options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
    { key: 'url', label: 'URL', kind: 'text' },
    { key: 'output_var', label: 'Store response as', kind: 'text' },
  ],
  sub_agent: [
    { key: 'task', label: 'Task', kind: 'multiline' },
    { key: 'persona', label: 'Persona', kind: 'text' },
    { key: 'tool_set', label: 'Tool set', kind: 'text' },
    { key: 'pack', label: 'Pack', kind: 'text' },
    { key: 'output_var', label: 'Store result as', kind: 'text' },
  ],
  approval: [
    { key: 'message', label: 'Ask', kind: 'multiline', hint: 'What the person is deciding.' },
    { key: 'timeout', label: 'Timeout (seconds)', kind: 'number' },
  ],
  wait: [
    { key: 'duration', label: 'For', kind: 'text', hint: 'e.g. 10m, 2h.' },
    { key: 'until', label: 'Or until', kind: 'text', hint: 'An RFC-3339 time.' },
  ],
  foreach: [
    { key: 'list', label: 'List', kind: 'text', hint: 'The variable to fan out over.' },
    { key: 'item_var', label: 'Each item as', kind: 'text' },
    { key: 'mode', label: 'Mode', kind: 'select', options: ['sequential', 'concurrent'] },
    { key: 'body_entry', label: 'Body starts at', kind: 'text' },
  ],
  end: [
    { key: 'status', label: 'Status', kind: 'text' },
  ],
}

/** The typed fields for a node type — empty for anything not described here. */
export const fieldsFor = (nodeType: string): Field[] => NODE_FIELDS[nodeType] ?? []

/**
 * The keys of `data` this build has no control for, which the inspector offers
 * as raw JSON.
 *
 * Includes the structured ones on purpose — `conditional.conditions` and
 * `branch.outputs` are lists of typed rows, and a row editor for them is real UI
 * that has not been built. Editing them as JSON is honest and complete; a
 * half-built row editor that silently could not express a field would not be.
 */
export function untypedKeys(nodeType: string, data: Record<string, unknown>): string[] {
  const typed = new Set(fieldsFor(nodeType).map((f) => f.key))
  return Object.keys(data).filter((k) => !typed.has(k))
}

/** Variables a node can read: everything an upstream step stored, plus the
 *  reserved ones the runtime always provides. */
export function variablesInScope(nodes: Array<{ data: unknown }>): string[] {
  const named = nodes
    .map((n) => (n.data as Record<string, unknown> | null)?.output_var)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  // `_last` is the payload of the edge just traversed, `_inputs` the entry's
  // parameters — always there, and the two people reach for first.
  return [...new Set(['_last', '_inputs', ...named])]
}
