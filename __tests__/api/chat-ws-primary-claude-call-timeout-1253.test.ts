import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * #1253 — the primary Claude/Bedrock codegen call (claude.messages.create(),
 * used for every real /build/{slug} generation) had NO timeout at all. This
 * is the exact same hang this repo already diagnosed and fixed once before in
 * lib/build/claude-completion.ts's completeText() — see that file's own
 * doc comment: "Bedrock has no built-in timeout option; the Anthropic SDK's
 * default is effectively unbounded for this use." There, the symptom was a
 * DocumentsPanel stuck on "Generating…" forever with no error. Here, the
 * same unbounded call left the whole chat-ws SSE stream open with zero
 * further events and zero errors — which matches the live production report:
 * the Preview artifact never leaves "Cody is building your app…", with no
 * error surfaced anywhere and no further network activity, for 4+ minutes.
 *
 * Fix: bound the call with Promise.race (provider-agnostic — Bedrock has no
 * built-in option, so a per-call AbortController signal isn't a complete
 * fix either), mirroring completeText's established fix shape, so a stalled
 * call always rejects and falls through to the existing AINative fallback
 * chain instead of hanging the generation (and the SSE stream) indefinitely.
 *
 * The route module isn't imported/executed directly here: app/api/chat-ws's
 * module scope eagerly instantiates OpenAI/Bedrock clients on import, which
 * is expensive/fragile to mock just to exercise one branch — a source-text
 * assertion is the established precedent for this exact file (see
 * __tests__/api/chat-ws-anthropic-direct-client-fallback-metric.test.ts and
 * __tests__/api/chat-ws-model-tier-naming.test.ts).
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

describe('primary Claude/Bedrock codegen call is bounded by a timeout (#1253)', () => {
  it('defines an explicit, env-overridable timeout constant for the primary call', () => {
    expect(routeSource).toContain('PRIMARY_CLAUDE_TIMEOUT_MS')
    expect(routeSource).toMatch(
      /const PRIMARY_CLAUDE_TIMEOUT_MS = Number\(process\.env\.PRIMARY_CLAUDE_TIMEOUT_MS \|\| [\d_]+\)/,
    )
  })

  it('races claude.messages.create() against that timeout instead of awaiting it unbounded', () => {
    const block = extractAround(routeSource, 'const claudeCall = claude.messages.create(', 200, 1400)
    // The raw SDK call must be captured as a promise (not directly awaited)...
    expect(block).toContain('const claudeCall = claude.messages.create(')
    // ...and raced against a timeout that rejects rather than resolves, so a
    // hang can never silently produce an empty/undefined response.
    expect(block).toMatch(/new Promise<never>\(\(_, reject\) => \{\s*setTimeout\(\(\) => reject\(new Error\('PRIMARY_CLAUDE_TIMEOUT'\)\), PRIMARY_CLAUDE_TIMEOUT_MS\)/)
    expect(block).toContain('await Promise.race([claudeCall, claudeTimeout])')
  })

  it('a timeout rejection is caught by the existing fallback catch block, not left to crash the stream', () => {
    // The pre-existing catch immediately below this call already resets
    // fullContent and falls through to the AINative fallback path for ANY
    // claudeErr — confirm the timeout's rejection lands in that same catch
    // rather than needing (or bypassing) special handling.
    const callIdx = routeSource.indexOf('const claudeCall = claude.messages.create(')
    const afterCall = routeSource.slice(callIdx, callIdx + 2600)
    const catchIdx = afterCall.search(/catch\s*\(claudeErr[^)]*\)\s*\{/)
    expect(catchIdx).toBeGreaterThan(-1)
    const catchBody = afterCall.slice(catchIdx, catchIdx + 260)
    expect(catchBody).toContain("fullContent = ''")
  })

  it('the timeout value is more generous than the AINative fallback tier but still well within what a founder would wait for a progress signal', () => {
    const match = routeSource.match(/const PRIMARY_CLAUDE_TIMEOUT_MS = Number\(process\.env\.PRIMARY_CLAUDE_TIMEOUT_MS \|\| ([\d_]+)\)/)
    expect(match).not.toBeNull()
    const ms = Number(match![1].replace(/_/g, ''))
    // Bounded, sane window: longer than the 90s AINative single-turn budget
    // (this call allows up to 16000 output tokens vs that path's ceiling),
    // but short enough that a hang is caught well before the ~4-minute
    // window in the live bug report.
    expect(ms).toBeGreaterThanOrEqual(90_000)
    expect(ms).toBeLessThanOrEqual(180_000)
  })
})
