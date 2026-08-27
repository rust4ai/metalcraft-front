import { useEffect, useState } from 'react'
import { FileText, Loader2, Sparkles } from 'lucide-react'
import { library } from '@/rpc'
import { blankFlow, copyFlow } from './newFlow'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { FlowTemplateSummary, SavedFlow } from '@/types'

/**
 * Starting an automation: from nothing, or from something.
 *
 * Templates are listed first because starting from one is almost always the
 * better move — a shipped template is a working shape, and "blank canvas plus
 * thirteen node types" is a worse first five minutes than "this one, but for my
 * channel".
 *
 * Nothing is written until the editor saves. This mints a document in memory and
 * hands it over; a flow that only exists on screen leaves nothing behind if
 * somebody changes their mind, which is not true of one created up front and
 * abandoned.
 */
export function NewFlowDialog({
  takenIds,
  onStart,
  onClose,
}: {
  /** Flow ids already on the pod, so a new one does not collide. */
  takenIds: string[]
  onStart: (flow: SavedFlow) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [templates, setTemplates] = useState<FlowTemplateSummary[] | null>(null)
  const [picked, setPicked] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    library
      .flowTemplates()
      // No templates is not a failure — a pod with no packs installed has none,
      // and a blank flow is still a perfectly good start.
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function start() {
    const label = name.trim()
    if (!label) return
    setBusy(true)
    setError(undefined)
    const now = new Date().toISOString()
    try {
      if (!picked) {
        onStart(blankFlow(label, takenIds, now))
        return
      }
      const template = await library.flowTemplate(picked)
      onStart(copyFlow(template, label, takenIds, now))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[30rem] flex-col rounded-card border border-line bg-surface shadow-overlay"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium text-ink">New automation</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-2">
            Nothing runs until you schedule it — this only creates the work.
          </p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void start()}
              placeholder="Morning brief"
              className="w-full rounded-md border border-line bg-field px-2 py-1.5 text-[12.5px] text-ink"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              Start from
            </span>
            <Choice
              icon={Sparkles}
              label="An empty flow"
              detail="One entry step, and the rest is yours."
              picked={!picked}
              onPick={() => setPicked(undefined)}
            />
            {templates === null ? (
              <div className="flex items-center gap-2 px-2 py-2 text-[11.5px] text-ink-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking for templates…
              </div>
            ) : (
              templates.map((t) => (
                <Choice
                  key={t.slug}
                  icon={FileText}
                  label={t.name}
                  // The pod sends a slug, a name and which pack shipped it —
                  // no description. Saying where it came from is the useful
                  // half of the answer anyway.
                  detail={t.pack_id ? `from ${t.pack_id}` : undefined}
                  picked={picked === t.slug}
                  onPick={() => setPicked(t.slug)}
                />
              ))
            )}
          </div>

          {error && <p className="text-[11.5px] text-red">{error}</p>}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-4 py-2.5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!name.trim() || busy} onClick={() => void start()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </Button>
        </footer>
      </div>
    </div>
  )
}

function Choice({
  icon: Icon,
  label,
  detail,
  picked,
  onPick,
}: {
  icon: typeof FileText
  label: string
  detail?: string
  picked: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'flex items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
        picked ? 'border-accent bg-accent-tint' : 'border-line hover:bg-hover',
      )}
    >
      <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', picked ? 'text-accent' : 'text-ink-3')} />
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] text-ink">{label}</span>
        {detail && <span className="block text-[11px] leading-snug text-ink-2">{detail}</span>}
      </span>
    </button>
  )
}
