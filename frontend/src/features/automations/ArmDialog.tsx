import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useAutomations } from '@/stores/automations'
import { useFleet } from '@/stores/fleet'
import { useUi } from '@/stores/ui'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { Flow, ScheduleSpec } from '@/types'

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
 *
 * It also picks the *when*, because since the flow/schedule split there is
 * nothing to select: a schedule does not exist until somebody creates one, and
 * creating it is the same act as agreeing to it.
 */
export function ArmDialog({
  flow,
  onClose,
}: {
  flow: Flow | null
  onClose: () => void
}) {
  const { bindings, loadBinding, arm, busy } = useAutomations()
  const instances = useFleet((s) => s.instances)
  const go = useUi((s) => s.go)
  const [attachTo, setAttachTo] = useState<string | null>(null)
  const [schedule, setSchedule] = useState<ScheduleSpec>(defaultSchedule)

  const open = Boolean(flow)
  const binding = flow ? bindings[flow.id] : undefined
  const working = flow ? (busy[`arm:${flow.id}`] ?? false) : false

  useEffect(() => {
    if (flow) void loadBinding(flow.id)
  }, [flow, loadBinding])

  // Reset between openings: the last flow's choices must not carry into the
  // next flow's dialog.
  useEffect(() => {
    if (!open) {
      setAttachTo(null)
      setSchedule(defaultSchedule())
    }
  }, [open])

  if (!flow) return null
  const consent = binding?.consent

  async function confirm() {
    if (!flow) return
    const armed = await arm(flow.id, schedule, attachTo ?? undefined)
    if (armed?.instance_id) {
      onClose()
      go({ kind: 'session', instanceId: armed.instance_id })
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={`Schedule "${flow.name}"`}
      description="This pod will run it on its own, with nobody watching."
    >
      {!binding ? (
        <div className="flex items-center gap-2 py-4 text-sm text-ink-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Asking the pod what this permits…
        </div>
      ) : (
        <div className="space-y-3">
          <Line label="When">
            <ScheduleEditor value={schedule} onChange={setSchedule} />
          </Line>

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
              {/* A real agent carries dozens of tools — the default preset alone
                  has 26 mutating ones — so the full list is a wall of text
                  nobody reads. Lead with the ones that can reach outside this
                  pod, cap the rest, and keep the count honest. */}
              <span className="text-[13px]">
                change things: {rank(consent.mutating_tools).slice(0, 4).join(', ')}
                {consent.mutating_tools.length > 4 &&
                  ` and ${consent.mutating_tools.length - 4} more`}
              </span>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {consent.mutating_tools.length} of {consent.tool_count} tool
                {consent.tool_count === 1 ? '' : 's'} it can call change something
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
          {working ? 'Scheduling…' : 'Schedule it'}
        </Button>
      </div>
    </Modal>
  )
}

/** A daily 8am cron, in the reader's own timezone.
 *
 *  Not the pod's: a cron with no zone is evaluated wherever the pod happens to
 *  run, so "8am" would mean 8am somewhere else. Stating the browser's zone makes
 *  the common case mean what it says. */
function defaultSchedule(): ScheduleSpec {
  return {
    type: 'cron',
    cron: '0 0 8 * * *',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

/** The trigger picker: a kind, and whatever that kind needs.
 *
 *  Cron is six fields here (seconds first) because that is what the pod parses —
 *  a five-field POSIX expression saves and then never fires, which the pod
 *  reports as `Invalid cron …` but only after the fact. */
function ScheduleEditor({
  value,
  onChange,
}: {
  value: ScheduleSpec
  onChange: (next: ScheduleSpec) => void
}) {
  const set = (patch: Partial<ScheduleSpec>) => onChange({ ...value, ...patch })
  const field =
    'w-full rounded-control border border-line bg-inset px-2 py-1 text-[13px] outline-none focus:border-accent'

  return (
    <div className="space-y-1.5">
      <select
        className={field}
        value={value.type}
        onChange={(e) => {
          const type = e.target.value
          onChange(
            type === 'cron'
              ? defaultSchedule()
              : { type, interval: type === 'manual' ? null : 1, name: value.name },
          )
        }}
      >
        <option value="cron">On a schedule (cron)</option>
        <option value="hours">Every N hours</option>
        <option value="minutes">Every N minutes</option>
        <option value="manual">Only when I run it</option>
      </select>

      {value.type === 'cron' && (
        <>
          <input
            className={cn(field, 'font-mono')}
            value={value.cron ?? ''}
            onChange={(e) => set({ cron: e.target.value })}
            placeholder="0 0 8 * * *"
            aria-label="Cron expression"
          />
          <p className="text-[11.5px] text-ink-3">
            Six fields, seconds first — <span className="font-mono">0 0 8 * * *</span> is 8am
            daily, in {value.timezone ?? 'the pod&apos;s timezone'}.
          </p>
        </>
      )}

      {(value.type === 'minutes' || value.type === 'hours') && (
        <input
          className={field}
          type="number"
          min={1}
          value={value.interval ?? 1}
          onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })}
          aria-label={`Every N ${value.type}`}
        />
      )}

      {value.type === 'manual' && (
        <p className="text-[11.5px] text-ink-3">
          Nothing fires on its own. This names the agent a hand-run belongs to, so what it
          learns carries between runs.
        </p>
      )}

      <input
        className={field}
        value={value.name ?? ''}
        onChange={(e) => set({ name: e.target.value })}
        placeholder="Name it (optional) — e.g. Morning brief"
        aria-label="Schedule name"
      />
    </div>
  )
}

/** Loudest first. `bash` and `write_file` are what someone needs to see in the
 *  four names that fit; `mem_remember` is not. */
const LOUD = ['bash', 'write_file', 'edit_file', 'web_fetch', 'key_set', 'key_delete']
function rank(tools: string[]): string[] {
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...tools].sort((a, b) => {
    const ai = LOUD.indexOf(a)
    const bi = LOUD.indexOf(b)
    return (ai < 0 ? LOUD.length : ai) - (bi < 0 ? LOUD.length : bi) || a.localeCompare(b)
  })
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-start gap-3">
      <span className="pt-0.5 text-[12px] text-ink-3">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
