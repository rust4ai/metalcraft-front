import { useState } from 'react'
import { useFleet } from '@/stores/fleet'
import { useUi } from '@/stores/ui'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/**
 * Orca's agent combobox, with presets where it has CLIs.
 *
 * A preset is chosen once and never changed: an instance's memory is seeded from
 * it, so swapping mid-life is incoherent — switching agents means spawning a new
 * one. The dialog says so rather than offering an edit that the pod would refuse.
 */
export function NewAgentDialog() {
  const { presets, spawn } = useFleet()
  const { newAgentOpen, setNewAgentOpen, go } = useUi()
  const [preset, setPreset] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const chosen = preset ?? presets[0]?.slug ?? null

  async function create() {
    if (!chosen) return
    setBusy(true)
    const instance = await spawn(chosen, name.trim() || undefined)
    setBusy(false)
    if (instance) {
      setNewAgentOpen(false)
      setName('')
      go({ kind: 'session', instanceId: instance.id })
    }
  }

  return (
    <Modal
      open={newAgentOpen}
      onOpenChange={setNewAgentOpen}
      title="New agent"
      description="Pick what it is. The preset is fixed for the agent's life — its memory is seeded from it."
    >
      <div className="max-h-72 space-y-1.5 overflow-y-auto">
        {presets.map((p) => (
          <button
            key={p.slug}
            type="button"
            onClick={() => setPreset(p.slug)}
            className={cn(
              'w-full rounded-control px-3 py-2.5 text-left transition-all duration-150',
              chosen === p.slug ? 'bg-accent-tint shadow-btn' : 'hover:bg-hover',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{p.name || p.slug}</span>
              {p.pack_id && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-3">{p.pack_id}</span>
              )}
            </div>
                {(p.tagline || p.description) && (
              <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{p.tagline || p.description}</p>
            )}
          </button>
        ))}
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name it (optional — naming makes it persistent)"
        className="mt-3 w-full rounded-control bg-field px-3 py-2 text-[13px] caret-accent outline-none placeholder:text-ink-3 shadow-btn"
      />

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setNewAgentOpen(false)}>
          Cancel
        </Button>
        <Button onClick={() => void create()} disabled={!chosen || busy}>
          {busy ? 'Creating…' : 'Create agent'}
        </Button>
      </div>
    </Modal>
  )
}
