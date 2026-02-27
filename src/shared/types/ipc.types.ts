import type { AgentDefinition } from '../schemas/agent.schema'

// ── IPC channel names ─────────────────────────────────────────────────────────

export const IPC_CHANNELS = {
  // Agent CRUD
  AGENTS_LIST: 'agents:list',
  AGENTS_GET: 'agents:get',
  AGENTS_CREATE: 'agents:create',
  AGENTS_UPDATE: 'agents:update',
  AGENTS_DELETE: 'agents:delete',
  AGENTS_EXPORT: 'agents:export',
  AGENTS_IMPORT: 'agents:import',

  // Agent runner
  RUNNER_START: 'runner:start',
  RUNNER_STOP: 'runner:stop',
  RUNNER_EVENT: 'runner:event', // main → renderer (pushed events)
  RUNNER_CONFIRM: 'runner:confirm', // renderer → main (user confirmation response)

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_SECRET: 'settings:getSecret',
  SETTINGS_SET_SECRET: 'settings:setSecret',
  SETTINGS_DELETE_SECRET: 'settings:deleteSecret',
  SETTINGS_LIST_SECRET_KEYS: 'settings:listSecretKeys',
  SETTINGS_TEST_PROVIDER: 'settings:testProvider',

  // Audit log
  AUDIT_QUERY: 'audit:query',
  AUDIT_CLEAR: 'audit:clear'
} as const

// ── Agent IPC payloads ────────────────────────────────────────────────────────

export interface AgentsListResponse {
  agents: AgentSummary[]
}

export interface AgentSummary {
  id: string
  name: string
  description: string
  provider: string
  model: string
  tags: string[]
  createdAt: string
  updatedAt: string
  enabledToolCount: number
}

export interface AgentsGetResponse {
  agent: AgentDefinition
}

export interface AgentsCreatePayload {
  name: string
  description?: string
}

export interface AgentsCreateResponse {
  agent: AgentDefinition
}

export interface AgentsUpdatePayload {
  id: string
  updates: Partial<AgentDefinition>
}

export interface AgentsUpdateResponse {
  agent: AgentDefinition
}

export interface AgentsDeletePayload {
  id: string
}

// ── Runner IPC payloads ───────────────────────────────────────────────────────

export interface RunnerStartPayload {
  agentId: string
  userMessage: string
  runId: string
}

export interface RunnerStopPayload {
  runId: string
}

export interface RunnerConfirmPayload {
  runId: string
  confirmationId: string
  decision: 'allow-once' | 'allow-session' | 'deny'
}

// Runner events emitted from main → renderer via IPC push
export type RunnerEventType =
  | 'run-started'
  | 'node-started'
  | 'node-completed'
  | 'node-error'
  | 'llm-chunk'
  | 'llm-tool-call'
  | 'tool-call'
  | 'tool-result'
  | 'requires-confirmation'
  | 'security-warning'
  | 'run-completed'
  | 'run-error'

export interface RunnerEvent {
  type: RunnerEventType
  runId: string
  timestamp: string
  nodeId?: string
  data: unknown
}

export interface ConfirmationRequest {
  confirmationId: string
  runId: string
  action: string
  description: string
  command?: string
  url?: string
  path?: string
}

// ── Settings IPC payloads ─────────────────────────────────────────────────────

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  defaultProvider: string
  auditRetentionDays: number
  confirmDestructiveActions: boolean
}

export interface SettingsGetResponse {
  settings: AppSettings
}

export interface SettingsSetPayload {
  key: keyof AppSettings
  value: unknown
}

export interface SecretSetPayload {
  key: string
  value: string
}

export interface ProviderTestPayload {
  providerId: string
}

export interface ProviderTestResponse {
  success: boolean
  error?: string
  latencyMs?: number
}

// ── Audit IPC payloads ────────────────────────────────────────────────────────

export interface AuditQueryPayload {
  agentId?: string
  runId?: string
  limit?: number
  offset?: number
  fromDate?: string
  toDate?: string
}

export interface AuditEntry {
  id: number
  ts: string
  agentId: string
  runId: string
  eventType: string
  tool?: string
  payload?: string
  outcome: 'success' | 'denied' | 'error'
  error?: string
}

export interface AuditQueryResponse {
  entries: AuditEntry[]
  total: number
}

// ── Generic IPC response wrapper ──────────────────────────────────────────────

export interface IpcSuccess<T> {
  ok: true
  data: T
}

export interface IpcError {
  ok: false
  error: string
  code?: string
}

export type IpcResponse<T> = IpcSuccess<T> | IpcError
