import { ipcMain, BrowserWindow } from 'electron'
import { streamText } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import { IPC_CHANNELS } from '@shared/types/ipc.types'
import * as agentsRepo from '../storage/agents.repo'
import { appendAuditLog } from '../storage/audit.repo'
import { buildModel } from '../llm/index'
import * as settingsRepo from '../storage/settings.repo'
import type {
  IpcResponse,
  RunnerStartPayload,
  RunnerStopPayload,
  RunnerConfirmPayload,
  RunnerEvent
} from '@shared/types/ipc.types'

function ok<T>(data: T): IpcResponse<T> {
  return { ok: true, data }
}

function err(error: string): IpcResponse<never> {
  return { ok: false, error }
}

// Active run state
const activeRuns = new Map<
  string,
  { abortController: AbortController; confirmations: Map<string, (decision: string) => void> }
>()

function emitToRenderer(runId: string, event: RunnerEvent): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.RUNNER_EVENT, event)
    }
  }
}

export function registerRunnerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.RUNNER_START, async (_event, payload: RunnerStartPayload) => {
    const { agentId, messages, runId } = payload

    try {
      const agent = agentsRepo.getAgent(agentId)
      if (!agent) return err('Agent not found')

      const abortController = new AbortController()
      activeRuns.set(runId, {
        abortController,
        confirmations: new Map()
      })

      const userMessage = messages[messages.length - 1]?.content ?? ''

      emitToRenderer(runId, {
        type: 'run-started',
        runId,
        timestamp: new Date().toISOString(),
        data: { agentId, agentName: agent.name }
      })

      if (agent.auditEnabled) {
        appendAuditLog({
          agentId,
          runId,
          eventType: 'run-started',
          outcome: 'success',
          payload: { userMessage: userMessage.slice(0, 200) }
        })
      }

      // Run agent asynchronously — return immediately so UI isn't blocked
      runAgent({ agent, messages, runId, abortController, agentId }).catch((runErr) => {
        console.error(`[runner] Run ${runId} failed:`, runErr)
        emitToRenderer(runId, {
          type: 'run-error',
          runId,
          timestamp: new Date().toISOString(),
          data: { error: String(runErr) }
        })
        activeRuns.delete(runId)
      })

      return ok({ runId, started: true })
    } catch (e) {
      return err(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.RUNNER_STOP, (_event, payload: RunnerStopPayload) => {
    const run = activeRuns.get(payload.runId)
    if (!run) return err('Run not found or already completed')

    run.abortController.abort()
    activeRuns.delete(payload.runId)
    return ok({ stopped: true })
  })

  ipcMain.handle(IPC_CHANNELS.RUNNER_CONFIRM, (_event, payload: RunnerConfirmPayload) => {
    const run = activeRuns.get(payload.runId)
    if (!run) return err('Run not found')

    const resolver = run.confirmations.get(payload.confirmationId)
    if (!resolver) return err('Confirmation not found')

    resolver(payload.decision)
    run.confirmations.delete(payload.confirmationId)
    return ok({ confirmed: true })
  })
}

// ── Agent execution engine ────────────────────────────────────────────────────

async function runAgent(params: {
  agent: import('@shared/schemas/agent.schema').AgentDefinition
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  runId: string
  agentId: string
  abortController: AbortController
}): Promise<void> {
  const { agent, messages, runId, agentId, abortController } = params

  try {
    emitToRenderer(runId, {
      type: 'node-started',
      runId,
      timestamp: new Date().toISOString(),
      nodeId: 'node-llm',
      data: {}
    })

    // Resolve API key (Ollama doesn't need one; all other providers do)
    let apiKey: string | null = null
    const providersWithoutKey = new Set(['ollama'])
    if (!providersWithoutKey.has(agent.provider.provider)) {
      const apiKeyRef = (agent.provider as { apiKeyRef?: string }).apiKeyRef ?? ''
      if (apiKeyRef) {
        apiKey = settingsRepo.getSecret(apiKeyRef)
      }
      if (!apiKey) {
        emitToRenderer(runId, {
          type: 'run-error',
          runId,
          timestamp: new Date().toISOString(),
          data: {
            error: `No API key found for ${agent.provider.provider}. Please add it in Settings → API Keys.`
          }
        })
        return
      }
    }

    if (agent.auditEnabled) {
      appendAuditLog({
        agentId,
        runId,
        eventType: 'llm-call',
        outcome: 'success',
        payload: {
          provider: agent.provider.provider,
          model: agent.provider.model,
          messageCount: messages.length
        }
      })
    }

    const model = buildModel(agent.provider, apiKey)

    const result = streamText({
      model,
      system: agent.systemPrompt || undefined,
      messages,
      maxTokens: agent.provider.maxTokens,
      temperature: agent.provider.temperature,
      abortSignal: abortController.signal
    })

    for await (const chunk of result.textStream) {
      if (abortController.signal.aborted) break
      emitToRenderer(runId, {
        type: 'llm-chunk',
        runId,
        timestamp: new Date().toISOString(),
        nodeId: 'node-llm',
        data: { chunk }
      })
    }

    emitToRenderer(runId, {
      type: 'node-completed',
      runId,
      timestamp: new Date().toISOString(),
      nodeId: 'node-llm',
      data: {}
    })

    emitToRenderer(runId, {
      type: 'run-completed',
      runId,
      timestamp: new Date().toISOString(),
      data: {}
    })

    if (agent.auditEnabled) {
      appendAuditLog({
        agentId,
        runId,
        eventType: 'run-completed',
        outcome: 'success'
      })
    }
  } catch (e) {
    const error = e as Error
    if (error.name === 'AbortError' || abortController.signal.aborted) {
      // Clean stop — emit run-completed so the UI unlocks
      emitToRenderer(runId, {
        type: 'run-completed',
        runId,
        timestamp: new Date().toISOString(),
        data: {}
      })
    } else {
      console.error('[runner] LLM error:', error)
      emitToRenderer(runId, {
        type: 'run-error',
        runId,
        timestamp: new Date().toISOString(),
        data: { error: error.message || String(error) }
      })
    }
  } finally {
    activeRuns.delete(runId)
  }
}
