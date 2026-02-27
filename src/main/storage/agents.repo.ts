import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'
import {
  AgentDefinition,
  AgentDefinitionSchema,
  createDefaultGraph
} from '@shared/schemas/agent.schema'
import { DEFAULT_TOOL_PERMISSIONS } from '@shared/schemas/tool.schema'
import { DEFAULT_PROVIDER } from '@shared/schemas/provider.schema'
import type { AgentSummary } from '@shared/types/ipc.types'

interface AgentRow {
  id: string
  version: number
  name: string
  description: string
  provider: string
  system_prompt: string
  graph: string
  code_blocks: string
  permissions: string
  tags: string
  audit_enabled: number
  created_at: string
  updated_at: string
}

function rowToAgent(row: AgentRow): AgentDefinition {
  const raw = {
    id: row.id,
    version: row.version as 1,
    name: row.name,
    description: row.description,
    provider: JSON.parse(row.provider),
    systemPrompt: row.system_prompt,
    graph: JSON.parse(row.graph),
    codeBlocks: JSON.parse(row.code_blocks),
    permissions: JSON.parse(row.permissions),
    tags: JSON.parse(row.tags),
    auditEnabled: row.audit_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  return AgentDefinitionSchema.parse(raw)
}

function agentToRow(
  agent: AgentDefinition
): Omit<AgentRow, 'created_at' | 'updated_at'> & { created_at: string; updated_at: string } {
  return {
    id: agent.id,
    version: agent.version,
    name: agent.name,
    description: agent.description,
    provider: JSON.stringify(agent.provider),
    system_prompt: agent.systemPrompt,
    graph: JSON.stringify(agent.graph),
    code_blocks: JSON.stringify(agent.codeBlocks),
    permissions: JSON.stringify(agent.permissions),
    tags: JSON.stringify(agent.tags),
    audit_enabled: agent.auditEnabled ? 1 : 0,
    created_at: agent.createdAt,
    updated_at: agent.updatedAt
  }
}

export function listAgents(): AgentSummary[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, name, description, provider, tags, created_at, updated_at, audit_enabled
       FROM agents ORDER BY updated_at DESC`
    )
    .all() as AgentRow[]

  return rows.map((row) => {
    const provider = JSON.parse(row.provider) as { provider: string; model: string }
    const permissions = JSON.parse(
      db.prepare('SELECT permissions FROM agents WHERE id = ?').get(row.id)
        ? (db.prepare('SELECT permissions FROM agents WHERE id = ?').get(row.id) as AgentRow)
            .permissions
        : '{}'
    ) as Record<string, { enabled: boolean }>

    const enabledToolCount = Object.values(permissions).filter((p) => p?.enabled).length

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      provider: provider.provider,
      model: provider.model,
      tags: JSON.parse(row.tags),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      enabledToolCount
    }
  })
}

export function getAgent(id: string): AgentDefinition | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
  if (!row) return null
  return rowToAgent(row)
}

export function createAgent(name: string, description = ''): AgentDefinition {
  const db = getDb()
  const now = new Date().toISOString()

  const agent: AgentDefinition = {
    id: uuidv4(),
    version: 1,
    name,
    description,
    provider: DEFAULT_PROVIDER,
    systemPrompt: 'You are a helpful AI assistant.',
    graph: createDefaultGraph(),
    codeBlocks: [],
    permissions: DEFAULT_TOOL_PERMISSIONS,
    tags: [],
    auditEnabled: true,
    createdAt: now,
    updatedAt: now
  }

  const row = agentToRow(agent)
  db.prepare(
    `INSERT INTO agents (id, version, name, description, provider, system_prompt, graph,
     code_blocks, permissions, tags, audit_enabled, created_at, updated_at)
     VALUES (@id, @version, @name, @description, @provider, @system_prompt, @graph,
     @code_blocks, @permissions, @tags, @audit_enabled, @created_at, @updated_at)`
  ).run(row)

  return agent
}

export function updateAgent(id: string, updates: Partial<AgentDefinition>): AgentDefinition {
  const db = getDb()
  const existing = getAgent(id)
  if (!existing) throw new Error(`Agent not found: ${id}`)

  const merged: AgentDefinition = {
    ...existing,
    ...updates,
    id, // id cannot be changed
    version: 1,
    updatedAt: new Date().toISOString()
  }

  // Validate the merged result
  AgentDefinitionSchema.parse(merged)

  const row = agentToRow(merged)
  db.prepare(
    `UPDATE agents SET
       version = @version, name = @name, description = @description,
       provider = @provider, system_prompt = @system_prompt, graph = @graph,
       code_blocks = @code_blocks, permissions = @permissions, tags = @tags,
       audit_enabled = @audit_enabled, updated_at = @updated_at
     WHERE id = @id`
  ).run(row)

  return merged
}

export function deleteAgent(id: string): void {
  const db = getDb()
  const info = db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  if (info.changes === 0) throw new Error(`Agent not found: ${id}`)
}

export function exportAgent(id: string): string {
  const agent = getAgent(id)
  if (!agent) throw new Error(`Agent not found: ${id}`)
  return JSON.stringify(agent, null, 2)
}

export function importAgent(json: string): AgentDefinition {
  const parsed = JSON.parse(json)
  // Validate and potentially fix schema
  const agent = AgentDefinitionSchema.parse({
    ...parsed,
    id: uuidv4(), // Always assign a new ID on import
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })

  const row = agentToRow(agent)
  const db = getDb()
  db.prepare(
    `INSERT INTO agents (id, version, name, description, provider, system_prompt, graph,
     code_blocks, permissions, tags, audit_enabled, created_at, updated_at)
     VALUES (@id, @version, @name, @description, @provider, @system_prompt, @graph,
     @code_blocks, @permissions, @tags, @audit_enabled, @created_at, @updated_at)`
  ).run(row)

  return agent
}
