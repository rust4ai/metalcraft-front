import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, Loader2, RefreshCw, ServerCog, Sparkles } from 'lucide-react'
import { useConnection } from '@/stores/connection'
import { billing, pods as podsRpc } from '@/rpc'
import type { Plan } from '@/types'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { OwnPodCard } from './OwnPodCard'
import { SignInCard } from './SignInCard'
import { WaitScreen } from './WaitScreen'

/**
 * The app without a pod — and the way out of it (`LAUNCHPAD_PLAN.md`).
 *
 * What stood here was a wall with a refresh button on it: *No pod on this
 * account · Check again*. Both things this app could have done for that person
 * were one screen away and unreachable — they could have connected a pod they
 * run (built, but its only entrance was behind them on the sign-in screen), and
 * they could have been sold one (never built at all).
 *
 * So this is not "the app minus a pod". It is the surface that gets you one,
 * with three doors that all end in the same place: `info` is set and the shell
 * mounts. A pod on the account, a pod you run, or an account that comes with one.
 *
 * **It outlives onboarding** (LAUNCHPAD_PLAN §4). Switching machines, adding a
 * second pod and reconnecting a self-hosted one are ordinary acts, not first-run
 * acts, so this is also a normal tab — which is why every piece of state it
 * shows is read from the connection store rather than passed in by a wizard.
 * `info` is the only thing that tells it which situation it is in.
 */
export function LaunchpadView() {
  const {
    pods,
    podsLoaded,
    podsLoading,
    podsError,
    connect,
    connecting,
    waking,
    error,
    boot,
    recheck,
    session,
    info,
    pod,
  } = useConnection()

  // Exactly as narrow as it has always been: one pod on the account and nothing
  // connected yet. A picker for a list of one is a speed bump — but a Launchpad
  // that auto-connects while you are trying to reach the pod you run yourself
  // would be worse, so `info` gates it and the in-shell tab never fires it.
  //
  // `podsLoaded` is not redundant with `pods.length === 1`: it is what makes the
  // *render* below able to tell that this is about to fire.
  const autoConnecting = !info && podsLoaded && pods.length === 1 && !error
  useEffect(() => {
    if (autoConnecting && !connecting) void connect()
  }, [autoConnecting]) // eslint-disable-line react-hooks/exhaustive-deps

  // Both are the same wait to the person watching. Without `autoConnecting` the
  // list of one paints for a frame and is snatched away by the effect that was
  // always going to connect it — a flash of a screen nobody was offered.
  //
  // Three waits, because three different things are happening. `waking` is only
  // ever set by a hosted connect, so the middle line is what a pod you run looks
  // like — there is no token to mint for one of those, and saying so was the
  // screen describing a step it was not taking.
  if (connecting || autoConnecting) {
    return (
      <Connecting
        detail={
          waking
            ? 'If it was asleep this takes a moment — it has to be scheduled and start up.'
            : connecting
              ? 'Opening a connection with the address and key you gave.'
              : 'Minting a connection token…'
        }
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-10">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface shadow-card">
            <ServerCog className="h-5 w-5 text-accent" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{info ? 'Pods' : 'Connect a pod'}</h1>
            <p className="text-sm text-ink-2">
              {info
                ? 'Where your agents run. Connecting to another one switches this window to it.'
                : 'Your agents run on a pod. It can be one we host, or one you do.'}
            </p>
          </div>
        </header>

        {/* Order is the argument: what you have, then how to get one, then the
            way that needs nothing from us. The pod you run is last because it is
            the alternative — never hidden, because for a self-hoster it is the
            only door that works, and never first, because for everyone else the
            hosted one is. */}
        <div className="flex flex-col gap-3">
          {session ? (
            <>
              <PodsCard
                pods={pods}
                loaded={podsLoaded}
                loading={podsLoading}
                failed={podsError}
                activeSlug={pod?.slug}
                onConnect={(id) => void connect(id)}
                onRefresh={() => void recheck()}
              />
              {/* Held back until the list is in. Both faces of this card are
                  claims about a pod that does not exist — a sales pitch, or a
                  provisioning failure — and neither is a thing to say to someone
                  whose pod we simply have not looked for yet. */}
              {podsLoaded && <GetAPodCard premium={session.premium} hasPod={pods.length > 0} />}
            </>
          ) : (
            <SignInCard />
          )}

          <OwnPodCard />
        </div>

        {error && (
          <div className="mt-4 rounded-card bg-red-tint px-4 py-3">
            <p className="text-[12.5px] text-red">{error}</p>
            {/* Retries what broke. Without a session this banner is a boot that
                failed, and offering to connect to a pod we never managed to ask
                about just produces a second, different error. */}
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => (session ? void connect() : void boot())}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A pod waking from suspend can take a couple of minutes before its ingress has a
 * healthy backend, so this is a stated wait with an explanation rather than a
 * spinner that looks broken.
 */
function Connecting({ detail }: { detail: string }) {
  return <WaitScreen title="Connecting to your pod" detail={detail} />
}

/** The pods on the account. One list, and the self-hosted ones join it at L2 —
 *  to the person reading it they are the same object, and `AppState` agrees.
 *
 *  Three answers, and emptiness is only one of them. "No pod on this account
 *  yet" is a fact about an account, and this card used to say it about a list
 *  nobody had fetched — every first paint after sign-in told the truth by
 *  accident or lied for a moment, depending on the network. So the empty array
 *  is read through `loaded`, and a list that came back broken says so instead of
 *  reporting zero. */
function PodsCard({
  pods,
  loaded,
  loading,
  failed,
  activeSlug,
  onConnect,
  onRefresh,
}: {
  pods: { id: string; slug: string; status?: string | null }[]
  loaded: boolean
  loading: boolean
  failed: string | null
  activeSlug?: string
  onConnect: (id: string) => void
  onRefresh: () => void
}) {
  return (
    <section className="rounded-card bg-surface p-5 shadow-card">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">On your account</h2>
          {!loaded ? (
            <p className="mt-0.5 flex items-center gap-2 text-[12.5px] text-ink-3">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              Checking this account for pods…
            </p>
          ) : (
            <p className="mt-0.5 text-[12.5px] text-ink-2">
              {failed
                ? 'Could not read the pod list, so there may well be one.'
                : pods.length === 0
                  ? 'No pod on this account yet.'
                  : 'Hosted, backed up, and woken on demand.'}
            </p>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading}>
          {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
          Check again
        </Button>
      </header>

      {/* Verbatim: the reason a list failed is the only thing that tells someone
          whether to retry, sign in again, or check their network. */}
      {loaded && failed && <p className="mt-2 text-[11.5px] text-red">{failed}</p>}

      {pods.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {pods.map((p) => {
            const active = p.slug === activeSlug
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onConnect(p.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-chip px-3 py-2 text-left text-[12.5px]',
                    active ? 'bg-accent-tint' : 'bg-inset hover:bg-field',
                  )}
                >
                  <span className="min-w-0 truncate font-medium">{p.slug || p.id}</span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                  <span className="ml-auto shrink-0 text-[11px] text-ink-3">
                    {active ? 'connected' : (p.status ?? 'ready')}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** `800` → `$8`, `150` → `$1.50`. Whole amounts lose the decimals, because
 *  "$8/mo" is what a person says and "$8.00/mo" is what a form says. */
function money(minor: number, currency = 'usd'): string {
  const major = minor / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
  }).format(major)
}

/**
 * The upsell — computed from state, and now priced by the hub.
 *
 * Three readers, three different things to say. Someone without premium is being
 * sold something, at a price this app asks for rather than remembers: the hub
 * reads it from Stripe, so the figure on this button is the figure on the
 * invoice, and the first month at a promo price is only offered to an account
 * that can still take it — the offer is per email and the hub is the only thing
 * that knows.
 *
 * Someone *with* premium and no pod has already bought it and is looking at a
 * provisioning problem. Upgrading now provisions on its own — the hub kicks it
 * off from Stripe's webhook — so what they need is patience and, if that runs
 * out, a button that asks directly rather than an invitation to pay again.
 *
 * And after checkout, this window has one job: watch. Payment happens in a
 * browser, so the only honest thing here is to keep asking whether premium
 * landed and whether a pod followed, and to stop asking after a few minutes
 * rather than spin forever.
 */
function GetAPodCard({ premium, hasPod }: { premium: boolean; hasPod: boolean }) {
  // `undefined` is "not asked yet", `null` is "asked, no answer" — the button
  // must not name a price it is about to change, and must not stay dumb about
  // one that is on its way.
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined)
  useEffect(() => {
    let answered = false
    // A hub that hangs must not leave a dead button behind a spinner: past this,
    // the offer stands at its price-free label and a late answer still lands.
    const giveUp = setTimeout(() => !answered && setPlan(null), PRICE_WAIT_MS)
    void billing
      .plan()
      .then((p) => setPlan(p ?? null))
      .catch(() => setPlan(null))
      .finally(() => {
        answered = true
        clearTimeout(giveUp)
      })
    return () => clearTimeout(giveUp)
  }, [])

  if (hasPod) return null
  return premium ? <PremiumNoPod /> : <Upgrade plan={plan} />
}

/** Long enough for a hub round-trip, short enough that nobody wonders whether
 *  the button is broken. */
const PRICE_WAIT_MS = 3000

/**
 * How long to keep watching after the browser opens, and how often.
 *
 * The user is in a checkout flow, so five seconds is invisible traffic and quick
 * enough to feel immediate when they come back. Five minutes is past the point
 * where "they are still typing a card number" is likelier than "they closed the
 * tab".
 *
 * Stopping is a thing that *happened*, and the card says so when it does — the
 * account keeps whatever was bought either way, but a screen that silently goes
 * back to selling premium is a screen telling somebody who just paid that
 * nothing did.
 */
const POLL_MS = 5000
const POLL_LIMIT_MS = 300_000

function Upgrade({ plan }: { plan: Plan | null | undefined }) {
  const [waiting, setWaiting] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  // Survives the polling loop's closure so cancelling actually stops it.
  const live = useRef(false)

  const label = (() => {
    if (plan === undefined) return 'Checking the price…'
    if (!plan) return 'Get Metalcraft premium'
    const per = `${money(plan.amount, plan.currency)}/${plan.interval ?? 'mo'}`
    if (plan.promo.eligible && plan.promo.first_month_amount !== null) {
      return `${money(plan.promo.first_month_amount, plan.currency)} first month, then ${per}`
    }
    return `Get premium — ${per}`
  })()

  const watch = useCallback(async () => {
    live.current = true
    for (let i = 0; i < POLL_LIMIT_MS / POLL_MS; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      if (!live.current) return
      // Re-reads the account, which is what turns a completed checkout into
      // `premium: true` here, *and* the pods, which is what notices the one the
      // hub provisioned behind it. The auto-connect above takes it from there.
      await useConnection.getState().recheck()
      const { session, pods } = useConnection.getState()
      // Either one is an answer and ends the watch. Premium means this card is
      // about to become `PremiumNoPod`, which waits for the pod itself; a pod
      // means the auto-connect above is about to take the window.
      if (session?.premium || pods.length > 0) {
        live.current = false
        setWaiting(false)
        return
      }
    }
    live.current = false
    setWaiting(false)
    // Giving up used to be silent: the card went back to selling premium to
    // somebody who may well have just bought it, with no account of the several
    // minutes it had spent watching. Whatever happened, the person deserves the
    // sentence.
    setGaveUp(true)
  }, [])

  const start = async () => {
    setWaiting(true)
    setGaveUp(false)
    try {
      setUrl(await billing.checkout())
    } catch {
      // The hand-off failed, not the offer. Fall back to the hub's own page as a
      // link rather than leaving a spinner with nothing behind it.
      setUrl(null)
    }
    void watch()
  }

  if (waiting) {
    return (
      <section className="rounded-card bg-surface p-5 shadow-card">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-3" />
          <p className="min-w-0 flex-1 text-[12.5px] text-ink-2">
            Finish in your browser — this picks it up on its own, and your pod is started for
            you.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              live.current = false
              setWaiting(false)
            }}
          >
            Cancel
          </Button>
        </div>
        {url && (
          <p className="mt-2 truncate text-[11px] text-ink-3">
            If no tab opened: <span className="font-mono">{url}</span>
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="rounded-card bg-surface p-5 shadow-card">
      <header className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">Get a pod</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            A pod comes with Metalcraft premium — hosted and woken on demand, with no VPS to
            keep alive.
          </p>
        </div>
      </header>

      {gaveUp && (
        <p className="mt-3 rounded-card bg-inset px-3 py-2 text-[11.5px] text-ink-2">
          We watched for {POLL_LIMIT_MS / 60_000} minutes and did not see an upgrade land. If you
          finished checkout since, <b>Check again</b> above will find it — a subscription and the
          pod that follows it can take a moment. If you did not, the offer is still here.
        </p>
      )}

      <ul className="mt-3 space-y-1 text-[12.5px] text-ink-2">
        <Perk>Thinking billed to your credits, so no provider key of your own</Perk>
        <Perk>WhatsApp and SMS, which need an account the pod can be linked to</Perk>
        <Perk>Registry identity for installing packs</Perk>
      </ul>

      {/* Disabled only while the price is unknown — a button that would open a
          checkout for a figure it is one tick away from correcting. */}
      <Button size="sm" className="mt-4" disabled={plan === undefined} onClick={() => void start()}>
        {plan === undefined ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {label} {plan !== undefined && <ExternalLink className="h-3.5 w-3.5" />}
      </Button>
      <p className="mt-3 text-[11px] text-ink-3">
        Opens in your browser. Your pod is provisioned for you when it goes through.
      </p>
    </section>
  )
}

/**
 * Paid, and nothing to show for it yet.
 *
 * Not a sale — a provisioning problem, and offering an upgrade button here would
 * be the app failing to notice it had already been paid. Provisioning is
 * automatic now, so the honest thing is to say it is coming and hand over a way
 * to ask directly when patience runs out.
 */
function PremiumNoPod() {
  const { refreshPods } = useConnection()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useWatchForPod()

  const ask = async () => {
    setBusy(true)
    setError(null)
    try {
      await podsRpc.provision()
      await refreshPods()
    } catch (e) {
      setError(String(e))
    }
    setBusy(false)
  }

  return (
    <section className="rounded-card bg-surface p-5 shadow-card">
      <header className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">Premium is on this account</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            Your pod is started for you when a subscription begins, and that takes a moment. If
            it does not appear, you can ask for it directly.
          </p>
        </div>
      </header>
      {error && <p className="mt-3 text-[11.5px] text-red">{error}</p>}
      <Button size="sm" className="mt-4" onClick={() => void ask()} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Provision my pod
      </Button>
    </section>
  )
}

/**
 * Ask again, slowly, while this card is on screen.
 *
 * This is the one state on the Launchpad where the answer changes with nobody
 * touching anything: the pod is provisioned by a Stripe webhook this app never
 * sees, through a control plane that retries on its own schedule. The card says
 * *your pod is started for you* and then never looked again — so a pod that
 * landed ninety seconds later sat there unclaimed until the user thought to
 * press something, which is the app being wrong about the only thing it is
 * claiming to know.
 *
 * Twenty seconds is slower than the checkout watch because nothing is being
 * waited on in a browser tab; twenty minutes of it is past the point where more
 * waiting is the answer, and the button that asks directly is already on the
 * card. Hidden windows do not count against the budget and do not ask — this
 * reaches the hub's database, and a laptop asleep with the app open should not
 * be keeping it awake.
 */
const POD_WATCH_MS = 20_000
const POD_WATCH_TRIES = 60

function useWatchForPod() {
  const refreshPods = useConnection((s) => s.refreshPods)
  useEffect(() => {
    let left = POD_WATCH_TRIES
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      if (left-- <= 0) {
        clearInterval(id)
        return
      }
      // Quietly: this is the app asking, not the user, and a refresh button that
      // disables itself every twenty seconds eats the click that lands on one.
      void refreshPods(true)
    }, POD_WATCH_MS)
    return () => clearInterval(id)
  }, [refreshPods])
}

function Perk({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2">
      <Check className="h-3 w-3 shrink-0 translate-y-0.5 text-green" />
      <span className="min-w-0">{children}</span>
    </li>
  )
}
