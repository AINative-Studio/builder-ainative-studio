import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// lib/llama-provider.ts evaluates `process.env.LLAMA_API_URL || '...'` and
// `process.env.LLAMA_MODEL || '...'` at MODULE LOAD time (top-level const
// initializers), not call time. To exercise both branches of each `||`
// fallback we must reset the module registry and dynamically re-import
// between assertions, with the relevant env vars set/unset beforehand.
const { createOpenAI, mockLlamaCallable } = vi.hoisted(() => {
  const mockLlamaCallable = vi.fn((_model: string) => ({ __model: _model }))
  const createOpenAI = vi.fn(() => mockLlamaCallable)
  return { createOpenAI, mockLlamaCallable }
})

vi.mock('@ai-sdk/openai', () => ({ createOpenAI }))

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  createOpenAI.mockClear()
  mockLlamaCallable.mockClear()
  process.env = { ...ORIGINAL_ENV }
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('lib/llama-provider', () => {
  it('uses explicit LLAMA_API_URL and LLAMA_MODEL env vars when set', async () => {
    process.env.LLAMA_API_KEY = 'test-key'
    process.env.LLAMA_API_URL = 'https://custom.example.com/v1'
    process.env.LLAMA_MODEL = 'My-Custom-Model'

    await import('@/lib/llama-provider')

    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-key',
        baseURL: 'https://custom.example.com/v1',
      })
    )
    expect(mockLlamaCallable).toHaveBeenCalledWith('My-Custom-Model')
  })

  it('falls back to the default baseURL and model when the env vars are unset', async () => {
    process.env.LLAMA_API_KEY = 'test-key'
    delete process.env.LLAMA_API_URL
    delete process.env.LLAMA_MODEL

    await import('@/lib/llama-provider')

    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-key',
        baseURL: 'https://api.llama.com/compat/v1',
      })
    )
    expect(mockLlamaCallable).toHaveBeenCalledWith('Llama-4-Maverick-17B-128E-Instruct-FP8')
  })
})
