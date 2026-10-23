import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * runClaudePass() — the obedience-repair / decomposition secondary pass used
 * by app/api/chat-ws's live-generation retry loop (4 call sites: primitive-
 * compliance repair, combined fix+split, general obedience repair, and the
 * standalone decomposition pass) — called `primary.client.messages.create()`
 * with no timeout/AbortSignal at all. Same bug class as #1253 (the PRIMARY
 * codegen call), #1266 (cody-chat.ts/subagents.ts) and #1268 (ask/nightshift/
 * help/brand routes): a hung upstream call here stalls the generation's
 * obedience-gate retry loop — and the SSE stream it's part of — indefinitely,
 * instead of falling through to this same function's existing AINative
 * fallback path (the function's own catch block already handles any
 * rejection by falling back, so a timeout rejection is a drop-in fit).
 *
 * Fix: race the call against PRIMARY_CLAUDE_TIMEOUT_MS, mirroring the #1253
 * fix shape exactly (same file, same constant, same Promise.race pattern).
 *
 * Source-text assertion, not a module-execution test: app/api/chat-ws's
 * module scope eagerly instantiates OpenAI/Bedrock clients on import, which
 * is expensive/fragile to mock just to exercise one branch — same
 * established precedent as __tests__/api/chat-ws-primary-claude-call-timeout-1253.test.ts.
 */

const routeSource = readFileSync(
  join(process.cwd(), 'app/api/chat-ws/route.ts'),
  'utf-8',
)

function extractAround(source: string, marker: string, before: number, after: number): string {
  const idx = source.indexOf(marker)
  expect(idx).toBeGreaterThan(-1)
  return source.slice(Math.max(0, idx - before), idx + after)
}

describe('runClaudePass() obedience-repair/decomposition call is bounded by a timeout', () => {
  it('captures the raw SDK call as a promise instead of awaiting it directly', () => {
    const block = extractAround(routeSource, 'async function runClaudePass(', 0, 1200)
    expect(block).toContain('const call = primary.client.messages.create({')
    expect(block).not.toMatch(/const resp = await primary\.client\.messages\.create\(/)
  })

  it('races the call against a rejecting timeout sized to PRIMARY_CLAUDE_TIMEOUT_MS', () => {
    const block = extractAround(routeSource, 'async function runClaudePass(', 0, 1600)
    expect(block).toMatch(/new Promise<never>\(\(_, reject\) => \{\s*setTimeout\(\(\) => reject\(new Error\('RUN_CLAUDE_PASS_TIMEOUT'\)\), PRIMARY_CLAUDE_TIMEOUT_MS\)/)
    expect(block).toContain('await Promise.race([call, timeout])')
  })

  it('a timeout rejection is caught by the existing AINative-fallback catch block', () => {
    const fnIdx = routeSource.indexOf('async function runClaudePass(')
    const fnBody = routeSource.slice(fnIdx, fnIdx + 1800)
    const catchIdx = fnBody.search(/catch\s*\(err[^)]*\)\s*\{/)
    expect(catchIdx).toBeGreaterThan(-1)
    const catchBody = fnBody.slice(catchIdx, catchIdx + 200)
    expect(catchBody).toContain('[runClaudePass] primary Claude failed, trying AINative fallback')
  })

  it('is reused by all four obedience-repair / decomposition call sites in the retry loop', () => {
    const occurrences = routeSource.split('await runClaudePass(').length - 1
    expect(occurrences).toBe(4)
  })
})
