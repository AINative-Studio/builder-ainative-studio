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

/**
 * #815 — real, live-confirmed bug: /build/agentive-product rendered TWO real
 * <aside> elements simultaneously at every viewport width — the correct
 * desktop sidebar, and a second "mobile" drawer with className="translate-x-0"
 * and nothing else (no fixed/absolute positioning, no -translate-x-full
 * off-canvas default, no responsive breakpoint hide class). Root cause: the
 * codegen system prompt had zero explicit guidance on implementing a correct
 * responsive off-canvas mobile sidebar — the prior "Sidebar Dashboard Layout"
 * pattern only described the desktop sidebar. These tests assert the fix
 * (concrete off-canvas drawer guidance, matching the WRONG/CORRECT format
 * used elsewhere in ANTI-PATTERNS) is actually present in the prompt Cody
 * builds to, and is internally consistent as a JS template literal (every
 * backtick/`${...}` inside the added code example is escaped, or the whole
 * module fails to import).
 */
describe('PROFESSIONAL_SYSTEM_PROMPT — responsive mobile sidebar/drawer (#815)', () => {
  it('imports as a valid string — proves every backtick/${...} in the new example is escaped correctly', () => {
    expect(typeof PROFESSIONAL_SYSTEM_PROMPT).toBe('string')
    expect(PROFESSIONAL_SYSTEM_PROMPT.length).toBeGreaterThan(0)
  })

  it('requires the desktop sidebar to hide itself below md, not just the mobile drawer to show', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/hidden md:flex(?:\s+md:flex-col)?.*so it never renders on mobile/)
  })

  it('gives a concrete off-canvas drawer code pattern with real state, not a hardcoded class', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/const \[mobileNavOpen, setMobileNavOpen\] = useState\(false\)/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/data-agent-context="sidebar-mobile"/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/-translate-x-full/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/mobileNavOpen \? 'translate-x-0' : '-translate-x-full'/)
  })

  it('requires fixed/absolute positioning so the drawer overlays instead of sitting inline', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/fixed inset-y-0 left-0/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/never sit inline in the flex\/grid flow like a second column/)
  })

  it('requires a backdrop/overlay that closes the drawer, with correct z-index layering', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/Backdrop/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/onClick=\{\(\) => setMobileNavOpen\(false\)\}/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/z-40/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/z-50/)
  })

  it('requires md:hidden (or equivalent breakpoint) so the drawer never renders on desktop', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/md:hidden.*neither renders once the desktop sidebar takes over/)
  })

  it('names a permanently-visible drawer as a CRITICAL bug, so the model treats it as a hard failure', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/A drawer that is always visible, or visible on desktop too, is a CRITICAL bug/)
  })

  it('adds a WRONG/CORRECT anti-pattern pair reproducing the exact #815 DOM shape (two <aside> elements)', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/### WRONG: Mobile sidebar with no off-canvas classes/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/### CORRECT: Desktop sidebar hidden below md, mobile drawer off-canvas until opened/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/data-agent-context="sidebar-mobile" className="translate-x-0"/)
  })
})
