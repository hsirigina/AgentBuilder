import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/types/ipc.types'
import type {
  IpcResponse,
  AgentsListResponse,
  AgentsGetResponse,
  AgentsCreateResponse,
  AgentsUpdateResponse,
  AppSettings,
  ProviderTestResponse,
  AuditQueryPayload,
  AuditQueryResponse,
  RunnerEvent,
  RunnerConfirmPayload
} from '../shared/types/ipc.types'
import type { AgentDefinition } from '../shared/schemas/agent.schema'

// Typed IPC invoke helper
async function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResponse<T>> {
  return ipcRenderer.invoke(channel, ...args)
}

// The API exposed to the renderer via window.electronAPI
const api = {
  // ── Agents ─────────────────────────────────────────────────────────────────
  agents: {
    list: (): Promise<IpcResponse<AgentsListResponse>> =>
      invoke(IPC_CHANNELS.AGENTS_LIST),

    get: (id: string): Promise<IpcResponse<AgentsGetResponse>> =>
      invoke(IPC_CHANNELS.AGENTS_GET, id),

    create: (payload: { name: string; description?: string }): Promise<IpcResponse<AgentsCreateResponse>> =>
      invoke(IPC_CHANNELS.AGENTS_CREATE, payload),

    update: (payload: { id: string; updates: Partial<AgentDefinition> }): Promise<IpcResponse<AgentsUpdateResponse>> =>
      invoke(IPC_CHANNELS.AGENTS_UPDATE, payload),

    delete: (id: string): Promise<IpcResponse<{ deleted: boolean }>> =>
      invoke(IPC_CHANNELS.AGENTS_DELETE, { id }),

    export: (id: string): Promise<IpcResponse<{ json: string }>> =>
      invoke(IPC_CHANNELS.AGENTS_EXPORT, id),

    import: (json: string): Promise<IpcResponse<AgentsCreateResponse>> =>
      invoke(IPC_CHANNELS.AGENTS_IMPORT, json)
  },

  // ── Runner ──────────────────────────────────────────────────────────────────
  runner: {
    start: (payload: {
      agentId: string
      userMessage: string
      runId: string
    }): Promise<IpcResponse<{ runId: string; started: boolean }>> =>
      invoke(IPC_CHANNELS.RUNNER_START, payload),

    stop: (runId: string): Promise<IpcResponse<{ stopped: boolean }>> =>
      invoke(IPC_CHANNELS.RUNNER_STOP, { runId }),

    confirm: (payload: RunnerConfirmPayload): Promise<IpcResponse<{ confirmed: boolean }>> =>
      invoke(IPC_CHANNELS.RUNNER_CONFIRM, payload),

    // Subscribe to runner events (streaming from main process)
    onEvent: (callback: (event: RunnerEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, event: RunnerEvent): void => callback(event)
      ipcRenderer.on(IPC_CHANNELS.RUNNER_EVENT, handler)
      // Return an unsubscribe function
      return () => ipcRenderer.removeListener(IPC_CHANNELS.RUNNER_EVENT, handler)
    }
  },

  // ── Settings ────────────────────────────────────────────────────────────────
  settings: {
    get: (): Promise<IpcResponse<{ settings: AppSettings }>> =>
      invoke(IPC_CHANNELS.SETTINGS_GET),

    set: (key: keyof AppSettings, value: unknown): Promise<IpcResponse<{ updated: boolean }>> =>
      invoke(IPC_CHANNELS.SETTINGS_SET, { key, value }),

    getSecretExists: (key: string): Promise<IpcResponse<{ exists: boolean }>> =>
      invoke(IPC_CHANNELS.SETTINGS_GET_SECRET, key),

    setSecret: (key: string, value: string): Promise<IpcResponse<{ saved: boolean }>> =>
      invoke(IPC_CHANNELS.SETTINGS_SET_SECRET, { key, value }),

    deleteSecret: (key: string): Promise<IpcResponse<{ deleted: boolean }>> =>
      invoke(IPC_CHANNELS.SETTINGS_DELETE_SECRET, key),

    listSecretKeys: (): Promise<IpcResponse<{ keys: string[] }>> =>
      invoke(IPC_CHANNELS.SETTINGS_LIST_SECRET_KEYS),

    testProvider: (payload: {
      provider: string
      apiKeyRef: string
      model: string
    }): Promise<IpcResponse<ProviderTestResponse>> =>
      invoke(IPC_CHANNELS.SETTINGS_TEST_PROVIDER, payload)
  },

  // ── Audit ───────────────────────────────────────────────────────────────────
  audit: {
    query: (params: AuditQueryPayload): Promise<IpcResponse<AuditQueryResponse>> =>
      invoke(IPC_CHANNELS.AUDIT_QUERY, params),

    clear: (agentId?: string): Promise<IpcResponse<{ cleared: boolean }>> =>
      invoke(IPC_CHANNELS.AUDIT_CLEAR, agentId)
  }
}

// Expose the typed API to the renderer via contextBridge
// window.electronAPI is the only way the renderer talks to main
contextBridge.exposeInMainWorld('electronAPI', api)

// Export type for use in renderer
export type ElectronAPI = typeof api
