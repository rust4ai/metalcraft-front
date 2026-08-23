import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useAutomations } from '@/stores/automations'
import { useFleet } from '@/stores/fleet'
import { useUi } from '@/stores/ui'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { Flow, FlowSchedule } from '@/types'

/**
 * The second consent moment (PLAN §10.7).
 *
 * Installing a pack asks once. Arming asks again, and this is the sharper ask:
 * an armed automation acts **while nobody is watching**, so a mutating tool
 * inside one is a bigger commitment than the same tool in a chat where an
 * approval prompt exists and someone is there to read it.
 *
 * Every line here is the pod's own answer (`GET /flows/{id}/binding`), not this
 * app's summary of one — and the list is *complete* rather than best-effort only
 * because of the containment rule: a flow cannot name a persona outside its
 * preset's roster, so what it can reach is knowable in advance.
 */
export function ArmDialog({
  flow,
  schedule,
  onClose,
}: {
  flow: Flow | null
  schedule: FlowSchedule | null
  onClose: () => void
}) {
  const { bindings, loadBinding, arm, busy } = useAutomations()
  const instances = useFleet((s) => s.instances)
  const go = useUi((s) => s.go)
  const [attachTo, setAttachTo] = useState<string | null>(null)

  const open = Boolean(flow && schedule)
  const binding = flow ? bindings[flow.id] : undefined
  const working = flow && schedule ? (busy[`${flow.id}:${schedule.id}`] ?? false) : false

  useEffect(() => {
    if (flow) void loadBinding(flow.id)
  }, [flow, loadBinding])

  // Reset the picker between openings: the last flow's choice must not carry
  // into the next flow's dialog.
  useEffect(() => {
    if (!open) setAttachTo(null)
  }, [open])

  if (!flow || !schedule) return null
  const consent = binding?.consent
  const label = schedule.name ?? schedule.id

  async function confirm() {
    if (!flow || !schedule) return
    const agent = await arm(flow.id, schedule.id, attachTo ?? undefined)
    if (agent) {
      onClose()
      go({ kind: 'session', instanceId: agent.id })
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={`Arm "${label}"`}
      description={schedule.description}
    >
      {!binding ? (
        <div className="flex items-center gap-2 py-4 text-sm text-ink-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Asking the pod what this permits…
        </div>
      ) : (
        <div className="space-y-3">
          <Line label="Runs as">
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setAttachTo(null)}
                className={cn(
                  'w-full rounded-control px-2.5 py-1.5 text-left text-[13px] transition-all duration-150',
                  attachTo === null ? 'bg-accent-tint shadow-btn' : 'hover:bg-hover',
                )}
              >
                {consent?.preset_name || binding.preset}
                <span className="ml-1.5 text-ink-3">— a new agent for this automation</span>
              </button>
              {/* Running a briefer as the agent you already chat with is a
                  reasonable thing to want, and the pod supports it. The cost is
                  worth stating: background runs then write into the memory of an
                  agent you are talking to. */}
              {instances
                .filter((i) => i.agent_preset === binding.preset)
                .map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setAttachTo(i.id)}
                    className={cn(
                      'w-full rounded-control px-2.5 py-1.5 text-left text-[13px] transition-all duration-150',
                      attachTo === i.id ? 'bg-accent-tint shadow-btn' : 'hover:bg-hover',
                    )}
                  >
                    {i.name}
                    <span className="ml-1.5 text-ink-3">— an agent you already have</span>
                  </button>
                ))}
            </div>
          </Line>

          {binding.personas.length > 0 && (
            <Line label="Personas">
              <span className="text-[13px]">
                {binding.personas.map((p) => p.slug).join(' → ')}
              </span>
              {binding.personas.some((p) => !p.allowed) && (
                <p className="mt-1 text-[12px] text-red">
                  {binding.personas
                    .filter((p) => !p.allowed)
                    .map((p) => p.slug)
                    .join(', ')}{' '}
                  {binding.personas.filter((p) => !p.allowed).length === 1 ? 'is' : 'are'} not in
                  this agent&apos;s roster — the pod will refuse.
                </p>
              )}
            </Line>
          )}

          {consent && consent.domains.length > 0 && (
            <Line label="Can reach">
              <span className="font-mono text-[12px]">{consent.domains.join(', ')}</span>
            </Line>
          )}

          {consent && consent.requires_env.length > 0 && (
            <Line label="Uses keys">
              <span className="font-mono text-[12px]">{consent.requires_env.join(', ')}</span>
              {/* The sharpest line in the dialog: a missing credential fails at
                  3am, not at a moment anyone is looking. */}
              {consent.missing_env.length > 0 && (
                <p className="mt-1 flex items-start gap-1.5 text-[12px] text-orange">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>
                    This pod does not have {consent.missing_env.join(', ')}. Those tools will
                    fail when it runs, with nobody watching.
                  </span>
                </p>
              )}
            </Line>
          )}

          {consent && consent.mutating_tools.length > 0 && (
            <Line label="Will">
              <span className="text-[13px]">
                change things: {consent.mutating_tools.join(', ')}
              </span>
              <p className="mt-0.5 text-[12px] text-ink-3">
                of {consent.tool_count} tool{consent.tool_count === 1 ? '' : 's'} it can call
              </p>
            </Line>
          )}

          {consent && (
            <Line label="Memory">
              <span className="text-[13px]">
                {consent.base_memories === 0
                  ? 'starts empty, and accumulates on every run'
                  : `starts from ${consent.base_memories} entries, and accumulates on every run`}
              </span>
            </Line>
          )}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!binding || working} onClick={() => void confirm()}>
          {working ? 'Arming…' : 'Arm it'}
        </Button>
      </div>
    </Modal>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-start gap-3">
      <span className="pt-0.5 text-[12px] text-ink-3">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
