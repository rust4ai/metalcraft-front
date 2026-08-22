import { useEffect, useRef, useState } from 'react'
import { LogIn, Copy, Check } from 'lucide-react'
import { auth } from '@/rpc'
import { useConnection } from '@/stores/connection'
import { Button } from '@/components/ui/Button'
import type { DeviceLogin } from '@/types'

/**
 * PLAN §9.1 — sign in with Metalcraft ID.
 *
 * Device flow: the browser does the authenticating, we poll. The verify URL is
 * always shown as copyable text, because a failed `open` must not dead-end the
 * only way into the app.
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
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl border border-line bg-raised">
          <LogIn className="h-6 w-6 text-accent" />
        </div>
        <h1 className="text-xl font-semibold">Metalcraft</h1>
        <p className="mt-2 text-sm text-ink-dim">
          Work a fleet of agents running on your pod.
        </p>

        {!login ? (
          <Button className="mt-8 w-full" size="lg" onClick={start}>
            Sign in with Metalcraft ID
          </Button>
        ) : (
          <div className="mt-8 space-y-4 text-left">
            <p className="text-sm text-ink-dim">
              Approve this sign-in in your browser. Waiting…
            </p>
            {login.user_code && (
              <div className="rounded-card border border-line bg-surface px-4 py-3 text-center font-mono text-lg tracking-[0.3em]">
                {login.user_code}
              </div>
            )}
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left font-mono text-xs text-ink-dim hover:text-ink"
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

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </div>
    </div>
  )
}
