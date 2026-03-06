import { anthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { ProviderConfig } from '@shared/schemas/provider.schema'

/**
 * Build a Vercel AI SDK LanguageModel from an agent's provider config + API key.
 * Gemini and Ollama use Google's / Ollama's OpenAI-compatible endpoints so we
 * don't need extra provider packages beyond @ai-sdk/openai-compatible.
 */
export function buildModel(config: ProviderConfig, apiKey: string | null): LanguageModel {
  switch (config.provider) {
    case 'anthropic':
      return anthropic(config.model, { apiKey: apiKey ?? '' })

    case 'openai':
      return createOpenAI({ apiKey: apiKey ?? '', baseURL: config.baseUrl })(config.model)

    case 'gemini':
      // Google exposes an OpenAI-compatible endpoint for Gemini
      return createOpenAICompatible({
        name: 'gemini',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        apiKey: apiKey ?? ''
      })(config.model)

    case 'ollama': {
      // Ollama exposes an OpenAI-compatible /v1 endpoint
      const baseURL = (config.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '') + '/v1'
      return createOpenAICompatible({ name: 'ollama', baseURL })(config.model)
    }

    case 'custom':
      return createOpenAICompatible({
        name: 'custom',
        baseURL: config.baseUrl,
        apiKey: apiKey ?? undefined,
        headers: config.headers
      })(config.model)
  }
}
