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
  /** `any` is a JSON-typed field: a string stays a string (so `{{template}}`
   *  reads as itself), anything that parses as JSON keeps its type. `rows` is a
   *  list of objects — `branch.outputs`, `conditional.conditions`. */
  kind: 'text' | 'multiline' | 'number' | 'select' | 'any' | 'rows'
  /** Placeholder or hint, shown under the control. */
  hint?: string
  options?: string[]
  /** For `rows`: what one row holds. */
  columns?: RowColumn[]
  /** For `rows`: the shape a new row starts at, and the button's noun. */
  newRow?: Record<string, unknown>
  rowNoun?: string
}

/** One cell of a `rows` field. */
export interface RowColumn {
  key: string
  label: string
  kind: 'text' | 'select' | 'any' | 'json'
  options?: string[]
  mono?: boolean
  placeholder?: string
}

/**
 * Condition operators, in the pod's own wire spelling.
 *
 * Copied from `metalcraft-flows`' `Operator::from_wire` — a typo here is a flow
 * that validates on this screen and is refused by the pod with
 * `UnknownOperator`, so they are offered as a list rather than typed.
 */
export const OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'starts_with',
  'ends_with',
  'gt',
  'lt',
  'exists',
  'truthy',
  'matches',
]

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
      key: 'conditions',
      label: 'Conditions',
      kind: 'rows',
      hint: 'Checked in order; the first match takes its handle.',
      rowNoun: 'condition',
      newRow: { variable: '_last', operator: 'equals', value: '', handle: '' },
      columns: [
        { key: 'variable', label: 'Variable', kind: 'text', mono: true, placeholder: '_last' },
        { key: 'operator', label: 'Is', kind: 'select', options: OPERATORS },
        { key: 'value', label: 'Value', kind: 'any' },
        { key: 'handle', label: 'Then handle', kind: 'text', mono: true },
      ],
    },
    {
      key: 'default_handle',
      label: 'Default handle',
      kind: 'text',
      hint: 'Taken when no condition matches.',
    },
  ],
  branch: [
    { key: 'query', label: 'Question', kind: 'multiline', hint: 'What the model decides.' },
    {
      key: 'outputs',
      label: 'Outputs',
      kind: 'rows',
      hint: 'The model picks exactly one. Each handle is a port on the card — wire it from there.',
      rowNoun: 'output',
      newRow: { handle: '' },
      columns: [
        { key: 'handle', label: 'Handle', kind: 'text', mono: true },
        {
          key: 'description',
          label: 'When to pick it',
          kind: 'text',
          placeholder: 'What this outcome means',
        },
        { key: 'schema', label: 'Payload', kind: 'json', placeholder: '{"type":"string"}' },
        { key: 'var', label: 'Store payload as', kind: 'text', mono: true },
      ],
    },
    { key: 'persona', label: 'Persona', kind: 'text' },
    { key: 'model', label: 'Model', kind: 'text' },
    { key: 'default_handle', label: 'Default handle', kind: 'text' },
    { key: 'timeout', label: 'Timeout (seconds)', kind: 'number' },
  ],
  set_variable: [
    { key: 'variable', label: 'Variable', kind: 'text' },
    {
      key: 'value',
      label: 'Value',
      kind: 'any',
      hint: 'A literal, or a {{template}}. Numbers, booleans, objects and lists keep their type.',
    },
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

/**
 * The `data` a newly added node starts with.
 *
 * Not cosmetic. Two core types have **required** fields the pod's validator
 * parses structurally (`branch.query` + `branch.outputs`, `conditional.conditions`),
 * so a node added with an empty payload is rejected the moment it appears —
 * "expected branch data: missing field `query`" — for something the person has
 * not had a chance to type yet. Worse, the list fields are edited as JSON, and
 * the JSON editor can only show keys that are already there: an empty branch
 * offered no way to declare an output at all.
 *
 * So the seed is exactly the required shape and nothing else. Empty strings and
 * a starter handle, not invented content — the node reads as unfinished, which
 * it is, and every field it needs is on screen.
 */
const NEW_NODE_DATA: Record<string, () => Record<string, unknown>> = {
  branch: () => ({ query: '', outputs: [{ handle: 'yes' }, { handle: 'no' }] }),
  conditional: () => ({ conditions: [] }),
  // Not required, but the card already reads a missing method as GET and the
  // runtime needs one — writing down what is already assumed beats a node that
  // means GET but does not say so.
  http: () => ({ method: 'GET' }),
  foreach: () => ({ mode: 'sequential' }),
}

/** The starting `data` for a node of this type — `{}` unless it needs more. */
export const newNodeData = (nodeType: string): Record<string, unknown> =>
  NEW_NODE_DATA[nodeType]?.() ?? {}

/**
 * Optional fields a type accepts that have **no typed control**, with the shape
 * to start them at.
 *
 * The JSON editor can only show keys that are already on the node, so before
 * this a fresh `tool` node could not be given `args` at all — there was no
 * control for it and no key to edit. The fields are real and documented in the
 * spec; the only thing missing was somewhere to put them.
 *
 * Skeletons, not content: an empty object, or the choices `approval` already
 * defaults to. Enough that the JSON editor has something to show.
 */
const ADDABLE: Record<string, Record<string, unknown>> = {
  entry: { inputs: {} },
  prompt: { output_schema: { type: 'object' } },
  tool: { args: {} },
  http: { headers: {}, body: {} },
  approval: { choices: ['approve', 'reject'] },
  end: { outputs: {} },
}

/** The fields this type accepts that are not on the node yet, as `[key, skeleton]`. */
export function addableFields(
  nodeType: string,
  data: Record<string, unknown>,
): Array<[string, unknown]> {
  return Object.entries(ADDABLE[nodeType] ?? {}).filter(([key]) => !(key in data))
}

/**
 * Whether a typed control can show this value without lying about it.
 *
 * A text box given an object renders `[object Object]` and writes that string
 * back on the next blur — the one thing this editor promises never to do. Such a
 * value falls through to the JSON editor instead, where it is the truth.
 */
const representable = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  typeof v === 'string' ||
  typeof v === 'number' ||
  typeof v === 'boolean'

/** Whether this control can show this value. `any` takes anything; a row editor
 *  takes a list and nothing else. */
const canShow = (field: Field, v: unknown): boolean => {
  if (field.kind === 'any') return true
  if (field.kind === 'rows') return v === undefined || Array.isArray(v)
  return representable(v)
}

/** The typed controls to show for a node, given what its `data` actually holds. */
export function typedFields(nodeType: string, data: Record<string, unknown>): Field[] {
  return fieldsFor(nodeType).filter((f) => canShow(f, data[f.key]))
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
  const typed = new Set(typedFields(nodeType, data).map((f) => f.key))
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
