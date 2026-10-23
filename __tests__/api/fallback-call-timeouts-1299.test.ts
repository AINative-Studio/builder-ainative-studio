import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Issue #1299 — the FALLBACK side of several routes already bounded on their
 * primary Claude path (#1253/#1259/#1266/#1268) still had unbounded
 * `*.chat.completions.create()`/`embeddings.create()` calls against the
 * AINative proxy, the legacy Llama route, or raw OpenAI. Same bug class: a
 * stalled upstream response hangs the whole request indefinitely with no
 * client-visible error.
 *
 * Source-text assertions only here (per this repo's established convention,
 * e.g. #1268's route-call-timeouts test) — behavioral coverage for the
 * lib/services call sites lives in each service's own existing test file,
 * which already mocks the OpenAI client.
 *
 * @vitest-environment node
 */

function readSrc(relPath: string): string {
  return readFileSync(join(__dirname, '../..', relPath), 'utf-8')
}

describe('source: AINative/Llama/OpenAI fallback calls carry a timeout signal (#1299)', () => {
  it('app/api/build/brand/route.ts (AINative fallback)', () => {
    const src = readSrc('app/api/build/brand/route.ts')
    expect(src).toContain('signal: AbortSignal.timeout(BRAND_PROPOSAL_TIMEOUT_MS)')
  })

  it('app/api/build/ask/route.ts (AINative fallback)', () => {
    const src = readSrc('app/api/build/ask/route.ts')
    expect(src).toContain('signal: AbortSignal.timeout(ASK_TOOL_LOOP_TIMEOUT_MS)')
  })

  it('app/api/build/help/route.ts (AINative fallback)', () => {
    const src = readSrc('app/api/build/help/route.ts')
    expect(src).toContain('signal: AbortSignal.timeout(HELP_ANSWER_TIMEOUT_MS)')
  })

  it('app/api/build/documents/route.ts (AINative fallback, both model tiers)', () => {
    const src = readSrc('app/api/build/documents/route.ts')
    expect(src).toContain('DOC_FALLBACK_TIMEOUT_MS = 45_000')
    expect(src).toContain('signal: AbortSignal.timeout(DOC_FALLBACK_TIMEOUT_MS)')
  })

  it('app/api/chat/route.ts (legacy Llama route, streaming + non-streaming)', () => {
    const src = readSrc('app/api/chat/route.ts')
    expect(src).toContain('signal: AbortSignal.timeout(LLAMA_STREAM_TIMEOUT_MS)')
    expect(src).toContain('signal: AbortSignal.timeout(LLAMA_COMPLETION_TIMEOUT_MS)')
  })

  it('lib/services/translation.service.ts', () => {
    const src = readSrc('lib/services/translation.service.ts')
    expect(src).toContain('signal: AbortSignal.timeout(TRANSLATION_TIMEOUT_MS)')
  })

  it('lib/services/template-matcher.service.ts', () => {
    const src = readSrc('lib/services/template-matcher.service.ts')
    expect(src).toContain('signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS)')
  })

  it('lib/services/example-selector.service.ts', () => {
    const src = readSrc('lib/services/example-selector.service.ts')
    expect(src).toContain('signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS)')
  })
})
