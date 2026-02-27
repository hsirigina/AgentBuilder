import { ipcMain, BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { IPC_CHANNELS } from '@shared/types/ipc.types'
import * as agentsRepo from '../storage/agents.repo'
import { appendAuditLog } from '../storage/audit.repo'
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
    const { agentId, userMessage, runId } = payload

    try {
      const agent = agentsRepo.getAgent(agentId)
      if (!agent) return err('Agent not found')

      const abortController = new AbortController()
      activeRuns.set(runId, {
        abortController,
        confirmations: new Map()
      })

      // Emit run-started event immediately
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

      // Run agent asynchronously — don't await so we return immediately
      runAgent({ agent, userMessage, runId, abortController, agentId }).catch((runErr) => {
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
// This is a placeholder that will be fully implemented in Phase 3.
// For now it executes a simple linear flow.

async function runAgent(params: {
  agent: import('@shared/schemas/agent.schema').AgentDefinition
  userMessage: string
  runId: string
  agentId: string
  abortController: AbortController
}): Promise<void> {
  const { agent, userMessage, runId, agentId, abortController } = params

  try {
    // Phase 3 will implement full graph traversal.
    // For now, emit a placeholder run-completed event.
    emitToRenderer(runId, {
      type: 'node-started',
      runId,
      timestamp: new Date().toISOString(),
      nodeId: 'node-llm',
      data: { message: `Processing: ${userMessage}` }
    })

    if (abortController.signal.aborted) {
      throw new Error('Run aborted by user')
    }

    // Placeholder: echo the message back (real LLM integration in Phase 3)
    const responseText = `[Agent "${agent.name}" received your message. LLM integration coming in Phase 3.]\n\nYour message: ${userMessage}`

    // Stream the response character by character to demonstrate streaming
    for (const char of responseText) {
      if (abortController.signal.aborted) break
      emitToRenderer(runId, {
        type: 'llm-chunk',
        runId,
        timestamp: new Date().toISOString(),
        nodeId: 'node-llm',
        data: { chunk: char }
      })
      await new Promise((r) => setTimeout(r, 10))
    }

    emitToRenderer(runId, {
      type: 'node-completed',
      runId,
      timestamp: new Date().toISOString(),
      nodeId: 'node-llm',
      data: { outputVariable: 'llmResponse', value: responseText }
    })

    emitToRenderer(runId, {
      type: 'run-completed',
      runId,
      timestamp: new Date().toISOString(),
      data: { result: responseText }
    })

    if (agent.auditEnabled) {
      appendAuditLog({
        agentId,
        runId,
        eventType: 'run-completed',
        outcome: 'success'
      })
    }
  } finally {
    activeRuns.delete(runId)
  }
}
