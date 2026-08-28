import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2, Search } from 'lucide-react'
import { settings as settingsApi } from '@/rpc'
import type { TimezoneRegion } from '@/types'

/**
 * Pick a timezone from the ones the pod can actually resolve.
 *
 * A picker rather than the text field this replaces, because the failure it
 * prevents is a typo: `america/detroit`, `PST`, `GMT-5` — all of which used to
 * save fine and then mean UTC, so the automation fired at an hour nobody chose
 * and nothing said so.
 *
 * The list comes from the pod (`GET /timezones`), not from this browser's own tz
 * database. The two drift, and a zone the browser knows about that this pod's
 * build does not is a save that fails *after* somebody chose it.
 */
export function TimezonePicker({
  value,
  onChange,
  disabled,
}: {
  /** The current zone, or `null` for a pod that has none. */
  value: string | null
  onChange: (zone: string) => void
  disabled?: boolean
}) {
  const [regions, setRegions] = useState<TimezoneRegion[] | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)

  // Fetched when it is opened, not when it is mounted: 500-odd names are not
  // worth a request on a settings screen nobody is going to change.
  useEffect(() => {
    if (!open || regions) return
    settingsApi
      .timezones()
      .then(setRegions)
      .catch(() => setRegions([]))
  }, [open, regions])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const matches = useMemo(() => filterZones(regions ?? [], query), [regions, query])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-64 items-center justify-between gap-2 rounded-control border border-line bg-inset px-2 py-1.5 text-[13px] hover:border-accent disabled:opacity-60"
      >
        <span className={value ? '' : 'text-ink-3'}>{value ?? 'Not set'}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-card border border-line bg-surface shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Detroit, Tokyo, UTC…"
              className="w-full bg-transparent text-[13px] outline-none"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {regions === null && (
              <p className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-ink-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking the pod…
              </p>
            )}
            {regions?.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-ink-3">
                This pod is older than the timezone list.
              </p>
            )}
            {regions !== null && regions.length > 0 && matches.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-ink-3">Nothing matches “{query}”.</p>
            )}
            {matches.map((zone) => (
              <button
                key={zone}
                type="button"
                role="option"
                aria-selected={zone === value}
                onClick={() => {
                  onChange(zone)
                  setOpen(false)
                  setQuery('')
                }}
                className={`block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-hover ${
                  zone === value ? 'text-accent' : 'text-ink'
                }`}
              >
                {zone}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Zones matching what was typed, capped.
 *
 * Matches on the city as well as the whole name, because that is what people
 * type — "detroit", not "america/detroit". Underscores are how IANA spells a
 * space (`America/New_York`), so a space matches one.
 */
export function filterZones(regions: TimezoneRegion[], query: string): string[] {
  const all = regions.flatMap((r) => r.zones)
  const needle = query.trim().toLowerCase().replace(/\s+/g, '_')
  if (!needle) return all.slice(0, 200)
  return all.filter((zone) => zone.toLowerCase().includes(needle)).slice(0, 200)
}
