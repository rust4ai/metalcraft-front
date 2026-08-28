import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Clock, Loader2 } from 'lucide-react'
import { TimezonePicker } from './TimezonePicker'
import { useSettings } from '@/stores/podSettings'

/**
 * What time it is, as far as this pod is concerned.
 *
 * The one preference on the surface so far, and it earns the card: a cron
 * schedule that names no zone is read in this one. Before the pod had a zone
 * that fallback was the pod's own clock — UTC in the cluster — so an 08:00
 * automation armed by anything that did not stop to think about timezones (the
 * agent's own scheduling tool, a pack suggestion, a hand-written flow) arrived
 * in the middle of the night, and nothing anywhere said so.
 *
 * It reads this machine's zone and offers to match, because a pod that disagrees
 * with the person using it is the ordinary starting state — a pod is provisioned
 * in a datacentre and nobody tells it where its owner lives.
 */
export function TimezoneCard() {
  const { podZone, loading, error, load, setZone } = useSettings()
  const [saving, setSaving] = useState(false)
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    void load()
  }, [load])

  const save = async (zone: string) => {
    setSaving(true)
    await setZone(zone)
    setSaving(false)
  }

  return (
    <section className="rounded-card bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">Timezone</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            What “8am” means to this pod. Automations that do not set a zone of their own run in
            this one.
          </p>

          <div className="mt-3 flex items-center gap-2">
            {loading && !podZone ? (
              <span className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking the pod…
              </span>
            ) : (
              <TimezonePicker value={podZone} onChange={(z) => void save(z)} disabled={saving} />
            )}
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-3" />}
          </div>

          {!loading && <ZoneNote podZone={podZone} here={here} onSync={() => void save(here)} />}
          {error && <p className="mt-2 text-[12px] text-red">{error}</p>}
        </div>
      </div>
    </section>
  )
}

/**
 * The line under the picker: agreed, unset, or disagreeing.
 *
 * Split out because it is the part with an opinion, and the same three states
 * are what the arming dialog shows — see `ZoneMismatch` there, which offers the
 * same one-press fix without making somebody leave the dialog they are in.
 */
function ZoneNote({
  podZone,
  here,
  onSync,
}: {
  podZone: string | null
  here: string
  onSync: () => void
}) {
  if (!podZone) {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-[12px] text-orange">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>
          This pod has no timezone, so an automation without one runs on the pod’s own clock —
          usually UTC.{' '}
          <button type="button" onClick={onSync} className="underline hover:text-ink">
            Use {here}
          </button>
          .
        </span>
      </p>
    )
  }
  if (podZone !== here) {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-[12px] text-orange">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>
          You are on {here}. An automation set for 8am here would run at 8am {podZone}.{' '}
          <button type="button" onClick={onSync} className="underline hover:text-ink">
            Match this computer
          </button>
          .
        </span>
      </p>
    )
  }
  return (
    <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-3">
      <Check className="h-3.5 w-3.5 text-green" />
      Same as this computer.
    </p>
  )
}
