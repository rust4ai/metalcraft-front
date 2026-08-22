import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { setTransport } from '@/rpc/transport'
import { tauriTransport } from '@/rpc/transport/tauri'
import '@/index.css'

// The entry point — not App — chooses the transport, so the component tree is
// testable against a stub and the web build (PLAN §11 P11) swaps this one line.
setTransport(tauriTransport)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
