import { useEffect, useRef, useState } from 'react'
import { Check, Copy, LogIn } from 'lucide-react'
import { auth } from '@/rpc'
import { useConnection } from '@/stores/connection'
import { Button } from '@/components/ui/Button'
import type { DeviceLogin } from '@/types'

/**
 * PLAN §9.1 — sign in with Metalcraft ID, as a **card rather than a gate**
 * (LAUNCHPAD_PLAN §4).
 *
 * This was the whole first screen. It stopped being one because the door beside
 * it — a pod you run yourself — needs no account, and a door behind a sign-in
 * wall is a door nobody opens. So the account is one of the three things offered
 * on the Launchpad, and it is offered for what it actually gets you rather than
 * as the price of entry.
 *
 * Device flow: the browser does the authenticating, we poll. The verify URL is
 * always shown as copyable text, because a failed `open` must not dead-end the
 * only way in.
 *
 * **It says that signing in is also signing up**, because for a brand-new reader
 * "Sign in with Metalcraft ID" is a wall: they know they do not have one. There
 * is genuinely no registration step — the hub's Google callback upserts the
 * account on first arrival — so the only thing missing was saying so, and the
 * only thing standing between a stranger and a pod was a sentence.
 */
export function SignInCard() {
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
    <section className="rounded-card bg-surface p-5 shadow-card">
      <header className="flex items-start gap-3">
        <LogIn className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">Metalcraft account</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            A hosted pod, thinking billed to your credits instead of a key of your own, and
            WhatsApp and SMS from your agent. None of it is needed to use a pod you run.
          </p>
        </div>
      </header>

      {!login ? (
        <>
          <Button size="sm" className="mt-4" onClick={start}>
            Sign in with Metalcraft ID
          </Button>
          <p className="mt-2 text-[11px] text-ink-3">
            No account yet? Signing in with Google makes one. There is no form to fill in.
          </p>
        </>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-[12.5px] text-ink-2">Approve this sign-in in your browser. Waiting…</p>
          {login.user_code && (
            <div className="rounded-chip bg-inset px-4 py-2.5 text-center font-mono text-lg tracking-[0.3em]">
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

      {error && <p className="mt-3 text-[12.5px] text-red">{error}</p>}
    </section>
  )
}
