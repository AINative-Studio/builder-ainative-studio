import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * #1299 — continuing the #1253/#1266/#1268/#1295 bug class, but on the
 * *fallback* side: several `*.chat.completions.create()` calls against the
 * AINative OpenAI-compatible proxy had no timeout/AbortSignal at all, even
 * though the Claude-path call they sit beside (or fall back from) was
 * already bounded. A hang on any of these stalls the same live generation/
 * repair paths the Claude-side fixes were protecting.
 *
 * Source-text assertions, same established precedent as
 * chat-ws-primary-claude-call-timeout-1253.test.ts and
 * route-call-timeouts-1268.test.ts — the files under test eagerly
 * instantiate OpenAI/Bedrock clients on import, which is expensive/fragile
 * to mock just to exercise one branch.
 */

function readSrc(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8')
}

describe('AINative/OpenAI-proxy fallback calls carry a timeout signal (#1299)', () => {
  it('lib/agent/multi-pass-generator.ts: executeChunkPlan\'s per-phase call is bounded', () => {
    const src = readSrc('lib/agent/multi-pass-generator.ts')
    expect(src).toContain('const CHUNK_GENERATION_TIMEOUT_MS = Number(process.env.CHUNK_GENERATION_TIMEOUT_MS || 120_000)')
    expect(src).toContain('{ signal: AbortSignal.timeout(CHUNK_GENERATION_TIMEOUT_MS) }')
  })

  it('app/api/chat-ws/route.ts: runClaudePass()\'s AINative fallback is bounded', () => {
    const src = readSrc('app/api/chat-ws/route.ts')
    expect(src).toContain('const REPAIR_RETRY_TIMEOUT_MS = Number(process.env.REPAIR_RETRY_TIMEOUT_MS || 90_000)')

    const fnIdx = src.indexOf('async function runClaudePass(')
    expect(fnIdx).toBeGreaterThan(-1)
    // #1331: a fixed-size window this tight (2200) silently broke once #1296
    // independently added its own timeout handling + comments to this same
    // function's primary-call branch — the combined (clean-merge, non-
    // conflicting) result pushed the fallback's timeout call past the old
    // window with no textual conflict to flag it. 3000 is a deliberately
    // generous margin past the function's current ~2528-char body, not a
    // tight fit, so a future small addition here doesn't retrigger this.
    const fnBody = src.slice(fnIdx, fnIdx + 3000)
    expect(fnBody).toContain("process.env.DEFAULT_MODEL || 'qwen-coder-32b'")
    expect(fnBody).toContain('{ signal: AbortSignal.timeout(PRIMARY_CLAUDE_TIMEOUT_MS) }')
  })

  it('app/api/chat-ws/route.ts: the in-stream repair-loop generate() callback is bounded', () => {
    const src = readSrc('app/api/chat-ws/route.ts')
    const idx = src.indexOf("generate: async (model, error, brokenCode) => {")
    expect(idx).toBeGreaterThan(-1)
    const block = src.slice(idx, idx + 1700)
    expect(block).toContain('{ signal: AbortSignal.timeout(REPAIR_RETRY_TIMEOUT_MS) }')
  })

  it('app/api/build/repair-app/route.ts: the stored-code repair generate() callback is bounded', () => {
    const src = readSrc('app/api/build/repair-app/route.ts')
    expect(src).toContain('const REPAIR_CALL_TIMEOUT_MS = Number(process.env.REPAIR_CALL_TIMEOUT_MS || 30_000)')

    const idx = src.indexOf('generate: async (model, err, brokenCode) => {')
    expect(idx).toBeGreaterThan(-1)
    const block = src.slice(idx, idx + 1000)
    expect(block).toContain('{ signal: AbortSignal.timeout(REPAIR_CALL_TIMEOUT_MS) }')
  })
})
