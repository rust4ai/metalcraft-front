# Developing metalcraft-front

## Run it

```bash
npm --prefix frontend install
./run.sh                            # builds the renderer, then runs the shell
```

`run.sh` touches `crates/front-tauri/src/main.rs` before building, and that matters:
`tauri-build` embeds `frontendDist` at compile time but does **not** treat it as a rebuild
input. Rebuilding only the frontend leaves you running the previous UI — the app starts
fine and your change is simply absent, which is a confusing hour if you do not know it.

For UI work, run the renderer with HMR and point the shell at it:

```bash
npm --prefix frontend run dev       # http://localhost:5173
cargo run -p front-tauri            # devUrl in tauri.conf.json picks it up
```

## Point it somewhere else

| Variable | Default | Use |
|---|---|---|
| `METALCRAFT_ID_URL` | `https://id.metalcraftai.com` | local hub |
| `METALCRAFT_PODS_URL` | `https://pods.metalcraftai.com` | local control plane |
| `RUST_LOG` | — | `info` shows connect/mint/refresh |

## The rules that are enforced, and why

- **Nothing in `src/` may import `@tauri-apps/api` except `src/rpc/transport/tauri.ts`.**
  oxlint fails the build otherwise. The renderer also ships as a browser build, and a
  direct `invoke()` in a component is what makes that impossible later.
- **The entry point installs the transport, not `App`.** `App` stays pure so the boot path
  can be tested against a stub — a Tauri window that came up blank looks identical from
  the outside to one that works.
- **Secrets never cross into the webview.** The PAT lives in the OS keychain, connection
  tokens live in the Rust core, and the renderer addresses a pod by slug.
- **Unknown wire variants are ignored, not fatal.** Pods roll independently of the
  desktop app: an unrecognised `ChatEvent` must not kill a live turn.

## Design

The token layer in `src/index.css` is **Beautiful UI**'s (beautifului.dev, MIT), adopted rather
than approximated — the primitives only cohere because they share one palette. Two rules follow
from it and are worth keeping:

- **No component branches on theme.** Every colour is a `light-dark()` pair and the theme is
  chosen once, by `color-scheme` on `:root`. If you find yourself writing `dark:` variants for
  colour, add a token instead.
- **Three ink levels, no fourth.** `ink` for the claim, `ink-2` for the label, `ink-3` for
  metadata. Mono is load-bearing: it marks machine-owned values (paths, args, timers, ids), and
  anything that ticks gets `.tnum`.

Rebranding means replacing `--color-accent*`. The gray ramp, shadow ladder and motion curves
carry almost all of the perceived quality and should be left alone.

`npm run dev` then **`localhost:5173/?gallery`** renders a dev-only harness of the primitives in
the states that are hard to produce on demand — a trace mid-run, a failed tool call, a turn that
ran out of credits. It is `import.meta.env.DEV`-gated and never ships.

## Tests

```bash
cargo test --workspace          # wire formats, SSE framing, token refresh maths
npm --prefix frontend test      # transcript reducer + app boot against a stub core
```

The transcript reducer is the piece most worth testing: it is the whole session view,
and every rule in it (a `reply` is the message, tool cards complete in place, `error`
still ends on `done`) came from how the agent actually behaves.
