import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Loader2, Unplug } from 'lucide-react'
import { octaweave } from '@/rpc'
import { useSettings } from '@/stores/settings'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/**
 * Connect an Octaweave workspace (PLAN §9.3, P7).
 *
 * "One click" is as close as the design allows, and the remaining step is a
 * security property rather than a gap: an `owk_` key cannot mint another and
 * Octaweave refuses key-auth for key creation, so producing one is necessarily a
 * signed-in human in a browser. What this card removes is everything *after*
 * that — pressing Connect verifies the key, writes it into the pod's key store
 * and installs the 32-tool integration pack in a single action.
 *
 * The key never reaches this component's store. It is handed to the core, which
 * proves it against `GET /api/v1/whoami` before writing it anywhere, and returns
 * a workspace and a scope list — never the credential.
 */
export function OctaweaveCard() {
  const {
    octaweave: status,
    connection,
    octaweaveBusy,
    octaweaveError,
    loadOctaweave,
    connectOctaweave,
    installOctaweavePack,
    disconnectOctaweave,
  } = useSettings()
  const [token, setToken] = useState('')
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void loadOctaweave()
  }, [loadOctaweave])

  // A key returned by the browser goes through the same Connect path as one
  // pasted by hand — one flow, one place verification happens.
  useEffect(() => {
    let stop: (() => void) | undefined
    void octaweave.onToken((t) => {
      setToken(t)
      void connectOctaweave(t).then(setNote)
    }).then((off) => {
      stop = off
    })
    return () => stop?.()
  }, [connectOctaweave])

  const connect = async () => {
    setNote(await connectOctaweave(token))
    setToken('')
  }

  const connected = status?.key_present ?? false

  return (
    <section className="rounded-card bg-surface p-5 shadow-card">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">Octaweave</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            Notes, board, drive, calendar, blog and studio — the workspace your agent can work in too.
          </p>
        </div>
        <StatusChip connected={connected} packInstalled={status?.pack_installed ?? false} />
      </header>

      {connection && (
        <dl className="mt-4 rounded-chip bg-inset px-3 py-2 text-[11.5px]">
          <Row label="Workspace" value={connection.label || connection.workspace_id} mono />
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

      {note && <Note tone="warn" text={note} />}
      {octaweaveError && <Note tone="bad" text={octaweaveError} />}

      {connected ? (
        <div className="mt-4 flex items-center gap-2">
          {!status?.pack_installed && (
            <Button size="sm" onClick={() => void installOctaweavePack().then(setNote)} disabled={octaweaveBusy}>
              {octaweaveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Install the tools
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            className="ml-auto"
            onClick={() => void disconnectOctaweave()}
            disabled={octaweaveBusy}
          >
            <Unplug className="h-4 w-4" />
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <ol className="space-y-3">
            <Step n={1} text="Create a workspace key in Octaweave. It is shown once, at creation.">
              <Button size="sm" variant="outline" onClick={() => void octaweave.openKeys()}>
                Open Octaweave <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </Step>
            <Step n={2} text="Paste it here. Everything after this is automatic.">
              <div className="flex gap-2">
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && token.trim()) void connect()
                  }}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="owk_live_…"
                  aria-label="Octaweave key"
                  className="h-8 min-w-0 flex-1 rounded-control bg-field px-2.5 font-mono text-[12px] text-ink placeholder:text-ink-3"
                />
                <Button size="sm" onClick={() => void connect()} disabled={octaweaveBusy || !token.trim()}>
                  {octaweaveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Connect
                </Button>
              </div>
            </Step>
          </ol>
          <p className="mt-3 text-[11px] text-ink-3">
            The key is verified against Octaweave and stored on your pod. It never enters this window.
          </p>
        </div>
      )}
    </section>
  )
}

function Step({ n, text, children }: { n: number; text: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-inset text-[11px] text-ink-2">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 text-[12.5px] text-ink-2">{text}</p>
        {children}
      </div>
    </li>
  )
}

function StatusChip({ connected, packInstalled }: { connected: boolean; packInstalled: boolean }) {
  const label = !connected ? 'Not connected' : packInstalled ? 'Connected' : 'Key only'
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-chip px-2 py-0.5 text-[11px]',
        connected && packInstalled ? 'bg-green-tint text-green' : connected ? 'bg-orange-tint text-orange' : 'bg-inset text-ink-3',
      )}
    >
      {connected && packInstalled && <Check className="h-3 w-3" />}
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
