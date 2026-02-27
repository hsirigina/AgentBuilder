import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/types/ipc.types'
import * as agentsRepo from '../storage/agents.repo'
import type { IpcResponse } from '@shared/types/ipc.types'

function ok<T>(data: T): IpcResponse<T> {
  return { ok: true, data }
}

function err(error: string, code?: string): IpcResponse<never> {
  return { ok: false, error, code }
}

export function registerAgentsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.AGENTS_LIST, () => {
    try {
      const agents = agentsRepo.listAgents()
      return ok({ agents })
    } catch (e) {
      return err(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AGENTS_GET, (_event, id: string) => {
    try {
      const agent = agentsRepo.getAgent(id)
      if (!agent) return err('Agent not found', 'NOT_FOUND')
      return ok({ agent })
    } catch (e) {
      return err(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AGENTS_CREATE, (_event, payload: { name: string; description?: string }) => {
    try {
      const agent = agentsRepo.createAgent(payload.name, payload.description)
      return ok({ agent })
    } catch (e) {
      return err(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AGENTS_UPDATE, (_event, payload: { id: string; updates: object }) => {
    try {
      const agent = agentsRepo.updateAgent(payload.id, payload.updates)
      return ok({ agent })
    } catch (e) {
      return err(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AGENTS_DELETE, (_event, payload: { id: string }) => {
    try {
      agentsRepo.deleteAgent(payload.id)
      return ok({ deleted: true })
    } catch (e) {
      return err(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AGENTS_EXPORT, (_event, id: string) => {
    try {
      const json = agentsRepo.exportAgent(id)
      return ok({ json })
    } catch (e) {
      return err(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AGENTS_IMPORT, (_event, json: string) => {
    try {
      const agent = agentsRepo.importAgent(json)
      return ok({ agent })
    } catch (e) {
      return err(String(e))
    }
  })
}
