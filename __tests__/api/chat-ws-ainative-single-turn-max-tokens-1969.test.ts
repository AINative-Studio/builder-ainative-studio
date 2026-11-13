import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * #1969 — continuing the #325 truncation-regression bug class: #325 raised
 * the primary Claude/Bedrock generation call and its 'meta'-provider
 * streaming fallback (+ that fallback's own non-streaming fallback) from
 * `max_tokens: 8192` to `16000`, since 8192 was confirmed to truncate complex
 * multi-file apps mid-JSX (leaving a dangling `));\n}\n}`). A third sibling
 * branch in the same fallback chain — the AINative single-turn generation
 * path, used when the primary call fails/returns too little content for any
 * non-'meta' provider — was never touched by that fix and still used 8192,
 * confirmed live to produce the exact same truncation signature.
 *
 * Source-text assertion, same established precedent as
 * chat-ws-primary-claude-call-timeout-1253.test.ts and
 * ainative-fallback-call-timeouts-1299.test.ts — this file eagerly
 * instantiates OpenAI/Bedrock clients on import, which is expensive/fragile
 * to mock just to exercise one branch.
 */

function readSrc(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8')
}

describe('AINative single-turn generation fallback uses the same raised token ceiling as its siblings (#1969)', () => {
  it('the AINative single-turn fallback branch no longer caps output at the pre-#325 8192', () => {
    const src = readSrc('app/api/chat-ws/route.ts')

    const idx = src.indexOf('} else if (!fullContent || fullContent.length <= 500) {')
    expect(idx).toBeGreaterThan(-1)

    // Bound the scan to this branch's own for-loop body, not the whole file —
    // other branches/tests already cover their own call sites, and a blind
    // src.includes('max_tokens: 8192') would also pass/fail on repair-loop
    // branches (app/api/build/repair-app, the in-stream repair generate())
    // that are a different, already-bounded single-file repair use case.
    const branchEnd = src.indexOf('\n            }', idx)
    const branch = src.slice(idx, branchEnd > idx ? branchEnd : idx + 2000)

    expect(branch).toContain('MODELS_TO_TRY')
    expect(branch).not.toContain('max_tokens: 8192')
    expect(branch).toContain('max_tokens: 16000')
  })

  it('the three sibling fallback branches in this same chain all share the 16000 ceiling', () => {
    const src = readSrc('app/api/chat-ws/route.ts')

    // Primary Claude/Bedrock call (#325/#310).
    const claudeIdx = src.indexOf('const claudeCall = claude.messages.create({')
    expect(claudeIdx).toBeGreaterThan(-1)
    expect(src.slice(claudeIdx, claudeIdx + 700)).toContain('max_tokens: 16000')

    // 'meta'-provider streaming fallback.
    const metaIdx = src.indexOf("} else if (provider === 'meta') {")
    expect(metaIdx).toBeGreaterThan(-1)
    expect(src.slice(metaIdx, metaIdx + 600)).toContain('max_tokens: 16000')

    // That branch's own non-streaming fallback.
    const streamFailIdx = src.indexOf('Meta streaming failed')
    expect(streamFailIdx).toBeGreaterThan(-1)
    expect(src.slice(streamFailIdx, streamFailIdx + 400)).toContain('max_tokens: 16000')
  })
})
