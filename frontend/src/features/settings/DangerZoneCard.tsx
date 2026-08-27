import { useState } from 'react'
import { AlertTriangle, Loader2, TriangleAlert } from 'lucide-react'
import { danger } from '@/rpc'
import { useConnection } from '@/stores/connection'
import { useUi } from '@/stores/ui'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/cn'
import type { ResetReport, ResetScope } from '@/types'

/** What the pod requires typed back. Must match the agent's `CONFIRM_PHRASE`. */
const CONFIRM_PHRASE = 'FACTORY RESET'

/**
 * Factory reset — the only control in this app that destroys something nobody
 * can get back.
 *
 * It exists for testing the first run. Onboarding is a series of claims about an
 * empty pod — *you have no agents*, *no source is bound*, *nothing is installed*
 * — and every one of them stops being checkable the moment the pod is used once.
 * Deleting chats does not restore it, because what onboarding reads is the
 * absence of whole directories, so the reset is defined against the pod's data
 * directory rather than against any feature's idea of "my content".
 *
 * Three guards, and each one stops a different mistake:
 *
 * 1. **A modal, not an inline confirm.** The rest of settings confirms in place
 *    (see `GatewayCard`), which is right for a reversible act next to the thing
 *    it affects. This one takes the window, because the cost of it being missed
 *    is not the same cost.
 * 2. **The phrase, typed.** Not "are you sure" — a person clicks through that
 *    without reading it. Typing `FACTORY RESET` cannot be done by a person who
 *    has not read what it says, which is the entire mechanism. The pod checks it
 *    again server-side; this copy is the human gate, that one is the machine's.
 * 3. **The scope, chosen explicitly.** Full is the default because it is the
 *    only scope that actually reproduces a new pod, and the weaker option says
 *    out loud which tests it invalidates.
 */
export function DangerZoneCard() {
  const [open, setOpen] = useState(false)
  const pod = useConnection((s) => s.pod)

  return (
    <section className="rounded-card border border-red/30 bg-surface p-5 shadow-card">
      <header className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">Factory reset</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            Erase {pod ? <span className="font-medium text-ink">{pod.slug}</span> : 'this pod'} and
            bring it back as a newly-provisioned one — the state a new user's pod boots in. Nothing
            here can be undone.
          </p>
        </div>
        <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
          Reset…
        </Button>
      </header>

      <ResetDialog open={open} onOpenChange={setOpen} />
    </section>
  )
}

/**
 * The dialog is a small state machine — *asking*, *erasing*, *done* — rather
 * than a form that closes on submit.
 *
 * It has to stay open through the last state: the pod exits a beat after it
 * answers, so the report it returns is the only account that will ever exist of
 * what was removed. Closing on success would throw away the one thing worth
 * reading, and leave a partial wipe looking exactly like a clean one.
 */
function ResetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [scope, setScope] = useState<ResetScope>('full')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ResetReport | null>(null)
  /** The pod answered 404 — older than the endpoint, and nothing to fall back on. */
  const [unsupported, setUnsupported] = useState(false)

  const armed = typed.trim() === CONFIRM_PHRASE && !busy

  const close = (next: boolean) => {
    // Never yanked out from under a running wipe: the request is in flight and
    // the report is the only thing that will say what it did.
    if (busy) return
    onOpenChange(next)
    if (!next) {
      setTyped('')
      setError(null)
      setReport(null)
      setUnsupported(false)
      setScope('full')
    }
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await danger.factoryReset(scope)
      if (result) setReport(result)
      else setUnsupported(true)
    } catch (e) {
      // A transport error here is genuinely ambiguous — the pod may have wiped
      // and exited before its answer reached us — so it is reported as
      // "unknown", not as "failed". Telling someone their reset did not happen
      // when it did is how a pod gets wiped twice.
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={report ? 'The pod is restarting' : 'Factory reset this pod'}
      description={
        report
          ? undefined
          : 'Everything the pod holds is deleted and it restarts as if it had just been provisioned.'
      }
    >
      {report ? (
        <ResetOutcome report={report} onClose={() => close(false)} />
      ) : unsupported ? (
        <div className="space-y-4">
          <p className="text-[12.5px] text-ink-2">
            This pod is too old to reset itself — the endpoint arrived in agent 0.35.0. Upgrade the
            pod's image and try again. There is no way to do it from here: erasing a pod from
            outside would delete its state one endpoint at a time and still leave the process
            running on the in-memory copy of all of it.
          </p>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => close(false)}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <WhatGoes scope={scope} />

          <fieldset className="space-y-2">
            <legend className="text-[12.5px] font-medium">How much</legend>
            <ScopeChoice
              checked={scope === 'full'}
              onSelect={() => setScope('full')}
              label="Everything"
              detail="Including the key store, so no source is bound and no service is connected. The only scope that replays a first run from step zero."
            />
            <ScopeChoice
              checked={scope === 'keep_keys'}
              onSelect={() => setScope('keep_keys')}
              label="Everything except my keys"
              detail="Faster to repeat, but any onboarding step gated on “no key bound” will not appear — so not the scope to check a first run with."
            />
          </fieldset>

          <label className="block">
            <span className="text-[12.5px] text-ink-2">
              Type <span className="font-mono font-semibold text-ink">{CONFIRM_PHRASE}</span> to
              confirm
            </span>
            <input
              className="mt-1.5 h-9 w-full rounded-control bg-hover px-3 font-mono text-sm outline-none ring-red/40 focus:ring-2"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label={`Type ${CONFIRM_PHRASE} to confirm`}
            />
          </label>

          {error && (
            <p className="rounded-control bg-red/10 px-3 py-2 text-[12.5px] text-red">
              The pod did not answer: {error}
              <br />
              It may still have reset and exited before replying — check whether it comes back
              before pressing this again.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => close(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={run} disabled={!armed}>
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Erasing…
                </>
              ) : (
                'Erase this pod'
              )}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** The inventory, named rather than counted — "all your data" is not a list
 *  anyone can check themselves against before pressing the button. */
function WhatGoes({ scope }: { scope: ResetScope }) {
  return (
    <div className="rounded-control bg-red/5 p-3">
      <p className="flex items-start gap-2 text-[12.5px] text-ink">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red" />
        <span>
          Deleted for good: every chat and agent, all of the agents' memory, your flows, their runs
          and schedules, installed packs and integrations, channels
          {scope === 'full' ? (
            <>
              , and <span className="font-medium">the key store</span> — the bound interface source
              and every service connection
            </>
          ) : null}
          .
        </span>
      </p>
      <p className="mt-2 text-[12.5px] text-ink-3">
        The pod restarts by itself if something supervises it. If you run this pod yourself, it will
        exit and stay down until you start it again.
      </p>
    </div>
  )
}

function ScopeChoice({
  checked,
  onSelect,
  label,
  detail,
}: {
  checked: boolean
  onSelect: () => void
  label: string
  detail: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-control p-2.5 transition-colors',
        checked ? 'bg-hover' : 'hover:bg-hover/60',
      )}
    >
      <input
        type="radio"
        name="reset-scope"
        className="mt-1 accent-red"
        checked={checked}
        onChange={onSelect}
      />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium">{label}</span>
        <span className="mt-0.5 block text-[12px] text-ink-3">{detail}</span>
      </span>
    </label>
  )
}

/**
 * What the reset did, and what to do next.
 *
 * `failed` is the field this screen exists for. A wipe that left entries behind
 * still restarts the pod, so the pod comes back looking new while holding some
 * of what it held before — and the operator would go on to test onboarding
 * against it. That has to be louder than the success case, not a footnote in it.
 */
function ResetOutcome({ report, onClose }: { report: ResetReport; onClose: () => void }) {
  const go = useUi((s) => s.go)
  const pods = useConnection((s) => s.pods)
  const pod = useConnection((s) => s.pod)
  const connect = useConnection((s) => s.connect)
  const connecting = useConnection((s) => s.connecting)

  // `ActivePod` carries a slug and a URL but no id, and `connect` wants the id
  // from the account's pod list. Matching on slug is what bridges them; a pod
  // reached by URL is not on that list at all, hence the fallback.
  const id = pods.find((p) => p.slug === pod?.slug)?.id

  return (
    <div className="space-y-4">
      {report.failed.length > 0 ? (
        <div className="rounded-control bg-red/10 p-3">
          <p className="text-[12.5px] font-medium text-red">
            This pod is not factory-fresh. {report.failed.length} item
            {report.failed.length === 1 ? '' : 's'} could not be removed:
          </p>
          <ul className="mt-1.5 space-y-1">
            {report.failed.map((f) => (
              <li key={f.name} className="text-[12px] text-ink-2">
                <span className="font-mono">{f.name}</span> — {f.error}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-ink-3">
            Do not read what comes back as a first-run pod.
          </p>
        </div>
      ) : (
        <p className="text-[12.5px] text-ink-2">
          Removed {report.removed.length} item{report.removed.length === 1 ? '' : 's'} from{' '}
          <span className="font-mono text-[12px]">{report.data_dir}</span>
          {report.kept.length > 0 && (
            <>
              , keeping <span className="font-mono text-[12px]">{report.kept.join(', ')}</span>
            </>
          )}
          .
        </p>
      )}

      <p className="text-[12.5px] text-ink-2">
        {report.restart === 'supervised'
          ? 'The pod is exiting now and will be restarted for you. It seeds itself on the way back up, so give it a moment before reconnecting.'
          : 'Nothing is supervising this pod, so it has exited and will stay down. Start it again yourself — it seeds itself on the way back up.'}
      </p>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
        {report.restart === 'supervised' && (
          <Button
            size="sm"
            variant="outline"
            disabled={connecting}
            onClick={async () => {
              // Reconnecting is the ordinary connect path, not a special one:
              // whatever the app does for a pod that was asleep is what it
              // should do for a pod that was just reborn.
              if (id) await connect(id)
              else go({ kind: 'pods' })
              onClose()
            }}
          >
            {connecting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reconnecting…
              </>
            ) : (
              'Reconnect'
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
