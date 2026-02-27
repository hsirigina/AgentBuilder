import { z } from 'zod'
import { ProviderConfigSchema } from './provider.schema'
import { ToolPermissionsSchema } from './tool.schema'

// ── Default code block template ───────────────────────────────────────────────
// Must be declared before CodeBlockSchema which references it as a default value.

export const DEFAULT_CODE_BLOCK_TEMPLATE = `import { z } from 'zod'

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
`

// ── Node graph types ──────────────────────────────────────────────────────────

export const NodeTypeSchema = z.enum([
  'input', // Entry point — receives user message
  'output', // Terminal — final response
  'llm-call', // LLM inference step
  'tool-call', // Built-in tool invocation (filesystem, http, shell)
  'code-block', // Custom TypeScript code block
  'condition', // Branch on a JS expression
  'transform' // Data mapper / transformation
])

export const GraphNodeSchema = z.object({
  id: z.string(),
  type: NodeTypeSchema,
  position: z.object({ x: z.number(), y: z.number() }),
  // Type-specific payload — each node type has its own data shape
  data: z.record(z.unknown())
})

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceHandle: z.string().optional(),
  target: z.string(),
  targetHandle: z.string().optional(),
  label: z.string().optional()
})

// ── Node data payloads (one per node type) ────────────────────────────────────

export const InputNodeDataSchema = z.object({
  variableName: z.string().default('userMessage'),
  description: z.string().default('User input')
})

export const OutputNodeDataSchema = z.object({
  // Template string with {{varName}} interpolation
  template: z.string().default('{{llmResponse}}')
})

export const LLMCallNodeDataSchema = z.object({
  providerOverride: ProviderConfigSchema.optional(),
  systemPromptOverride: z.string().optional(),
  inputBindings: z.record(z.string()).default({}),
  outputVariable: z.string().default('llmResponse'),
  streaming: z.boolean().default(true)
})

export const ToolCallNodeDataSchema = z.object({
  toolName: z.enum(['filesystem', 'http', 'shell']),
  params: z.record(z.unknown()).default({}),
  outputVariable: z.string().default('toolResult'),
  requiresConfirmation: z.boolean().default(true)
})

export const CodeBlockNodeDataSchema = z.object({
  codeBlockId: z.string(),
  inputBindings: z.record(z.string()).default({}),
  outputVariable: z.string().default('blockResult')
})

export const ConditionNodeDataSchema = z.object({
  // Safe JS expression evaluated against graph scope variables
  expression: z.string().default('true'),
  trueLabel: z.string().default('Yes'),
  falseLabel: z.string().default('No')
})

export const TransformNodeDataSchema = z.object({
  // JS expression mapping input to output; has access to scope variables
  expression: z.string().default('input'),
  inputVariable: z.string(),
  outputVariable: z.string()
})

// ── Code block (custom tool) ──────────────────────────────────────────────────

export const CodeBlockSchema = z.object({
  id: z.string().uuid(),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Name must be a valid identifier'),
  description: z.string().max(512).default(''),
  // Full TypeScript source. Must export: default async function run(input, ctx)
  code: z.string().default(DEFAULT_CODE_BLOCK_TEMPLATE),
  // Stringified Zod schema for input validation (e.g., "z.object({ url: z.string() })")
  inputSchema: z.string().default('z.object({})'),
  // Position in node graph canvas
  graphPosition: z.object({ x: z.number(), y: z.number() }).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

// ── Top-level agent definition ────────────────────────────────────────────────

export const AgentDefinitionSchema = z.object({
  id: z.string().uuid(),
  version: z.literal(1),
  name: z.string().min(1).max(128),
  description: z.string().max(1024).default(''),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  // Which LLM provider and model this agent uses
  provider: ProviderConfigSchema,

  // System prompt with {{variable}} interpolation support
  systemPrompt: z.string().default('You are a helpful AI assistant.'),

  // Node graph topology
  graph: z.object({
    nodes: z.array(GraphNodeSchema).default([]),
    edges: z.array(GraphEdgeSchema).default([])
  }),

  // Custom TypeScript code blocks that become agent tools
  codeBlocks: z.array(CodeBlockSchema).default([]),

  // Per-tool permission configuration (all disabled by default)
  permissions: ToolPermissionsSchema.default({}),

  // Tags for filtering / organization
  tags: z.array(z.string()).default([]),

  // Whether to record audit logs for this agent's runs
  auditEnabled: z.boolean().default(true)
})

export type NodeType = z.infer<typeof NodeTypeSchema>
export type GraphNode = z.infer<typeof GraphNodeSchema>
export type GraphEdge = z.infer<typeof GraphEdgeSchema>
export type InputNodeData = z.infer<typeof InputNodeDataSchema>
export type OutputNodeData = z.infer<typeof OutputNodeDataSchema>
export type LLMCallNodeData = z.infer<typeof LLMCallNodeDataSchema>
export type ToolCallNodeData = z.infer<typeof ToolCallNodeDataSchema>
export type CodeBlockNodeData = z.infer<typeof CodeBlockNodeDataSchema>
export type ConditionNodeData = z.infer<typeof ConditionNodeDataSchema>
export type TransformNodeData = z.infer<typeof TransformNodeDataSchema>
export type CodeBlock = z.infer<typeof CodeBlockSchema>
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>

// ── Default starter graph ─────────────────────────────────────────────────────

export function createDefaultGraph(): AgentDefinition['graph'] {
  return {
    nodes: [
      {
        id: 'node-input',
        type: 'input',
        position: { x: 100, y: 200 },
        data: { variableName: 'userMessage', description: 'User input' }
      },
      {
        id: 'node-llm',
        type: 'llm-call',
        position: { x: 350, y: 200 },
        data: {
          inputBindings: { userMessage: '{{userMessage}}' },
          outputVariable: 'llmResponse',
          streaming: true
        }
      },
      {
        id: 'node-output',
        type: 'output',
        position: { x: 600, y: 200 },
        data: { template: '{{llmResponse}}' }
      }
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'node-input',
        sourceHandle: 'handle-out',
        target: 'node-llm',
        targetHandle: 'handle-in'
      },
      {
        id: 'edge-2',
        source: 'node-llm',
        sourceHandle: 'handle-out',
        target: 'node-output',
        targetHandle: 'handle-in'
      }
    ]
  }
}
