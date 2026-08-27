import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { fieldsFor, INTERPOLATES, untypedKeys, variablesInScope } from './nodeFields'
import { look, vendorOf } from './nodeKinds'
import type { FlowNode, SavedFlow } from '@/types'
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
  const fields = fieldsFor(node.node_type)
  const extras = untypedKeys(node.node_type, data)
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

        {extras.length > 0 && (
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
        )}
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
