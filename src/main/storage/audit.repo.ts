import { getDb } from './db'
import type { AuditEntry, AuditQueryPayload, AuditQueryResponse } from '@shared/types/ipc.types'

export interface AuditLogEntry {
  agentId: string
  runId: string
  eventType: string
  tool?: string
  payload?: unknown
  outcome: 'success' | 'denied' | 'error'
  error?: string
}

export function appendAuditLog(entry: AuditLogEntry): void {
  const db = getDb()
  // Serialize payload to JSON, truncate if too large
  let payloadStr: string | undefined
  if (entry.payload !== undefined) {
    try {
      payloadStr = JSON.stringify(entry.payload)
      if (payloadStr.length > 10_000) {
        payloadStr = payloadStr.slice(0, 10_000) + '...[truncated]'
      }
    } catch {
      payloadStr = '[non-serializable]'
    }
  }

  db.prepare(
    `INSERT INTO audit_log (agent_id, run_id, event_type, tool, payload, outcome, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.agentId,
    entry.runId,
    entry.eventType,
    entry.tool ?? null,
    payloadStr ?? null,
    entry.outcome,
    entry.error ?? null
  )
}

export function queryAuditLog(params: AuditQueryPayload): AuditQueryResponse {
  const db = getDb()
  const conditions: string[] = []
  const args: unknown[] = []

  if (params.agentId) {
    conditions.push('agent_id = ?')
    args.push(params.agentId)
  }
  if (params.runId) {
    conditions.push('run_id = ?')
    args.push(params.runId)
  }
  if (params.fromDate) {
    conditions.push('ts >= ?')
    args.push(params.fromDate)
  }
  if (params.toDate) {
    conditions.push('ts <= ?')
    args.push(params.toDate)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = params.limit ?? 100
  const offset = params.offset ?? 0

  const total = (
    db.prepare(`SELECT COUNT(*) as n FROM audit_log ${where}`).get(...args) as { n: number }
  ).n

  const rows = db
    .prepare(
      `SELECT id, ts, agent_id, run_id, event_type, tool, payload, outcome, error
       FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset) as Array<{
    id: number
    ts: string
    agent_id: string
    run_id: string
    event_type: string
    tool: string | null
    payload: string | null
    outcome: string
    error: string | null
  }>

  const entries: AuditEntry[] = rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    agentId: r.agent_id,
    runId: r.run_id,
    eventType: r.event_type,
    tool: r.tool ?? undefined,
    payload: r.payload ?? undefined,
    outcome: r.outcome as 'success' | 'denied' | 'error',
    error: r.error ?? undefined
  }))

  return { entries, total }
}

export function clearAuditLog(agentId?: string): void {
  const db = getDb()
  if (agentId) {
    db.prepare('DELETE FROM audit_log WHERE agent_id = ?').run(agentId)
  } else {
    db.prepare('DELETE FROM audit_log').run()
  }
}

export function pruneAuditLog(retentionDays: number): void {
  const db = getDb()
  db.prepare(`DELETE FROM audit_log WHERE ts < datetime('now', '-${retentionDays} days')`).run()
}
