import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Loader2, Unplug } from 'lucide-react'
import { useSettings } from '@/stores/settings'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { openExternal } from '@/lib/external'
import type { ServiceId } from '@/types'
import { judgeKey } from './keyHealth'
import { SERVICES } from './services'

/**
 * Connect a service to this pod (PLAN §9.3, P7) — one button.
 *
 * The card used to walk the user through creating an API key and pasting it
 * back. It no longer asks for anything they hold: the core connects with the
 * Metalcraft account already signed in here, mints the key itself and installs
 * the pack.
 *
 * Two things can interrupt that, and both are clicks rather than typing. The
 * first time, the service has never seen this Metalcraft account, so a browser
 * opens on its link page and this card waits. And Octaweave with several
 * workspaces gets a picker, because which workspace an agent lives in is not a
 * choice to make on someone's behalf.
 *
 * **One component, both services.** It was written for Octaweave and copied for
 * nothing: buildr.space arrived with the same five steps, the same three-minute
 * browser poll, the same halfway state when the key stores and the pack does
 * not. What differs is [`SERVICES`] — the words — and one branch that only
 * Octaweave takes.
 *
 * No credential passes through this component. It renders a name and a scope
 * list; the key exists only between the service and the pod.
 */
export function ConnectionCard({ service }: { service: ServiceId }) {
  const spec = SERVICES[service]
  const { status, connection, busy, error, linking, choices } = useSettings(
    (s) => s.services[service],
  )
  const { loadService, connectService, cancelLink, installServicePack, disconnectService } =
    useSettings()
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void loadService(service)
  }, [loadService, service])

  const connected = status?.key_present ?? false
  // What the pod holds and whether it still works are two questions, and only
  // the first has an answer on the pod. See `keyHealth.ts`.
  const key = judgeKey(status)

  return (
    <section className="rounded-card bg-surface p-5 shadow-card">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">{spec.name}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">{spec.blurb}</p>
        </div>
        <StatusChip
          connected={connected}
          packInstalled={status?.pack_installed ?? false}
          broken={key.broken}
        />
      </header>

      {connection && (
        <dl className="mt-4 rounded-chip bg-inset px-3 py-2 text-[11.5px]">
          <Row label={spec.identity} value={connection.label || connection.id} />
          <Row label="Scopes" value={connection.scopes.join(' ') || 'none reported'} mono />
        </dl>
      )}

      {status?.pack_installed && (
        <p className="mt-3 text-[11.5px] text-ink-3">
          {status.api_tools} tools installed
          {status.pack_version ? ` · v${status.pack_version}` : ''}
          {/* Installed but off means the tools exist and will never fire, which
              looks identical to "not installed" from a conversation. */}
          {!status.pack_enabled && <span className="text-orange"> · disabled on the pod</span>}
        </p>
      )}

      {/* Whether the key still authenticates — the half the pod cannot answer,
          and the one that used to fail silently a month after connecting. */}
      {key.tone === 'quiet' && <p className="mt-2 text-[11.5px] text-ink-3">{key.text}</p>}
      {key.tone === 'warn' && <Note tone="warn" text={key.text ?? ''} />}
      {key.tone === 'bad' && <Note tone="bad" text={key.text ?? ''} />}

      {/* Silence here would read as "it left the old key working", which is the
          one thing a reconnect must not be ambiguous about. */}
      {connection && connection.replaced > 0 && (
        <p className="mt-2 text-[11.5px] text-ink-3">
          {connection.replaced === 1
            ? 'The key this app made before was revoked.'
            : `${connection.replaced} keys this app made before were revoked.`}
        </p>
      )}

      {note && <Note tone="warn" text={note} />}
      {error && <Note tone="bad" text={error} />}

      {connected ? (
        <div className="mt-4 flex items-center gap-2">
          {/* A dead key needs replacing, and Disconnect-then-Connect is two
              steps for one intention. Connect already revokes its predecessor,
              so this is the same button under the name that fits the state. */}
          {key.broken && (
            <Button
              size="sm"
              onClick={() => void connectService(service).then(setNote)}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Reconnect
            </Button>
          )}
          {!status?.pack_installed && (
            <Button
              size="sm"
              onClick={() => void installServicePack(service).then(setNote)}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Install the tools
            </Button>
          )}
          {connection?.url && (
            <Button size="sm" variant="outline" onClick={() => void openExternal(connection.url)}>
              {spec.open} <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            className="ml-auto"
            onClick={() => void disconnectService(service)}
            disabled={busy}
          >
            <Unplug className="h-4 w-4" />
            Disconnect
          </Button>
        </div>
      ) : linking ? (
        <Waiting onCancel={() => cancelLink(service)} />
      ) : choices ? (
        <div className="mt-4">
          <p className="text-[12.5px] text-ink-2">{spec.choose}</p>
          <ul className="mt-2 space-y-1.5">
            {choices.map((w) => (
              <li key={w.id}>
                <button
                  onClick={() => void connectService(service, w.id).then(setNote)}
                  disabled={busy}
                  className="flex w-full items-baseline gap-2 rounded-chip bg-inset px-3 py-2 text-left text-[12.5px] hover:bg-field disabled:opacity-50"
                >
                  <span className="min-w-0 truncate">{w.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-3">
                    {w.org_slug}/{w.slug}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-4">
          <Button
            size="sm"
            onClick={() => void connectService(service).then(setNote)}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {spec.connect}
          </Button>
          <p className="mt-3 text-[11px] text-ink-3">{spec.footnote}</p>
        </div>
      )}
    </section>
  )
}

/**
 * The browser is open on the service's link page.
 *
 * Cancel is offered because the alternative is a spinner with no way out, and
 * cancelling costs nothing: it stops the asking, not the linking, so a link that
 * lands anyway is picked up by the next Connect.
 */
function Waiting({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="mt-4 flex items-center gap-2.5 rounded-chip bg-inset px-3 py-2.5">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-3" />
      <p className="min-w-0 flex-1 text-[12.5px] text-ink-2">
        Approve the connection in your browser — this finishes on its own.
      </p>
      <Button size="sm" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

/**
 * The one-word summary, and the one that must never be generous.
 *
 * `broken` outranks everything: a pod holding a revoked or lapsed key looks
 * identical to a working one from here — same key name, same installed pack —
 * and reading "Connected" over it is the failure this card was changed to end.
 */
function StatusChip({
  connected,
  packInstalled,
  broken,
}: {
  connected: boolean
  packInstalled: boolean
  broken: boolean
}) {
  const label = broken
    ? 'Key not working'
    : !connected
      ? 'Not connected'
      : packInstalled
        ? 'Connected'
        : 'Key only'
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-chip px-2 py-0.5 text-[11px]',
        broken
          ? 'bg-red-tint text-red'
          : connected && packInstalled
            ? 'bg-green-tint text-green'
            : connected
              ? 'bg-orange-tint text-orange'
              : 'bg-inset text-ink-3',
      )}
    >
      {broken && <AlertTriangle className="h-3 w-3" />}
      {!broken && connected && packInstalled && <Check className="h-3 w-3" />}
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
