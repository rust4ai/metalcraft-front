import { useEffect, useState } from 'react'
import { Check, KeyRound, Loader2, Lock } from 'lucide-react'
import { useSettings } from '@/stores/settings'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/** One credential something asks for, as either shape the pod describes it in:
 *  a bare name (a preset, an integration) or a name with provenance (a pack
 *  manifest's `requires_env`). */
export type KeyNeed = { name: string; needed_by?: string[]; required?: boolean }

/**
 * What a pack, preset or integration needs from the key store — and the field
 * to put it there.
 *
 * Four screens used to answer this question four ways: a checklist on the
 * install sheet, green-and-orange chips on an integration, a bullet list on a
 * preset, and a raw JSON dump on an installed pack's page. All four could say a
 * key was missing; none of them could do anything about it, so every one ended
 * in the same instruction to go to Settings and retype a name from memory. That
 * round trip is the bug this component exists to delete.
 *
 * The standing comes from the settings store rather than a `podKeys` list
 * passed in, because that store is the one that also *writes* — a screen that
 * read from its own copy would show a key as missing right after setting it.
 * Loading is idempotent and costs two GETs, so it is done here rather than
 * requiring every host page to remember.
 */
export function KeyNeeds({
  env,
  title = 'Needs in the key store',
  subject = 'it',
  onSaved,
}: {
  env: readonly (string | KeyNeed)[]
  title?: string
  /** Named in the warning line: "keys this agent needs". */
  subject?: string
  /** Called after a successful write, for a page holding its own copy of the
   *  pod's key names that is now one key out of date. */
  onSaved?: () => void
}) {
  const { keys, recommendedKeys, saveKey, loadKeys } = useSettings()
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  const needs: KeyNeed[] = env.map((e) => (typeof e === 'string' ? { name: e } : e))
  if (needs.length === 0) return null

  const standingOf = (name: string): 'set' | 'missing' | 'managed' => {
    const stored = keys.find((k) => k.name === name)
    const wanted = recommendedKeys.find((k) => k.name === name)
    // Managed means the platform injects it as pod environment. Offering a field
    // for a value nobody can supply is worse than saying nothing.
    if (stored?.managed || wanted?.managed) return 'managed'
    if (stored || wanted?.configured) return 'set'
    return 'missing'
  }

  // Optional env is listed but never counted missing — a pack that works better
  // with a key it does not require should not look broken for lacking one.
  const unmet = needs.filter((n) => n.required !== false && standingOf(n.name) === 'missing')

  const save = async (name: string) => {
    if (!value.trim()) return
    setBusy(true)
    const failed = await saveKey(name, value.trim())
    setBusy(false)
    setError(failed)
    if (failed) return
    setEditing(null)
    setValue('')
    onSaved?.()
  }

  return (
    <section className="pt-4">
      <div className="flex items-baseline gap-2 pb-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{title}</h3>
        <span className="tnum text-[11px] text-ink-3">{needs.length}</span>
      </div>

      {unmet.length > 0 && (
        <p className="mb-2 rounded-chip bg-orange-tint px-2.5 py-2 text-[11.5px] text-ink-2">
          {unmet.length === 1
            ? `One key ${subject} needs is`
            : `${unmet.length} keys ${subject} needs are`}{' '}
          not in this pod&rsquo;s key store. The tools that use{' '}
          {unmet.length === 1 ? 'it' : 'them'} are what fail — set{' '}
          {unmet.length === 1 ? 'it' : 'them'} here.
        </p>
      )}

      <ul>
        {needs.map((need) => {
          const standing = standingOf(need.name)
          const open = editing === need.name
          return (
            <li key={need.name} className="border-b border-line py-1.5 last:border-0">
              <div className="flex items-center gap-2">
                {standing === 'set' ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-green" />
                ) : standing === 'managed' ? (
                  <Lock className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                ) : (
                  <KeyRound
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      need.required === false ? 'text-ink-3' : 'text-orange',
                    )}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-[11.5px] text-ink">{need.name}</span>
                  {need.required === false && (
                    <span className="ml-1.5 text-[11px] text-ink-3">optional</span>
                  )}
                  {need.needed_by && need.needed_by.length > 0 && (
                    <span className="block truncate text-[11px] text-ink-3">
                      for {need.needed_by.join(', ')}
                    </span>
                  )}
                </span>
                {standing === 'managed' ? (
                  <span className="shrink-0 text-[11px] text-ink-3">provided</span>
                ) : open ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(need.name)
                      setValue('')
                      setError(null)
                    }}
                    aria-label={`${standing === 'set' ? 'Replace' : 'Set'} ${need.name}`}
                    className="shrink-0 text-[11.5px] text-accent hover:underline"
                  >
                    {standing === 'set' ? 'Replace' : 'Set'}
                  </button>
                )}
              </div>

              {open && (
                <div className="mt-1.5 flex gap-2">
                  <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void save(need.name)
                      if (e.key === 'Escape') setEditing(null)
                    }}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="value"
                    aria-label={`Value for ${need.name}`}
                    autoFocus
                    className="h-8 min-w-0 flex-1 rounded-control bg-field px-2.5 font-mono text-[12px] text-ink placeholder:text-ink-3"
                  />
                  <Button size="sm" onClick={() => void save(need.name)} disabled={busy || !value.trim()}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {error && <p className="mt-2 text-[11.5px] text-red">{error}</p>}
    </section>
  )
}
