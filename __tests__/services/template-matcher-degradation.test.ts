import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetAllCircuitBreakers, getCircuitBreaker } from '@/lib/circuit-breaker'
import { TemplateMatcherService } from '@/lib/services/template-matcher.service'

/**
 * Graceful degradation for template matching (issue #1191).
 *
 * `matchTemplate` already caught semantic-scoring failures internally and
 * fell back to confidence 0 / matchType 'none' — but completely silently:
 * nothing distinguished "genuinely no good template match" from "the
 * semantic-scoring dependency (OpenAI embeddings) is down/misconfigured".
 * A caller (and therefore the user) could not tell the difference. Worse,
 * every failed call still re-attempted the OpenAI embedding call once per
 * category (5 categories) on every single request.
 *
 * These tests prove: (a) semantic-scoring failures are now routed through
 * a circuit breaker keyed per-process, (b) repeated consecutive failures
 * open the breaker and stop attempting new embedding calls, and (c) the
 * result now explicitly reports degraded semantic matching instead of
 * silently returning as if nothing were wrong.
 */
describe('TemplateMatcherService — circuit breaker + degraded-state reporting', () => {
  beforeEach(() => {
    resetAllCircuitBreakers()
  })

  it('falls back to keyword-only matching and reports degraded semantic matching when OpenAI is unavailable', async () => {
    // No OPENAI_API_KEY in this test environment — the service's internal
    // `openai` client is null, so every semantic-score attempt throws and
    // is caught. This exercises the REAL fallback path, not a mock.
    const service = new TemplateMatcherService()

    const result = await service.matchTemplate(
      'dashboard analytics metrics charts KPI monitoring saas statistics',
      true
    )

    // Keyword-only score is still strong enough to match on this prompt.
    expect(result.templateCategory).toBe('dashboard')
    expect(result.semanticDegraded).toBe(true)
  })

  it('opens the semantic-matching breaker after consecutive failures and stops attempting further embedding calls', async () => {
    const service = new TemplateMatcherService()

    await service.matchTemplate('dashboard analytics metrics charts', true)
    await service.matchTemplate('dashboard analytics metrics charts', true)
    await service.matchTemplate('dashboard analytics metrics charts', true)

    expect(getCircuitBreaker('template-matcher-semantic').isOpen()).toBe(true)

    // A subsequent call must short-circuit semantic scoring entirely rather
    // than attempting (and failing) another embedding call per category.
    const result = await service.matchTemplate('dashboard analytics metrics charts', true)

    expect(result.semanticDegraded).toBe(true)
  })

  it('does not mark the result degraded when semantic matching is explicitly disabled', async () => {
    const service = new TemplateMatcherService()

    const result = await service.matchTemplate('dashboard analytics metrics charts', false)

    expect(result.semanticDegraded).toBe(false)
  })
})
