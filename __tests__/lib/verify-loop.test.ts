import { describe, it, expect } from 'vitest'
import {
  VERIFY_AGENT_TOOLS,
  VERIFY_AGENT_MAX_BUDGET_USD,
  VERIFY_MAX_TURNS,
  buildVerifySystemPrompt,
  buildVerifyPrompt,
  buildVerifyAgentOptions,
} from '@/lib/agent/verify-loop'

describe('verify-loop (#80)', () => {
  it('grants the agent Read + Bash so it can actually verify, plus Write/Edit', () => {
    expect(VERIFY_AGENT_TOOLS).toContain('Read')
    expect(VERIFY_AGENT_TOOLS).toContain('Bash')
    expect(VERIFY_AGENT_TOOLS).toContain('Write')
    expect(VERIFY_AGENT_TOOLS).toContain('Edit')
  })

  it('has a sane budget and turn cap', () => {
    expect(VERIFY_AGENT_MAX_BUDGET_USD).toBeGreaterThan(0)
    expect(VERIFY_MAX_TURNS).toBeGreaterThanOrEqual(2)
    expect(VERIFY_MAX_TURNS).toBeLessThanOrEqual(6)
  })

  it('system prompt instructs verify + covers the runtime error class', () => {
    const p = buildVerifySystemPrompt()
    expect(p).toMatch(/verify/i)
    expect(p).toMatch(/Element type is invalid/i)
    expect(p).toMatch(/export default function App/)
    expect(p).toMatch(/```jsx/)
  })

  it('user prompt includes the error, the broken code, and the original ask', () => {
    const p = buildVerifyPrompt('build a dashboard', 'Unexpected token', 'const x =;')
    expect(p).toMatch(/Unexpected token/)
    expect(p).toMatch(/build a dashboard/)
    expect(p).toMatch(/const x =;/)
    expect(p).toMatch(/```jsx/)
  })

  it('truncates very long broken code', () => {
    const big = 'x'.repeat(20000)
    const p = buildVerifyPrompt('p', 'e', big)
    // 12000 cap + surrounding text — well under the raw 20000
    expect(p.length).toBeLessThan(13000)
  })

  it('handles empty/undefined broken code without throwing', () => {
    expect(() => buildVerifyPrompt('p', 'e', '')).not.toThrow()
    // @ts-expect-error exercise the nullish path
    expect(() => buildVerifyPrompt('p', 'e', undefined)).not.toThrow()
  })

  it('buildVerifyAgentOptions wires tools/budget/turns/systemPrompt', () => {
    const opts = buildVerifyAgentOptions('gpt-oss-120b')
    expect(opts.model).toBe('gpt-oss-120b')
    expect(opts.allowedTools).toEqual(VERIFY_AGENT_TOOLS)
    expect(opts.maxBudgetUsd).toBe(VERIFY_AGENT_MAX_BUDGET_USD)
    expect(opts.maxTurns).toBe(VERIFY_MAX_TURNS)
    expect(opts.systemPrompt).toMatch(/verify/i)
  })

  it('buildVerifyAgentOptions works with no model (runtime default)', () => {
    const opts = buildVerifyAgentOptions()
    expect(opts.model).toBeUndefined()
    expect(opts.allowedTools.length).toBeGreaterThan(0)
  })
})
