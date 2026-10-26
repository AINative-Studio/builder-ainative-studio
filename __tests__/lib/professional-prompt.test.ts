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
 * #1540 — real, live-confirmed bug: a generated landing page for company
 * "silo" shipped a fabricated testimonial ("Sarah Martinez, Head of Security"
 * — a specific invented name, role, quote, and a precise-sounding "cut
 * compliance audit time by 70%" metric) presented as a real customer, on a
 * real paying company's live page. The prompt previously only encouraged
 * testimonials as a layout-variety device (Rule 5/Rule in ANTI-PATTERNS
 * sections) with no honesty guardrail at all. C6 closes that gap.
 */
describe('PROFESSIONAL_SYSTEM_PROMPT — never fabricate a named person/testimonial (C6, #1540)', () => {
  it('explicitly forbids inventing a named customer with a fabricated quote/metric', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/[Nn]ever fabricate a named person, customer, or quote/)
  })

  it('gives a concrete WRONG/CORRECT example matching the fabricated real-world case', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/Sarah Martinez/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/generic\/unattributed, no invented person or invented statistic/i)
  })

  it('offers a real alternative (generic/omit) rather than just a prohibition', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/omit the section rather than invent/i)
  })
})

/**
 * #1559 — real, live-confirmed bug: company "huddle"'s "Get Early Access"
 * waitlist form called `alert(...)` to confirm a submission. A native
 * browser alert blocks the ENTIRE page until manually dismissed — on the
 * sandboxed preview iframe this reproduced as the whole tab appearing
 * frozen/unresponsive (click succeeded, every subsequent interaction timed
 * out until the dialog was dismissed). A server-side sweep of the
 * `generations` table (server-filtered on `generated_code` containing
 * "alert(") found 82 rows using this pattern — a real, recurring
 * content-generation gap, not an isolated incident. C7 closes it.
 */
describe('PROFESSIONAL_SYSTEM_PROMPT — never use native alert/confirm/prompt (C7, #1559)', () => {
  it('explicitly forbids native alert/confirm/prompt dialogs', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/[Nn]ever use native `?alert`?\/`?confirm`?\/`?prompt`?/)
  })

  it('explains WHY: a real alert blocks the whole page until manually dismissed', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/blocks the ENTIRE page/)
  })

  it('gives a concrete WRONG/CORRECT example using real in-page state instead', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/\/\/ ❌ WRONG: blocks the whole page until manually dismissed/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/\/\/ ✅ CORRECT: real in-page state, never blocks/)
  })
})

/**
 * #1572 — real, live-confirmed bug: a real showcase entry's generated app
 * fetched /api/db/workouts (a table that had never been written to yet — a
 * normal, expected state for a freshly-generated app, since ZeroDB creates a
 * table on first WRITE, not on read) and only ever set state on the success
 * path. The real response was a genuine 404, which the app's own useEffect
 * never handled: loading never cleared, and the page was stuck on "Loading
 * workouts..." forever — worse than a crash, which at least shows an error
 * boundary. C8 closes that gap.
 */
describe('PROFESSIONAL_SYSTEM_PROMPT — every fetch needs a real error/empty state (C8, #1572)', () => {
  it('explicitly requires handling a non-ok/404 response, not just the success path', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/[Ee]very data fetch needs a real error\/empty state/)
  })

  it('explains WHY: a 404 on an empty table is normal, not a failure, but loading must still clear', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/NORMAL, expected state for a freshly-generated app/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/NEVER leave the loading flag set forever/)
  })

  it('gives a concrete WRONG/CORRECT example covering success, empty, and error paths', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/\/\/ ❌ WRONG: loading never clears on a fetch error or non-ok response/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/\.catch\(\(\) => setWorkouts\(\[\]\)\)/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/\.finally\(\(\) => setLoading\(false\)\)/)
  })
})

/**
 * #1576 — real, live-confirmed bug, found twice independently on real
 * companies (beacon's "Get Started", wrench's "Log in"): a generated
 * landing page's nav bar included a secondary CTA button alongside the real
 * hero waitlist form, with no onClick at all — a dead no-op. A pre-launch
 * product with no users yet has no real account system for a "Log in"
 * button to open. C9 closes this gap explicitly, since the general
 * no-decorative-buttons rule alone wasn't preventing this specific,
 * recurring shape.
 */
describe('PROFESSIONAL_SYSTEM_PROMPT — no dead nav "Log in" CTA on a pre-launch page (C9, #1576)', () => {
  it('explicitly calls out the nav-bar Log in / Sign in button case', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/nav bar "Log in" \/ "Sign in" button on a pre-launch waitlist page/)
  })

  it('explains WHY: no real account system exists yet for the button to open', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/has no real account system for that button to open/)
  })

  it('offers a real alternative: omit it, or route to the same real email capture', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/either omit it, or make it scroll to \/ focus the same real email capture/)
  })

  it('gives a concrete WRONG/CORRECT example', () => {
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/\/\/ ❌ WRONG: a second nav CTA with no real destination/)
    expect(PROFESSIONAL_SYSTEM_PROMPT).toMatch(/\/\/ ✅ CORRECT: one real CTA, or a nav button that routes to the SAME real capture/)
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
