/**
 * The pod's OTLP trace, turned into something a person can read.
 *
 * Named `turnTrace` rather than `trace` because `Trace.tsx` in this folder is
 * already the tool-call trace in the transcript, and on a case-insensitive
 * filesystem the two would be the same module.
 *
 * The pod writes one OpenTelemetry document per run (`traces/<id>/otlp-trace.json`,
 * GenAI semantic conventions): a session span, a span per turn under it, and
 * under each turn a span per model call and per tool execution. That document is
 * the only place the *durations* live — a chat's frames say what happened and its
 * diagnostics files say what was sent, but neither says where six minutes went.
 *
 * Two things this parser has to get right:
 *
 * - **Timestamps are unix nanoseconds**, which is about 1.8e18 — two hundred
 *   times past `Number.MAX_SAFE_INTEGER`. They arrive as strings for that
 *   reason, and are subtracted as `BigInt` before ever becoming a number. Parsing
 *   them with `Number()` first loses hundreds of microseconds per value, which is
 *   invisible in a six-minute turn and wrong in a fast one.
 * - **A gap is evidence.** The time between a turn span starting and its first
 *   child starting is compaction, memory recall and prompt building — work that
 *   has no span of its own. Reporting it as a named prelude rather than letting
 *   it vanish into the turn total is the whole point of reading the trace.
 *
 * Tolerant by construction: a document that is missing, truncated, or written by
 * a newer pod yields fewer turns rather than an exception. A debug view that
 * throws is worth less than one that shows what it could read.
 */

/** A model call, a tool run, or something a newer pod traces that we don't know. */
export type StepKind = 'model' | 'tool' | 'other'

export interface TokenUse {
  input?: number
  output?: number
  total?: number
  reasoning?: number
  /** Served from the provider's prompt cache — cheap input, and worth seeing. */
  cached?: number
}

export interface TurnStep {
  id: string
  kind: StepKind
  /** The model name, or the tool name. */
  label: string
  /** Milliseconds from the start of the turn, for laying the step out in time. */
  offsetMs: number
  durationMs: number
  tokens?: TokenUse
  /** Tool arguments, or the assistant's text — whatever the span carried. */
  detail?: string
  /** The span reported an error status. */
  failed: boolean
}

export interface TurnTrace {
  id: string
  /** The pod's own turn number within the run. */
  index: number
  /** The user message that opened the turn, when the span recorded one. */
  message?: string
  durationMs: number
  /**
   * Time before the first model call or tool: compaction, memory recall, prompt
   * building. Untraced work, visible only as this gap.
   */
  preludeMs: number
  steps: TurnStep[]
  failed: boolean
}

/** OTLP attribute values, as the pod encodes them. */
type AnyValue = {
  stringValue?: string
  intValue?: string | number
  doubleValue?: number
  boolValue?: boolean
}

interface RawSpan {
  spanId?: string
  parentSpanId?: string
  name?: string
  startTimeUnixNano?: string
  endTimeUnixNano?: string
  attributes?: { key?: string; value?: AnyValue }[]
  events?: { name?: string; timeUnixNano?: string; attributes?: { key?: string; value?: AnyValue }[] }[]
  status?: { code?: number; message?: string }
}

const STATUS_ERROR = 2

/** Nanosecond strings, as `BigInt`. See the note at the top of the file. */
function nanos(raw: unknown): bigint | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  try {
    return BigInt(raw)
  } catch {
    return undefined
  }
}

/** A nanosecond difference in milliseconds, to a tenth. Never negative. */
function millisBetween(from: bigint, to: bigint): number {
  const delta = to > from ? to - from : 0n
  // Divide in BigInt down to microseconds, then convert — the quotient is small
  // enough to be exact as a number, which the raw nanosecond value is not.
  return Number(delta / 1000n) / 1000
}

function attrValue(v: AnyValue | undefined): string | number | boolean | undefined {
  if (!v) return undefined
  if (v.stringValue !== undefined) return v.stringValue
  if (v.intValue !== undefined) return Number(v.intValue)
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.boolValue !== undefined) return v.boolValue
  return undefined
}

function attrs(list: RawSpan['attributes']): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const a of list ?? []) {
    const value = attrValue(a?.value)
    if (a?.key && value !== undefined) out[a.key] = value
  }
  return out
}

const num = (v: string | number | boolean | undefined): number | undefined =>
  typeof v === 'number' ? v : undefined

/** Pull every span out of the OTLP envelope, whatever nesting it arrived in. */
function allSpans(doc: unknown): RawSpan[] {
  const out: RawSpan[] = []
  const resources = (doc as { resourceSpans?: unknown[] } | null)?.resourceSpans
  for (const resource of Array.isArray(resources) ? resources : []) {
    const scopes = (resource as { scopeSpans?: unknown[] })?.scopeSpans
    for (const scope of Array.isArray(scopes) ? scopes : []) {
      const spans = (scope as { spans?: unknown[] })?.spans
      for (const span of Array.isArray(spans) ? spans : []) {
        if (span && typeof span === 'object') out.push(span as RawSpan)
      }
    }
  }
  return out
}

function tokensOf(a: Record<string, string | number | boolean>): TokenUse | undefined {
  const use: TokenUse = {
    input: num(a['gen_ai.usage.input_tokens']),
    output: num(a['gen_ai.usage.output_tokens']),
    total: num(a['gen_ai.usage.total_tokens']),
    reasoning: num(a['gen_ai.usage.reasoning_tokens']),
    cached: num(a['gen_ai.usage.cache_read.input_tokens']),
  }
  return Object.values(use).some((v) => v !== undefined) ? use : undefined
}

/**
 * The text a step is worth showing next to its duration: what a tool was called
 * with, or what the model said. Taken from the span's events, where the pod puts
 * message content, falling back to the tool-arguments attribute.
 */
function detailOf(span: RawSpan, a: Record<string, string | number | boolean>): string | undefined {
  for (const ev of span.events ?? []) {
    const evAttrs = attrs(ev?.attributes)
    // A failed span carries its cause under `exception.message`, and that is the
    // one thing worth reading on the step that went wrong.
    const text = evAttrs['content'] ?? evAttrs['exception.message']
    if (typeof text === 'string' && text.trim()) return text
  }
  const args = a['gen_ai.tool.call.arguments']
  return typeof args === 'string' && args.trim() ? args : undefined
}

function stepKind(name: string): StepKind {
  if (name.startsWith('execute_tool')) return 'tool'
  if (name.startsWith('chat ')) return 'model'
  return 'other'
}

/**
 * Read a pod trace document into one entry per agent turn, newest last.
 *
 * Returns `[]` for anything unreadable — a missing document, a run from before
 * tracing, a shape a newer pod invented.
 */
export function readTrace(doc: unknown): TurnTrace[] {
  const spans = allSpans(doc)
  const byParent = new Map<string, RawSpan[]>()
  for (const span of spans) {
    const parent = span.parentSpanId
    if (!parent) continue
    const siblings = byParent.get(parent)
    if (siblings) siblings.push(span)
    else byParent.set(parent, [span])
  }

  const turns: TurnTrace[] = []
  for (const span of spans) {
    if (!span.name?.startsWith('agent turn ')) continue
    const start = nanos(span.startTimeUnixNano)
    const end = nanos(span.endTimeUnixNano)
    if (start === undefined || end === undefined) continue

    const turnAttrs = attrs(span.attributes)
    const children = [...(byParent.get(span.spanId ?? '') ?? [])]
      .map((child) => ({ child, at: nanos(child.startTimeUnixNano) }))
      .filter((c): c is { child: RawSpan; at: bigint } => c.at !== undefined)
      // `sort` rather than `toSorted`: the build targets safari15 for older macOS
      // webviews, and this is already a fresh array from `map`.
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

    const steps: TurnStep[] = children.map(({ child, at }, i) => {
      const childAttrs = attrs(child.attributes)
      const childEnd = nanos(child.endTimeUnixNano) ?? at
      const name = child.name ?? ''
      const kind = stepKind(name)
      return {
        id: child.spanId ?? `${span.spanId}-${i}`,
        kind,
        label:
          (typeof childAttrs['gen_ai.tool.name'] === 'string'
            ? (childAttrs['gen_ai.tool.name'] as string)
            : undefined) ??
          (typeof childAttrs['gen_ai.request.model'] === 'string'
            ? (childAttrs['gen_ai.request.model'] as string)
            : undefined) ??
          name,
        offsetMs: millisBetween(start, at),
        durationMs: millisBetween(at, childEnd),
        tokens: kind === 'model' ? tokensOf(childAttrs) : undefined,
        detail: detailOf(child, childAttrs),
        failed: child.status?.code === STATUS_ERROR,
      }
    })

    // The gap this whole file exists to surface: everything before the first
    // traced step is compaction, recall and prompt building. With no steps at
    // all, the entire turn was prelude — which is exactly what a turn that died
    // before reaching the model looks like.
    const firstStep = children[0]
    const preludeMs = firstStep ? millisBetween(start, firstStep.at) : millisBetween(start, end)

    let message: string | undefined
    for (const ev of span.events ?? []) {
      if (ev?.name !== 'gen_ai.user.message') continue
      const content = attrs(ev.attributes)['content']
      if (typeof content === 'string') message = content
    }

    turns.push({
      id: span.spanId ?? `turn-${turns.length}`,
      index: num(turnAttrs['metalcraft.turn.index']) ?? turns.length + 1,
      message,
      durationMs: millisBetween(start, end),
      preludeMs,
      steps,
      failed: span.status?.code === STATUS_ERROR || steps.some((s) => s.failed),
    })
  }

  // Built here, so sorting in place is sorting our own array. See above re safari15.
  // oxlint-disable-next-line unicorn/no-array-sort
  return turns.sort((a, b) => a.index - b.index)
}

/** `1.4s`, `2m 06s`, `340ms` — the scale a reader actually wants at each size. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms - mins * 60_000) / 1000)
  return `${mins}m ${String(secs).padStart(2, '0')}s`
}

/** `12.4k`, `840` — token counts are read for magnitude, not for their last digit. */
export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
