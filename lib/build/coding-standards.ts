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

// ---------------------------------------------------------------------------
// Enforcement checks (#357 GIT-5) — programmatic validation of standards
// ---------------------------------------------------------------------------

export interface StandardsCheck {
  name: string
  passed: boolean
  reason?: string
  details?: string[]
}

export interface StandardsResult {
  passed: boolean
  checks: StandardsCheck[]
  summary: string
}

export const COVERAGE_THRESHOLD = 80

/** Patterns that indicate AI attribution in commit messages. Case-insensitive. */
export const AI_ATTRIBUTION_PATTERNS = [
  /co-authored-by:.*claude/i,
  /co-authored-by:.*anthropic/i,
  /co-authored-by:.*chatgpt/i,
  /co-authored-by:.*openai/i,
  /co-authored-by:.*copilot/i,
  /generated by (claude|chatgpt|copilot|ai|gpt)/i,
  /written by (claude|chatgpt|copilot|ai|gpt)/i,
  /created by (claude|chatgpt|copilot|ai|gpt)/i,
  /assisted by (claude|chatgpt|copilot|ai|gpt)/i,
  /with help from (claude|chatgpt|copilot|ai|gpt)/i,
  /🤖.*claude|claude.*🤖/i,
  /\[claude\]|\[chatgpt\]|\[copilot\]/i,
]

/** File patterns that should have test coverage. */
export const TESTABLE_FILE_PATTERNS = [
  /^lib\/.*\.ts$/,
  /^app\/api\/.*\.ts$/,
  /^components\/.*\.tsx?$/,
]

/** File patterns that are exempt from test coverage requirements. */
export const TEST_EXEMPT_PATTERNS = [
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
  /\/__tests__\//,
  /^e2e\//,
  /\.d\.ts$/,
  /types\.ts$/,
  /config\.(ts|js)$/,
]

/**
 * Check a commit message for AI attribution violations. PURE.
 * Returns { passed: true } if no violations, { passed: false, reason, details }
 * with the matched patterns if violations are found.
 */
export function checkCommitMessage(message: string): StandardsCheck {
  const violations: string[] = []
  for (const pattern of AI_ATTRIBUTION_PATTERNS) {
    const match = message.match(pattern)
    if (match) {
      violations.push(`Matched: "${match[0]}"`)
    }
  }
  if (violations.length > 0) {
    return {
      name: 'no-ai-attribution',
      passed: false,
      reason: 'Commit message contains AI attribution',
      details: violations,
    }
  }
  return { name: 'no-ai-attribution', passed: true }
}

/**
 * Check test coverage percentage against the threshold. PURE.
 * @param coverage - The coverage percentage (0-100)
 * @param threshold - The minimum required percentage (default: COVERAGE_THRESHOLD)
 */
export function checkTestCoverage(
  coverage: number,
  threshold: number = COVERAGE_THRESHOLD
): StandardsCheck {
  const pct = Math.round(coverage * 100) / 100
  if (pct >= threshold) {
    return {
      name: 'coverage-threshold',
      passed: true,
      details: [`Coverage: ${pct}% (threshold: ${threshold}%)`],
    }
  }
  return {
    name: 'coverage-threshold',
    passed: false,
    reason: `Coverage ${pct}% is below threshold ${threshold}%`,
    details: [`Required: ${threshold}%, Actual: ${pct}%`],
  }
}

/**
 * Check if a file path should have test coverage. PURE.
 * Returns true if the file matches testable patterns and doesn't match exempt patterns.
 */
export function shouldHaveTests(filePath: string): boolean {
  const path = filePath.replace(/\\/g, '/')
  const isTestable = TESTABLE_FILE_PATTERNS.some((p) => p.test(path))
  const isExempt = TEST_EXEMPT_PATTERNS.some((p) => p.test(path))
  return isTestable && !isExempt
}

/**
 * Check TDD compliance: changed source files should have corresponding tests. PURE.
 * @param changedFiles - List of changed file paths
 * @param testFiles - List of existing test file paths
 */
export function checkTddCompliance(
  changedFiles: string[],
  testFiles: string[]
): StandardsCheck {
  const testableFiles = changedFiles.filter(shouldHaveTests)
  if (testableFiles.length === 0) {
    return {
      name: 'tdd-compliance',
      passed: true,
      details: ['No testable files in changeset'],
    }
  }

  const missingTests: string[] = []
  for (const file of testableFiles) {
    const normalized = file.replace(/\\/g, '/')
    const baseName = normalized.replace(/\.(ts|tsx)$/, '').split('/').pop()!
    const hasTest = testFiles.some((tf) => {
      const testNorm = tf.replace(/\\/g, '/')
      return testNorm.includes(baseName) && /\.(test|spec)\.(ts|tsx)$/.test(testNorm)
    })
    if (!hasTest) {
      missingTests.push(file)
    }
  }

  if (missingTests.length === 0) {
    return {
      name: 'tdd-compliance',
      passed: true,
      details: [`${testableFiles.length} testable files have associated tests`],
    }
  }
  return {
    name: 'tdd-compliance',
    passed: false,
    reason: `${missingTests.length} files lack test coverage`,
    details: missingTests.map((f) => `Missing tests for: ${f}`),
  }
}

/**
 * Validate a PR title/body against standards. PURE.
 * Checks for clear description and no AI attribution.
 */
export function checkPRDescription(title: string, body?: string): StandardsCheck {
  const combined = `${title}\n${body || ''}`
  const attributionCheck = checkCommitMessage(combined)
  if (!attributionCheck.passed) {
    return {
      name: 'pr-description',
      passed: false,
      reason: 'PR description contains AI attribution',
      details: attributionCheck.details,
    }
  }
  if (title.length < 10) {
    return {
      name: 'pr-description',
      passed: false,
      reason: 'PR title is too short',
      details: ['Title should be at least 10 characters'],
    }
  }
  return { name: 'pr-description', passed: true }
}

/**
 * Run all standards checks and aggregate results. PURE.
 */
export function checkAllStandards(opts: {
  commitMessage?: string
  coverage?: number
  changedFiles?: string[]
  testFiles?: string[]
  prTitle?: string
  prBody?: string
}): StandardsResult {
  const checks: StandardsCheck[] = []

  if (opts.commitMessage) {
    checks.push(checkCommitMessage(opts.commitMessage))
  }

  if (opts.coverage !== undefined) {
    checks.push(checkTestCoverage(opts.coverage))
  }

  if (opts.changedFiles && opts.testFiles) {
    checks.push(checkTddCompliance(opts.changedFiles, opts.testFiles))
  }

  if (opts.prTitle) {
    checks.push(checkPRDescription(opts.prTitle, opts.prBody))
  }

  const passed = checks.every((c) => c.passed)
  const failedChecks = checks.filter((c) => !c.passed)
  const summary = passed
    ? `All ${checks.length} standards checks passed`
    : `${failedChecks.length}/${checks.length} checks failed: ${failedChecks.map((c) => c.name).join(', ')}`

  return { passed, checks, summary }
}

/**
 * Format standards result for CI output. PURE.
 */
export function formatForCI(result: StandardsResult): string {
  const lines: string[] = []
  lines.push(`## Coding Standards Check`)
  lines.push('')
  lines.push(result.passed ? '✅ **All checks passed**' : '❌ **Some checks failed**')
  lines.push('')
  for (const check of result.checks) {
    const icon = check.passed ? '✅' : '❌'
    lines.push(`### ${icon} ${check.name}`)
    if (check.reason) {
      lines.push(`**Reason:** ${check.reason}`)
    }
    if (check.details?.length) {
      lines.push('')
      for (const detail of check.details) {
        lines.push(`- ${detail}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Format standards result for committee review. PURE.
 */
export function formatForCommittee(result: StandardsResult): {
  verdict: 'approve' | 'request-changes'
  summary: string
  details: string
} {
  return {
    verdict: result.passed ? 'approve' : 'request-changes',
    summary: result.summary,
    details: formatForCI(result),
  }
}
