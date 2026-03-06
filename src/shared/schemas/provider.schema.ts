import { z } from 'zod'

export const AnthropicProviderSchema = z.object({
  provider: z.literal('anthropic'),
  model: z.string().default('claude-haiku-4-5-20251001'),
  apiKeyRef: z.string().default('anthropic_api_key'),
  maxTokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(1).default(0.7)
})

export const OpenAIProviderSchema = z.object({
  provider: z.literal('openai'),
  model: z.string().default('gpt-4o'),
  apiKeyRef: z.string().default('openai_api_key'),
  baseUrl: z.string().url().optional(), // For Azure or custom OpenAI endpoints
  maxTokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(1).default(0.7)
})

export const GeminiProviderSchema = z.object({
  provider: z.literal('gemini'),
  model: z.string().default('gemini-2.0-flash'),
  apiKeyRef: z.string().default('gemini_api_key'),
  maxTokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(1).default(0.7)
})

export const OllamaProviderSchema = z.object({
  provider: z.literal('ollama'),
  model: z.string().default('llama3.2'),
  baseUrl: z.string().url().default('http://localhost:11434'),
  maxTokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(1).default(0.7)
})

export const CustomProviderSchema = z.object({
  provider: z.literal('custom'),
  model: z.string().min(1),
  baseUrl: z.string().url(),
  apiKeyRef: z.string().optional(),
  headers: z.record(z.string()).optional(),
  maxTokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(1).default(0.7)
})

export const ProviderConfigSchema = z.discriminatedUnion('provider', [
  AnthropicProviderSchema,
  OpenAIProviderSchema,
  GeminiProviderSchema,
  OllamaProviderSchema,
  CustomProviderSchema
])

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type AnthropicProvider = z.infer<typeof AnthropicProviderSchema>
export type OpenAIProvider = z.infer<typeof OpenAIProviderSchema>
export type GeminiProvider = z.infer<typeof GeminiProviderSchema>
export type OllamaProvider = z.infer<typeof OllamaProviderSchema>
export type CustomProvider = z.infer<typeof CustomProviderSchema>

export const PROVIDER_LABELS: Record<ProviderConfig['provider'], string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI / GPT',
  gemini: 'Google Gemini',
  ollama: 'Ollama (Local)',
  custom: 'Custom API'
}

export const DEFAULT_PROVIDER: GeminiProvider = {
  provider: 'gemini',
  model: 'gemini-2.0-flash',
  apiKeyRef: 'gemini_api_key',
  maxTokens: 4096,
  temperature: 0.7
}
