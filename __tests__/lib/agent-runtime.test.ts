import { describe, it, expect } from 'vitest'
import {
  getAgentRuntime,
  getAgentBinary,
  getAgentSpawnEnv,
  isAgentEnabled,
  isAgentFallbackEnabled,
  resolveAgentModel,
} from '@/lib/agent/agent-runtime'

const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv

describe('agent-runtime (#79)', () => {
  describe('getAgentRuntime', () => {
    it('defaults to claude', () => {
      expect(getAgentRuntime(env({}))).toBe('claude')
    })
    it('returns cody when AGENT_RUNTIME=cody (case-insensitive, trimmed)', () => {
      expect(getAgentRuntime(env({ AGENT_RUNTIME: 'cody' }))).toBe('cody')
      expect(getAgentRuntime(env({ AGENT_RUNTIME: '  CODY ' }))).toBe('cody')
    })
    it('returns claude for any other value', () => {
      expect(getAgentRuntime(env({ AGENT_RUNTIME: 'gpt' }))).toBe('claude')
    })
  })

  describe('getAgentBinary', () => {
    it('resolves cody to the local bin path or the bare name', () => {
      const bin = getAgentBinary(env({ AGENT_RUNTIME: 'cody' }))
      // Either the resolved node_modules/.bin/cody path or the bare 'cody'
      expect(bin === 'cody' || bin.endsWith('/.bin/cody')).toBe(true)
    })
    it('maps claude to the bare binary name', () => {
      expect(getAgentBinary(env({}))).toBe('claude')
    })
  })

  describe('getAgentSpawnEnv', () => {
    it('returns no overrides for claude', () => {
      expect(getAgentSpawnEnv(env({}))).toEqual({})
    })
    it('points cody at AINative and passes the key through', () => {
      const out = getAgentSpawnEnv(env({ AGENT_RUNTIME: 'cody', AINATIVE_API_KEY: 'k-123' }))
      expect(out.ANTHROPIC_BASE_URL).toBe('https://api.ainative.studio')
      expect(out.ANTHROPIC_API_KEY).toBe('k-123')
    })
    it('honors AINATIVE_API_URL / CODY_BASE_URL override for cody', () => {
      expect(
        getAgentSpawnEnv(env({ AGENT_RUNTIME: 'cody', AINATIVE_API_URL: 'https://core.local' }))
          .ANTHROPIC_BASE_URL,
      ).toBe('https://core.local')
    })
    it('falls back through key sources', () => {
      expect(
        getAgentSpawnEnv(env({ AGENT_RUNTIME: 'cody', ZERODB_API_KEY: 'z' })).ANTHROPIC_API_KEY,
      ).toBe('z')
    })
    it('omits the key when none is set', () => {
      const out = getAgentSpawnEnv(env({ AGENT_RUNTIME: 'cody' }))
      expect(out.ANTHROPIC_API_KEY).toBeUndefined()
    })
  })

  describe('isAgentEnabled', () => {
    it('true when USE_CLAUDE_AGENT=true', () => {
      expect(isAgentEnabled(env({ USE_CLAUDE_AGENT: 'true' }))).toBe(true)
    })
    it('true for cody runtime by default', () => {
      expect(isAgentEnabled(env({ AGENT_RUNTIME: 'cody' }))).toBe(true)
    })
    it('false for cody when USE_CODY_AGENT=false', () => {
      expect(isAgentEnabled(env({ AGENT_RUNTIME: 'cody', USE_CODY_AGENT: 'false' }))).toBe(false)
    })
    it('false by default (claude runtime, no flag)', () => {
      expect(isAgentEnabled(env({}))).toBe(false)
    })
  })

  describe('isAgentFallbackEnabled', () => {
    it('true when USE_CLAUDE_AGENT_FALLBACK=true', () => {
      expect(isAgentFallbackEnabled(env({ USE_CLAUDE_AGENT_FALLBACK: 'true' }))).toBe(true)
    })
    it('true when the agent is enabled', () => {
      expect(isAgentFallbackEnabled(env({ AGENT_RUNTIME: 'cody' }))).toBe(true)
    })
    it('false by default', () => {
      expect(isAgentFallbackEnabled(env({}))).toBe(false)
    })
  })
})

describe('resolveAgentModel (builder#99 — cody model mapping)', () => {
  it('leaves the model unchanged for the claude runtime', () => {
    expect(resolveAgentModel('sonnet', env({}))).toBe('sonnet')
    expect(resolveAgentModel('sonnet', env({ AGENT_RUNTIME: 'claude' }))).toBe('sonnet')
  })

  it('maps anthropic shorthands to the cody default (kimi-k2) under the cody runtime', () => {
    const e = env({ AGENT_RUNTIME: 'cody' })
    expect(resolveAgentModel('sonnet', e)).toBe('kimi-k2')
    expect(resolveAgentModel('opus', e)).toBe('kimi-k2')
    expect(resolveAgentModel('claude-sonnet', e)).toBe('kimi-k2')
  })

  it('honors CODY_MODEL override', () => {
    const e = env({ AGENT_RUNTIME: 'cody', CODY_MODEL: 'qwen3-coder-flash' })
    expect(resolveAgentModel('sonnet', e)).toBe('qwen3-coder-flash')
  })

  it('passes through an explicit AINative model unchanged under cody', () => {
    const e = env({ AGENT_RUNTIME: 'cody' })
    expect(resolveAgentModel('kimi-k2', e)).toBe('kimi-k2')
    expect(resolveAgentModel('qwen3-coder-flash', e)).toBe('qwen3-coder-flash')
    expect(resolveAgentModel('deepseek-4-flash', e)).toBe('deepseek-4-flash')
  })

  it('is case-insensitive on the shorthand match', () => {
    const e = env({ AGENT_RUNTIME: 'cody' })
    expect(resolveAgentModel('Sonnet', e)).toBe('kimi-k2')
    expect(resolveAgentModel(' OPUS ', e)).toBe('kimi-k2')
  })
})
