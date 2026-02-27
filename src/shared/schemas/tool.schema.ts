import { z } from 'zod'

// ── Filesystem permissions ────────────────────────────────────────────────────

export const FileSystemPermissionSchema = z.object({
  enabled: z.boolean().default(false),
  access: z.enum(['read', 'read-write']).default('read'),
  // Glob patterns for allowed paths, e.g. ["/home/user/docs/**", "/tmp/agent-*"]
  allowedPaths: z.array(z.string()).default([]),
  // Glob patterns that override allowedPaths (deny wins)
  deniedPaths: z.array(z.string()).default([]),
  maxFileSizeBytes: z.number().int().positive().default(10 * 1024 * 1024) // 10 MB
})

// ── HTTP permissions ──────────────────────────────────────────────────────────

export const HttpPermissionSchema = z.object({
  enabled: z.boolean().default(false),
  // Micromatch glob patterns, e.g. ["api.github.com", "*.example.com"]
  allowedDomains: z.array(z.string()).default([]),
  blockedDomains: z.array(z.string()).default([]),
  allowedMethods: z
    .array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']))
    .default(['GET']),
  rateLimitPerMinute: z.number().int().positive().default(30),
  timeoutMs: z.number().int().positive().default(10_000),
  followRedirects: z.boolean().default(true),
  maxResponseBytes: z.number().int().positive().default(5 * 1024 * 1024) // 5 MB
})

// ── Shell permissions ─────────────────────────────────────────────────────────

export const ShellPermissionSchema = z.object({
  enabled: z.boolean().default(false),
  // Exact binary names only — "git" allows "git status" but not "gitt"
  allowedCommands: z.array(z.string()).default([]),
  // Regex patterns matched against the full command string
  blockedPatterns: z
    .array(z.string())
    .default(['rm\\s+-rf', 'sudo', '> /dev', 'chmod 777', 'curl.*\\|.*sh']),
  workingDirectory: z.string().optional(),
  timeoutMs: z.number().int().positive().default(30_000),
  // Always true by default — shell commands always need user confirmation
  requiresConfirmation: z.boolean().default(true),
  // Extra env vars injected (only these + PATH and HOME from system)
  env: z.record(z.string()).default({})
})

// ── Code execution permissions ────────────────────────────────────────────────

export const CodeExecPermissionSchema = z.object({
  enabled: z.boolean().default(false),
  memoryLimitMb: z.number().int().positive().default(128),
  timeLimitMs: z.number().int().positive().default(10_000),
  // If false, ctx.http inside code blocks throws immediately
  networkAccess: z.boolean().default(false),
  // npm package names pre-bundled into the safe stdlib available in sandboxes
  allowedModules: z.array(z.string()).default([])
})

// ── Combined tool permissions ─────────────────────────────────────────────────

export const ToolPermissionsSchema = z.object({
  filesystem: FileSystemPermissionSchema.default({}),
  http: HttpPermissionSchema.default({}),
  shell: ShellPermissionSchema.default({}),
  codeExec: CodeExecPermissionSchema.default({})
})

export type FileSystemPermission = z.infer<typeof FileSystemPermissionSchema>
export type HttpPermission = z.infer<typeof HttpPermissionSchema>
export type ShellPermission = z.infer<typeof ShellPermissionSchema>
export type CodeExecPermission = z.infer<typeof CodeExecPermissionSchema>
export type ToolPermissions = z.infer<typeof ToolPermissionsSchema>

export const DEFAULT_TOOL_PERMISSIONS: ToolPermissions = {
  filesystem: {
    enabled: false,
    access: 'read',
    allowedPaths: [],
    deniedPaths: [],
    maxFileSizeBytes: 10 * 1024 * 1024
  },
  http: {
    enabled: false,
    allowedDomains: [],
    blockedDomains: [],
    allowedMethods: ['GET'],
    rateLimitPerMinute: 30,
    timeoutMs: 10_000,
    followRedirects: true,
    maxResponseBytes: 5 * 1024 * 1024
  },
  shell: {
    enabled: false,
    allowedCommands: [],
    blockedPatterns: ['rm\\s+-rf', 'sudo', '> /dev', 'chmod 777', 'curl.*\\|.*sh'],
    workingDirectory: undefined,
    timeoutMs: 30_000,
    requiresConfirmation: true,
    env: {}
  },
  codeExec: {
    enabled: false,
    memoryLimitMb: 128,
    timeLimitMs: 10_000,
    networkAccess: false,
    allowedModules: []
  }
}
