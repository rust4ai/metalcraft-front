import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, MessageCircle, Unplug } from 'lucide-react'
import { useSettings } from '@/stores/settings'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/**
 * WhatsApp and SMS (PLAN §10.6) — the surface the iOS app has had since 0.3 and
 * the desktop has not.
 *
 * Three steps, and the card is really three cards in sequence, because they fail
 * in unrelated ways: **register** a number, **verify** it by texting a code from
 * that phone, then **connect** — which is the step nobody would guess at, since
 * it is not about the number at all. It wires the pod's `metalcraft` channel and
 * registers the inbound webhook, and without it a perfectly verified number
 * reaches a gateway that has nowhere to deliver.
 *
 * Everything here is read from the pod, not from the gateway. The pod is what
 * receives a message; asking the account-level service instead would let this
 * card show a working connection for a pod that is not wired to anything —
 * which is the same class of bug as showing push "On" while the gateway holds
 * zero devices.
 *
 * `verified` is the one transition this window cannot cause: it happens when a
 * person texts a code from their phone. So the card polls while it waits, and
 * shows the code the whole time — the gateway issues a fresh one on every
 * register, so a code that scrolls away is a code that is gone.
 */

/**
 * How often to re-ask while a number is waiting to be verified.
 *
 * The user is in a texting app, and the round trip through Twilio is seconds —
 * so 5s is the difference between "it noticed" and "did that work?". Nothing
 * polls once the number is verified: the remaining states only change when
 * somebody presses a button here.
 */
const POLL_MS = 5000

export function GatewayCard({ pollMs = POLL_MS }: { pollMs?: number } = {}) {
  const {
    gatewayStatus: status,
    gatewayUnsupported,
    gatewayPending,
    gatewayBusy,
    gatewayError,
    loadGateway,
    registerGatewayNumber,
    clearGatewayPending,
    connectGateway,
    disconnectGateway,
  } = useSettings()
  const [number, setNumber] = useState('')
  /**
   * The user asked to go back to the number field.
   *
   * Local, and not in the store, because nothing changed anywhere else: the
   * gateway still holds the old registration until a new one replaces it. The
   * pod would go on reporting "registered, unverified" forever, so without this
   * the button that offers a way out is the one button on the card that does
   * nothing visible.
   */
  const [changingNumber, setChangingNumber] = useState(false)

  useEffect(() => {
    void loadGateway()
  }, [loadGateway])

  const awaitingCode = (status?.registered ?? false) && !(status?.verified ?? false)
  useEffect(() => {
    if (!awaitingCode) return
    const t = setInterval(() => void loadGateway(), pollMs)
    return () => clearInterval(t)
  }, [awaitingCode, loadGateway, pollMs])

  // The gateway wants E.164 and refuses anything else with a 400. Checking the
  // same rule here turns a round trip into a disabled button.
  const usable = /^\+\d{7,}$/.test(number.replace(/[\s()-]/g, ''))

  const register = async () => {
    // Only on success: a refused number has to leave the field on screen with
    // what was typed still in it, next to the reason.
    if (await registerGatewayNumber(number)) setChangingNumber(false)
  }
  const connected = status?.connected ?? false

  return (
    <section className="rounded-card bg-surface p-5 shadow-card">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">WhatsApp &amp; SMS</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            Message your agent from your phone, and let it message you back.
          </p>
        </div>
        <StatusChip status={status} unsupported={gatewayUnsupported} />
      </header>

      {gatewayUnsupported ? (
        <p className="mt-4 text-[12.5px] text-ink-2">
          This pod is older than the messaging endpoints. Upgrade the agent and this card comes
          back.
        </p>
      ) : !status ? (
        <p className="mt-4 flex items-center gap-2 text-[12.5px] text-ink-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking the pod…
        </p>
      ) : !status.configured ? (
        <p className="mt-4 text-[12.5px] text-ink-2">
          This pod is not linked to a Metalcraft account, so it cannot reach the gateway. Nothing
          here can be set up until it is.
        </p>
      ) : (
        <>
          {connected && (
            <dl className="mt-4 rounded-chip bg-inset px-3 py-2 text-[11.5px]">
              <Row label="Reaches your agent at" value={status.active_number ?? '—'} mono />
              <Row label="Channel" value={status.channel ?? '—'} />
              {/* Config on disk vs. a live long-poll. A pod can be "connected"
                  and receiving nothing, and that is the state worth naming. */}
              <Row
                label="Receiving"
                value={status.streaming ? 'yes, right now' : 'on delivery to its webhook'}
              />
            </dl>
          )}

          {/* Connected and dead: the webhook the gateway holds no longer points
              at this pod, so messages are being delivered into the void.
              Connecting again re-registers it. */}
          {connected && status.webhook_stale && (
            <Note
              tone="warn"
              text="The gateway is delivering to an address this pod no longer answers on — messages are being lost. Connect again to re-register it."
            />
          )}

          {status.error && <Note tone="warn" text={status.error} />}
          {gatewayError && <Note tone="bad" text={gatewayError} />}

          {connected ? (
            <div className="mt-4 flex items-center gap-2">
              {status.webhook_stale && (
                <Button size="sm" onClick={() => void connectGateway()} disabled={gatewayBusy}>
                  {gatewayBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Re-register the webhook
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                className="ml-auto"
                onClick={() => void disconnectGateway()}
                disabled={gatewayBusy}
              >
                <Unplug className="h-4 w-4" />
                Disconnect
              </Button>
            </div>
          ) : status.verified ? (
            <div className="mt-4">
              <p className="text-[12.5px] text-ink-2">
                {status.active_number ?? 'Your number'} is verified. One step left: wire it to this
                pod.
              </p>
              <Button
                size="sm"
                className="mt-2"
                onClick={() => void connectGateway()}
                disabled={gatewayBusy}
              >
                {gatewayBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Connect
              </Button>
              {/* Neither is fatal — a pull-mode pod has no public URL and needs
                  none — but a pod with no URL *and* no long-poll receives
                  nothing, and finding that out after connecting is worse. */}
              {!status.has_public_url && (
                <p className="mt-2 text-[11.5px] text-ink-3">
                  This pod does not know its own public URL, so it will receive by long-poll rather
                  than by webhook.
                </p>
              )}
            </div>
          ) : awaitingCode && !changingNumber ? (
            <Waiting
              code={gatewayPending?.verify_code ?? null}
              to={status.active_number ?? gatewayPending?.active_number ?? null}
              onChangeNumber={() => {
                clearGatewayPending()
                setChangingNumber(true)
              }}
            />
          ) : (
            <div className="mt-4">
              <div className="flex gap-2">
                <input
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && usable) void register()
                  }}
                  placeholder="+1 555 010 0000"
                  aria-label="Your phone number"
                  type="tel"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 min-w-0 flex-1 rounded-control bg-field px-2.5 font-mono text-[12px] text-ink placeholder:text-ink-3"
                />
                <Button
                  size="sm"
                  onClick={() => void register()}
                  disabled={gatewayBusy || !usable}
                >
                  {gatewayBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Register
                </Button>
              </div>
              <p className="mt-3 text-[11px] text-ink-3">
                Your own number, with the country code. You will get a code to text back from it,
                which is what proves the phone is yours.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/**
 * Registered, waiting on the text.
 *
 * The code is on screen rather than in a dismissable toast because it is the
 * only copy: registering again issues a *new* one, so a code that scrolls away
 * has to be re-requested. When the pending registration is gone — a reload, or
 * this card mounted fresh — the instruction stays true without it, and offering
 * a re-register is better than inventing a code we do not have.
 */
function Waiting({
  code,
  to,
  onChangeNumber,
}: {
  code: string | null
  to: string | null
  onChangeNumber: () => void
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2.5 rounded-chip bg-inset px-3 py-2.5">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-3" />
        <p className="min-w-0 flex-1 text-[12.5px] text-ink-2">
          {code ? (
            <>
              Text <span className="font-mono text-ink">{code}</span> to{' '}
              <span className="font-mono text-ink">{to ?? 'the gateway number'}</span> from that
              phone, within fifteen minutes. This finishes on its own.
            </>
          ) : (
            <>
              Waiting for the code to be texted back. Register the number again to get a fresh one —
              codes last fifteen minutes.
            </>
          )}
        </p>
      </div>
      <Button size="sm" variant="ghost" className="mt-2" onClick={onChangeNumber}>
        Use a different number
      </Button>
    </div>
  )
}

/**
 * One chip for a three-step setup, so the header says which step without
 * anybody reading the body. "Not receiving" is deliberately not "Connected":
 * a stale webhook is the state that most looks fine and least is.
 */
function StatusChip({
  status,
  unsupported,
}: {
  status: { registered: boolean; verified: boolean; connected: boolean; webhook_stale: boolean } | null
  unsupported: boolean
}) {
  if (unsupported) return <Chip tone="dim" label="Unavailable" />
  if (!status) return <Chip tone="dim" label="…" />
  if (status.connected && status.webhook_stale) return <Chip tone="warn" label="Not receiving" />
  if (status.connected) return <Chip tone="good" label="Connected" />
  if (status.verified) return <Chip tone="warn" label="Not connected" />
  if (status.registered) return <Chip tone="warn" label="Unverified" />
  return <Chip tone="dim" label="Not set up" />
}

function Chip({ tone, label }: { tone: 'good' | 'warn' | 'dim'; label: string }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-chip px-2 py-0.5 text-[11px]',
        tone === 'good' ? 'bg-green-tint text-green' : tone === 'warn' ? 'bg-orange-tint text-orange' : 'bg-inset text-ink-3',
      )}
    >
      {tone === 'good' && <Check className="h-3 w-3" />}
      {tone === 'dim' && <MessageCircle className="h-3 w-3" />}
      {label}
    </span>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right text-ink-2', mono && 'font-mono text-[11px]')}>{value}</dd>
    </div>
  )
}

function Note({ tone, text }: { tone: 'warn' | 'bad'; text: string }) {
  return (
    <div
      className={cn(
        'mt-3 flex gap-2 rounded-chip px-2.5 py-2 text-[11.5px] text-ink-2',
        tone === 'warn' ? 'bg-orange-tint' : 'bg-red-tint',
      )}
    >
      <AlertTriangle className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone === 'warn' ? 'text-orange' : 'text-red')} />
      <span>{text}</span>
    </div>
  )
}
