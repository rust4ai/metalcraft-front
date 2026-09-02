# HARNESS_UI_PLAN — the shell, redesigned toward `agent_harness1.png`

A follow-on to `UI_PLAN.md`. That plan built the Orca shell: three columns, a tab
strip, a status bar. This one keeps every bone of it and changes the *reading* of
it, toward the reference in `~/Downloads/agent_harness1.png`.

The honest starting position: **this is a re-skin plus four structural moves, not
a rewrite.** The reference and the current app already agree on the frame —
sidebar / centre / rail / status bar, dark, dense, one accent. What differs is
where the global chrome lives, how the rail is organised, what the composer
admits about the turn it is about to start, and how much a sidebar row says.

---

## 0. The rule

**Nothing on screen that the backend cannot answer.** The reference is a
screenshot of a different product, and the failure mode of working from one is
building its affordances hollow: an attach button that opens nothing, a `Changed
files` panel that is permanently empty, a `<1%` ring computed from a number the
pod never sent.

So, for every slot in the reference, exactly one of three outcomes — and §3
records which, for all of them:

1. **Build it** — there is a real source, named.
2. **Remap it** — the slot is a good shape and something real fits it. The label
   changes to what it actually shows. Never the reference's word over our data.
3. **Drop it** — nothing real fits. It does not get drawn greyed out, disabled,
   "coming soon", or as an empty state implying it will fill. It is simply not
   there, and §3 says why.

A control that cannot do its job is worse than a missing one: the missing one
costs a feature, the hollow one costs trust in every other control on screen.

## 1. What the reference actually shows

Read top-down, and named so the phases below can point at things.

**R1 — a global top bar, full width.** Above all three columns: panel toggle,
product mark (`Harness Lab`), a breadcrumb (`dhruvalgolakiya / conductor-playground`),
a *centred* search field (`Search sessions, files, commands…` with a `⌘K` chip),
and a right cluster: a usage ring reading `<1%`, a bell, a theme toggle, a
right-panel toggle, avatar + username. The window's chrome lives here and nowhere
else.

**R2 — the sidebar is a session list, not a nav.** Header is `SESSIONS` with a
green `14 live` pill, a `+`, and a collapse. Then a filter field with its own
options button. Then a **collapsible scope group** — `This machine` with a count
of `352`. Then two-line rows: a square letter tile (per-agent colour), the
session's opening line as the title, a status dot, and a quiet second line of
`provider · workspace` with a relative time right-aligned.

**R3 — the centre header is a mode switcher.** `Agent · Changes · Files ·
Terminal · Skills` as a segmented row of icon+label pills, the active one filled
with a hairline ring. Right-aligned on the same row: contextual actions for the
thing being worked on (`Sandbox`, `Open PR`).

**R4 — the transcript is prose with disclosures.** The user's message is a small
right-aligned bubble. The agent's reply is bare text, no bubble. Between them,
collapsed one-liners with chevrons: `Listed .`, `Plan complete 1/1` with a
struck-through checked step under it, `Thought for a moment`. Each finished turn
ends with a quiet meta line: `7.8k in · 155 out · 35.8s · 3 tool calls`.

**R5 — the composer is a card with a chip rail.** Textarea on top; underneath, in
the same card: a workspace chip (folder icon, `org/repo`, a lock), a model chip
(`Pi  GLM 5.3 Flash`, a lock), then `@`, attach, mic, the usage ring, and `↵ send`
beside an arrow button. A disclaimer sits under the card, outside it.

**R6 — the rail is an INSPECTOR: one scroll of collapsible sections.** Not tabs.
`Workspace` (leading with a status card — `● Ready` … `sandbox` — then label/value
rows: Repository, Branch, Agent, Model), `Plan`, `Changed files` (with an empty
sentence, not an empty box), `Usage` (a stacked meter, a legend of Input / Cached
/ Reasoning / Output, then rows: Context window, Turns, Tool calls, Time), and
`Checks`, collapsed.

**R7 — the status bar is machine facts.** Sandbox state, branch, changed count,
and on the right the model and its usage.

---

## 2. What we already have

Worth stating so nothing gets rebuilt that exists:

- The three-column grid that never unmounts — `app/Shell.tsx`.
- The whole token layer the reference's look depends on: surfaces, a three-step
  ink ramp, the shadow ladder, `light-dark()` pairs — `src/index.css`. **No new
  colours are needed for any of this.** `data-theme` is already honoured; nothing
  sets it yet.
- A collapsible tool trace with past-tense labels — `features/session/Trace.tsx`.
  This is R4's disclosure pattern, already built and already correct.
- A turn plan as a checklist — `PlanList` in `SessionView.tsx`. This is R6's
  `Plan` section, in the wrong column.
- Sidebar partitioned into active vs. history with counts — `Sidebar.tsx` +
  `features/fleet/activity.ts`. This is R2's scope group, one restyle away.
- A command palette on ⌘K — `app/CommandPalette.tsx`. R1's search field is a
  *button that opens it*, not new machinery.
- A per-run trace reader with real token splits — `features/session/turnTrace.ts`
  already parses `gen_ai.usage.{input,output,reasoning,cache_read}_tokens`. This
  is exactly R6's Usage legend, currently buried in a debug drawer.
- Per-instance memory, persona switching, schedules, key health, diagnostics —
  all fetched, all rendered somewhere.

So the work is mostly *moving things to where the reference puts them* and
tightening the type scale — with four genuinely new pieces: the top bar, the
session mode switcher, the usage store, and the composer chip rail.

---

## 3. Where the reference has no counterpart

The reference is a coding harness. This is an agent pod. Four slots do not map,
and guessing at them would produce panels that lie:

| Reference | Metalcraft | Decision |
|---|---|---|
| `Changes` / `Files` / `Open PR` / `Changed files` | no working tree | **Drop.** Replaced by modes that exist: Memory, Runs, Schedules |
| `Terminal` | none | **Drop** |
| `Sandbox` / `Ready · sandbox` | the pod itself | **Remap** — the status card carries pod slug, version, reachability |
| `Checks` | no CI | **Remap** — key health (`features/settings/keyHealth.ts`), inference credential, unseen diagnostics count |
| `Thought for a moment` (expandable reasoning) | reasoning items arrive **encrypted** (`types.ts:301`) | **Remap** — the disclosure expands the *phase timeline* (compaction, recall, waiting) with durations, not hidden prose. There is no text to reveal and we must not imply there is |
| `7.8k in · 155 out` on every turn | the SSE stream carries `duration_ms` but **no token counts** — those exist only in the OTLP trace | **Split** — the live turn footer shows `N tool calls · Ns`; token splits appear in the Inspector's Usage, which reads the trace. Putting tokens in the footer would need a pod-side change to `ChatEvent`, which is out of scope here |
| avatar + username, top right | `Session` is `{ email, premium }` (`types.ts:9`) — **no avatar, no display name** | **Remap** — a monogram tile derived from the email plus the email itself. A derived initial is not a claim about a photo; a generic person-icon standing in for one would be |
| `@` mention, attach, mic in the composer | no mentions, no upload endpoint, no voice | **Drop** — see H6 |
| the bell | no notification stream | **Remap** — the existing error log, keeping its `ScrollText` icon rather than borrowing a bell. A bell asserts a notification stream; we have a log of things that already went wrong, which is a different promise. It moves to the top bar with its unseen badge intact |

---

## 4. Phases

Ordered so each one lands as a visible improvement on its own and nothing is
half-migrated at a commit boundary.

### H1 — the global top bar ✅ *landed*

**New:** `app/TopBar.tsx`, `stores/theme.ts`, `stores/theme.test.ts`.
**Edits:** `app/Shell.tsx`, `app/Sidebar.tsx`, `app/TabStrip.tsx`, `app/StatusBar.tsx`,
`app/RightRail.tsx`, `stores/ui.ts`, `app/App.test.tsx`.

> **One deviation from this section, on §0's authority.** The plan said the usage
> ring could "land stubbed and fill in after". It doesn't: there is no number
> behind it until H5, and a ring reading `<1%` off a figure the pod never sent is
> the hollow control §0 exists to forbid. The spot is left empty and H5 fills it.
>
> Two further slots resolved the same way while building: the account is a
> monogram derived from the email, because `Session` carries no avatar and no
> display name; and the error log kept its `ScrollText` glyph rather than
> borrowing the reference's bell.

The window is frameless, and today the traffic-light inset is paid twice —
`pl-20` in the sidebar header and again in the tab strip when the sidebar is
hidden. A full-width bar collects that into one place and is the reason the
reference's chrome reads as one object rather than three headers at the same
height.

`Shell.tsx` grows a row: `gridTemplateRows: 'auto minmax(0,1fr) auto'`, top bar
spanning `col-span-full`. Height 44px, the drag region.

Contents, left to right:
- sidebar toggle (moves out of `Sidebar.tsx`'s header)
- the mark: pod name from `useConnection().info`
- breadcrumb: `pod.slug / <active tab label>` — reuse `tabLabel()` from `TabStrip.tsx`
- centre: a **button**, styled as a field, `Search agents, packs, commands…` with
  a `⌘K` chip; opens the existing `CommandPalette`. Lifting `paletteOpen` out of
  `Shell` into `stores/ui.ts` so both the bar and the shortcut drive it
- right: context usage ring (H5), the error log with its unseen badge and its own
  `ScrollText` icon (moves out of `Sidebar.tsx`'s footer — **not** a bell, per
  §3), theme toggle, rail toggle (moves out of `TabStrip.tsx`), and an email
  monogram tile + the address (moves out of `StatusBar.tsx`; no avatar exists)

`StatusBar` then keeps only machine facts, per R7: pod slug, version, `n working`,
credits. The email leaves it — it was only there because the title bar was
deleted, and now there is one again.

**Theme.** `stores/theme.ts` writes `data-theme` on `<html>` and persists to
`localStorage`, defaulting to system. `index.css` needs no change. Three states,
not two: light / dark / system, cycled by the sun button.

### H2 + H3 — modes in the centre ✅ *landed together*

**New:** `features/session/ModeTabs.tsx`, `RunsPanel.tsx`, `MemoryPanel.tsx`,
`SchedulesPanel.tsx`, `ModeTabs.test.tsx`, `components/ui/Facts.tsx`.
**Edits:** `features/session/SessionView.tsx`, `app/RightRail.tsx`, `stores/ui.ts`,
`stores/layout.ts`, `stores/turnDebug.ts` (+ its test).
**Deleted:** `features/session/DebugDrawer.tsx` and its test.

> **These could not ship separately.** The plan had H2 build the switcher and H3
> fill it, but all four modes' content already existed — so H2 alone would have
> shipped three tabs opening onto blank panes, for one commit, which is the thing
> §0 forbids. Landed as one change instead.

There is a real tension worth naming: the reference's centre header is a *mode
switcher for one session*, while ours is a *document tab strip* — browser-like,
holding Home, Settings, three agents. Those are different objects and collapsing
one into the other would cost the ability to have two agents open.

So: **keep both, at two altitudes.** The tab strip stays where it is and gets the
reference's pill geometry (26→28px, `rounded-full` active pill with
`shadow-hairline`, icon + label, close on hover). Below it, `SessionView`'s
current header — status dot, editable name, conversation picker, debug button —
is replaced by a segmented `ModeTabs` row with the same treatment as R3, and the
contextual actions right-aligned on that row.

The modes, each backed by something that already loads:

| Mode | Source | Today |
|---|---|---|
| **Chat** | `stores/sessions.ts` | the transcript |
| **Runs** | `stores/turnDebug.ts` | trapped in a drawer |
| **Memory** | `fleet.memory(id)` | a cramped rail tab |
| **Schedules** | `fleet.flows(id)` | a rail section |

`stores/ui.ts` gains `sessionMode: Record<string, Mode>` — per instance, not
global, so switching agents does not drop you into someone else's Runs tab.

**What actually changed, beyond the plan's sketch:**

- The rail's **Activity** tab had nowhere to go in a four-mode row, so it became
  the first section *of* Runs — "This conversation", the live transcript's tools,
  above the pod's recorded traces. Two grains of the same question, and the live
  one needs no fetch to answer.
- The rail keeps **no summaries** of what moved. The plan said it would; that was
  wrong. Two copies of one schedule list is how they drift, and the mode row is
  one click away.
- `turnDebug` lost its `open`/`hide`/`show` drawer semantics for a plain
  `load()`. A store that also knew whether it was on screen would be a second,
  disagreeing answer to a question the router already settles.
- `stores/layout.ts` lost `railTab` entirely: with Memory and Activity gone the
  rail had one tab left, and a single always-selected icon is chrome pretending
  to be a control. The rail is now a labelled single scroll — H4's shape, arrived
  at early rather than left half-migrated.

**Two defects the work surfaced, both fixed:**

1. `RunsOnItsOwn` returned `null` when an agent had no schedules. Correct as a
   rail section with something always below it; wrong as a *pane*, where it drew
   a blank rectangle under a tab you had just pressed. It says so in a sentence
   now. Caught by the §0 test, which asserts each mode renders content rather
   than merely becoming current.
2. `prune()` dropped a deleted agent's mode only when a tab also disappeared, so
   an agent deleted while its tab was closed leaked its entry for the life of the
   window — where a re-used id would inherit a room nobody chose. The reconcile
   moved above the early return.
3. `Row` puts its label and value at opposite ends, which is right in a 360px
   rail and absurd in an 800px pane. The fact blocks in the panels keep a narrow
   measure of their own; the prose beside them does not.

### H4 — the Inspector ✅ *landed*

**New:** `components/ui/Collapsible.tsx`, `app/RightRail.test.tsx`.
**Edits:** `app/RightRail.tsx` (rewritten), `stores/layout.ts`.

> **Three deviations from the section below.**
>
> **Plan is not mirrored here.** The plan said it would move from the transcript
> to the rail. That is wrong once you remember the rail is closable (⌘J): a
> running turn's checklist would vanish with it. The plan stays in the transcript,
> where it survives the rail being shut, and the Inspector has no Plan section
> rather than a second copy.
>
> **Usage is absent, not stubbed** — same reason as the top bar's ring. It arrives
> with H5, when there is a number behind it.
>
> **Checks fires no requests of its own.** `inference` is already read at boot and
> the diagnostics are already polled by the window bar, so the section is free.
> Service key health (Octaweave, Buildr) is deliberately *not* here: the settings
> store only holds it once the Settings tab has fetched it, and a row reading
> "unknown" is a check that never checked.
>
> **One defect found by running it:** `Row` hides an absent value, so
> `This conversation` rendered a heading with nothing under it whenever no chat
> had opened — a fold you expand onto blank space, which is the same lie as a
> hollow control. It says so in a sentence now.

Icon tabs out, one scroll of collapsible sections in — R6. Each section header:
chevron, icon, title at `11px` uppercase tracking-wide. Open/closed persists in
`stores/layout.ts` as `railSections: Record<string, boolean>`, alongside the
widths, same `localStorage` key.

Sections, in order:

1. **Agent** — leading with the status card the reference puts at the top:
   `● Ready` / preset name, on `bg-inset` with a hairline. Then the existing
   label/value rows (name, preset, pack, persona, origin, model, chat id).
2. **Plan** — `session.transcript.plan`, the checklist from `SessionView`. It
   *moves* here rather than being mirrored: two copies of the same checklist on
   one screen is the reference's mistake, not one to copy. The transcript keeps
   its plan only while a turn is running and no plan section is open.
3. **Memory** — top facts, count, `Open memory →`.
4. **Usage** — H5.
5. **Runs on its own** — the existing `RunsOnItsOwn`, unchanged but folded.
6. **Checks** — collapsed by default: inference credential resolves, key health,
   unseen diagnostics, gateway reachable. Each a row with a dot. This is the one
   section that earns a badge on its collapsed header, because everything in it
   is invisible until it breaks.
7. Delete, below a rule, last — unchanged.

Off a session (Home, Settings, Packs) the rail shows the pod's own version of
sections 1, 4 and 6.

### H5 — usage, as one number and one meter ✅ *landed*

**New:** `stores/usage.ts`, `stores/usage.test.ts`, `components/ui/Usage.tsx`.
**Edits:** `app/TopBar.tsx`, `app/RightRail.tsx`.

> **The ring measures context, and credits stay in the status bar.** Two
> different questions — "can this conversation keep going" and "can this account
> afford it" — and one ring cannot answer both. The reference's `<1%` is the
> first, so that is what this is.
>
> **The token legend (Input / Cached / Reasoning / Output) was not built.** Those
> splits live only in the OTLP trace, which `useTurnDebug` loads for one run at a
> time; a second consumer in the rail would either fight it for that slot or fire
> a duplicate fetch on every session open. They are already shown per turn in the
> Runs mode, which is more useful than an aggregate — a legend averaging every
> turn together answers no question anyone asks.
>
> What the meter shows instead is the thing the reference's ring cannot: the
> **compaction threshold, marked on the bar**. 48% means nothing alone; 48% with
> a tick at 60% says "two more exchanges and this gets summarized".
>
> The estimate is labelled as one, in the panel rather than a tooltip:
> `estimated_tokens` is the pod's ~4-chars-per-token figure, and anyone
> reconciling it against a provider bill needs to know that before they try.

The reference shows the same fact at three sizes: a ring in the top bar, a ring
in the composer, a stacked meter with a legend in the Inspector. One store, three
readers.

The store merges two sources that exist and never meet today:

- `chats.context(chatId)` → `estimated_tokens`, `context_window`,
  `compact_threshold_tokens`. This drives the **ring**: percent of window used.
  It is an estimate (~4 chars/token — `types.ts:59`) and the tooltip must say so;
  a ring that reads `<1%` implies a precision this number does not have.
- the newest `TurnTrace` → `TokenUse { input, output, reasoning, cached }`, plus
  step counts and durations. This drives the **stacked meter and legend**, and
  the `Turns` / `Tool calls` / `Time` rows.

Colours come straight from the existing tokens — `accent` for input, `ink-3` for
cached, `orange` for reasoning, `green` for output — which is the reference's
own assignment and needs nothing new.

A pod that cannot answer either question gets **no readout**, not a zero. This is
the rule `StatusBar`'s credits readout already follows and it holds here.

### H6 — the composer chip rail ✅ *landed*

**New:** `features/session/Composer.test.tsx`.
**Edits:** `features/session/Composer.tsx`, `features/session/SessionView.tsx`.

> **The persona chip is a live control, not a label.** It was already the
> Inspector's `PersonaSwitcher`; moving it here is the whole point of the rail —
> "actually, ask this as the other voice" is a thought you have with the message
> half-typed, not one that should send you to a panel that can also be closed.
>
> `instanceId` is optional because the dev gallery mounts a composer with no
> agent behind it. Without one there are no chips at all, which is the honest
> rendering rather than a special case — and it is tested as such.
>
> The `↵ send` hint disappears while a turn runs, because there Enter *queues* a
> message rather than sending one, and the button is Stop.

The card grows a second row inside itself — R5. The discipline: **only ship chips
backed by something real.** The reference's `@`, attach and mic have no
counterpart here (no mentions, no uploads, no voice) and drawing them dead would
be worse than not drawing them.

What is real:
- **Agent chip** — bot icon, instance name. Click focuses the Inspector's Agent
  section.
- **Persona chip** — `PersonaSwitcher` already exists and is a full control; it
  belongs here, next to the message it will govern, far more than in a rail.
- **Model chip** — `session.modelName`, with the reference's lock glyph, because
  it genuinely is fixed for the life of the chat (`RightRail.tsx` explains why).
  The lock is honest here in a way it rarely is.
- **Usage ring** — H5.
- `↵ send` label beside the existing send/stop button.

Under the card, outside it: the disclaimer, matching R5's placement.

The keyboard behaviour, the `/` command menu, the queue-while-busy semantics and
the draft-survives-failure rule are all untouched. This phase is layout only.

### H7 — sidebar density

**Edits:** `app/Sidebar.tsx`, `features/fleet/InstanceRow.tsx`.

Toward R2:
- Header becomes `AGENTS` (uppercase, `11px`) with a green `n live` pill counting
  `thinking`/`running` from `stores/fleet.ts` — the number `StatusBar` already
  computes.
- The active list gets a collapsible scope header, `This pod` with a count,
  matching the history fold that already exists below it. Both folds, same
  component.
- `InstanceRow` gains a square letter tile (first letter of the name, hue derived
  from the instance id — deterministic, no stored colour) and a right-aligned
  relative time from `last_active_at`, using `relative()` from `FleetView.tsx`.
  Status dot stays; the schedule clock stays.
- The nav rows (Home / Automations / Extensions) stay above the filter. They are
  the one thing the reference has no room for and we would miss.

**The sidebar stays a list of agents.** The reference's rows are conversations;
ours are persistent things that hold memory, a persona and a schedule, and an
agent outliving any one of its chats is the deliberate part of this product. So
this phase borrows the reference's *density* and not its *unit* — conversations
stay behind the picker in the mode row, where H2 leaves them.

### H8 — transcript typography

**Edits:** `features/session/SessionView.tsx`, `features/session/Trace.tsx`.

- User bubble: smaller radius, `bg-hover-2`/`text-ink` rather than a full accent
  fill. In the reference the user's line is quiet and the agent's answer is the
  page; today it is the loudest thing on screen.
- `Trace`'s collapsed header restyled to the reference's disclosure row (chevron
  first, quiet label, no border box when collapsed).
- **New:** a turn footer — `3 tool calls · 35.8s` — under each completed agent
  reply, at `11px` in `ink-3`, from `llm_completed.duration_ms` and the tool
  counts already in the transcript state. Tokens deliberately absent; see §3.
- The `Thought for a moment` disclosure: past-tense, expanding to the phase
  timeline with durations. Not hidden reasoning — there is none to show.

---

## 4a. The spacing scale

The layout is already right. What separates the app from the reference, once the
furniture is in the same places, is **air** — the reference is meaningfully
tighter, and that is most of why it reads as an instrument rather than a
document. So this is not a per-phase decoration; it is one recalibration that
every phase then builds against.

One pass, defined once here and applied everywhere:

| | now | target | where |
|---|---|---|---|
| chrome row height | 38px | 34px | tab strip, rail header |
| top bar | — | 44px | new, and the only tall row |
| status bar | 26px | 24px | `StatusBar.tsx` |
| sidebar row | `py-1.5` two-line | `py-1` two-line | `InstanceRow.tsx` |
| tab pill | 26px | 28px, `rounded-full` | `TabStrip.tsx` |
| body / transcript | 13.5px | 13px | `SessionView.tsx` |
| metadata | 11.5–12px | 11px | rail rows, second lines, footers |
| section heading | 11px | 11px, unchanged | already correct |
| transcript padding | `px-4 py-6` | `px-4 py-4` | `SessionView.tsx` |
| rail / sidebar padding | `px-3`/`px-2` | unchanged | already correct |

Two things deliberately do **not** tighten. The transcript keeps its
`max-w-3xl` measure — a longer line is harder to read, and density must not be
bought from the one surface people actually read. And `leading-relaxed` stays on
agent replies for the same reason: the reference's own prose is loose inside a
tight frame, which is exactly the contrast that makes it work.

The ink ramp, the radii, the shadows and the accent are untouched. This is a
spacing pass, not a palette one.

## 5. Order and risk

H1 → H2 → H3 → H4 → H5 → H6 → H7 → H8, with §4a's spacing pass folded into each
phase as it touches its files rather than run as a separate sweep — a global
find-and-replace on paddings would churn every file at once and make each phase's
diff unreadable.

H1 and H4 are the two that touch layout others depend on, so they go early. H3
must precede H4 (the rail cannot lose its tabs until the modes hold their
content). H5 is a dependency of the *decorations* in H1 and H6 but not their
structure, so both can land with the ring stubbed and fill in after.

Risk sits almost entirely in H1: it moves the drag region and the traffic-light
inset, which is the one thing that is invisible in `?gallery` and in tests and
only shows up in a real Tauri window. Everything else is inside components with
existing test files (`Sidebar`, `TabStrip`, `SessionView`, `Composer`,
`RightRail` all have neighbours under test) and the stores are additive.

Nothing in here changes an RPC call, a store's data shape, or a pod contract.
`stores/ui.ts` and `stores/layout.ts` gain fields; `stores/theme.ts` and
`stores/usage.ts` are new; no existing field changes meaning. A persisted layout
from the current build stays valid.

## 6. Out of scope

- Markdown rendering in replies (still owed from `UI_PLAN` P4).
- Transcript virtualization.
- Any pod-side change — notably putting token counts on `ChatEvent`, which is
  what a per-turn `7.8k in · 155 out` would actually require.
- The Launchpad, Packs, Automations and Settings views. They inherit the tokens,
  the top bar and the rail, and are otherwise untouched.
