import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  addableFields,
  INTERPOLATES,
  typedFields,
  untypedKeys,
  variablesInScope,
  type Field,
  type RowColumn,
} from './nodeFields'
import { handlesOf, look, vendorOf } from './nodeKinds'
import type { FlowEdge, FlowNode, SavedFlow } from '@/types'
import { cn } from '@/lib/cn'

/**
 * One node's settings.
 *
 * Typed controls for the fields this build knows, and a JSON editor for
 * everything else — including a vendor node's whole payload, which this app has
 * no standing to put labels on. The JSON half is not a fallback for something
 * unfinished; it is the only honest way to edit a field whose meaning belongs to
 * somebody else.
 */
export function Inspector({
  flow,
  node,
  onData,
  onRename,
  onDelete,
}: {
  flow: SavedFlow
  node: FlowNode
  onData: (patch: Record<string, unknown>) => void
  onRename: (to: string) => void
  onDelete: () => void
}) {
  const info = look(node.node_type)
  const vendor = vendorOf(node.node_type)
  const data = (node.data ?? {}) as Record<string, unknown>
  // Typed controls only for values a typed control can show — an object in a
  // text box would render `[object Object]` and write it back on blur.
  const fields = typedFields(node.node_type, data)
  const extras = untypedKeys(node.node_type, data)
  const addable = addableFields(node.node_type, data)
  const scope = variablesInScope(flow.flow.nodes)

  return (
    <div className="flex h-full flex-col overflow-y-auto border-l border-line bg-surface">
      <header className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-ink">{info.label}</div>
          <div className="truncate font-mono text-[11px] text-ink-3">
            {vendor ? node.node_type : info.label.toLowerCase()}
          </div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          title="Delete this step"
          className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-hover hover:text-red"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex flex-col gap-3 px-3 py-3">
        <Labelled label="Step id" hint="Edges follow a rename; nothing has to be rewired.">
          <TextField value={node.id} onCommit={onRename} mono />
        </Labelled>

        {fields.map((f) => (
          <Labelled
            key={f.key}
            label={f.label}
            hint={
              INTERPOLATES.has(f.key)
                ? [f.hint, `Variables: ${scope.map((v) => `{{${v}}}`).join(', ')}`]
                    .filter(Boolean)
                    .join(' ')
                : f.hint
            }
          >
            {f.kind === 'select' ? (
              <select
                value={String(data[f.key] ?? '')}
                onChange={(e) => onData({ [f.key]: e.target.value || undefined })}
                className="w-full rounded-md border border-line bg-field px-2 py-1.5 text-[12.5px] text-ink"
              >
                <option value="">—</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : f.kind === 'rows' ? (
              <RowsField
                field={f}
                rows={data[f.key]}
                onCommit={(rows) => onData({ [f.key]: rows })}
              />
            ) : f.kind === 'any' ? (
              <AnyField
                value={data[f.key]}
                onCommit={(v) => onData({ [f.key]: v })}
              />
            ) : f.kind === 'multiline' ? (
              <TextField
                value={String(data[f.key] ?? '')}
                onCommit={(v) => onData({ [f.key]: v || undefined })}
                multiline
              />
            ) : (
              <TextField
                value={String(data[f.key] ?? '')}
                onCommit={(v) =>
                  onData({
                    [f.key]:
                      f.kind === 'number' ? (v === '' ? undefined : Number(v)) : v || undefined,
                  })
                }
                numeric={f.kind === 'number'}
              />
            )}
          </Labelled>
        ))}

        {/* Always shown, even with nothing in it. It is the only way to put a key
            on a node that has no typed control for it — and a field that exists
            in the spec but not in this table (`tool.args`, `http.body`) was
            unreachable while this was hidden behind having one already. */}
        <Labelled
          label={fields.length > 0 ? 'Other settings' : 'Settings'}
          hint={
            vendor
              ? `Defined by ${vendor}, not by this app — edited as JSON so nothing is lost.`
              : 'Edited as JSON. Structured lists (conditions, outputs) live here.'
          }
        >
          <JsonField
            value={Object.fromEntries(extras.map((k) => [k, data[k]]))}
            onCommit={(patch) => {
              // Keys removed in the editor have to be sent as `undefined` or
              // the merge would silently keep them.
              const cleared = Object.fromEntries(extras.map((k) => [k, undefined]))
              onData({ ...cleared, ...patch })
            }}
          />
        </Labelled>

        {addable.length > 0 && (
          <Labelled
            label="Add a field"
            hint="Accepted by this step, not set yet. Starts as an empty shape to fill in."
          >
            <div className="flex flex-wrap gap-1.5">
              {addable.map(([key, skeleton]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onData({ [key]: skeleton })}
                  className={cn(
                    'rounded-chip border border-line px-2 py-0.5 font-mono text-[11px] text-ink-2',
                    'transition-colors hover:bg-hover hover:text-ink',
                  )}
                >
                  + {key}
                </button>
              ))}
            </div>
          </Labelled>
        )}
      </div>
    </div>
  )
}

/**
 * One edge's settings — which output of the source node it leaves from.
 *
 * The whole reason this pane exists. A `branch` picks one of its declared
 * handles at runtime and the edges have to say which is which; the canvas draws
 * handle names as edge labels rather than as ports (see `FlowGraph`), so
 * without somewhere to set the name, a branch could be built here and never be
 * saveable — the pod answers "no edge for handle yes" and nothing on screen
 * offers a way to fix it.
 *
 * The source's declared handles are offered, and a free-text box stays for
 * anything this build cannot derive, because a vendor node's handles belong to
 * the vendor.
 */
export function EdgeInspector({
  flow,
  edge,
  onHandle,
  onDelete,
}: {
  flow: SavedFlow
  edge: FlowEdge
  onHandle: (handle?: string) => void
  onDelete: () => void
}) {
  const source = flow.flow.nodes.find((n) => n.id === edge.source)
  const options = source
    ? handlesOf(source.node_type, (source.data ?? {}) as Record<string, unknown>)
    : []
  const current = edge.source_handle ?? ''
  // An edge already carrying a handle this build did not derive still belongs in
  // the list, or selecting it back would be impossible after one stray click.
  const choices = [...new Set([...options, ...(current ? [current] : [])])]

  return (
    <div className="flex h-full flex-col overflow-y-auto border-l border-line bg-surface">
      <header className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-ink">Connection</div>
          <div className="truncate font-mono text-[11px] text-ink-3">
            {edge.source} → {edge.target}
          </div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          title="Delete this connection"
          className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-hover hover:text-red"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex flex-col gap-3 px-3 py-3">
        <Labelled
          label="Leaves from"
          hint={
            choices.length > 0
              ? `Which output of "${edge.source}" takes this path.`
              : `"${edge.source}" has one unnamed output — a handle is only needed for a step that forks.`
          }
        >
          <select
            value={choices.includes(current) ? current : ''}
            onChange={(e) => onHandle(e.target.value || undefined)}
            className="w-full rounded-md border border-line bg-field px-2 py-1.5 text-[12.5px] text-ink"
          >
            <option value="">— unnamed —</option>
            {choices.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </Labelled>

        <Labelled label="Or a handle by name" hint="For an output this app cannot derive.">
          <TextField value={current} onCommit={(v) => onHandle(v || undefined)} mono />
        </Labelled>
      </div>
    </div>
  )
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-ink-3">{hint}</span>}
    </label>
  )
}

/**
 * A field that commits on blur, not on every keystroke.
 *
 * Each commit is an undo step and a validation round trip; per-keystroke would
 * make undo walk back through a sentence one letter at a time.
 */
function TextField({
  value,
  onCommit,
  multiline,
  mono,
  numeric,
}: {
  value: string
  onCommit: (value: string) => void
  multiline?: boolean
  mono?: boolean
  numeric?: boolean
}) {
  const [draft, setDraft] = useState(value)
  // Follow the document when it changes underneath — an undo, or another node
  // being selected into the same control.
  useEffect(() => setDraft(value), [value])

  const shared = cn(
    'w-full rounded-md border border-line bg-field px-2 py-1.5 text-[12.5px] text-ink',
    mono && 'font-mono text-[11.5px]',
  )
  const commit = () => draft !== value && onCommit(draft)

  return multiline ? (
    <textarea
      value={draft}
      rows={4}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      className={cn(shared, 'resize-y')}
    />
  ) : (
    <input
      value={draft}
      inputMode={numeric ? 'numeric' : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={shared}
    />
  )
}

/**
 * A list of objects — `branch.outputs`, `conditional.conditions`.
 *
 * These are the fields that decide where a flow *goes*, and they were the last
 * ones edited as raw JSON: a branch's handles, the descriptions the classifier
 * reads to choose between them, the schema its payload must satisfy. Hand-written
 * JSON is a poor way to write the part of a flow that the model reads as prose.
 *
 * One component for both, driven by the `columns` in the field table, for the
 * same reason the table exists at all: the version that is two bespoke editors
 * is the version where one of them stops matching the spec.
 *
 * A row is patched, never rebuilt — a key this build does not know (a field from
 * a newer pod) survives editing the ones it does.
 */
function RowsField({
  field,
  rows,
  onCommit,
}: {
  field: Field
  rows: unknown
  onCommit: (rows: Record<string, unknown>[]) => void
}) {
  const list = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]
  const columns = field.columns ?? []
  const noun = field.rowNoun ?? 'row'
  const patch = (i: number, p: Record<string, unknown>) =>
    onCommit(list.map((row, j) => (j === i ? { ...row, ...p } : row)))

  return (
    <div className="flex flex-col gap-1.5">
      {list.map((row, i) => (
        // Index as key: rows have no id, and the only reorder is delete, which
        // rerenders the whole list from the document anyway.
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="rounded-md border border-line bg-field/50 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-ink-3">
              {noun} {i + 1}
            </span>
            <button
              type="button"
              onClick={() => onCommit(list.filter((_, j) => j !== i))}
              title={`Remove this ${noun}`}
              className="rounded p-0.5 text-ink-3 transition-colors hover:bg-hover hover:text-red"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {columns.map((c) => (
              <Cell key={c.key} column={c} value={row[c.key]} onCommit={(v) => patch(i, { [c.key]: v })} />
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onCommit([...list, { ...(field.newRow ?? {}) }])}
        className={cn(
          'flex items-center justify-center gap-1 rounded-md border border-dashed border-line py-1',
          'text-[11.5px] text-ink-3 transition-colors hover:bg-hover hover:text-ink',
        )}
      >
        <Plus className="h-3 w-3" /> Add {noun}
      </button>
    </div>
  )
}

/** One cell of a row, by column kind. */
function Cell({
  column,
  value,
  onCommit,
}: {
  column: RowColumn
  value: unknown
  onCommit: (value: unknown) => void
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-ink-3">{column.label}</span>
      {column.kind === 'select' ? (
        <select
          value={String(value ?? column.options?.[0] ?? '')}
          onChange={(e) => onCommit(e.target.value)}
          className="w-full rounded-md border border-line bg-field px-1.5 py-1 text-[11.5px] text-ink"
        >
          {(column.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : column.kind === 'any' ? (
        <AnyField value={value} onCommit={onCommit} compact />
      ) : column.kind === 'json' ? (
        <JsonValueField value={value} onCommit={onCommit} placeholder={column.placeholder} />
      ) : (
        <TextField
          value={typeof value === 'string' ? value : value == null ? '' : String(value)}
          onCommit={(v) => onCommit(v || undefined)}
          mono={column.mono}
          placeholder={column.placeholder}
          compact
        />
      )}
    </label>
  )
}

/** A single JSON value — a branch output's payload schema. Held, not discarded,
 *  while it does not parse: JSON is typed one character at a time. */
function JsonValueField({
  value,
  onCommit,
  placeholder,
}: {
  value: unknown
  onCommit: (value: unknown) => void
  placeholder?: string
}) {
  const text = value === undefined ? '' : JSON.stringify(value)
  const [draft, setDraft] = useState(text)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setDraft(text)
    setBad(false)
  }, [text])

  return (
    <input
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === text) return
        if (draft.trim() === '') {
          setBad(false)
          return onCommit(undefined)
        }
        try {
          onCommit(JSON.parse(draft) as unknown)
          setBad(false)
        } catch {
          setBad(true)
        }
      }}
      className={cn(
        'w-full rounded-md border bg-field px-1.5 py-1 font-mono text-[11px] text-ink',
        bad ? 'border-red' : 'border-line',
      )}
    />
  )
}

/**
 * A field whose value may be any JSON type.
 *
 * `set_variable.value` is `any` in the spec, and a text-only control quietly
 * made every one of them a string: a flow authored with `value: 42` showed
 * `42`, and the next blur wrote `"42"`. A `{{template}}` is a string and has to
 * keep reading as one, so the rule is the one people already expect from a
 * config file — text that parses as JSON is that JSON, and text that does not
 * is a string.
 */
function AnyField({ value, onCommit }: { value: unknown; onCommit: (value: unknown) => void }) {
  const text = typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value)
  return (
    <TextField
      value={text}
      multiline
      onCommit={(v) => {
        if (v === '') return onCommit(undefined)
        try {
          onCommit(JSON.parse(v) as unknown)
        } catch {
          onCommit(v)
        }
      }}
    />
  )
}

/** Raw JSON, rejected loudly rather than saved as something else. */
function JsonField({
  value,
  onCommit,
}: {
  value: Record<string, unknown>
  onCommit: (value: Record<string, unknown>) => void
}) {
  const text = JSON.stringify(value, null, 2)
  const [draft, setDraft] = useState(text)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setDraft(text)
    setBad(false)
  }, [text])

  return (
    <>
      <textarea
        value={draft}
        rows={Math.min(14, draft.split('\n').length + 1)}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === text) return
          try {
            const parsed: unknown = JSON.parse(draft)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              setBad(true)
              return
            }
            setBad(false)
            onCommit(parsed as Record<string, unknown>)
          } catch {
            // Held, not discarded: the text stays for editing rather than
            // snapping back and losing what someone typed.
            setBad(true)
          }
        }}
        className={cn(
          'w-full resize-y rounded-md border bg-field px-2 py-1.5 font-mono text-[11.5px] text-ink',
          bad ? 'border-red' : 'border-line',
        )}
      />
      {bad && <span className="text-[11px] text-red">Not a JSON object — not saved.</span>}
    </>
  )
}
