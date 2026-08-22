/* eslint-disable no-restricted-imports -- this file *is* the Tauri boundary */
import { invoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'
import type { Transport } from './index'

export const tauriTransport: Transport = {
  call: (method, args) => invoke(method, args),
  listen: async (channel, onEvent) => {
    const un = await tauriListen(channel, (e) => onEvent(e.payload as never))
    return un
  },
}
