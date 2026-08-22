# UI_PLAN — the Orca shell

**Status:** S1–S8 done (2026-08-22) — the Orca shell is complete, plus settings/keys/Octaweave. Companion to `PLAN.md`; this document
owns the *shape of the window*, PLAN.md owns the product. Where they overlap
(PLAN §10 surfaces, §11 P2 "tabs/panes/splits", §14.2 "layout is local") PLAN.md
is the authority on *what* and this is the authority on *where it sits*.
**Reference:** `~/Pictures/orca_screenshot.png`.

---

## 1. What the reference actually shows

The mistake to avoid is reading the screenshot as decoration. It is a structural
claim: Orca is **a persistent three-column frame that never unmounts**, and the
only thing that swaps is the body of the centre column. metalcraft-front today is
the opposite — a full-width title bar over a `view.kind` switch that replaces the
entire window (`app/App.tsx`), so every navigation is a scene change and the
fleet is a *place you go back to* rather than a thing you can see.

Notably there is **no full-width title bar** in Orca. The window's drag region is
split between the sidebar header (inset past the traffic lights) and the empty
part of the tab strip. So `app/TitleBar.tsx` does not move — it dissolves, its
left half becoming the sidebar header and its right half the status bar.

| Region | Orca | metalcraft-front |
|---|---|---|
| Sidebar ~264px | Tasks / Automations / Orca Mobile → Search → **Projects** tree → worktree rows: status dot, name, `primary` badge, branch subline | Fleet / Agents / Flows → Search → **Agents** tree → instance rows: status dot, name, origin badge, `preset · persona` subline |
| Sidebar footer | gear · help · layout toggles | same, plus theme |
| Sidebar floating card | "Add a setup script → Configure" | PLAN §9's *optional* steps as ambient nudges, not blocking screens |
| Centre | tab strip (`Terminal 1`, `+`, `▷ Command`) over the pane | session tabs over the transcript, `⌘K` palette at the right |
| Right rail ~368px | icon strip (files · apps · git · tasks), header, find field, `Names`/`Contents` segmented control | PLAN §10.2's rail: Details · Memory · Workspace · Diagnostics |
| Status bar ~26px | `10% used 2h 14m · 6% used 5d 23h`, memory, shell count | pod slug + readiness, account, active agents, theme |

### Geometry

Measured off the reference (2083×1511 @2x ⇒ a ~1042×756pt window):

| | default | min | max |
|---|---|---|---|
| Sidebar | 264px | 200 | 420 |
| Right rail | 368px | 280 | 560 |
| Top row (sidebar header / tab strip) | 38px | — | — |
| Status bar | 26px | — | — |

Sidebar and rail are drag-resizable and collapsible; both widths persist.

---

## 2. Stages

### S1 — the frame
`app/Shell.tsx`: one CSS grid, mounted once.

```
grid-template-columns: <sidebar> 1fr <rail>
grid-template-rows:    1fr <statusbar>

┌──────────┬──────────────────┬──────────┐
│ Sidebar  │ Centre           │ Rail     │   each column owns its own 38px header
├──────────┴──────────────────┴──────────┤
│ StatusBar (spans all three)            │
└────────────────────────────────────────┘
```

`stores/layout.ts` holds sidebar/rail open + width, persisted to `localStorage`
(PLAN §14.2 — layout is local, and `localStorage` works in both the Tauri webview
and the P11 web target, where `tauri-plugin-store` would not).

Resizing is a hand-rolled ~40-line pointer-capture handle rather than
`react-resizable-panels`. Two draggable edges do not justify a dependency.

`LoginView` and `ConnectView` stay full-screen takeovers **outside** the shell:
there is no pod to put in a sidebar yet. Everything post-connect lives inside it.

Deletes `app/TitleBar.tsx`.

### S2 — the sidebar
`app/Sidebar.tsx` + `features/fleet/InstanceRow.tsx`. Nav rows, a search field,
an `Agents` section header carrying its own `+`, and instance rows in Orca's
selected-row treatment: a filled rounded rect, two lines, status dot, badge.

This is the change that makes the fleet **ambient**. The grid in `FleetView`
stays as the fleet tab's body — an overview you can open — but it stops being the
only way to reach an agent.

### S3 — tabs *(closes PLAN §11 P2's outstanding "tabs/panes")*
`stores/ui.ts` grows from `view: View` to `tabs: Tab[]` + `activeKey`.

The trick that keeps this small: **a tab's identity is derived from its view** —
`fleet`, `packs`, `source`, `session:<instanceId>`. So `go(view)` keeps its exact
signature and every existing caller (`FleetView`, `PacksView`, `SessionView`,
the sidebar) is unchanged; it just means *open-or-focus* now, and deduplication
is free. The fleet tab is pinned at index 0 and cannot be closed, which
guarantees `tabs` is never empty and there is always an active tab to render.

Tabs and the active key persist, so a relaunch comes back where it left off.
`SessionView`'s back button goes — the tab strip is the way back.

Keys: `⌘W` close · `⌘1`–`⌘9` select · `⌘⇧[` / `⌘⇧]` cycle · `⌘B` sidebar.

### S4 — the right rail
`app/RightRail.tsx`, icon strip down the left of the column. Session tab →
instance memory, persona switcher, model, linked workspace, diagnostics. Fleet
tab → pod summary. Remembers which icon tab per view kind.

**Built.** Three icon tabs — Details, Memory and Activity — toggled with `⌘J`,
open by default as in the reference, width persisted.

PLAN §10.2 asks this rail for instance memory, a persona switcher and a model
picker, and the pod already serves what the first two need:

| Want | Endpoint | Status |
|---|---|---|
| Persona roster | `GET /agent-presets/{slug}` → resolved `personas[]` | built |
| Switch persona | `PATCH /agents/instances/{id}` `{persona}` | built |
| Instance memory | `GET /agents/instances/{id}/memory?limit=N` | built |
| Change model | — none — | **shown, not editable** |

The model is reported rather than offered, and that is the pod's shape rather
than a shortcut: a model is chosen when a conversation is *created*
(`NewConversationRequest.model_name`) and nothing changes it afterwards. A picker
here would have to silently start a new conversation, which is not what "change
the model" looks like to anyone.

Two details the rail refuses to smooth over. A persona the pack names but this
pod cannot resolve stays in the dropdown, **disabled and labelled** — dropping it
would turn a legible problem into a missing voice nobody can explain. And the
pod's refusal on a bad switch names the roster it validated against, so it is
shown verbatim instead of being replaced with "could not update".

Alongside those: the instance's provenance, its chat id (what a log grep needs,
and the only thing the UI never showed), and the tool calls the transcript
collapses into `Ran N tools`.

### S5 — the status bar
Pod slug + readiness dot, account, active-agent count, theme toggle.

**Built against the real ledger.** The first pass here invented
`GET /api/usage` on the pods control plane and shipped a percentage meter for it.
That endpoint does not exist and never did. The ones that do:

| | Where | Auth | Returns |
|---|---|---|---|
| `GET /credits/balance` | **metalcraft-id** | our PAT | `{credits, available_credits, micro_credits}` |
| `GET /account/usage` | metalcraft-inference | browser cookie | recent requests, no balance |

The second is unreachable from this app — it is cookie-authed for the website,
and we hold a PAT. The first is exactly right, and it is the same ledger
`/credits/authorize` reserves against, so what the bar shows is what the next
turn will actually be allowed to spend.

`front_cloud::Credits` → `IdClient::credits()` → `account_credits` →
`rpc.account.credits()` → `stores/credits.ts` → the bar.

Three decisions carry it:

- **Show `available`, not `credits`.** A turn in flight has already authorized
  against the balance and not settled, so the raw number is optimistic in exactly
  the place someone is checking whether they can afford to keep going. The
  difference is surfaced as "N held" only when it is non-zero, because otherwise
  it explains a discrepancy that isn't there.
- **404 is not an error.** `credits()` returns `Ok(None)` for an older ID
  deployment and `Err` only for real failure. Collapsing them would paint a
  permanent red error into every user's status bar.
- **Unknown is not zero.** The store keeps `null | false | true` distinct and the
  bar renders no readout at all when credits are unreported. "0 credits" and "we
  don't know" look identical and mean opposite things.

A failed poll keeps the last good balance rather than blanking the bar: a stale
number beats none, and the status bar is not where a network blip should
announce itself.

There is no percentage meter, because there is no allowance to be a fraction of
— Orca's `10% used` is a plan quota, ours is a balance.


### S5b — the pack detail sheet
Not originally a stage here, but it is the same lesson as S4/S5: the registry
protocol's `/manifest` was already wired through to `rpc.packs.manifest()` and
typed `unknown`, called by nothing. A pack reference is enough to *install* and
not enough to *decide*, so the card now opens a side sheet — presets, personas,
skills, integrations, the hosts it will reach out to, the content hash — and
installing blind stays possible rather than required.

The part worth building is the **requirements checklist**: `requires_env` checked
against the pod's own key store, so an unmet key is a pre-install fact instead of
a runtime failure the first time somebody talks to the agent. Optional env is
listed but never counted as missing — a pack that merely works *better* with a
key should not look broken without one.

A side sheet rather than a centred modal, so the list stays put behind it and
comparing two packs is a click each way instead of a re-search.

### S6 — nudge cards
**Built.** Orca's bottom-left setup card, driven by facts three other stores
already own: no interface source bound, no packs installed, packs but no agents.
Ranked in that order — spawning an agent you cannot talk to is worse than having
nothing to spawn.

**One card, not a stack.** The original spec here said stack; a queue of setup
nags in the corner of a working app is noise, and the second-most-urgent thing
can wait until the first is handled or dismissed.

**Dismissals expire with their condition.** Waving away "no agents to spawn from"
once should not silence it forever if every pack is later uninstalled, so a
dismissal is forgotten the moment its condition resolves.

**Never while the fleet is loading.** Every condition is "you have none of X",
and an empty list mid-fetch is indistinguishable from an empty pod — nudging on
that would flash a wrong card on every launch.

Nothing nudges toward Octaweave (PLAN §9.3 / P7). It is not built, and a card
offering a button that goes nowhere is worse than silence.

*Correction to the original plan:* this section claimed S6 was what would stop
`sourceBound === false` being a "full-screen takeover". That stopped being true
at S3 — once views became tabs, the source step was already a focused tab rather
than a takeover.

### S7 — command palette
**Built.** `⌘K` and the `▷ Command` button at the right of the tab strip.

Ordered by what someone is actually reaching for: the agent they want to talk to,
then the tab they left open, then spawning, then the places, then the view
toggles. **Presets rank below instances deliberately** — "open Amy" is far more
common than "spawn a second Amy", and a palette that puts creation first is one
that creates things by accident.

An agent's preset is part of its searchable value, not just its label, so typing
a pack name surfaces every agent spawned from it.

`⌘N` came along with it, since the palette needed a New-agent entry anyway.

---

## 3. Order

S1–S3 shipped as one commit: the frame without tabs is a decoration, and moving
to tabs rewrites `App.tsx`'s view switch either way, so splitting them would have
meant writing that switch twice. S4–S5 followed together — both are chrome around
the same frame — then S5b, then S6–S7 together as the last of the furniture.

## 4. Shortcuts

| | |
|---|---|
| `⌘K` | Command palette |
| `⌘N` | New agent |
| `⌘B` | Sidebar |
| `⌘J` | Details rail |
| `⌘W` | Close tab |
| `⌘1`–`⌘9` | Select tab (`⌘9` is the last, matching browsers) |
| `⌘⇧[` / `⌘⇧]` | Cycle tabs |

### S8 — settings, keys, and the Octaweave connection
Not in the original stage list; it is where PLAN §9.3/§10.6 land in this shell.

The gear now opens a **Settings** tab rather than jumping to the interface-source
step. It holds three things and stubs nothing: a link out to the source step, the
**key store**, and the **Octaweave connection**.

The key store is the load-bearing addition. Until now the app could write exactly
two keys — `OPENAI_API_KEY` and `OPENAI_BASE_URL`, hardcoded into the wizard —
while the pod happily holds any number, which made every credential-needing pack
unreachable from the desktop. Names are upper-cased on entry, because packs match
`requires_env` by name and a lower-case entry silently never matches.

**Octaweave is one action, and the key never enters the webview.** The core takes
it, proves it against `GET /api/v1/whoami` (real, deployed, 401 for anonymous),
*then* writes it to the pod and installs the integration pack. Verify-before-store
is the whole ordering: a mistyped or revoked key fails in the card rather than
sitting in a pod waiting to fail mid-conversation.

Three states the card refuses to collapse:
- **Key only** — stored, but the pack did not install. Reachable today, because
  the pack is unpublished. Reporting success would leave an agent holding a
  credential and no tools.
- **Installed but disabled** — from inside a conversation this is identical to
  not installed, so it is called out in orange rather than counted as connected.
- **Rejected** — surfaced from Octaweave's own answer, and nothing is written.

The deep-link handler is implemented (`metalcraft-front://octaweave/callback`) and
routes a returned key through the *same* `connect` path as a pasted one, so there
is one place verification happens. Whether Octaweave will redirect there is its
half of the contract and is not knowable from outside — its site answers 200 on
every path — so ours is built and inert rather than assumed.

## 5. What the shell still doesn't have

Honest gaps, so nobody rediscovers them as bugs:

- **No theme toggle.** `index.css` has the `data-theme` hooks and every colour is
  a `light-dark()` pair, so the work is a store and a button — it just has not
  been done, and the app follows the OS.
- **No split panes.** PLAN §11 P2 says "tabs/panes/splits"; tabs and the two side
  columns are built, splitting the centre is not.
- **No transcript virtualization.** `@tanstack/react-virtual` is a dependency and
  unused; long sessions will get slow before they get unusable.
- **No published `octaweave` pack.** The connection card works; the install step
  fails with *no version of 'octaweave' matches* until the pack is pushed to
  packs.metalcraftai.com. The card names that state rather than hiding it.
- **No windowed-allowance meter.** The status bar shows a credit balance because
  that is what the ledger has (§S5). Orca's "10% used this month" needs a
  denominator nothing serves.
