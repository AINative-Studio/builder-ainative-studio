import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Issue #1268 — four more `claude.client.messages.create()` call sites with
 * no AbortSignal/timeout, same bug class as #1253/#1266: a stalled upstream
 * response hangs the whole request indefinitely with no client-visible
 * error. ask/route.ts's tool-use loop in particular only bounds the number
 * of ROUNDS (MAX_TOOL_ROUNDS), not any single round's own latency — a
 * stalled round still hangs forever despite the round cap.
 *
 * Source-text assertions only here (per this repo's established convention,
 * e.g. #1266's cody-chat-call-timeout test) — the behavioral
 * (AbortSignal-is-passed / a stalled call doesn't hang) coverage for each
 * route lives in that route's own existing test file instead, since
 * `vi.mock`'d module paths are file-scoped: mocking the same module (e.g.
 * `@/lib/build/claude-completion`) differently per describe block in one
 * shared file does not compose, it silently collides.
 *
 * @vitest-environment node
 */

function readSrc(relPath: string): string {
  return readFileSync(join(__dirname, '../..', relPath), 'utf-8')
}

describe('source: all four call sites carry a timeout signal (#1268)', () => {
  it('app/api/build/ask/route.ts', () => {
    const src = readSrc('app/api/build/ask/route.ts')
    expect(src).toContain('signal: AbortSignal.timeout(ASK_TOOL_LOOP_TIMEOUT_MS)')
  })

  it('app/api/build/nightshift/route.ts', () => {
    const src = readSrc('app/api/build/nightshift/route.ts')
    expect(src).toContain('signal: AbortSignal.timeout(NIGHTSHIFT_SUMMARY_TIMEOUT_MS)')
  })

  it('app/api/build/help/route.ts', () => {
    const src = readSrc('app/api/build/help/route.ts')
    expect(src).toContain('signal: AbortSignal.timeout(HELP_ANSWER_TIMEOUT_MS)')
  })

  it('app/api/build/brand/route.ts', () => {
    const src = readSrc('app/api/build/brand/route.ts')
    expect(src).toContain('signal: AbortSignal.timeout(BRAND_PROPOSAL_TIMEOUT_MS)')
  })
})
