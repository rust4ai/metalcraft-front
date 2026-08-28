import type { SavedFlow } from '@/types'

/**
 * The parameters a flow asks for, and turning what someone typed into them.
 *
 * A flow's entry node may declare typed `inputs` that seed its state — the way
 * a template says "this one is about *a* repo, not *my* repo". Until this the
 * Run button sent none of them, so every flow that declared one ran with its
 * inputs unset: the pod now warns rather than refusing, which means the failure
 * moved from an error message to a prompt quietly reading "summarize commits in
 * ".
 *
 * Kept separate from the dialog because the conversion is the part that can be
 * wrong. `{"per_page": "50"}` and `{"per_page": 50}` are different requests —
 * an HTML input only ever hands back a string, and the pod passes the value
 * through with its JSON type intact.
 */

/** One declared parameter, as the entry node's `data.inputs` describes it. */
export interface FlowInput {
  name: string
  /** JSON type name from the spec — `string`, `integer`, `number`, `boolean`.
   *  Advisory there, and advisory here: it picks the control and the parse. */
  type: string
  required: boolean
  /** The value used when nothing is supplied. Already the right JSON type. */
  default?: unknown
}

/**
 * What this flow asks for, in declaration order.
 *
 * Empty for a flow that declares nothing — which is most of them, and the case
 * where Run should stay a single click rather than growing a dialog that asks
 * nothing.
 */
export function declaredInputs(flow: SavedFlow): FlowInput[] {
  const entry = flow.flow.nodes.find((n) => n.node_type === 'entry')
  const data = entry?.data
  if (!data || typeof data !== 'object') return []
  const inputs = (data as { inputs?: unknown }).inputs
  if (!inputs || typeof inputs !== 'object') return []
  return Object.entries(inputs as Record<string, unknown>).map(([name, raw]) => {
    const spec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    return {
      name,
      type: typeof spec.type === 'string' ? spec.type : 'string',
      required: spec.required === true,
      default: spec.default,
    }
  })
}

/** What a field starts at: the declared default, as text someone can edit. */
export function initialText(input: FlowInput): string {
  if (input.default === undefined || input.default === null) return ''
  return typeof input.default === 'string' ? input.default : JSON.stringify(input.default)
}

/**
 * The `inputs` object to send, from what was typed.
 *
 * A field left empty is **omitted rather than sent as `""`**: absent means "use
 * the declared default", and an empty string would override that default with
 * nothing — turning a field someone simply did not touch into a deliberate
 * blank.
 */
export function collectInputs(
  inputs: FlowInput[],
  text: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const input of inputs) {
    const raw = text[input.name]
    if (raw === undefined || raw.trim() === '') continue
    out[input.name] = coerce(raw, input.type)
  }
  return out
}

/** Which declared-and-required inputs still have nothing to send. */
export function unfilled(inputs: FlowInput[], text: Record<string, string>): string[] {
  return inputs
    .filter((i) => i.required && i.default === undefined)
    .filter((i) => (text[i.name] ?? '').trim() === '')
    .map((i) => i.name)
}

/**
 * A typed field's text as the JSON value the pod expects.
 *
 * Numbers and booleans are parsed because the flow interpolates a whole `{{x}}`
 * as the referenced *value*, keeping its type: a `limit` of `"100"` reaches a
 * tool as a string where its schema says integer. Anything that fails to parse
 * is sent as the text it is — the pod's own error about the wrong type is more
 * use than this guessing.
 */
function coerce(raw: string, type: string): unknown {
  const text = raw.trim()
  switch (type) {
    case 'integer':
    case 'number': {
      const n = Number(text)
      return Number.isFinite(n) ? n : raw
    }
    case 'boolean': {
      if (/^(true|yes|1)$/i.test(text)) return true
      if (/^(false|no|0)$/i.test(text)) return false
      return raw
    }
    case 'object':
    case 'array': {
      try {
        return JSON.parse(text)
      } catch {
        return raw
      }
    }
    default:
      // Strings keep their whitespace: a prompt fragment is not a token, and
      // trimming one is this app editing what someone wrote.
      return raw
  }
}
