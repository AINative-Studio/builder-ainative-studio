import { describe, it, expect } from 'vitest'
import {
  getAgentRuntime,
  getAgentBinary,
  getAgentSpawnEnv,
  isAgentEnabled,
  isAgentFallbackEnabled,
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
    it('maps runtime to binary name', () => {
      expect(getAgentBinary(env({ AGENT_RUNTIME: 'cody' }))).toBe('cody')
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
