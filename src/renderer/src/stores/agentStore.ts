import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { AgentDefinition } from '@shared/schemas/agent.schema'
import type { AgentSummary } from '@shared/types/ipc.types'
import { ipc, ipcCall } from '../lib/ipc-client'

interface AgentState {
  // List view
  summaries: AgentSummary[]
  summariesLoading: boolean
  summariesError: string | null

  // Editor state
  currentAgent: AgentDefinition | null
  currentAgentLoading: boolean
  currentAgentDirty: boolean

  // Actions
  loadSummaries: () => Promise<void>
  loadAgent: (id: string) => Promise<void>
  createAgent: (name: string, description?: string) => Promise<AgentDefinition>
  updateAgent: (id: string, updates: Partial<AgentDefinition>) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
  setCurrentAgent: (agent: AgentDefinition | null) => void
  patchCurrentAgent: (updates: Partial<AgentDefinition>) => void
  saveCurrentAgent: () => Promise<void>
}

export const useAgentStore = create<AgentState>()(
  immer((set, get) => ({
    summaries: [],
    summariesLoading: false,
    summariesError: null,
    currentAgent: null,
    currentAgentLoading: false,
    currentAgentDirty: false,

    loadSummaries: async () => {
      set((s) => {
        s.summariesLoading = true
        s.summariesError = null
      })
      try {
        const { agents } = await ipcCall(ipc.agents.list())
        set((s) => {
          s.summaries = agents
          s.summariesLoading = false
        })
      } catch (e) {
        set((s) => {
          s.summariesError = String(e)
          s.summariesLoading = false
        })
      }
    },

    loadAgent: async (id: string) => {
      set((s) => {
        s.currentAgentLoading = true
      })
      try {
        const { agent } = await ipcCall(ipc.agents.get(id))
        set((s) => {
          s.currentAgent = agent
          s.currentAgentLoading = false
          s.currentAgentDirty = false
        })
      } catch (e) {
        set((s) => {
          s.currentAgentLoading = false
        })
        throw e
      }
    },

    createAgent: async (name: string, description?: string) => {
      const { agent } = await ipcCall(ipc.agents.create({ name, description }))
      await get().loadSummaries()
      return agent
    },

    updateAgent: async (id: string, updates: Partial<AgentDefinition>) => {
      await ipcCall(ipc.agents.update({ id, updates }))
      // Refresh summaries list
      await get().loadSummaries()
      // If this is the current agent, update it too
      if (get().currentAgent?.id === id) {
        await get().loadAgent(id)
      }
    },

    deleteAgent: async (id: string) => {
      await ipcCall(ipc.agents.delete(id))
      if (get().currentAgent?.id === id) {
        set((s) => {
          s.currentAgent = null
        })
      }
      await get().loadSummaries()
    },

    setCurrentAgent: (agent) => {
      set((s) => {
        s.currentAgent = agent
        s.currentAgentDirty = false
      })
    },

    patchCurrentAgent: (updates) => {
      set((s) => {
        if (!s.currentAgent) return
        Object.assign(s.currentAgent, updates)
        s.currentAgentDirty = true
      })
    },

    saveCurrentAgent: async () => {
      const { currentAgent } = get()
      if (!currentAgent) return
      await ipcCall(ipc.agents.update({ id: currentAgent.id, updates: currentAgent }))
      set((s) => {
        s.currentAgentDirty = false
      })
    }
  }))
)
