import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * #888 — getAnthropicDirectClient()'s catch block used to be a plain
 * console.warn('@anthropic-ai/sdk not available, falling back to AINative')
 * with no metric/alert, so a caller (and anyone reading production data)
 * had zero way to distinguish "SDK genuinely missing" from any other reason
 * the direct client came back null. Combined with #886 (no persisted cost
 * ledger) that meant there was no production signal for how often Builder
 * falls through past its secondary tier (direct Anthropic) to core's
 * tertiary fallback — which matters for sizing Bedrock/direct-API migration
 * work.
 *
 * Fix: emit a Sentry.captureMessage (the same alerting mechanism this file
 * already uses for output-validation failures, see the two other
 * Sentry.captureMessage call sites) tagged with a distinguishable reason
 * code (`anthropic_sdk_import_failed`) on this specific failure path.
 *
 * The route module isn't imported directly here: app/api/chat-ws/route.ts
 * instantiates OpenAI/Bedrock clients at module scope on import, which is
 * expensive/fragile to mock just to exercise one lazy-init branch — a
 * source-text assertion is the established precedent for this file (see
 * __tests__/api/chat-ws-model-tier-naming.test.ts).
 */

const routeSource = readFileSync(
  join(process.cwd(), 'app/api/chat-ws/route.ts'),
  'utf-8',
)

function extractFunctionBody(source: string, signature: string): string {
  const start = source.indexOf(signature)
  expect(start).toBeGreaterThan(-1)
  // Grab a generous window after the signature — enough to cover the whole
  // function body without needing a real brace-matching parser.
  return source.slice(start, start + 2200)
}

describe('getAnthropicDirectClient SDK-import-failure observability (#888)', () => {
  const fnBody = extractFunctionBody(routeSource, 'function getAnthropicDirectClient()')

  it('no longer relies on a bare console.warn as the only signal on import failure', () => {
    // The console.warn may still exist for local/dev visibility, but it must
    // not be the ONLY thing emitted on this path — a real metric/alert is
    // required alongside it.
    expect(fnBody).toMatch(/catch\s*\(e[^)]*\)\s*\{/)
  })

  it('emits a Sentry alert from the SDK-import-failure catch block', () => {
    const catchIdx = fnBody.search(/catch\s*\(e[^)]*\)\s*\{/)
    expect(catchIdx).toBeGreaterThan(-1)
    const catchBody = fnBody.slice(catchIdx)
    expect(catchBody).toContain('Sentry.captureMessage')
  })

  it('tags the alert with a distinguishable reason code (not a generic message)', () => {
    expect(fnBody).toContain('anthropic_sdk_import_failed')
  })

  it('distinguishes the SDK-import failure from the benign "no key configured" null-return', () => {
    // Line above the try/catch: returns null early when no sk-ant- key is
    // configured. That is an expected config state (e.g. Bedrock-only
    // deploys), not a failure — it must NOT be tagged with the same
    // failure reason code as the SDK import catch block.
    const earlyReturnIdx = fnBody.indexOf("return null")
    expect(earlyReturnIdx).toBeGreaterThan(-1)
    const beforeTry = fnBody.slice(0, fnBody.indexOf('try {'))
    expect(beforeTry).not.toContain('anthropic_sdk_import_failed')
    expect(beforeTry).not.toContain('Sentry.captureMessage')
  })

  it('includes the real error message/stack as structured context, not just a label', () => {
    const catchIdx = fnBody.search(/catch\s*\(e[^)]*\)\s*\{/)
    const catchBody = fnBody.slice(catchIdx)
    expect(catchBody).toMatch(/extra:\s*\{[^}]*error/i)
  })

  it('uses the same captureMessage pattern already established elsewhere in this file', () => {
    const occurrences = routeSource.match(/Sentry\.captureMessage\(/g) || []
    // Two pre-existing call sites (output validation, JSX import validation)
    // plus this new one.
    expect(occurrences.length).toBeGreaterThanOrEqual(3)
  })
})
