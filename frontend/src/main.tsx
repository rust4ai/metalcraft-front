import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { setTransport } from '@/rpc/transport'
import { tauriTransport } from '@/rpc/transport/tauri'
import { httpTransport } from '@/rpc/transport/http'
import { captureDiagnostics } from '@/stores/diagnostics'
import '@/index.css'

// The entry point — not App — chooses the transport, so the component tree is
// testable against a stub and the web build (PLAN §11 P11) swaps this one line.
//
// `VITE_DEV_RPC=http://127.0.0.1:1421 npm run dev` runs this UI in a browser
// against the desktop core's dev bridge, which is how the app gets driven
// against a live pod without a Tauri window. Dev-only by construction: Vite
// inlines `import.meta.env` at build time and nothing sets this in a release.
const devRpc = import.meta.env.VITE_DEV_RPC
setTransport(devRpc ? httpTransport(devRpc) : tauriTransport)

// After the transport, before the tree: the error log's sink hangs off the
// transport, and a failure during the first render is exactly the kind this is
// meant to catch. The Rust-side boot probe still writes to the terminal — this
// is the same information somewhere a user can reach it.
captureDiagnostics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
