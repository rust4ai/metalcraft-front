import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, Plus, Redo2, Save, Undo2 } from 'lucide-react'
import { automations } from '@/rpc'
import { FlowGraph } from './FlowGraph'
import { EdgeInspector, Inspector } from './Inspector'
import { CORE_NODES, look } from './nodeKinds'
import {
  addNode,
  apply,
  connect,
  deleteEdge,
  deleteNode,
  editNodeData,
  historyOf,
  localProblems,
  moveNode,
  redo,
  renameNode,
  setEdgeHandle,
  undo,
  type History,
} from './edit'
import type { SavedFlow } from '@/types'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/**
 * Editing a flow.
 *
 * Three panes and one rule: **the pod is the authority**. Everything here is a
 * draft until `PUT /flows/{id}` accepts it, and that endpoint validates again
 * regardless of what this screen believed. What the client adds is speed — the
 * two or three problems it can answer without a round trip, and the pod's own
 * verdict on everything else while someone is still typing rather than after
 * they press save.
 */
export function FlowEditor({
  flow: initial,
  onSaved,
  onClose,
}: {
  flow: SavedFlow
  onSaved: (flow: SavedFlow) => void
  onClose: () => void
}) {
  const [history, setHistory] = useState<History>(() => historyOf(initial))
  const [selectedId, setSelectedId] = useState<string>()
  // A node and an edge are one selection between them — the right pane shows
  // whichever was clicked last, so picking one clears the other.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>()
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [podProblems, setPodProblems] = useState<string[]>()

  const flow = history.present
  const dirty = flow !== initial
  const selected = flow.flow.nodes.find((n) => n.id === selectedId)
  const selectedEdge = flow.flow.edges.find((e) => e.id === selectedEdgeId)

  const edit = useCallback((next: SavedFlow) => setHistory((h) => apply(h, next)), [])

  // Ask the pod what is wrong, debounced. The client's own checks are instant
  // and cover almost nothing; this is the real validator, and it runs while
  // someone is still editing because that is when the answer can still change
  // what they do.
  const latest = useRef(flow)
  latest.current = flow
  useEffect(() => {
    const timer = setTimeout(() => {
      const asked = latest.current
      automations
        .validate(asked)
        .then((v) => {
          // A verdict on a flow that has since changed is worse than none — it
          // would point at something no longer on screen.
          if (latest.current === asked) setPodProblems(v.valid ? [] : v.errors)
        })
        .catch(() => setPodProblems(undefined))
    }, 400)
    return () => clearTimeout(timer)
  }, [flow])

  const local = localProblems(flow)
  const problems = [...local, ...(podProblems ?? [])]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        setHistory(undo)
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault()
        setHistory(redo)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function save() {
    setSaving(true)
    setSaveError(undefined)
    try {
      const saved = await automations.save(flow)
      onSaved(saved)
    } catch (e) {
      // The pod's own words. It refuses a graph it cannot run, and its reason is
      // the useful one — this screen must not paraphrase it.
      setSaveError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{flow.name}</div>
          <div className="truncate text-xs text-ink-2">
            {flow.flow.nodes.length === 1 ? '1 step' : `${flow.flow.nodes.length} steps`}
            {dirty && ' · unsaved'}
          </div>
        </div>

        <div className="relative">
          <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
            <Plus className="h-4 w-4" /> Add step
          </Button>
          {adding && (
            <Palette
              onPick={(type) => {
                // Dropped to the right of everything, so a new step never lands
                // underneath one already on the canvas.
                const x = Math.max(0, ...flow.flow.nodes.map((n) => n.position?.[0] ?? 0)) + 260
                const next = addNode(flow, type, [x, 0])
                edit(next)
                setSelectedId(next.flow.nodes.at(-1)?.id)
                setSelectedEdgeId(undefined)
                setAdding(false)
              }}
              onClose={() => setAdding(false)}
            />
          )}
        </div>

        <Button variant="ghost" size="sm" disabled={history.past.length === 0} onClick={() => setHistory(undo)}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" disabled={history.future.length === 0} onClick={() => setHistory(redo)}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </header>

      {(problems.length > 0 || saveError) && (
        <div className="border-b border-line bg-orange-tint px-4 py-1.5">
          {saveError && (
            <p className="text-[11.5px] text-red">The pod refused this: {saveError}</p>
          )}
          {problems.map((p) => (
            <p key={p} className="flex items-start gap-1.5 text-[11.5px] text-orange">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              {p}
            </p>
          ))}
        </div>
      )}
      {problems.length === 0 && podProblems?.length === 0 && dirty && (
        <p className="flex items-center gap-1.5 border-b border-line px-4 py-1.5 text-[11.5px] text-ink-3">
          <Check className="h-3.5 w-3.5 text-green" /> The pod says this will save.
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <FlowGraph
            definition={flow.flow}
            edit={{
              selectedId,
              selectedEdgeId,
              onSelect: (id) => {
                setSelectedId(id)
                if (id) setSelectedEdgeId(undefined)
              },
              onSelectEdge: (id) => {
                setSelectedEdgeId(id)
                if (id) setSelectedId(undefined)
              },
              onMove: (id, to) => edit(moveNode(flow, id, to)),
              onConnect: (source, target) => edit(connect(flow, source, target)),
              onDeleteNode: (id) => {
                edit(deleteNode(flow, id))
                setSelectedId((s) => (s === id ? undefined : s))
              },
              onDeleteEdge: (id) => {
                edit(deleteEdge(flow, id))
                setSelectedEdgeId((s) => (s === id ? undefined : s))
              },
            }}
          />
        </div>
        {selected && (
          <div className="w-80 shrink-0">
            <Inspector
              flow={flow}
              node={selected}
              onData={(patch) => edit(editNodeData(flow, selected.id, patch))}
              onRename={(to) => {
                edit(renameNode(flow, selected.id, to))
                setSelectedId(to)
              }}
              onDelete={() => {
                edit(deleteNode(flow, selected.id))
                setSelectedId(undefined)
              }}
            />
          </div>
        )}
        {!selected && selectedEdge && (
          <div className="w-80 shrink-0">
            <EdgeInspector
              flow={flow}
              edge={selectedEdge}
              onHandle={(handle) => edit(setEdgeHandle(flow, selectedEdge.id, handle))}
              onDelete={() => {
                edit(deleteEdge(flow, selectedEdge.id))
                setSelectedEdgeId(undefined)
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The steps that can be added.
 *
 * Core types only. A vendor type belongs to a pack, and this app has no list of
 * what a given pod's packs provide — offering a guess would be offering steps
 * that fail to run. Existing vendor nodes are still fully editable; they just
 * cannot be conjured from here.
 */
function Palette({ onPick, onClose }: { onPick: (type: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // `branch_tool` is deprecated: round-tripped when present, never offered.
  const types = Object.keys(CORE_NODES).filter((t) => t !== 'branch_tool')

  return (
    <div className="absolute right-0 top-full z-20 mt-1.5 w-56 rounded-card border border-line bg-surface py-1 shadow-lg">
      {types.map((type) => {
        const info = look(type)
        const Icon = info.icon
        return (
          <button
            key={type}
            type="button"
            onClick={() => onPick(type)}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink',
              'transition-colors hover:bg-hover',
            )}
          >
            <Icon className="h-3.5 w-3.5 text-ink-3" />
            {info.label}
          </button>
        )
      })}
    </div>
  )
}
