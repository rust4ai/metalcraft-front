import { create } from 'zustand'
import { settings as settingsApi } from '@/rpc'

/**
 * The pod's own preferences, held once.
 *
 * A store rather than per-card state because two surfaces ask the same question:
 * the settings card that sets the timezone, and the arming dialog that warns
 * when it disagrees with this computer's. Both must see the same answer, and the
 * second must see the first's edit without a reload.
 */
interface PodSettingsState {
  /** The pod's IANA zone. `null` for a pod nobody has told, which is not the
   *  same as UTC — it means "whatever clock the pod itself is on". */
  podZone: string | null
  loading: boolean
  error: string | null
  /** Read once per app run unless forced: a pod's timezone changes about never. */
  load: (force?: boolean) => Promise<void>
  /** Save, and adopt what the pod echoes back rather than what was sent. */
  setZone: (zone: string) => Promise<boolean>
}

export const useSettings = create<PodSettingsState>((set, get) => ({
  podZone: null,
  loading: false,
  error: null,
  loaded: false,

  load: async (force = false) => {
    if (get().loading) return
    if (!force && get().podZone) return
    set({ loading: true, error: null })
    try {
      const settings = await settingsApi.get()
      set({ podZone: settings.timezone ?? null, loading: false })
    } catch (e) {
      // A pod older than this setting answers 404. That is "no timezone", which
      // is exactly what the surface already knows how to say — not an error to
      // put in front of somebody.
      const missing = /404|not found/i.test(String(e))
      set({ podZone: null, loading: false, error: missing ? null : String(e) })
    }
  },

  setZone: async (zone) => {
    set({ error: null })
    try {
      const saved = await settingsApi.save({ timezone: zone })
      set({ podZone: saved.timezone ?? null })
      return true
    } catch (e) {
      // The pod refuses a zone it cannot resolve, and names the format it wants.
      // Its wording is the useful one.
      set({ error: String(e) })
      return false
    }
  },
}))
