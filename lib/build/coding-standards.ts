/**
 * AINative Engineering Standards / Definition of Done (#71).
 *
 * This is the CANONICAL, single source of truth for the engineering standards
 * Cody was trained to follow — mirrored from the real AINative skills so the
 * build workflow surfaces the SAME rules Cody actually builds to:
 *   - mandatory-tdd        (TDD + BDD, >=80% coverage, mandatory test execution)
 *   - file-placement       (docs/ + scripts/ placement rules)
 *   - git-workflow /
 *     ainative-git-workflow (branch naming, PR discipline, NO AI attribution)
 *   - primitives-first     (compose AINative primitives, don't regenerate)
 *   - security baseline    (validate inputs, never log secrets)
 *
 * Two consumers:
 *   1. The `codingStandards` artifact (display) — grounds Cody's stated
 *      Definition of Done so it's consistent across every idea, not hallucinated.
 *   2. The codegen/swarm dispatch (`/api/build/swarm`) — the standards are
 *      injected into the build agents' context so Cody actually BUILDS to them
 *      (the integrity piece, not display-only).
 *
 * These strings are intentionally idea-agnostic: the standards are the same for
 * every app; only light tailoring (which primitives, which security surface)
 * belongs in the generated artifact body.
 */

export interface CodingStandard {
  /** short stable key (also used as a checklist id) */
  id: string
  /** the standard's title */
  title: string
  /** the concrete rule Cody commits to */
  rule: string
  /** the AINative skill this is grounded in (traceability) */
  source: string
}

/**
 * The canonical Definition of Done. Order is the order they should render +
 * be injected. Keep this list tight and real — every entry maps to a skill.
 */
export const CODING_STANDARDS: readonly CodingStandard[] = [
  {
    id: 'tdd',
    title: 'Test-Driven Development (TDD + BDD)',
    rule: 'Write BDD-style tests first (describe/it, given/when/then), then the implementation. No feature ships without tests written before the code.',
    source: 'mandatory-tdd',
  },
  {
    id: 'coverage',
    title: '>=80% coverage, tests actually executed',
    rule: 'Minimum 80% coverage on new code, and tests are RUN with proof of passing status before any commit, PR, or issue closure — never assumed green.',
    source: 'mandatory-tdd',
  },
  {
    id: 'primitives-first',
    title: 'Primitives-first composition',
    rule: 'Compose real AINative primitives (ZeroDB, ZeroMemory, Agent Cloud, MCP, Auth, ...) you own — never regenerate throwaway equivalents of what a primitive already provides.',
    source: 'primitives-first',
  },
  {
    id: 'file-placement',
    title: 'File placement discipline',
    rule: 'All documentation lives under docs/; all utility scripts under scripts/. No stray .md/.sh files scattered across the source tree.',
    source: 'file-placement',
  },
  {
    id: 'git-workflow',
    title: 'Git workflow + branch naming',
    rule: 'Branches follow feature/issue-{n}-{slug} or bug/issue-{n}-{slug}; every change goes through a PR with a clear description tied to its issue.',
    source: 'ainative-git-workflow',
  },
  {
    id: 'no-ai-attribution',
    title: 'No AI attribution',
    rule: 'ZERO AI tool attribution in commits, PRs, issues, or documentation — no "Claude", "Anthropic", "AI-generated", or "Generated with" anywhere.',
    source: 'ainative-git-workflow',
  },
  {
    id: 'security-baseline',
    title: 'Security baseline',
    rule: 'Validate and sanitize all inputs, enforce authz on every endpoint, and never log secrets, tokens, or credentials.',
    source: 'ainative-git-workflow',
  },
] as const

/** The stable set of standard ids — used by the display artifact + tests. */
export const CODING_STANDARD_IDS = CODING_STANDARDS.map((s) => s.id)

/**
 * Render the canonical standards as a compact context block for injection into
 * the codegen/swarm build agents' task description. This is what makes the
 * standards LOAD-BEARING (agents receive + follow them), not just displayed.
 *
 * Kept plain-text + deterministic (no idea interpolation) so the same rules go
 * to every build and the block is cheap to prepend to a task description.
 */
export function codingStandardsContextBlock(): string {
  const lines = CODING_STANDARDS.map((s, i) => `${i + 1}. ${s.title}: ${s.rule}`)
  return [
    'AINATIVE ENGINEERING STANDARDS — DEFINITION OF DONE (mandatory, build to these):',
    ...lines,
    'Every shipped issue must satisfy ALL of the above before it is considered done.',
  ].join('\n')
}
