# LAUNCHPAD_PLAN — the app without a pod

**Status:** L1 done (2026-08-24) — the dead end is gone: `LaunchpadView` is what the app opens
on with no pod and a normal tab once there is one, `LoginView`/`ConnectView` are folded into it
and deleted, and 7 cases cover it. L2–L5 outstanding. Companion to `PLAN.md`, which owns
the product and whose §9.1 ends this story in one sentence ("No pod → the *get a pod*
hand-off") and points here. This document owns that hand-off: what a person sees when the account has no pod, how they
get one, and how someone running their own reaches it without an account at all.

---

## 1. The dead end this replaces

*Gone as of L1. Kept in the present tense because it is the thing every decision below is an
answer to, and a plan that erases what it fixed cannot be read back.*

Sign in, have no pod, and the app says:

```
No pod on this account
An agent pod comes with Metalcraft premium. Once you have one it shows up here.
                      [ Check again ]
```

That is a wall with a refresh button on it. Everything the product can do for this person is
one screen away and unreachable:

- **They could connect a pod they run.** `connect_pod_url` is built, tested and complete —
  but its only entrance is a grey text link at the bottom of `LoginView`, which is
  *behind* them. A user who signed in can no longer reach it.
- **They could be sold a pod.** Nothing in this repo mentions upgrade, checkout, billing or
  a trial. `premium` is a boolean read off `/me` and never acted on except to explain a
  failure.

Both are one screen. The screen does not exist.

## 2. The constraint, stated once

Everything this app does is pod-side. Fleet, sessions, packs, automations, keys — all of it
is `/api/v1/*` on a pod. Inference credentials are **written into the pod's key store**
(`bind_interface_source` → the Keys API), and turns run in the pod's runtime.

So "no pod, but I have an OpenAI key" does not yield a usable app. There is nothing to write
the key into and nothing to run the turn. A podless dashboard that pretends otherwise would
be promising an agent it cannot spawn.

**Decision (2026-08-24): no local agent runtime, ever. A pod is always something at a URL.**
The alternative — a mini-runtime inside the desktop app so that a bare provider key does
something — forks the entire session/fleet/packs layer against a second backend that speaks
a different protocol, to serve a demo. The same user is served completely by a pod they run,
which is a `docker run` away and gives them the *whole* product rather than a sketch of it.

That decision is also a simplification, and the rest of this plan leans on it: **a pod is a
URL plus a way to authenticate to it**, and there are exactly two ways.

| | URL from | Authenticates with | Refresh |
|---|---|---|---|
| **Hub pod** | control plane, by slug | minted `pod:{slug}` connection token | `spawn_token_refresher` |
| **Your pod** | you typed it | static `WORKSHOP_API_KEY` | none — it does not expire |

`AppState`'s map already treats these as peers (its own doc calls a manually-keyed agent "a
peer entry"). The Launchpad makes the *UI* agree: one list of pods, two ways an entry got
there, no second mode anywhere in the app past the moment of connecting.

## 3. Three doors

The Launchpad is not "the app minus a pod". It is a pod-acquisition surface, and it has
three doors that each end at the same place — `info` is set, the shell mounts.

### 3.1 A pod you run — *built, buried; promoted in L1*
Promoted from a text link to a first-class card. URL + key, straight to `connect_pod_url`,
no hub in the loop. This is the door that makes "no premium" mean *no hosted pod* rather
than *no product*, which is the difference between a paywall and a funnel.

What it needs beyond what exists: **saved endpoints**. Today a direct pod is retyped every
time and its key lives nowhere — the store passes it renderer → core and forgets it, so a
window reload survives (the core still holds the connection) but a quit does not. Named
endpoints, keys in the OS keychain beside the PAT, last-connected, and a reachability check
turn this from a dev affordance into somewhere you live.

### 3.2 Bring your own inference — *built, pod-dependent; L3*
`InterfaceSourceView` is right; it just has nowhere to write. Podless it becomes
**pre-staged**: the source is kept locally and applied to the first pod that connects, with
a visible "will be applied when you connect a pod" state so nothing is silently pending.

This is what stops the funnel dead-ending someone who arrives holding an `sk-…`. It also
captures the intent *before* the paywall instead of after it.

Verification cannot be the pod's throwaway turn (PLAN §9.2) when there is no pod, so the
**core probes `POST {base}/responses` itself**. That is worth having with a pod too: it is
the difference between the "custom" source being a hope and being a check, and it is the one
compatibility question this product cannot answer from the client's side by reading docs.

### 3.3 Get a Metalcraft pod — *built (L4)*
Sign up → upgrade → a pod appears → connect, without leaving the app except for the browser
trip that payment requires. The poll-while-the-user-is-in-the-browser shape is one this repo
already trusts twice (device login, `ConnectionCard`'s link trip), so it is a pattern to
reuse rather than invent.

The upsell has to be computed from state, not written as marketing, and it differs by who is
reading it:

- **No account.** The pitch is the product.
- **Account, no pod, no premium.** Credits-billed inference with no key of your own; a pod
  that is backed up, wakes on demand and needs no ops; registry identity.
- **Account, no pod, running their own pod.** The most valuable reader in the funnel, and
  the one a paywall insults. They already use the product daily. What premium adds *for
  them* is specific and checkable: **WhatsApp and SMS** — `GatewayCard` already refuses on a
  pod with no Metalcraft account, in those words — plus credits instead of their own
  provider bill. One ambient nudge in `Nudges.tsx`, dismissible, never a wall.
- **Premium, no pod.** Not a sales problem — a provisioning one. Say so, and offer the
  re-check rather than an upgrade button they already bought.

## 4. Where it lives

**During onboarding** it replaces `ConnectView` and absorbs `LoginView`: sign-in is a card on
it, not a screen before it, because door 3.1 needs no account and must not sit behind one.

**After onboarding** it stays, as `{ kind: 'pods' }` — a normal tab in the shell, reached
from Settings and the palette. Not wizard-only: switching machines, adding a second pod and
reconnecting a self-hosted one are ordinary acts, not first-run acts.

Auto-connect stays exactly as narrow as it is now — exactly one hub pod, nothing connected
yet — so the Launchpad appears only when there is a real choice or a real absence, and never
in front of someone whose single pod was going to connect anyway.

## 5. Phases

| L | Deliverable | Done when |
|---|---|---|
| **L1** ✅ | `LaunchpadView` — pods list, connect-your-own, account/upsell cards; `App.tsx` routes `!info` here; `LoginView`/`ConnectView` fold in; reachable after onboarding as a tab | done — one component for both situations, gated on `info`: it takes the window when there is no pod and is the `{kind:'pods'}` tab when there is, reached from Settings and `⌘K`. Auto-connect stayed narrow (one hub pod, nothing connected) and cannot fire in the tab. The upsell is computed from state — a premium account with no pod is told it is a provisioning problem, not sold what it already bought. **`UPGRADE_URL` is a guess** (§6.14) and is the one line L4 replaces |
| **L2** | Saved endpoints: named, keychain-stored keys, last-connected, reachability check, reconnect from the Launchpad | quit and reopen reconnects a self-hosted pod without retyping a key |
| **L3** | Pre-staged interface source + `verify_source` in the core (`POST {base}/responses` probe) | a key entered with no pod is applied on connect, and a custom base URL is checked before it is trusted |
| **L4** 🟢 | The funnel: upgrade hand-off, post-upgrade poll → auto-connect, state-computed comparison, the self-hoster nudge | **done, except the nudge.** The button is priced by the hub (`billing_plan` → Stripe), and quotes the first month at the promo price only to an account that can still take it — the offer is per email and the hub is the only thing that knows. Checkout opens in a browser and the card watches for five minutes: premium lands, the pod the webhook provisioned appears, auto-connect fires. A paid account with no pod is told one is coming and offered `provision_pod` when patience runs out. **Outstanding:** the self-hoster nudge in `Nudges.tsx` |
| **L5** | Copy and docs: a copyable `docker run` for standing up your own pod, linked to the agent repo | someone with a VPS and no account is running in one paste |

L1 is the whole dead-end fix. L2–L3 make the self-hosted path livable. L4 is the sales
funnel proper and is the one with upstream dependencies.

## 6. Upstream gaps (extends PLAN §12)

L4 is guesswork without these. Numbered from §12's end.

14. ~~**No checkout hand-off.**~~ **WRONG, and it was already there.** metalcraft-id
    serves `GET /billing/checkout?return=…` (hosted Stripe Checkout) and now
    `GET /billing/plan` beside it. The hardcoded `UPGRADE_URL` guess is deleted;
    `IdClient::plan` and `checkout_url` replace it. The lesson is the one this
    repo keeps relearning: the gap was in what we had read, not in what existed.
15. ~~**Does premium provision a pod?**~~ **It does now.** metalcraft-id's Stripe
    webhook spawns a provisioning call to k3's new
    `POST /internal/pods/provision` (service-secret authed, idempotent) with
    bounded retries. So the post-upgrade poll has a real end condition: premium
    lands, a pod follows, auto-connect takes it from there. `ControlPlane` also
    grew `provision` — the button is the fallback for a webhook that lost a race
    or a pod that was deleted, since a funnel whose last step can only be reached
    by paying again is not a funnel.
16. **`premium` is a boolean.** Never-subscribed, lapsed and mid-trial want different words
    and different buttons. A `plan` field on `/me` (`free|trial|premium` + renewal) makes
    the upsell truthful. *(id, small)*
17. **No trial-code redemption.** PLAN §9.1 names one ("premium upsell / trial code");
    nothing anywhere implements it. *(id + control plane)*

## 7. Decisions

1. **No local agent runtime — a pod is always something at a URL.** §2. *(2026-08-24)*
2. **The Launchpad outlives onboarding.** §4. *(2026-08-24)*
3. **Sign-in is a card, not a gate.** The self-hosted door must be reachable with no account,
   from the first screen and from every screen after it.
4. **One pods list, two provenances.** Hub and self-hosted pods are the same object to the
   user, and `AppState` already agrees.
