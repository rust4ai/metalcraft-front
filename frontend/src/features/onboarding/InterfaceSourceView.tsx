import { useEffect, useState } from 'react'
import { Check, Info, KeyRound } from 'lucide-react'
import { keys as keysRpc } from '@/rpc'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { SOURCES, type Source } from './sources'

/**
 * PLAN §9.2 — bind an interface source.
 *
 * This is the step that makes the agent able to think, so it is also the step
 * that has to be truthful about a limitation: the pod reads its provider from
 * process env today, so a freshly bound key takes effect on restart. Saying that
 * plainly beats a green tick followed by a turn that fails for a reason the user
 * cannot see.
 */
export function InterfaceSourceView({ onDone }: { onDone?: () => void }) {
  const [selected, setSelected] = useState<Source>(SOURCES[0]!)
  const [apiKey, setApiKey] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [bound, setBound] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    keysRpc
      .list()
      .then((entries) => setBound(entries.map((e) => e.name)))
      .catch((e) => setError(String(e)))
  }, [])

  const needsUrl = selected.id === 'custom'
  const canSave = apiKey.trim().length > 0 && (!needsUrl || customUrl.trim().length > 0)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const baseUrl = needsUrl ? customUrl.trim() : selected.baseUrl
      await keysRpc.bindInterfaceSource(apiKey.trim(), baseUrl)
      setSaved(true)
      setApiKey('')
      setBound(await keysRpc.list().then((e) => e.map((k) => k.name)))
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-8 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface">
          <KeyRound className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Interface source</h1>
          <p className="text-sm text-ink-2">Where this agent&rsquo;s thinking comes from.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelected(s)}
            className={cn(
              'w-full rounded-control px-3 py-2.5 text-left transition-all duration-150',
              selected.id === s.id ? 'bg-accent-tint shadow-btn' : 'hover:bg-hover',
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{s.name}</span>
              {s.responsesApi === 'verify' && (
                <span className="rounded border border-orange/40 px-1 py-px text-[10px] uppercase tracking-wide text-orange">
                  verify
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-ink-2">{s.blurb}</p>
          </button>
        ))}
      </div>

      {needsUrl && (
        <input
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          placeholder="https://your-gateway.example.com/v1"
          className="mt-3 w-full rounded-control bg-field px-3 py-2 text-[13px] caret-accent outline-none placeholder:text-ink-3 shadow-btn"
        />
      )}

      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={selected.keyHint}
        className="mt-3 w-full rounded-control bg-field px-3 py-2 text-[13px] caret-accent outline-none placeholder:text-ink-3 shadow-btn"
      />

      {selected.responsesApi === 'verify' && (
        <Note>
          Every source has to implement <code className="font-mono">POST {'{base}'}/responses</code> — the agent
          sends parallel tool calls that the chat/completions surface rejects outright. If this one doesn&rsquo;t,
          turns will fail with a 400.
        </Note>
      )}

      <Note>
        The pod reads its provider from environment at turn time, so a key saved here applies after the pod
        restarts. (Fix is upstream and small: resolve through the key store, which already prefers stored keys
        over env.)
      </Note>

      {bound.includes('OPENAI_API_KEY') && !saved && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
          <Check className="h-3.5 w-3.5 text-live" /> a key is already stored on this pod
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red">{error}</p>}

      <div className="mt-5 flex items-center justify-between">
        {onDone && (
          <Button variant="ghost" onClick={onDone}>
            Skip
          </Button>
        )}
        <Button className="ml-auto" onClick={() => void save()} disabled={!canSave || saving}>
          {saving ? 'Saving…' : saved ? 'Saved — save again' : 'Bind source'}
        </Button>
      </div>

      {saved && onDone && (
        <Button variant="outline" className="mt-3 w-full" onClick={onDone}>
          Continue
        </Button>
      )}
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-2">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" />
      <p>{children}</p>
    </div>
  )
}
