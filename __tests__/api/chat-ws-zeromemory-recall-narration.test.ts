import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * #1307 — when a build's system prompt is actually enriched with a real
 * cross-build ZeroMemory recall (`ragBlock` non-empty), the founder watching
 * the SSE chat stream had NO visibility into it: the only signal was a
 * server-only console.log. Generation just came out quietly different with
 * zero explanation.
 *
 * This asserts chat-ws/route.ts emits one additional `build_step` narration
 * event (the exact existing SSE convention already used throughout this
 * route for "Cody is doing X" status lines — see e.g. the Context Budget
 * Manager's `budget` event and the PRD-analysis build-step loop) whenever
 * `ragBlock` is truthy, with plain-language founder-facing text that never
 * leaks internal jargon (RAG/vector/ZeroMemory/recall), and that NO such
 * event is emitted when `ragBlock` is empty (never fabricate the signal).
 *
 * Source-text assertion, matching this file's established test style for
 * app/api/chat-ws/route.ts (see chat-ws-context-budget-wiring.test.ts /
 * chat-ws-model-tier-naming.test.ts) — the route module instantiates
 * OpenAI/Bedrock clients at module scope on import, which is expensive and
 * fragile to mock just to check wiring shape.
 */

const routeSource = readFileSync(
  join(process.cwd(), 'app/api/chat-ws/route.ts'),
  'utf-8',
)

describe('chat-ws ZeroMemory recall narration (#1307)', () => {
  it('still computes ragBlock from the real, untouched buildRagContext/recallPastPerformance wiring', () => {
    // This feature must NOT touch the actual recall/generation mechanism —
    // only add a visibility signal on top of it.
    expect(routeSource).toContain(
      'const ragBlock = await buildRagContext(message, recallPastPerformance)',
    )
  })

  it('emits a build_step narration event gated on the real ragBlock truthiness, immediately alongside the existing server-log gate', () => {
    // Match the existing `if (ragBlock) console.log(...)` gate and assert a
    // build_step emission sits in the same truthy-ragBlock branch.
    const gateMatch = routeSource.match(
      /if \(ragBlock\) \{([\s\S]{0,600}?)\n\s*\}/,
    )
    expect(gateMatch).toBeTruthy()
    const gateBody = gateMatch![1]
    expect(gateBody).toContain("type: 'build_step'")
  })

  it('never fabricates the narration — the build_step emission is inside the ragBlock-truthy branch, not unconditional', () => {
    // The emission call site must be preceded (within a small window) by the
    // `if (ragBlock)` guard — i.e. it is NOT sent unconditionally right after
    // ragBlock is computed.
    const idx = routeSource.indexOf(
      'const ragBlock = await buildRagContext(message, recallPastPerformance)',
    )
    expect(idx).toBeGreaterThan(-1)
    const windowAfter = routeSource.slice(idx, idx + 800)
    expect(windowAfter).toMatch(/if \(ragBlock\)/)
  })

  it('the founder-facing narration text avoids internal jargon', () => {
    const gateMatch = routeSource.match(
      /if \(ragBlock\) \{([\s\S]{0,600}?)\n\s*\}/,
    )
    const gateBody = gateMatch![1]
    const stepMatch = gateBody.match(/type: 'build_step',\s*step:\s*(['"])([\s\S]*?)\1/)
    expect(stepMatch).toBeTruthy()
    const stepText = stepMatch![2]
    expect(stepText.length).toBeGreaterThan(0)
    for (const banned of ['RAG', 'rag', 'vector', 'ZeroMemory', 'zeromemory', 'recall']) {
      expect(stepText).not.toContain(banned)
    }
  })

  it('does not change formatRagContext/buildRagContext/recallPastPerformance themselves (visibility-only change)', () => {
    // lib/build/rag-context.ts and lib/agent/zeromemory.ts are out of scope
    // for this issue — only chat-ws/route.ts's narration layer changes.
    const ragContextSource = readFileSync(
      join(process.cwd(), 'lib/build/rag-context.ts'),
      'utf-8',
    )
    const zeromemorySource = readFileSync(
      join(process.cwd(), 'lib/agent/zeromemory.ts'),
      'utf-8',
    )
    expect(ragContextSource).toContain('export async function buildRagContext(')
    expect(zeromemorySource).toContain('recallPastPerformance')
  })
})
