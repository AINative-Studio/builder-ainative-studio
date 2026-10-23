import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetAllCircuitBreakers, getCircuitBreaker } from '@/lib/circuit-breaker'

/**
 * Graceful degradation for design-tokens extraction (issue #1191).
 *
 * `extractDesignTokens` already fell back to DEFAULT_DESIGN_TOKENS on any
 * MCP failure (comment at the top of design-tokens.service.ts has said so
 * since US-022), but that fallback was silent: callers got the same-shaped
 * TokenExtractionResult whether the real extraction succeeded or quietly
 * died, with `source: 'default'` the only hint buried in a field nothing
 * read. These tests prove the breaker now (a) stops hammering a known-down
 * MCP endpoint after consecutive failures, (b) short-circuits WITHOUT
 * attempting another real network call once open, and (c) the result
 * surfaces an explicit, human-readable degraded flag + reason a caller can
 * show to the user instead of pretending nothing happened.
 */

const extractTokensMock = vi.fn()

vi.mock('@/lib/mcp/design-system-client', () => ({
  getMCPClient: () => ({
    extractTokens: extractTokensMock,
  }),
}))

describe('extractDesignTokens — circuit breaker + degraded-state reporting', () => {
  beforeEach(() => {
    resetAllCircuitBreakers()
    extractTokensMock.mockReset()
    vi.useRealTimers()
  })

  it('a single MCP failure still falls back to defaults and marks the result degraded', async () => {
    // Generous timeout: the FIRST dynamic import of lib/logger in a fresh
    // test file pulls in the real (lazily-guarded) postgres connection
    // module, which can take several seconds in this environment — a
    // pre-existing test-infra cost unrelated to the breaker logic itself
    // (reproduces identically on main for other, unrelated test files).
    extractTokensMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { extractDesignTokens } = await import('@/lib/services/design-tokens.service')

    const result = await extractDesignTokens('<div>template</div>', { templateId: undefined })

    expect(result.source).toBe('default')
    expect(result.degraded).toBe(true)
    expect(result.degradedReason).toBeTruthy()
    expect(typeof result.degradedReason).toBe('string')
  })

  it('opens the breaker after 3 consecutive failures and short-circuits the 4th call without calling the MCP client', async () => {
    extractTokensMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { extractDesignTokens } = await import('@/lib/services/design-tokens.service')

    await extractDesignTokens('<div>1</div>')
    await extractDesignTokens('<div>2</div>')
    await extractDesignTokens('<div>3</div>')

    expect(extractTokensMock).toHaveBeenCalledTimes(3)

    const fourth = await extractDesignTokens('<div>4</div>')

    // The breaker must prevent a 4th real call entirely.
    expect(extractTokensMock).toHaveBeenCalledTimes(3)
    expect(fourth.source).toBe('default')
    expect(fourth.degraded).toBe(true)
    expect(fourth.degradedReason).toMatch(/unavailable|temporarily/i)
  })

  it('a successful extraction is reported as NOT degraded', async () => {
    extractTokensMock.mockResolvedValue({
      light: {
        colors: { primary: '#111111', secondary: '#222222' },
        typography: { fontFamily: 'Inter', sizes: { base: '1rem' } },
        spacing: { baseUnit: '4px', scale: [0, 4, 8] },
      },
    })
    const { extractDesignTokens } = await import('@/lib/services/design-tokens.service')

    const result = await extractDesignTokens('<div>ok</div>')

    expect(result.source).toBe('mcp')
    expect(result.degraded).toBe(false)
    expect(result.degradedReason).toBeUndefined()
  })

  it('getCircuitBreaker("design-tokens-mcp") reflects the open state after repeated failures', async () => {
    extractTokensMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { extractDesignTokens } = await import('@/lib/services/design-tokens.service')

    await extractDesignTokens('<div>1</div>')
    await extractDesignTokens('<div>2</div>')
    await extractDesignTokens('<div>3</div>')

    expect(getCircuitBreaker('design-tokens-mcp').isOpen()).toBe(true)
  })
})
