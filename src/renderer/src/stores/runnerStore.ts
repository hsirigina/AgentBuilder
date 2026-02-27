import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { v4 as uuidv4 } from 'uuid'
import type { RunnerEvent, ConfirmationRequest } from '@shared/types/ipc.types'
import { ipc, ipcCall } from '../lib/ipc-client'

export interface ConsoleEntry {
  id: string
  timestamp: string
  type: 'user' | 'assistant' | 'tool' | 'system' | 'error' | 'warning'
  content: string
  nodeId?: string
}

interface RunnerState {
  runId: string | null
  isRunning: boolean
  activeNodeId: string | null
  completedNodeIds: Set<string>
  errorNodeIds: Set<string>
  consoleEntries: ConsoleEntry[]
  pendingConfirmation: ConfirmationRequest | null
  streamingText: string

  // Actions
  startRun: (agentId: string, userMessage: string) => Promise<void>
  stopRun: () => Promise<void>
  handleEvent: (event: RunnerEvent) => void
  respondToConfirmation: (decision: 'allow-once' | 'allow-session' | 'deny') => Promise<void>
  clearConsole: () => void
}

export const useRunnerStore = create<RunnerState>()(
  immer((set, get) => ({
    runId: null,
    isRunning: false,
    activeNodeId: null,
    completedNodeIds: new Set(),
    errorNodeIds: new Set(),
    consoleEntries: [],
    pendingConfirmation: null,
    streamingText: '',

    startRun: async (agentId: string, userMessage: string) => {
      const runId = uuidv4()

      set((s) => {
        s.runId = runId
        s.isRunning = true
        s.activeNodeId = null
        s.completedNodeIds = new Set()
        s.errorNodeIds = new Set()
        s.streamingText = ''
        s.pendingConfirmation = null
        s.consoleEntries.push({
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          type: 'user',
          content: userMessage
        })
      })

      await ipcCall(ipc.runner.start({ agentId, userMessage, runId }))
    },

    stopRun: async () => {
      const { runId } = get()
      if (!runId) return

      try {
        await ipcCall(ipc.runner.stop(runId))
      } catch {
        // Ignore errors when stopping
      }

      set((s) => {
        s.isRunning = false
        s.activeNodeId = null
        s.consoleEntries.push({
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          type: 'system',
          content: 'Run stopped by user'
        })
      })
    },

    handleEvent: (event: RunnerEvent) => {
      set((s) => {
        switch (event.type) {
          case 'node-started':
            s.activeNodeId = event.nodeId ?? null
            break

          case 'node-completed':
            if (event.nodeId) {
              s.completedNodeIds.add(event.nodeId)
              if (s.activeNodeId === event.nodeId) {
                s.activeNodeId = null
              }
            }
            break

          case 'node-error':
            if (event.nodeId) {
              s.errorNodeIds.add(event.nodeId)
              s.activeNodeId = null
            }
            s.consoleEntries.push({
              id: uuidv4(),
              timestamp: event.timestamp,
              type: 'error',
              content: `Node error: ${JSON.stringify(event.data)}`,
              nodeId: event.nodeId
            })
            break

          case 'llm-chunk': {
            const chunk = (event.data as { chunk: string }).chunk
            s.streamingText += chunk
            // Update or add the streaming assistant entry
            const lastEntry = s.consoleEntries[s.consoleEntries.length - 1]
            if (lastEntry?.type === 'assistant' && lastEntry.nodeId === event.nodeId) {
              lastEntry.content = s.streamingText
            } else {
              s.consoleEntries.push({
                id: uuidv4(),
                timestamp: event.timestamp,
                type: 'assistant',
                content: s.streamingText,
                nodeId: event.nodeId
              })
            }
            break
          }

          case 'tool-call':
            s.consoleEntries.push({
              id: uuidv4(),
              timestamp: event.timestamp,
              type: 'tool',
              content: `Tool: ${JSON.stringify(event.data)}`,
              nodeId: event.nodeId
            })
            break

          case 'requires-confirmation':
            s.pendingConfirmation = event.data as ConfirmationRequest
            break

          case 'security-warning':
            s.consoleEntries.push({
              id: uuidv4(),
              timestamp: event.timestamp,
              type: 'warning',
              content: `Security: ${JSON.stringify(event.data)}`
            })
            break

          case 'run-completed':
            s.isRunning = false
            s.activeNodeId = null
            s.streamingText = ''
            break

          case 'run-error': {
            const errorData = event.data as { error: string }
            s.isRunning = false
            s.activeNodeId = null
            s.consoleEntries.push({
              id: uuidv4(),
              timestamp: event.timestamp,
              type: 'error',
              content: `Run failed: ${errorData.error}`
            })
            break
          }
        }
      })
    },

    respondToConfirmation: async (decision) => {
      const { runId, pendingConfirmation } = get()
      if (!runId || !pendingConfirmation) return

      set((s) => {
        s.consoleEntries.push({
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          type: 'system',
          content: `Action ${decision === 'deny' ? 'denied' : 'allowed'}: ${pendingConfirmation.action}`
        })
        s.pendingConfirmation = null
      })

      await ipcCall(
        ipc.runner.confirm({
          runId,
          confirmationId: pendingConfirmation.confirmationId,
          decision
        })
      )
    },

    clearConsole: () => {
      set((s) => {
        s.consoleEntries = []
        s.streamingText = ''
      })
    }
  }))
)
