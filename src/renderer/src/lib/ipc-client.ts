// Typed wrapper around window.electronAPI (exposed via contextBridge in preload)
// This is the only way the renderer communicates with the Electron main process.

import type { ElectronAPI } from '../../../preload/index'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export const ipc = window.electronAPI

// Helper to unwrap IPC responses and throw on error
export async function ipcCall<T>(
  promise: Promise<{ ok: true; data: T } | { ok: false; error: string; code?: string }>
): Promise<T> {
  const result = await promise
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.data
}
