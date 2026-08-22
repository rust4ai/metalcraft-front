import { KeyRound } from 'lucide-react'
import { useUi } from '@/stores/ui'
import { Button } from '@/components/ui/Button'
import { OctaweaveCard } from './OctaweaveCard'
import { KeysCard } from './KeysCard'

/**
 * PLAN §10.6 — the settings surface, as far as it exists.
 *
 * Deliberately only the parts that are built: the interface source (which links
 * out to its own step rather than being duplicated here), the key store, and the
 * Octaweave connection. Account, pods, gateway channels, registries and updates
 * are named in PLAN §10.6 and are not here, so they are not stubbed either — an
 * empty settings panel implies a feature that does not exist.
 */
export function SettingsView() {
  const go = useUi((s) => s.go)
  const sourceBound = useUi((s) => s.sourceBound)

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <header className="mb-6">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-ink-2">What this pod is connected to.</p>
      </header>

      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <section className="flex items-center gap-3 rounded-card bg-surface p-5 shadow-card">
          <KeyRound className="h-4 w-4 shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold">Interface source</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-2">
              {sourceBound === false
                ? 'Not bound — the agent cannot think without one.'
                : 'Where completions come from.'}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => go({ kind: 'source' })}>
            {sourceBound === false ? 'Bind a source' : 'Change'}
          </Button>
        </section>

        <OctaweaveCard />
        <KeysCard />
      </div>
    </div>
  )
}
