import { KeyRound, ServerCog } from 'lucide-react'
import { useConnection } from '@/stores/connection'
import { canThink, useUi } from '@/stores/ui'
import { Button } from '@/components/ui/Button'
import { ConnectionCard } from './ConnectionCard'
import { DangerZoneCard } from './DangerZoneCard'
import { GatewayCard } from './GatewayCard'
import { KeysCard } from './KeysCard'
import { TimezoneCard } from './TimezoneCard'

/**
 * PLAN §10.6 — the settings surface, as far as it exists.
 *
 * Deliberately only the parts that are built: the interface source (which links
 * out to its own step rather than being duplicated here), the key store, the
 * service connections, and the gateway channel that carries WhatsApp and SMS.
 * Account, pods, per-channel configuration, registries and updates are named in
 * PLAN §10.6 and are not here, so they are not stubbed either — an empty
 * settings panel implies a feature that does not exist.
 *
 * The two connection cards are one component twice, in a fixed order — a card
 * that moved when you connected it would be a card you had to re-find.
 *
 * Factory reset sits at the bottom, alone. It is the only thing on this surface
 * that takes something away permanently, and grouping it with the cards that
 * merely configure things is how it gets pressed by someone aiming at one.
 */
export function SettingsView() {
  const go = useUi((s) => s.go)
  const ownSource = useUi((s) => s.ownSource)
  const inference = useUi((s) => s.inference)
  const premium = useConnection((s) => s.session?.premium ?? false)
  const pod = useConnection((s) => s.pod)

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <header className="mb-6">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-ink-2">What this pod is connected to.</p>
      </header>

      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {/* The Launchpad, from the other side of a connection. It is the same
            surface the app opens on with no pod (LAUNCHPAD_PLAN §4) — reachable
            here because switching machines and reconnecting a pod you run are
            ordinary acts, not first-run acts. */}
        <section className="flex items-center gap-3 rounded-card bg-surface p-5 shadow-card">
          <ServerCog className="h-4 w-4 shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold">Pods</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-2">
              {pod ? `This window is on ${pod.slug}.` : 'Where your agents run.'}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => go({ kind: 'pods' })}>
            Connect another
          </Button>
        </section>

        <section className="flex items-center gap-3 rounded-card bg-surface p-5 shadow-card">
          <KeyRound className="h-4 w-4 shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold">Interface source</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-2">
              {ownSource
                ? 'A key of your own, stored on this pod.'
                : canThink({ inference, ownSource }, premium) === false
                  ? inference?.ready
                    ? 'Not bound — and this account has no premium to bill inference to.'
                    : 'Not bound, and this pod has no credential of its own either.'
                  : 'Metalcraft Inference, billed to your credits. Bind a key to use another provider.'}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => go({ kind: 'source' })}>
            {ownSource ? 'Change' : 'Bind a source'}
          </Button>
        </section>

        <ConnectionCard service="octaweave" />
        <ConnectionCard service="buildr" />
        <GatewayCard />
        <TimezoneCard />

        <KeysCard />

        {/* Last, and after a gap: the one control here that destroys something.
            It is in settings because that is where someone looks for it, and at
            the bottom because nothing should be reachable by overshooting it. */}
        <div className="mt-4">
          <DangerZoneCard />
        </div>
      </div>
    </div>
  )
}
