import { useEffect, useRef, useState } from 'react'
import { LogIn, Copy, Check } from 'lucide-react'
import { auth } from '@/rpc'
import { useConnection } from '@/stores/connection'
import { Button } from '@/components/ui/Button'
import type { DeviceLogin } from '@/types'

/**
 * PLAN §9.1 — sign in with Metalcraft ID, **or don't**.
 *
 * Device flow: the browser does the authenticating, we poll. The verify URL is
 * always shown as copyable text, because a failed `open` must not dead-end the
 * only way into the app.
 *
 * The second path exists because this screen used to be a wall: a pod you run
 * yourself needs no Metalcraft account, but the app demanded one before it would
 * show you anything — so a self-hoster (and anyone developing against a local
 * pod) could not reach their own agent. A URL and the pod's `WORKSHOP_API_KEY`
 * are enough, and what you lose by skipping the account is stated rather than
 * discovered: no credits, no registry identity, no pod list.
 */
export function LoginView() {
  const setSession = useConnection((s) => s.setSession)
  const [login, setLogin] = useState<DeviceLogin | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const polling = useRef(false)

  useEffect(() => () => { polling.current = false }, [])

  async function start() {
    setError(null)
    try {
      const l = await auth.start()
      setLogin(l)
      polling.current = true
      void poll(l)
    } catch (e) {
      setError(String(e))
    }
  }

  async function poll(l: DeviceLogin) {
    const interval = (l.interval_secs ?? 3) * 1000
    while (polling.current) {
      await new Promise((r) => setTimeout(r, interval))
      if (!polling.current) return
      try {
        const res = await auth.poll(l.device_code)
        if (res.status === 'signed_in') {
          polling.current = false
          setSession({ email: res.email, premium: res.premium })
          return
        }
        if (res.status === 'expired') {
          polling.current = false
          setLogin(null)
          setError('that sign-in request expired — try again')
          return
        }
      } catch (e) {
        polling.current = false
        setError(String(e))
        return
      }
    }
  }

  return (
    <div className="grid h-full place-items-center p-8">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-card bg-surface shadow-card">
          <LogIn className="h-6 w-6 text-accent" />
        </div>
        <h1 className="text-xl font-semibold">Metalcraft</h1>
        <p className="mt-2 text-sm text-ink-2">
          Work a fleet of agents running on your pod.
        </p>

        {!login ? (
          <Button className="mt-8 w-full" size="lg" onClick={start}>
            Sign in with Metalcraft ID
          </Button>
        ) : (
          <div className="mt-8 space-y-4 text-left">
            <p className="text-sm text-ink-2">
              Approve this sign-in in your browser. Waiting…
            </p>
            {login.user_code && (
              <div className="rounded-card border border-line bg-surface px-4 py-3 text-center font-mono text-lg tracking-[0.3em]">
                {login.user_code}
              </div>
            )}
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-control bg-inset px-3 py-2 text-left font-mono text-[11.5px] text-ink-2 hover:text-ink"
              onClick={() => {
                void navigator.clipboard.writeText(login.verify_url)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Copy className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{login.verify_url}</span>
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red">{error}</p>}

        <DirectConnect />
      </div>
    </div>
  )
}

/** Connect to a pod you run, with no account in the loop. */
function DirectConnect() {
  const connectDirect = useConnection((s) => s.connectDirect)
  const connecting = useConnection((s) => s.connecting)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('http://localhost:3002')
  const [key, setKey] = useState('')
  const [failed, setFailed] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
      >
        Or connect to a pod you run
      </button>
    )
  }

  async function submit() {
    setFailed(null)
    const message = await connectDirect(url, key)
    if (message) setFailed(message)
  }

  return (
    <div className="mt-6 space-y-2 text-left">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="http://localhost:3002"
        aria-label="Pod URL"
        className="h-9 w-full rounded-control bg-field px-3 text-[13px] text-ink placeholder:text-ink-3 focus-visible:outline-accent"
      />
      <input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        type="password"
        placeholder="WORKSHOP_API_KEY"
        aria-label="Pod key"
        className="h-9 w-full rounded-control bg-field px-3 text-[13px] text-ink placeholder:text-ink-3 focus-visible:outline-accent"
      />
      <Button className="w-full" disabled={connecting || !url.trim()} onClick={() => void submit()}>
        {connecting ? 'Connecting…' : 'Connect'}
      </Button>
      {failed && <p className="text-[12.5px] text-red">{failed}</p>}
      <p className="text-[11.5px] text-ink-3">
        No Metalcraft account: no credits meter, no registry identity, and this pod pays for
        its own inference with its own key.
      </p>
    </div>
  )
}
