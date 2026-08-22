import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useSettings } from '@/stores/settings'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/**
 * The pod's key store (PLAN §10.6).
 *
 * Until now the app could write exactly two keys — `OPENAI_API_KEY` and
 * `OPENAI_BASE_URL`, both hardcoded into the interface-source wizard — while the
 * pod happily holds any number. Every integration pack that needs a credential
 * was therefore unreachable from the desktop. This is the general case.
 *
 * A value is never read back. The pod returns a mask, and a written value goes
 * straight through the transport into the core without being kept anywhere a
 * devtools snapshot could reach.
 */
export function KeysCard() {
  const { keys, loadingKeys, keyError, loadKeys, saveKey, deleteKey } = useSettings()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  const add = async () => {
    if (!name.trim() || !value.trim()) return
    setBusy(true)
    const failed = await saveKey(name.trim(), value.trim())
    setBusy(false)
    setError(failed)
    if (!failed) {
      setName('')
      setValue('')
    }
  }

  return (
    <section className="rounded-card bg-surface p-5 shadow-card">
      <header>
        <h2 className="text-[14px] font-semibold">Keys</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-2">
          Credentials the pod holds for its agents. Packs read them by name — the name is not
          cosmetic.
        </p>
      </header>

      <div className="mt-4">
        {loadingKeys && keys.length === 0 ? (
          <p className="flex items-center gap-2 py-4 text-[12.5px] text-ink-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the key store…
          </p>
        ) : keys.length === 0 ? (
          <p className="py-4 text-[12.5px] text-ink-3">This pod holds no keys yet.</p>
        ) : (
          <ul>
            {keys.map((k) => (
              <li key={k.name} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12px] text-ink">{k.name}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-3">{k.masked}</span>
                </span>
                {k.scope && k.scope !== 'global' && (
                  <span className="shrink-0 rounded-chip bg-inset px-1.5 py-0.5 text-[10px] text-ink-3">
                    {k.scope}
                  </span>
                )}
                {/* A managed key is one the pod maintains for itself; deleting it
                    would break something the user did not set up and cannot
                    easily put back. */}
                {k.managed ? (
                  <span className="shrink-0 text-[11px] text-ink-3">managed</span>
                ) : confirming === k.name ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="danger" onClick={() => void deleteKey(k.name)}>
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Delete ${k.name}`}
                    onClick={() => setConfirming(k.name)}
                    className="shrink-0 rounded-chip p-1 text-ink-3 hover:bg-red/10 hover:text-red"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          placeholder="NAME"
          aria-label="Key name"
          spellCheck={false}
          className="h-8 w-40 shrink-0 rounded-control bg-field px-2.5 font-mono text-[12px] text-ink placeholder:text-ink-3"
        />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add()
          }}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="value"
          aria-label="Key value"
          className="h-8 min-w-0 flex-1 rounded-control bg-field px-2.5 font-mono text-[12px] text-ink placeholder:text-ink-3"
        />
        <Button size="sm" onClick={() => void add()} disabled={busy || !name.trim() || !value.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </div>

      {(error || keyError) && (
        <p className={cn('mt-2 text-[11.5px] text-red')}>{error ?? keyError}</p>
      )}
    </section>
  )
}
