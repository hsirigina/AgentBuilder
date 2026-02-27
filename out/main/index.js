"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const Database = require("better-sqlite3");
const fs = require("fs");
const uuid = require("uuid");
const zod = require("zod");
let db = null;
const MIGRATIONS = [
  // Migration 1: initial schema
  `
  CREATE TABLE IF NOT EXISTS agents (
    id         TEXT PRIMARY KEY,
    version    INTEGER NOT NULL DEFAULT 1,
    name       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    provider   TEXT NOT NULL,  -- JSON: ProviderConfig
    system_prompt TEXT NOT NULL DEFAULT '',
    graph      TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}', -- JSON: graph
    code_blocks TEXT NOT NULL DEFAULT '[]',  -- JSON: CodeBlock[]
    permissions TEXT NOT NULL DEFAULT '{}',  -- JSON: ToolPermissions
    tags       TEXT NOT NULL DEFAULT '[]',   -- JSON: string[]
    audit_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL  -- JSON encoded value
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT NOT NULL DEFAULT (datetime('now','utc')),
    agent_id   TEXT NOT NULL,
    run_id     TEXT NOT NULL,
    event_type TEXT NOT NULL,
    tool       TEXT,
    payload    TEXT,    -- JSON, secrets redacted before storing
    outcome    TEXT NOT NULL DEFAULT 'success',
    error      TEXT
  );

  -- Index for common audit log queries
  CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id);
  CREATE INDEX IF NOT EXISTS idx_audit_run   ON audit_log(run_id);
  CREATE INDEX IF NOT EXISTS idx_audit_ts    ON audit_log(ts);
  `
];
function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}
function initDb() {
  const userDataPath = electron.app.getPath("userData");
  const dbDir = path.join(userDataPath, "data");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = path.join(dbDir, "agentbuilder.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("secure_delete = ON");
  runMigrations(db);
  return db;
}
function runMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now','utc'))
    )
  `);
  const getVersion = database.prepare("SELECT MAX(version) as v FROM schema_migrations");
  const result = getVersion.get();
  const currentVersion = result.v ?? 0;
  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    const migrationVersion = i + 1;
    database.transaction(() => {
      database.exec(MIGRATIONS[i]);
      database.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(migrationVersion);
    })();
    console.log(`[db] Applied migration ${migrationVersion}`);
  }
}
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
const IPC_CHANNELS = {
  // Agent CRUD
  AGENTS_LIST: "agents:list",
  AGENTS_GET: "agents:get",
  AGENTS_CREATE: "agents:create",
  AGENTS_UPDATE: "agents:update",
  AGENTS_DELETE: "agents:delete",
  AGENTS_EXPORT: "agents:export",
  AGENTS_IMPORT: "agents:import",
  // Agent runner
  RUNNER_START: "runner:start",
  RUNNER_STOP: "runner:stop",
  RUNNER_EVENT: "runner:event",
  // main → renderer (pushed events)
  RUNNER_CONFIRM: "runner:confirm",
  // renderer → main (user confirmation response)
  // Settings
  SETTINGS_GET: "settings:get",
  SETTINGS_SET: "settings:set",
  SETTINGS_GET_SECRET: "settings:getSecret",
  SETTINGS_SET_SECRET: "settings:setSecret",
  SETTINGS_DELETE_SECRET: "settings:deleteSecret",
  SETTINGS_LIST_SECRET_KEYS: "settings:listSecretKeys",
  SETTINGS_TEST_PROVIDER: "settings:testProvider",
  // Audit log
  AUDIT_QUERY: "audit:query",
  AUDIT_CLEAR: "audit:clear"
};
const AnthropicProviderSchema = zod.z.object({
  provider: zod.z.literal("anthropic"),
  model: zod.z.string().default("claude-opus-4-6"),
  apiKeyRef: zod.z.string().min(1, "API key reference is required"),
  maxTokens: zod.z.number().int().positive().default(4096),
  temperature: zod.z.number().min(0).max(1).default(0.7)
});
const OpenAIProviderSchema = zod.z.object({
  provider: zod.z.literal("openai"),
  model: zod.z.string().default("gpt-4o"),
  apiKeyRef: zod.z.string().min(1, "API key reference is required"),
  baseUrl: zod.z.string().url().optional(),
  // For Azure or custom OpenAI endpoints
  maxTokens: zod.z.number().int().positive().default(4096),
  temperature: zod.z.number().min(0).max(1).default(0.7)
});
const OllamaProviderSchema = zod.z.object({
  provider: zod.z.literal("ollama"),
  model: zod.z.string().default("llama3.2"),
  baseUrl: zod.z.string().url().default("http://localhost:11434"),
  maxTokens: zod.z.number().int().positive().default(4096),
  temperature: zod.z.number().min(0).max(1).default(0.7)
});
const CustomProviderSchema = zod.z.object({
  provider: zod.z.literal("custom"),
  model: zod.z.string().min(1),
  baseUrl: zod.z.string().url(),
  apiKeyRef: zod.z.string().optional(),
  headers: zod.z.record(zod.z.string()).optional(),
  maxTokens: zod.z.number().int().positive().default(4096),
  temperature: zod.z.number().min(0).max(1).default(0.7)
});
const ProviderConfigSchema = zod.z.discriminatedUnion("provider", [
  AnthropicProviderSchema,
  OpenAIProviderSchema,
  OllamaProviderSchema,
  CustomProviderSchema
]);
const DEFAULT_PROVIDER = {
  provider: "anthropic",
  model: "claude-opus-4-6",
  apiKeyRef: "",
  maxTokens: 4096,
  temperature: 0.7
};
const FileSystemPermissionSchema = zod.z.object({
  enabled: zod.z.boolean().default(false),
  access: zod.z.enum(["read", "read-write"]).default("read"),
  // Glob patterns for allowed paths, e.g. ["/home/user/docs/**", "/tmp/agent-*"]
  allowedPaths: zod.z.array(zod.z.string()).default([]),
  // Glob patterns that override allowedPaths (deny wins)
  deniedPaths: zod.z.array(zod.z.string()).default([]),
  maxFileSizeBytes: zod.z.number().int().positive().default(10 * 1024 * 1024)
  // 10 MB
});
const HttpPermissionSchema = zod.z.object({
  enabled: zod.z.boolean().default(false),
  // Micromatch glob patterns, e.g. ["api.github.com", "*.example.com"]
  allowedDomains: zod.z.array(zod.z.string()).default([]),
  blockedDomains: zod.z.array(zod.z.string()).default([]),
  allowedMethods: zod.z.array(zod.z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])).default(["GET"]),
  rateLimitPerMinute: zod.z.number().int().positive().default(30),
  timeoutMs: zod.z.number().int().positive().default(1e4),
  followRedirects: zod.z.boolean().default(true),
  maxResponseBytes: zod.z.number().int().positive().default(5 * 1024 * 1024)
  // 5 MB
});
const ShellPermissionSchema = zod.z.object({
  enabled: zod.z.boolean().default(false),
  // Exact binary names only — "git" allows "git status" but not "gitt"
  allowedCommands: zod.z.array(zod.z.string()).default([]),
  // Regex patterns matched against the full command string
  blockedPatterns: zod.z.array(zod.z.string()).default(["rm\\s+-rf", "sudo", "> /dev", "chmod 777", "curl.*\\|.*sh"]),
  workingDirectory: zod.z.string().optional(),
  timeoutMs: zod.z.number().int().positive().default(3e4),
  // Always true by default — shell commands always need user confirmation
  requiresConfirmation: zod.z.boolean().default(true),
  // Extra env vars injected (only these + PATH and HOME from system)
  env: zod.z.record(zod.z.string()).default({})
});
const CodeExecPermissionSchema = zod.z.object({
  enabled: zod.z.boolean().default(false),
  memoryLimitMb: zod.z.number().int().positive().default(128),
  timeLimitMs: zod.z.number().int().positive().default(1e4),
  // If false, ctx.http inside code blocks throws immediately
  networkAccess: zod.z.boolean().default(false),
  // npm package names pre-bundled into the safe stdlib available in sandboxes
  allowedModules: zod.z.array(zod.z.string()).default([])
});
const ToolPermissionsSchema = zod.z.object({
  filesystem: FileSystemPermissionSchema.default({}),
  http: HttpPermissionSchema.default({}),
  shell: ShellPermissionSchema.default({}),
  codeExec: CodeExecPermissionSchema.default({})
});
const DEFAULT_TOOL_PERMISSIONS = {
  filesystem: {
    enabled: false,
    access: "read",
    allowedPaths: [],
    deniedPaths: [],
    maxFileSizeBytes: 10 * 1024 * 1024
  },
  http: {
    enabled: false,
    allowedDomains: [],
    blockedDomains: [],
    allowedMethods: ["GET"],
    rateLimitPerMinute: 30,
    timeoutMs: 1e4,
    followRedirects: true,
    maxResponseBytes: 5 * 1024 * 1024
  },
  shell: {
    enabled: false,
    allowedCommands: [],
    blockedPatterns: ["rm\\s+-rf", "sudo", "> /dev", "chmod 777", "curl.*\\|.*sh"],
    workingDirectory: void 0,
    timeoutMs: 3e4,
    requiresConfirmation: true,
    env: {}
  },
  codeExec: {
    enabled: false,
    memoryLimitMb: 128,
    timeLimitMs: 1e4,
    networkAccess: false,
    allowedModules: []
  }
};
const DEFAULT_CODE_BLOCK_TEMPLATE = `import { z } from 'zod'

// Define the input schema for this code block
const inputSchema = z.object({
  // Add your input fields here
  message: z.string()
})

// BlockContext provides access to safe, permission-checked sub-tools
export default async function run(
  input: z.infer<typeof inputSchema>,
  ctx: BlockContext
): Promise<{ result: string }> {
  // ctx.log() - log messages to the console
  // ctx.http.get(url) - make HTTP requests (requires http permission)
  // ctx.fs.readFile(path) - read files (requires filesystem permission)
  // ctx.shell.exec(cmd, args) - run shell commands (requires shell permission)

  ctx.log('Running code block with input:', input)

  return {
    result: \`Processed: \${input.message}\`
  }
}
`;
const NodeTypeSchema = zod.z.enum([
  "input",
  // Entry point — receives user message
  "output",
  // Terminal — final response
  "llm-call",
  // LLM inference step
  "tool-call",
  // Built-in tool invocation (filesystem, http, shell)
  "code-block",
  // Custom TypeScript code block
  "condition",
  // Branch on a JS expression
  "transform"
  // Data mapper / transformation
]);
const GraphNodeSchema = zod.z.object({
  id: zod.z.string(),
  type: NodeTypeSchema,
  position: zod.z.object({ x: zod.z.number(), y: zod.z.number() }),
  // Type-specific payload — each node type has its own data shape
  data: zod.z.record(zod.z.unknown())
});
const GraphEdgeSchema = zod.z.object({
  id: zod.z.string(),
  source: zod.z.string(),
  sourceHandle: zod.z.string().optional(),
  target: zod.z.string(),
  targetHandle: zod.z.string().optional(),
  label: zod.z.string().optional()
});
zod.z.object({
  variableName: zod.z.string().default("userMessage"),
  description: zod.z.string().default("User input")
});
zod.z.object({
  // Template string with {{varName}} interpolation
  template: zod.z.string().default("{{llmResponse}}")
});
zod.z.object({
  providerOverride: ProviderConfigSchema.optional(),
  systemPromptOverride: zod.z.string().optional(),
  inputBindings: zod.z.record(zod.z.string()).default({}),
  outputVariable: zod.z.string().default("llmResponse"),
  streaming: zod.z.boolean().default(true)
});
zod.z.object({
  toolName: zod.z.enum(["filesystem", "http", "shell"]),
  params: zod.z.record(zod.z.unknown()).default({}),
  outputVariable: zod.z.string().default("toolResult"),
  requiresConfirmation: zod.z.boolean().default(true)
});
zod.z.object({
  codeBlockId: zod.z.string(),
  inputBindings: zod.z.record(zod.z.string()).default({}),
  outputVariable: zod.z.string().default("blockResult")
});
zod.z.object({
  // Safe JS expression evaluated against graph scope variables
  expression: zod.z.string().default("true"),
  trueLabel: zod.z.string().default("Yes"),
  falseLabel: zod.z.string().default("No")
});
zod.z.object({
  // JS expression mapping input to output; has access to scope variables
  expression: zod.z.string().default("input"),
  inputVariable: zod.z.string(),
  outputVariable: zod.z.string()
});
const CodeBlockSchema = zod.z.object({
  id: zod.z.string().uuid(),
  name: zod.z.string().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Name must be a valid identifier"),
  description: zod.z.string().max(512).default(""),
  // Full TypeScript source. Must export: default async function run(input, ctx)
  code: zod.z.string().default(DEFAULT_CODE_BLOCK_TEMPLATE),
  // Stringified Zod schema for input validation (e.g., "z.object({ url: z.string() })")
  inputSchema: zod.z.string().default("z.object({})"),
  // Position in node graph canvas
  graphPosition: zod.z.object({ x: zod.z.number(), y: zod.z.number() }).optional(),
  createdAt: zod.z.string().datetime(),
  updatedAt: zod.z.string().datetime()
});
const AgentDefinitionSchema = zod.z.object({
  id: zod.z.string().uuid(),
  version: zod.z.literal(1),
  name: zod.z.string().min(1).max(128),
  description: zod.z.string().max(1024).default(""),
  createdAt: zod.z.string().datetime(),
  updatedAt: zod.z.string().datetime(),
  // Which LLM provider and model this agent uses
  provider: ProviderConfigSchema,
  // System prompt with {{variable}} interpolation support
  systemPrompt: zod.z.string().default("You are a helpful AI assistant."),
  // Node graph topology
  graph: zod.z.object({
    nodes: zod.z.array(GraphNodeSchema).default([]),
    edges: zod.z.array(GraphEdgeSchema).default([])
  }),
  // Custom TypeScript code blocks that become agent tools
  codeBlocks: zod.z.array(CodeBlockSchema).default([]),
  // Per-tool permission configuration (all disabled by default)
  permissions: ToolPermissionsSchema.default({}),
  // Tags for filtering / organization
  tags: zod.z.array(zod.z.string()).default([]),
  // Whether to record audit logs for this agent's runs
  auditEnabled: zod.z.boolean().default(true)
});
function createDefaultGraph() {
  return {
    nodes: [
      {
        id: "node-input",
        type: "input",
        position: { x: 100, y: 200 },
        data: { variableName: "userMessage", description: "User input" }
      },
      {
        id: "node-llm",
        type: "llm-call",
        position: { x: 350, y: 200 },
        data: {
          inputBindings: { userMessage: "{{userMessage}}" },
          outputVariable: "llmResponse",
          streaming: true
        }
      },
      {
        id: "node-output",
        type: "output",
        position: { x: 600, y: 200 },
        data: { template: "{{llmResponse}}" }
      }
    ],
    edges: [
      {
        id: "edge-1",
        source: "node-input",
        sourceHandle: "handle-out",
        target: "node-llm",
        targetHandle: "handle-in"
      },
      {
        id: "edge-2",
        source: "node-llm",
        sourceHandle: "handle-out",
        target: "node-output",
        targetHandle: "handle-in"
      }
    ]
  };
}
function rowToAgent(row) {
  const raw = {
    id: row.id,
    version: row.version,
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
  };
  return AgentDefinitionSchema.parse(raw);
}
function agentToRow(agent) {
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
  };
}
function listAgents() {
  const db2 = getDb();
  const rows = db2.prepare(
    `SELECT id, name, description, provider, tags, created_at, updated_at, audit_enabled
       FROM agents ORDER BY updated_at DESC`
  ).all();
  return rows.map((row) => {
    const provider = JSON.parse(row.provider);
    const permissions = JSON.parse(
      db2.prepare("SELECT permissions FROM agents WHERE id = ?").get(row.id) ? db2.prepare("SELECT permissions FROM agents WHERE id = ?").get(row.id).permissions : "{}"
    );
    const enabledToolCount = Object.values(permissions).filter((p) => p?.enabled).length;
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
    };
  });
}
function getAgent(id) {
  const db2 = getDb();
  const row = db2.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  if (!row) return null;
  return rowToAgent(row);
}
function createAgent(name, description = "") {
  const db2 = getDb();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const agent = {
    id: uuid.v4(),
    version: 1,
    name,
    description,
    provider: DEFAULT_PROVIDER,
    systemPrompt: "You are a helpful AI assistant.",
    graph: createDefaultGraph(),
    codeBlocks: [],
    permissions: DEFAULT_TOOL_PERMISSIONS,
    tags: [],
    auditEnabled: true,
    createdAt: now,
    updatedAt: now
  };
  const row = agentToRow(agent);
  db2.prepare(
    `INSERT INTO agents (id, version, name, description, provider, system_prompt, graph,
     code_blocks, permissions, tags, audit_enabled, created_at, updated_at)
     VALUES (@id, @version, @name, @description, @provider, @system_prompt, @graph,
     @code_blocks, @permissions, @tags, @audit_enabled, @created_at, @updated_at)`
  ).run(row);
  return agent;
}
function updateAgent(id, updates) {
  const db2 = getDb();
  const existing = getAgent(id);
  if (!existing) throw new Error(`Agent not found: ${id}`);
  const merged = {
    ...existing,
    ...updates,
    id,
    // id cannot be changed
    version: 1,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  AgentDefinitionSchema.parse(merged);
  const row = agentToRow(merged);
  db2.prepare(
    `UPDATE agents SET
       version = @version, name = @name, description = @description,
       provider = @provider, system_prompt = @system_prompt, graph = @graph,
       code_blocks = @code_blocks, permissions = @permissions, tags = @tags,
       audit_enabled = @audit_enabled, updated_at = @updated_at
     WHERE id = @id`
  ).run(row);
  return merged;
}
function deleteAgent(id) {
  const db2 = getDb();
  const info = db2.prepare("DELETE FROM agents WHERE id = ?").run(id);
  if (info.changes === 0) throw new Error(`Agent not found: ${id}`);
}
function exportAgent(id) {
  const agent = getAgent(id);
  if (!agent) throw new Error(`Agent not found: ${id}`);
  return JSON.stringify(agent, null, 2);
}
function importAgent(json) {
  const parsed = JSON.parse(json);
  const agent = AgentDefinitionSchema.parse({
    ...parsed,
    id: uuid.v4(),
    // Always assign a new ID on import
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  const row = agentToRow(agent);
  const db2 = getDb();
  db2.prepare(
    `INSERT INTO agents (id, version, name, description, provider, system_prompt, graph,
     code_blocks, permissions, tags, audit_enabled, created_at, updated_at)
     VALUES (@id, @version, @name, @description, @provider, @system_prompt, @graph,
     @code_blocks, @permissions, @tags, @audit_enabled, @created_at, @updated_at)`
  ).run(row);
  return agent;
}
function ok$3(data) {
  return { ok: true, data };
}
function err$3(error, code) {
  return { ok: false, error, code };
}
function registerAgentsIpc() {
  electron.ipcMain.handle(IPC_CHANNELS.AGENTS_LIST, () => {
    try {
      const agents = listAgents();
      return ok$3({ agents });
    } catch (e) {
      return err$3(String(e));
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.AGENTS_GET, (_event, id) => {
    try {
      const agent = getAgent(id);
      if (!agent) return err$3("Agent not found", "NOT_FOUND");
      return ok$3({ agent });
    } catch (e) {
      return err$3(String(e));
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.AGENTS_CREATE, (_event, payload) => {
    try {
      const agent = createAgent(payload.name, payload.description);
      return ok$3({ agent });
    } catch (e) {
      return err$3(String(e));
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.AGENTS_UPDATE, (_event, payload) => {
    try {
      const agent = updateAgent(payload.id, payload.updates);
      return ok$3({ agent });
    } catch (e) {
      return err$3(String(e));
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.AGENTS_DELETE, (_event, payload) => {
    try {
      deleteAgent(payload.id);
      return ok$3({ deleted: true });
    } catch (e) {
      return err$3(String(e));
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.AGENTS_EXPORT, (_event, id) => {
    try {
      const json = exportAgent(id);
      return ok$3({ json });
    } catch (e) {
      return err$3(String(e));
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.AGENTS_IMPORT, (_event, json) => {
    try {
      const agent = importAgent(json);
      return ok$3({ agent });
    } catch (e) {
      return err$3(String(e));
    }
  });
}
const SECRET_PREFIX = "secret:";
const DEFAULT_SETTINGS = {
  theme: "system",
  defaultProvider: "anthropic",
  auditRetentionDays: 30,
  confirmDestructiveActions: true
};
function dbGet(key) {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row?.value ?? null;
}
function dbSet(key, value) {
  getDb().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}
function dbDelete(key) {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}
function getSettings() {
  const stored = dbGet("app_settings");
  if (!stored) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
function setSetting(key, value) {
  const current = getSettings();
  dbSet("app_settings", JSON.stringify({ ...current, [key]: value }));
}
function setSecret(key, value) {
  if (!electron.safeStorage.isEncryptionAvailable()) {
    console.warn("[settings] safeStorage unavailable — storing API key without encryption");
    dbSet(SECRET_PREFIX + key, "PLAIN:" + value);
    return;
  }
  const encrypted = electron.safeStorage.encryptString(value);
  dbSet(SECRET_PREFIX + key, encrypted.toString("base64"));
}
function getSecret(key) {
  const stored = dbGet(SECRET_PREFIX + key);
  if (!stored) return null;
  if (stored.startsWith("PLAIN:")) {
    return stored.slice(6);
  }
  if (!electron.safeStorage.isEncryptionAvailable()) {
    console.warn("[settings] safeStorage unavailable — cannot decrypt secret");
    return null;
  }
  try {
    const buf = Buffer.from(stored, "base64");
    return electron.safeStorage.decryptString(buf);
  } catch {
    console.error(`[settings] Failed to decrypt secret: ${key}`);
    return null;
  }
}
function deleteSecret(key) {
  dbDelete(SECRET_PREFIX + key);
}
function listSecretKeys() {
  const rows = getDb().prepare("SELECT key FROM settings WHERE key LIKE ?").all(SECRET_PREFIX + "%");
  return rows.map((r) => r.key.slice(SECRET_PREFIX.length));
}
function ok$2(data) {
  return { ok: true, data };
}
function err$2(error) {
  return { ok: false, error };
}
function registerSettingsIpc() {
  electron.ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    try {
      const settings = getSettings();
      return ok$2({ settings });
    } catch (e) {
      return err$2(String(e));
    }
  });
  electron.ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET,
    (_event, payload) => {
      try {
        setSetting(payload.key, payload.value);
        return ok$2({ updated: true });
      } catch (e) {
        return err$2(String(e));
      }
    }
  );
  electron.ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_SECRET, (_event, key) => {
    try {
      const value = getSecret(key);
      return ok$2({ exists: value !== null });
    } catch (e) {
      return err$2(String(e));
    }
  });
  electron.ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET_SECRET,
    (_event, payload) => {
      try {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(payload.key)) {
          return err$2("Invalid secret key name");
        }
        setSecret(payload.key, payload.value);
        return ok$2({ saved: true });
      } catch (e) {
        return err$2(String(e));
      }
    }
  );
  electron.ipcMain.handle(IPC_CHANNELS.SETTINGS_DELETE_SECRET, (_event, key) => {
    try {
      deleteSecret(key);
      return ok$2({ deleted: true });
    } catch (e) {
      return err$2(String(e));
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.SETTINGS_LIST_SECRET_KEYS, () => {
    try {
      const keys = listSecretKeys();
      return ok$2({ keys });
    } catch (e) {
      return err$2(String(e));
    }
  });
  electron.ipcMain.handle(
    IPC_CHANNELS.SETTINGS_TEST_PROVIDER,
    async (_event, payload) => {
      try {
        const startTime = Date.now();
        const apiKey = getSecret(payload.apiKeyRef);
        if (!apiKey) {
          return ok$2({
            success: false,
            error: "API key not found. Please save your API key first."
          });
        }
        if (payload.provider === "anthropic") {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json"
            },
            body: JSON.stringify({
              model: payload.model || "claude-haiku-4-5-20251001",
              max_tokens: 1,
              messages: [{ role: "user", content: "Hi" }]
            })
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            return ok$2({
              success: false,
              error: body.error?.message || `HTTP ${response.status}`
            });
          }
        } else if (payload.provider === "openai") {
          const response = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` }
          });
          if (!response.ok) {
            return ok$2({
              success: false,
              error: `HTTP ${response.status}`
            });
          }
        } else if (payload.provider === "ollama") {
          const response = await fetch("http://localhost:11434/api/tags").catch(
            () => null
          );
          if (!response || !response.ok) {
            return ok$2({
              success: false,
              error: "Could not connect to Ollama. Is it running on localhost:11434?"
            });
          }
        }
        return ok$2({
          success: true,
          latencyMs: Date.now() - startTime
        });
      } catch (e) {
        return ok$2({ success: false, error: String(e) });
      }
    }
  );
}
function appendAuditLog(entry) {
  const db2 = getDb();
  let payloadStr;
  if (entry.payload !== void 0) {
    try {
      payloadStr = JSON.stringify(entry.payload);
      if (payloadStr.length > 1e4) {
        payloadStr = payloadStr.slice(0, 1e4) + "...[truncated]";
      }
    } catch {
      payloadStr = "[non-serializable]";
    }
  }
  db2.prepare(
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
  );
}
function queryAuditLog(params) {
  const db2 = getDb();
  const conditions = [];
  const args = [];
  if (params.agentId) {
    conditions.push("agent_id = ?");
    args.push(params.agentId);
  }
  if (params.runId) {
    conditions.push("run_id = ?");
    args.push(params.runId);
  }
  if (params.fromDate) {
    conditions.push("ts >= ?");
    args.push(params.fromDate);
  }
  if (params.toDate) {
    conditions.push("ts <= ?");
    args.push(params.toDate);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;
  const total = db2.prepare(`SELECT COUNT(*) as n FROM audit_log ${where}`).get(...args).n;
  const rows = db2.prepare(
    `SELECT id, ts, agent_id, run_id, event_type, tool, payload, outcome, error
       FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...args, limit, offset);
  const entries = rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    agentId: r.agent_id,
    runId: r.run_id,
    eventType: r.event_type,
    tool: r.tool ?? void 0,
    payload: r.payload ?? void 0,
    outcome: r.outcome,
    error: r.error ?? void 0
  }));
  return { entries, total };
}
function clearAuditLog(agentId) {
  const db2 = getDb();
  if (agentId) {
    db2.prepare("DELETE FROM audit_log WHERE agent_id = ?").run(agentId);
  } else {
    db2.prepare("DELETE FROM audit_log").run();
  }
}
function ok$1(data) {
  return { ok: true, data };
}
function err$1(error) {
  return { ok: false, error };
}
const activeRuns = /* @__PURE__ */ new Map();
function emitToRenderer(runId, event) {
  const windows = electron.BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.RUNNER_EVENT, event);
    }
  }
}
function registerRunnerIpc() {
  electron.ipcMain.handle(IPC_CHANNELS.RUNNER_START, async (_event, payload) => {
    const { agentId, userMessage, runId } = payload;
    try {
      const agent = getAgent(agentId);
      if (!agent) return err$1("Agent not found");
      const abortController = new AbortController();
      activeRuns.set(runId, {
        abortController,
        confirmations: /* @__PURE__ */ new Map()
      });
      emitToRenderer(runId, {
        type: "run-started",
        runId,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        data: { agentId, agentName: agent.name }
      });
      if (agent.auditEnabled) {
        appendAuditLog({
          agentId,
          runId,
          eventType: "run-started",
          outcome: "success",
          payload: { userMessage: userMessage.slice(0, 200) }
        });
      }
      runAgent({ agent, userMessage, runId, abortController, agentId }).catch((runErr) => {
        console.error(`[runner] Run ${runId} failed:`, runErr);
        emitToRenderer(runId, {
          type: "run-error",
          runId,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          data: { error: String(runErr) }
        });
        activeRuns.delete(runId);
      });
      return ok$1({ runId, started: true });
    } catch (e) {
      return err$1(String(e));
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.RUNNER_STOP, (_event, payload) => {
    const run = activeRuns.get(payload.runId);
    if (!run) return err$1("Run not found or already completed");
    run.abortController.abort();
    activeRuns.delete(payload.runId);
    return ok$1({ stopped: true });
  });
  electron.ipcMain.handle(IPC_CHANNELS.RUNNER_CONFIRM, (_event, payload) => {
    const run = activeRuns.get(payload.runId);
    if (!run) return err$1("Run not found");
    const resolver = run.confirmations.get(payload.confirmationId);
    if (!resolver) return err$1("Confirmation not found");
    resolver(payload.decision);
    run.confirmations.delete(payload.confirmationId);
    return ok$1({ confirmed: true });
  });
}
async function runAgent(params) {
  const { agent, userMessage, runId, agentId, abortController } = params;
  try {
    emitToRenderer(runId, {
      type: "node-started",
      runId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      nodeId: "node-llm",
      data: { message: `Processing: ${userMessage}` }
    });
    if (abortController.signal.aborted) {
      throw new Error("Run aborted by user");
    }
    const responseText = `[Agent "${agent.name}" received your message. LLM integration coming in Phase 3.]

Your message: ${userMessage}`;
    for (const char of responseText) {
      if (abortController.signal.aborted) break;
      emitToRenderer(runId, {
        type: "llm-chunk",
        runId,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        nodeId: "node-llm",
        data: { chunk: char }
      });
      await new Promise((r) => setTimeout(r, 10));
    }
    emitToRenderer(runId, {
      type: "node-completed",
      runId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      nodeId: "node-llm",
      data: { outputVariable: "llmResponse", value: responseText }
    });
    emitToRenderer(runId, {
      type: "run-completed",
      runId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      data: { result: responseText }
    });
    if (agent.auditEnabled) {
      appendAuditLog({
        agentId,
        runId,
        eventType: "run-completed",
        outcome: "success"
      });
    }
  } finally {
    activeRuns.delete(runId);
  }
}
function ok(data) {
  return { ok: true, data };
}
function err(error) {
  return { ok: false, error };
}
function registerAuditIpc() {
  electron.ipcMain.handle(IPC_CHANNELS.AUDIT_QUERY, (_event, params) => {
    try {
      const result = queryAuditLog(params);
      return ok(result);
    } catch (e) {
      return err(String(e));
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUDIT_CLEAR, (_event, agentId) => {
    try {
      clearAuditLog(agentId);
      return ok({ cleared: true });
    } catch (e) {
      return err(String(e));
    }
  });
}
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1e3,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0f0f0f",
    webPreferences: {
      // Security hardening — renderer cannot access Node APIs directly
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Preload script exposes only the typed IPC bridge
      preload: path.join(__dirname, "../preload/index.js"),
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Disable remote module (deprecated but belt-and-suspenders)
      enableRemoteModule: false
    }
  });
  if (!utils.is.dev) {
    electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              // Tailwind requires inline styles
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "worker-src 'self' blob:",
              "frame-src 'none'",
              "object-src 'none'"
            ].join("; ")
          ]
        }
      });
    });
  }
  win.webContents.on("will-navigate", (event, url) => {
    const parsedUrl = new URL(url);
    const isLocalDev = utils.is.dev && (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1"));
    const isFileProtocol = parsedUrl.protocol === "file:";
    if (!isLocalDev && !isFileProtocol) {
      event.preventDefault();
      electron.shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });
  win.on("ready-to-show", () => {
    win.show();
    if (utils.is.dev) {
      win.webContents.openDevTools({ mode: "detach" });
    }
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.agentbuilder.app");
  try {
    initDb();
    console.log("[main] Database initialized");
  } catch (err2) {
    console.error("[main] Failed to initialize database:", err2);
    electron.app.quit();
    return;
  }
  registerAgentsIpc();
  registerSettingsIpc();
  registerRunnerIpc();
  registerAuditIpc();
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  closeDb();
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("before-quit", () => {
  closeDb();
});
const gotTheLock = electron.app.requestSingleInstanceLock();
if (!gotTheLock) {
  electron.app.quit();
}
