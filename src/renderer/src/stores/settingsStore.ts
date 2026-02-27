import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { AppSettings } from '@shared/types/ipc.types'
import { ipc, ipcCall } from '../lib/ipc-client'

interface SettingsState {
  settings: AppSettings | null
  loading: boolean
  secretKeys: string[]

  load: () => Promise<void>
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  setSecret: (key: string, value: string) => Promise<void>
  deleteSecret: (key: string) => Promise<void>
  loadSecretKeys: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>()(
  immer((set) => ({
    settings: null,
    loading: false,
    secretKeys: [],

    load: async () => {
      set((s) => {
        s.loading = true
      })
      try {
        const { settings } = await ipcCall(ipc.settings.get())
        set((s) => {
          s.settings = settings
          s.loading = false
        })
      } catch {
        set((s) => {
          s.loading = false
        })
      }
    },

    setSetting: async (key, value) => {
      await ipcCall(ipc.settings.set(key, value))
      set((s) => {
        if (s.settings) {
          (s.settings as Record<string, unknown>)[key] = value
        }
      })
    },

    setSecret: async (key: string, value: string) => {
      await ipcCall(ipc.settings.setSecret(key, value))
      set((s) => {
        if (!s.secretKeys.includes(key)) {
          s.secretKeys.push(key)
        }
      })
    },

    deleteSecret: async (key: string) => {
      await ipcCall(ipc.settings.deleteSecret(key))
      set((s) => {
        s.secretKeys = s.secretKeys.filter((k) => k !== key)
      })
    },

    loadSecretKeys: async () => {
      const { keys } = await ipcCall(ipc.settings.listSecretKeys())
      set((s) => {
        s.secretKeys = keys
      })
    }
  }))
)
