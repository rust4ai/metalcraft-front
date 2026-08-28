import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useAutomations } from '@/stores/automations'
import { useSettings } from '@/stores/podSettings'
import { useFleet } from '@/stores/fleet'
import { useUi } from '@/stores/ui'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { automations } from '@/rpc'
import {
  packSatisfied,
  type Flow,
  type PackRequirement,
  type SchedulePreview,
  type ScheduleSpec,
} from '@/types'

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
  const [needs, setNeeds] = useState<PackRequirement[]>([])
  const [attachTo, setAttachTo] = useState<string | null>(null)
  const [schedule, setSchedule] = useState<ScheduleSpec>(defaultSchedule)

  /** The agent this flow already has, if it has one — minted by an earlier hand
   *  run, or by arming it before. Arming continues it. */
  const ownAgent = instances.find(
    (i) => i.origin.kind === 'flow' && i.origin.flow_id === flow?.id,
  )

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

  // Packs, which `binding` does not cover. Kept local to the dialog and failing
  // quietly: a pod too old for the route, or one that will not answer, must not
  // block a consent screen whose other half loaded fine.
  const flowId = open ? flow?.id : undefined
  useEffect(() => {
    setNeeds([])
    if (!flowId) return
    let live = true
    automations
      .dependencies(flowId)
      .then((d) => live && setNeeds(d.packs.filter((p) => !packSatisfied(p))))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [flowId])

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
            <SchedulePreviewLine schedule={schedule} />
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
                {ownAgent?.name ?? consent?.preset_name ?? binding.preset}
                {/* Not always *new*: a flow that has already been run by hand
                    has an agent, and arming continues it rather than minting a
                    second one beside it. Saying "a new agent" there promised a
                    fresh memory and delivered an existing one. */}
                <span className="ml-1.5 text-ink-3">
                  {ownAgent ? '— this automation’s own agent' : '— a new agent for this automation'}
                </span>
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

          {needs.length > 0 && (
            <Line label="Needs packs">
              {/* The same failure as a missing credential, from the other
                  direction: the graph reaches a pack this agent does not have,
                  and nothing else on this screen would say so. */}
              <p className="flex items-start gap-1.5 text-[12px] text-orange">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  This pod does not have {needs.map((p) => p.pack).join(', ')}. Steps that use
                  {needs.length === 1 ? ' it' : ' them'} will fail when it runs.
                </span>
              </p>
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

/** A daily 8am cron, in whatever zone the pod reads a zone-less schedule in.
 *
 *  It used to stamp the browser's zone onto every schedule, which made the ones
 *  armed from here correct and left every other way of arming one — the agent's
 *  own scheduling tool, a pack suggestion, a hand-written flow — running on the
 *  pod's clock. The pod has a timezone of its own now, so the fix belongs there
 *  and this inherits it. `ZoneMismatch` below is what makes that visible, and
 *  offers to set it when the two disagree. */
function defaultSchedule(): ScheduleSpec {
  return { type: 'cron', cron: '0 0 8 * * *' }
}

/**
 * Which zone this will actually run in, and an offer to change it when that is
 * not the one the reader lives in.
 *
 * A pod is provisioned in a datacentre and nobody tells it where its owner
 * lives, so disagreeing is the *starting* state, not an exotic one — and the
 * symptom is the worst kind: the automation works, on the wrong hour, silently.
 * The fix sets the pod's zone rather than this schedule's, because a person
 * whose pod is on the wrong clock does not have one wrong automation, they have
 * every future one.
 */
function ZoneMismatch({ schedule }: { schedule: ScheduleSpec }) {
  const { podZone, load, setZone } = useSettings()
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    void load()
  }, [load])

  // A schedule carrying its own zone is not inheriting anything, so there is
  // nothing here to disagree about.
  if (schedule.type !== 'cron' || schedule.timezone) return null

  if (podZone === here) {
    return <p className="text-[11.5px] text-ink-3">Runs in {here}, this pod’s timezone.</p>
  }

  return (
    <p className="flex items-start gap-1.5 text-[11.5px] text-orange">
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>
        {podZone
          ? `This pod is on ${podZone} and you are on ${here}, so 8am here would fire at 8am ${podZone}.`
          : `This pod has no timezone, so it will use its own clock — usually UTC, not ${here}.`}{' '}
        <button
          type="button"
          onClick={() => void setZone(here)}
          className="underline hover:text-ink"
        >
          Set the pod to {here}
        </button>
      </span>
    </p>
  )
}

/**
 * When this trigger would actually fire, asked of the pod while somebody types.
 *
 * The editor below warns that a five-field POSIX cron saves and then never
 * fires; this is the pod answering that question *before* it is armed. An empty
 * `next_runs` on a cron is exactly that failure — the pod could not parse it —
 * and it is worth shouting about, because the alternative is finding out at 8am
 * on a morning when nothing happened.
 */
function SchedulePreviewLine({ schedule }: { schedule: ScheduleSpec }) {
  const [preview, setPreview] = useState<SchedulePreview | null>(null)

  // Keyed on the spec's content, so retyping a cron re-asks and switching to
  // `manual` stops asking about a cron that is no longer on screen.
  const key = JSON.stringify(schedule)
  useEffect(() => {
    setPreview(null)
    if (schedule.type === 'manual') return
    let live = true
    // Debounced: a cron is typed a character at a time, and every intermediate
    // state is a different, mostly invalid expression.
    const timer = setTimeout(() => {
      automations
        .previewSchedule(schedule)
        .then((p) => live && setPreview(p))
        .catch(() => {})
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // Keyed on the serialised spec rather than the object: a new object with the
    // same fields is a re-render, not a new question to ask the pod.
  }, [key])

  if (schedule.type === 'manual' || !preview) return null

  if (preview.next_runs.length === 0) {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-[12px] text-orange">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>
          This pod cannot read that trigger, so it would never fire. Saved as{' '}
          <span className="font-mono">{preview.description}</span>.
        </span>
      </p>
    )
  }

  return (
    <p className="mt-1 text-[11.5px] text-ink-3">
      Next:{' '}
      {preview.next_runs.slice(0, 3).map((iso, i) => (
        <span key={iso}>
          {i > 0 && ', '}
          {new Date(iso).toLocaleString()}
        </span>
      ))}
    </p>
  )
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
            daily. Weekdays are <span className="font-mono">SUN</span>…
            <span className="font-mono">SAT</span>, or 1–7 from Sunday: a bare{' '}
            <span className="font-mono">1</span> is Sunday, not Monday.
          </p>
          <ZoneMismatch schedule={value} />
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
