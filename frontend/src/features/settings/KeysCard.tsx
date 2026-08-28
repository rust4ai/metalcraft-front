import { useEffect, useState } from 'react'
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { useSettings } from '@/stores/settings'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { RecommendedKey } from '@/types'

/**
 * Keys the packs on this pod read by name, that nobody has filled in.
 *
 * The store above can only say what is *stored*. A pack that needs
 * `RESEND_API_KEY` and does not have it looks exactly like a pack that needs
 * nothing, right up until somebody runs a tool and reads the failure — the pod
 * knows the difference from every enabled integration's `requires_env`, and this
 * is that list.
 *
 * Configured ones are not shown: this is a to-do, and a satisfied requirement
 * has nothing to do about. Managed ones are not shown either — the platform
 * injects those, and prompting for a value the user cannot supply is worse than
 * silence.
 */
function Wanted({ keys, onPick }: { keys: RecommendedKey[]; onPick: (name: string) => void }) {
  const missing = keys.filter((k) => !k.configured && !k.managed)
  if (missing.length === 0) return null

  return (
    <div className="mt-4 rounded-card bg-inset p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
        Keys these packs still need
      </p>
      <ul className="mt-1.5">
        {missing.map((k) => (
          <li key={k.name} className="flex items-center gap-2 py-1">
            <KeyRound className="h-3.5 w-3.5 shrink-0 text-ink-3" />
            <button
              type="button"
              onClick={() => onPick(k.name)}
              // The visible text is the key's name; what the button *does* is
              // put that name in the form below, which only a label can say.
              aria-label={`Add ${k.name}`}
              title={`Add ${k.name}`}
              className="min-w-0 shrink-0 font-mono text-[12px] text-accent hover:underline"
            >
              {k.name}
            </button>
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">
              {k.packs.join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

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
  const { keys, recommendedKeys, loadingKeys, keyError, loadKeys, saveKey, deleteKey } =
    useSettings()
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

      <Wanted
        keys={recommendedKeys}
        onPick={(picked) => {
          setName(picked)
          setValue('')
        }}
      />

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
