import { describe, it, expect } from 'vitest'
import { PROFESSIONAL_SYSTEM_PROMPT } from '@/lib/professional-prompt'

/**
 * The generated-app codegen system prompt (used by app/api/chat-ws/route.ts,
 * the actual app-generation path every real user hits) had NO exposure to
 * AINative's own engineering standards (lib/build/coding-standards.ts) — only
 * the enterprise-gated, currently-broken (core#6422) /api/build/swarm path
 * injected them. Generated apps are single-shot frontend code with no commit/
 * test-execution loop of their own, so TDD/coverage/git-workflow don't apply,
 * but the security baseline (validate/sanitize input, never log secrets) does.
 * This asserts that subset is actually present in the prompt Cody builds to.
 */
describe('PROFESSIONAL_SYSTEM_PROMPT — security baseline (C5)', () => {
  it('warns against dangerouslySetInnerHTML on user-supplied content', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/dangerouslySetInnerHTML/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/never render raw user-supplied strings via/i)
  })

  it('warns against logging secrets/API keys', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/never log secrets, API keys, or tokens/i)
  })

  it('instructs sanitizing/validating user input and fetched data', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/[Ss]anitize and validate anything derived from user input/)
  })

  it('is labeled as the AINative engineering standard, traceable to coding-standards.ts', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/Security baseline \(AINative engineering standard\)/)
  })
})
