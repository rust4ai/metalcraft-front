# UI_PLAN — the Orca shell

**Status:** S1–S5 done (2026-08-22); S6–S7 outstanding. Companion to `PLAN.md`; this document
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

**Built.** Two icon tabs — Details and Activity — toggled with `⌘J`, open by
default as in the reference, width persisted.

PLAN §10.2 also asks this rail for **instance memory, a persona switcher and a
model picker, and none of the three is here**: `rpc/index.ts` stops at fleet,
keys and chats, so a persona dropdown could not change the persona and a model
picker could not change the model. What went in instead is everything the client
already knew and was throwing away — the instance's provenance, its chat id (the
thing a log grep needs and the only thing the UI never showed), and the tool
calls the transcript deliberately collapses into `Ran N tools`. The rail is where
that detail goes without making every reader scroll past it.

### S5 — the status bar
Pod slug + readiness dot, account, active-agent count, theme toggle.

**Built, including the API surface the meter needs** — which did not exist:
PLAN §12.6 lists a per-account usage summary as outstanding work in
metalcraft-id/inference, and nothing serves it today. So the contract is
proposed client-first, end to end, and the meter lights up the day the hub
implements it:

`front_cloud::Usage` → `ControlPlane::usage()` (`GET /api/usage`) →
`account_usage` command → `rpc.account.usage()` → `stores/usage.ts` → the bar.

Two decisions carry the whole design:

- **404 is not an error.** `usage()` returns `Ok(None)` on a 404 and `Err` only
  on a real failure. Collapsing them would put a permanent red error in every
  user's status bar until §12.6 ships.
- **Unknown is not zero.** The store keeps `supported: null | false | true`
  distinct, and the bar renders *no meter at all* when usage is unreported. An
  empty meter and an unknown meter look identical and mean opposite things — and
  the one place a person checks what they have spent is the worst possible place
  to guess.

A failed poll keeps the last good reading rather than blanking the bar: a stale
balance beats none, and the status bar is not where a network blip should
announce itself.

### S6 — nudge cards
The bottom-left dismissible card stack, driven by unmet setup facts (no interface
source, no Octaweave, no packs installed).

This is what lets `sourceBound === false` stop being a **full-screen takeover**
(`stores/ui.ts`) for someone whose pod already works. Only a genuinely keyless
pod — which cannot think, so a fleet would be a dead end — still gets the
takeover; everything else in PLAN §9.3–9.4 becomes a nudge you can ignore.

### S7 — command palette
`cmdk` is already a dependency and currently unused. The `▷ Command` button at
the right of the tab strip plus `⌘K`: instances, presets, open tabs, actions.

---

## 3. Order

S1–S3 shipped as one commit: the frame without tabs is a decoration, and moving
to tabs rewrites `App.tsx`'s view switch either way, so splitting them would have
meant writing that switch twice. S4–S5 followed together — both are chrome around
the same frame, and S5's honest-gap decision only becomes visible once the rail
proves the pattern. S6–S7 remain independent and can land in any order.
