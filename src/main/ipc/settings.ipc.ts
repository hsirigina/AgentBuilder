import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/types/ipc.types'
import * as settingsRepo from '../storage/settings.repo'
import type { IpcResponse, AppSettings, ProviderTestResponse } from '@shared/types/ipc.types'

function ok<T>(data: T): IpcResponse<T> {
  return { ok: true, data }
}

function err(error: string): IpcResponse<never> {
  return { ok: false, error }
}

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    try {
      const settings = settingsRepo.getSettings()
      return ok({ settings })
    } catch (e) {
      return err(String(e))
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET,
    (_event, payload: { key: keyof AppSettings; value: unknown }) => {
      try {
        settingsRepo.setSetting(payload.key, payload.value as AppSettings[typeof payload.key])
        return ok({ updated: true })
      } catch (e) {
        return err(String(e))
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_SECRET, (_event, key: string) => {
    try {
      const value = settingsRepo.getSecret(key)
      // Return a boolean indicating if it exists, not the actual value
      // The actual value is only used server-side for API calls
      return ok({ exists: value !== null })
    } catch (e) {
      return err(String(e))
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET_SECRET,
    (_event, payload: { key: string; value: string }) => {
      try {
        // Validate the secret key name (only allow safe identifiers)
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(payload.key)) {
          return err('Invalid secret key name')
        }
        settingsRepo.setSecret(payload.key, payload.value)
        return ok({ saved: true })
      } catch (e) {
        return err(String(e))
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.SETTINGS_DELETE_SECRET, (_event, key: string) => {
    try {
      settingsRepo.deleteSecret(key)
      return ok({ deleted: true })
    } catch (e) {
      return err(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_LIST_SECRET_KEYS, () => {
    try {
      const keys = settingsRepo.listSecretKeys()
      return ok({ keys })
    } catch (e) {
      return err(String(e))
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_TEST_PROVIDER,
    async (_event, payload: { provider: string; apiKeyRef: string; model: string }) => {
      try {
        const startTime = Date.now()
        const apiKey = settingsRepo.getSecret(payload.apiKeyRef)
        if (!apiKey) {
          return ok<ProviderTestResponse>({
            success: false,
            error: 'API key not found. Please save your API key first.'
          })
        }

        // Minimal test: just verify the API key is valid by making a tiny request
        if (payload.provider === 'anthropic') {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              model: payload.model || 'claude-haiku-4-5-20251001',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'Hi' }]
            })
          })
          if (!response.ok) {
            const body = await response.json().catch(() => ({}))
            return ok<ProviderTestResponse>({
              success: false,
              error: (body as { error?: { message?: string } }).error?.message || `HTTP ${response.status}`
            })
          }
        } else if (payload.provider === 'openai') {
          const response = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` }
          })
          if (!response.ok) {
            return ok<ProviderTestResponse>({
              success: false,
              error: `HTTP ${response.status}`
            })
          }
        } else if (payload.provider === 'ollama') {
          const response = await fetch('http://localhost:11434/api/tags').catch(
            () => null
          )
          if (!response || !response.ok) {
            return ok<ProviderTestResponse>({
              success: false,
              error: 'Could not connect to Ollama. Is it running on localhost:11434?'
            })
          }
        }

        return ok<ProviderTestResponse>({
          success: true,
          latencyMs: Date.now() - startTime
        })
      } catch (e) {
        return ok<ProviderTestResponse>({ success: false, error: String(e) })
      }
    }
  )
}
