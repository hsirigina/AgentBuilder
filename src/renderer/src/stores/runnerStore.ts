import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { v4 as uuidv4 } from 'uuid'
import type { RunnerEvent, ConfirmationRequest, ChatMessage } from '@shared/types/ipc.types'
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
  // Plain arrays instead of Set — avoids needing Immer's MapSet plugin
  completedNodeIds: string[]
  errorNodeIds: string[]
  consoleEntries: ConsoleEntry[]
  pendingConfirmation: ConfirmationRequest | null
  // ID of the currently-streaming assistant entry so we can find and update it
  streamingEntryId: string | null

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
    completedNodeIds: [],
    errorNodeIds: [],
    consoleEntries: [],
    pendingConfirmation: null,
    streamingEntryId: null,

    startRun: async (agentId: string, userMessage: string) => {
      const runId = uuidv4()

      set((s) => {
        s.runId = runId
        s.isRunning = true
        s.activeNodeId = null
        s.completedNodeIds = []
        s.errorNodeIds = []
        s.streamingEntryId = null
        s.pendingConfirmation = null
        s.consoleEntries.push({
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          type: 'user',
          content: userMessage
        })
      })

      // Build conversation history from all user/assistant entries (includes the new user message)
      const { consoleEntries } = get()
      const messages: ChatMessage[] = consoleEntries
        .filter((e) => e.type === 'user' || e.type === 'assistant')
        .map((e) => ({ role: e.type as 'user' | 'assistant', content: e.content }))

      try {
        await ipcCall(ipc.runner.start({ agentId, messages, runId }))
      } catch (e) {
        set((s) => {
          s.isRunning = false
          s.consoleEntries.push({
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            type: 'error',
            content: `Failed to start: ${String(e)}`
          })
        })
      }
    },

    stopRun: async () => {
      const { runId } = get()
      if (!runId) return

      try {
        await ipcCall(ipc.runner.stop(runId))
      } catch {
        // Ignore stop errors
      }

      set((s) => {
        s.isRunning = false
        s.activeNodeId = null
        s.streamingEntryId = null
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
          case 'run-started':
            s.consoleEntries.push({
              id: uuidv4(),
              timestamp: event.timestamp,
              type: 'system',
              content: 'Agent running...'
            })
            break

          case 'node-started':
            s.activeNodeId = event.nodeId ?? null
            break

          case 'node-completed':
            if (event.nodeId && !s.completedNodeIds.includes(event.nodeId)) {
              s.completedNodeIds.push(event.nodeId)
            }
            if (s.activeNodeId === event.nodeId) {
              s.activeNodeId = null
            }
            break

          case 'node-error':
            if (event.nodeId && !s.errorNodeIds.includes(event.nodeId)) {
              s.errorNodeIds.push(event.nodeId)
            }
            s.activeNodeId = null
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

            if (s.streamingEntryId) {
              // Find the existing streaming entry and append to it
              const idx = s.consoleEntries.findIndex((e) => e.id === s.streamingEntryId)
              if (idx >= 0) {
                s.consoleEntries[idx].content = s.consoleEntries[idx].content + chunk
                break
              }
            }

            // No streaming entry yet — create one
            const entryId = uuidv4()
            s.streamingEntryId = entryId
            s.consoleEntries.push({
              id: entryId,
              timestamp: event.timestamp,
              type: 'assistant',
              content: chunk,
              nodeId: event.nodeId
            })
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
            s.streamingEntryId = null
            break

          case 'run-error': {
            const errorData = event.data as { error: string }
            s.isRunning = false
            s.activeNodeId = null
            s.streamingEntryId = null
            s.consoleEntries.push({
              id: uuidv4(),
              timestamp: event.timestamp,
              type: 'error',
              content: `Error: ${errorData.error}`
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
        s.streamingEntryId = null
      })
    }
  }))
)
