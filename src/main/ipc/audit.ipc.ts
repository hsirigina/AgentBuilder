import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/types/ipc.types'
import * as auditRepo from '../storage/audit.repo'
import type { IpcResponse, AuditQueryPayload } from '@shared/types/ipc.types'

function ok<T>(data: T): IpcResponse<T> {
  return { ok: true, data }
}

function err(error: string): IpcResponse<never> {
  return { ok: false, error }
}

export function registerAuditIpc(): void {
  ipcMain.handle(IPC_CHANNELS.AUDIT_QUERY, (_event, params: AuditQueryPayload) => {
    try {
      const result = auditRepo.queryAuditLog(params)
      return ok(result)
    } catch (e) {
      return err(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUDIT_CLEAR, (_event, agentId?: string) => {
    try {
      auditRepo.clearAuditLog(agentId)
      return ok({ cleared: true })
    } catch (e) {
      return err(String(e))
    }
  })
}
