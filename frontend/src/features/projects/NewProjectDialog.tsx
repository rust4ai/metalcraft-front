import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useProjects } from '@/stores/projects'
import { cn } from '@/lib/cn'
import type { GoalKind } from '@/types'

const KINDS: { value: GoalKind; label: string; blurb: string }[] = [
  {
    value: 'build',
    label: 'Build',
    blurb: 'Work through it phase by phase, on its own branch, opening a PR per phase.',
  },
  {
    value: 'audit',
    label: 'Audit',
    blurb: 'Sweep the repo, keep a findings ledger, open one small PR per accepted finding.',
  },
]

/** Cadences worth offering. Below five minutes is a busy-loop, and above a day
 *  the thing has stopped being a heartbeat. */
const CADENCES = [15, 30, 60, 180]

/**
 * Setting a project — the one place a project comes into existence.
 *
 * Deliberately one big field and four small ones. The project text is what the
 * agent re-reads on every tick for possibly a week, so it gets the room to be a
 * paragraph; everything else has a defensible default, because this is a form
 * somebody fills in once and then leaves running.
 */
export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { create, active, maxActive, error } = useProjects()
  const [project, setGoal] = useState('')
  const [kind, setKind] = useState<GoalKind>('build')
  const [repo, setRepo] = useState('')
  const [everyMinutes, setEveryMinutes] = useState(30)
  const [paused, setPaused] = useState(false)
  const [saving, setSaving] = useState(false)

  // Checked here as well as by the pod so the refusal arrives before the typing,
  // not after it.
  const full = !paused && maxActive > 0 && active >= maxActive

  async function submit() {
    if (!project.trim() || saving) return
    setSaving(true)
    const created = await create({
      goal: project.trim(),
      kind,
      repo: repo.trim() || undefined,
      every_minutes: everyMinutes,
      paused,
    })
    setSaving(false)
    if (created) {
      setGoal('')
      setRepo('')
      onOpenChange(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Set a project"
      description="It will work at this on its own, waking on a heartbeat, until it is done or it needs you."
    >
      <div className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">The project</span>
          <textarea
            value={project}
            onChange={(e) => setGoal(e.target.value)}
            rows={5}
            autoFocus
            placeholder="Ship Stripe billing in rust4ai/foo: checkout, webhooks, reconciliation."
            aria-label="The project"
            className="mt-1 w-full resize-y rounded-control bg-field p-2 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-accent"
          />
          <span className="text-xs text-ink-3">
            Written for someone who knows nothing else — it is re-read on every tick.
          </span>
        </label>

        <fieldset>
          <legend className="text-sm font-medium">Kind</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                aria-pressed={kind === k.value}
                className={cn(
                  'rounded-control p-2 text-left text-sm shadow-btn transition-colors',
                  kind === k.value ? 'bg-accent text-accent-ink' : 'hover:bg-hover',
                )}
              >
                <span className="font-medium">{k.label}</span>
                <span className={cn('mt-0.5 block text-xs', kind === k.value ? 'opacity-80' : 'text-ink-3')}>
                  {k.blurb}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="text-sm font-medium">Repo</span>
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/name"
            aria-label="Repo"
            className="mt-1 h-8 w-full rounded-control bg-field px-2 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-accent"
          />
          <span className="text-xs text-ink-3">
            Optional. Without one it can plan and research, but it has nowhere to build.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Wakes every</span>
          <div className="mt-1 flex gap-1.5">
            {CADENCES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setEveryMinutes(m)}
                aria-pressed={everyMinutes === m}
                className={cn(
                  'h-8 flex-1 rounded-control text-sm shadow-btn transition-colors',
                  everyMinutes === m ? 'bg-accent text-accent-ink' : 'hover:bg-hover',
                )}
              >
                {m < 60 ? `${m}m` : `${m / 60}h`}
              </button>
            ))}
          </div>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={paused}
            onChange={(e) => setPaused(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Start paused
            <span className="block text-xs text-ink-3">
              Read its plan before it starts spending. Resume from the project.
            </span>
          </span>
        </label>

        {full && (
          <p className="text-sm text-red">
            {maxActive} projects are already running. Pause or finish one, or start this one paused.
          </p>
        )}
        {error && <p className="text-sm text-red">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!project.trim() || saving || full}>
            {saving ? 'Setting…' : paused ? 'Create paused' : 'Set it going'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
