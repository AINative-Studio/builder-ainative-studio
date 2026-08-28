import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for lib/build/committee-gate.ts — the multi-model completeness committee
 * (builder#346).
 *
 * The pure merge / agreement-counting / dedupe / ranking / verdict logic is
 * exercised directly and thoroughly. The K model calls are the only I/O; they
 * come in through an injected RunModel, which we mock — zero API budget. The
 * offline analyzer (reviewGeneration) mocks loadGeneration.
 */

import {
  // config / kill switch
  isKilledByEnv,
  resolveRoster,
  DEFAULT_ROSTER,
  MAX_ROSTER,
  // prompts
  reviewerSystemPrompt,
  chairSystemPrompt,
  // brief
  buildBrief,
  orderedFiles,
  // parsing
  coerceFinding,
  extractJsonArrayText,
  extractFindings,
  parseReviewerOutput,
  // merge
  normalizeTitle,
  normalizeFile,
  titleSimilarity,
  sameIssue,
  mergeFindingsLocally,
  rankFindings,
  deriveVerdict,
  // orchestration
  runCommittee,
  buildChairInput,
  inertReport,
  reviewGeneration,
  renderReport,
  type ReviewerReview,
  type Finding,
  type MergedFinding,
  type ReviewSubject,
  type RunModel,
} from '@/lib/build/committee-gate'

// loadGeneration is mocked for the offline-analyzer tests.
vi.mock('@/lib/zerodb-store', () => ({
  loadGeneration: vi.fn(),
}))
import { loadGeneration } from '@/lib/zerodb-store'

const OLD_ENV = { ...process.env }
afterEach(() => {
  process.env = { ...OLD_ENV }
  vi.clearAllMocks()
})

// ---- helpers ----

function finding(over: Partial<Finding> = {}): Finding {
  return {
    file: 'App.tsx',
    line: null,
    severity: 'major',
    confidence: 0.8,
    category: 'correctness',
    title: 'Something wrong',
    detail: 'detail here',
    suggestion: null,
    ...over,
  }
}

function review(model: string, findings: Finding[], over: Partial<ReviewerReview> = {}): ReviewerReview {
  return { model, verdict: 'request-changes', summary: 's', findings, ...over }
}

// ---------------------------------------------------------------------------
// kill switch + roster
// ---------------------------------------------------------------------------

describe('isKilledByEnv', () => {
  it('is false by default', () => {
    delete process.env.COMMITTEE_GATE_DISABLED
    expect(isKilledByEnv({} as any)).toBe(false)
  })
  it.each(['1', 'true', 'YES', 'True'])('is true for %s', (v) => {
    expect(isKilledByEnv({ COMMITTEE_GATE_DISABLED: v } as any)).toBe(true)
  })
  it('is false for other values', () => {
    expect(isKilledByEnv({ COMMITTEE_GATE_DISABLED: '0' } as any)).toBe(false)
    expect(isKilledByEnv({ COMMITTEE_GATE_DISABLED: 'off' } as any)).toBe(false)
  })
})

describe('resolveRoster', () => {
  it('defaults to DEFAULT_ROSTER (Claude + at least one other)', () => {
    const r = resolveRoster({}, {} as any)
    expect(r).toEqual(DEFAULT_ROSTER)
    expect(r.some((m) => m.startsWith('claude'))).toBe(true)
    expect(r.some((m) => !m.startsWith('claude'))).toBe(true)
  })
  it('reads COMMITTEE_MODELS from env', () => {
    expect(resolveRoster({}, { COMMITTEE_MODELS: 'a, b ,c' } as any)).toEqual(['a', 'b', 'c'])
  })
  it('options.models beats env', () => {
    expect(resolveRoster({ models: ['x'] }, { COMMITTEE_MODELS: 'a,b' } as any)).toEqual(['x'])
  })
  it('dedupes (same model twice buys no independence)', () => {
    expect(resolveRoster({ models: ['a', 'a', 'b'] })).toEqual(['a', 'b'])
  })
  it('caps at MAX_ROSTER', () => {
    const many = Array.from({ length: MAX_ROSTER + 3 }, (_, i) => `m${i}`)
    expect(resolveRoster({ models: many }).length).toBe(MAX_ROSTER)
  })
  it('drops blanks', () => {
    expect(resolveRoster({ models: ['a', '', '  '] })).toEqual(['a'])
  })
})

// ---------------------------------------------------------------------------
// prompts
// ---------------------------------------------------------------------------

describe('prompts', () => {
  it('reviewer prompt demands structured output and independence', () => {
    const p = reviewerSystemPrompt()
    expect(p).toMatch(/independent/i)
    expect(p).toMatch(/VERDICT:/)
    expect(p).toMatch(/```json/)
    expect(p).toMatch(/completeness/i)
  })
  it('reviewer prompt injects focus when present', () => {
    expect(reviewerSystemPrompt('concurrency only')).toMatch(/PRIORITY FOCUS/)
    expect(reviewerSystemPrompt()).not.toMatch(/PRIORITY FOCUS/)
  })
  it('chair prompt trusts agreement and requires a discarded section', () => {
    const p = chairSystemPrompt('perf')
    expect(p).toMatch(/agreement/i)
    expect(p).toMatch(/Discarded/i)
    expect(p).toMatch(/perf/)
  })
})

// ---------------------------------------------------------------------------
// brief
// ---------------------------------------------------------------------------

describe('orderedFiles', () => {
  it('puts App.tsx first, then index/main, then alpha', () => {
    const subject: ReviewSubject = {
      target: 't',
      idea: 'i',
      files: {
        '/src/Zebra.tsx': 'z',
        '/src/App.tsx': 'a',
        '/src/main.tsx': 'm',
        '/src/Alpha.tsx': 'al',
        '/src/index.tsx': 'ix',
      },
    }
    expect(orderedFiles(subject).map(([p]) => p.split('/').pop())).toEqual([
      'App.tsx',
      'index.tsx',
      'main.tsx',
      'Alpha.tsx',
      'Zebra.tsx',
    ])
  })
  it('skips non-code and empty files', () => {
    const subject: ReviewSubject = {
      target: 't',
      idea: 'i',
      files: { 'App.tsx': 'code', 'styles.css': 'x', 'empty.tsx': '   ' },
    }
    expect(orderedFiles(subject).map(([p]) => p)).toEqual(['App.tsx'])
  })
  it('falls back to a synthetic App.tsx from code when no files map', () => {
    expect(orderedFiles({ target: 't', idea: 'i', code: 'const A = 1' })).toEqual([['App.tsx', 'const A = 1']])
  })
  it('returns [] when neither files nor code present', () => {
    expect(orderedFiles({ target: 't', idea: 'i' })).toEqual([])
  })
})

describe('buildBrief', () => {
  it('includes idea, files, and focus', () => {
    const b = buildBrief({ target: 'gen1', idea: 'a todo app', code: 'const App = () => null' }, { focus: 'a11y' })
    expect(b).toMatch(/gen1/)
    expect(b).toMatch(/a todo app/)
    expect(b).toMatch(/PRIORITY FOCUS/)
    expect(b).toMatch(/a11y/)
    expect(b).toMatch(/const App/)
  })
  it('notes when no source files recorded', () => {
    expect(buildBrief({ target: 't', idea: 'i' })).toMatch(/no source files recorded/)
  })
  it('bounds the brief to the char budget (truncates)', () => {
    const big = 'x'.repeat(50_000)
    const b = buildBrief({ target: 't', idea: 'i', code: big }, { maxChars: 3_000 })
    expect(b.length).toBeLessThan(4_000)
    expect(b).toMatch(/truncated/)
  })
  it('omits remaining files when budget exhausted across multiple files', () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 20; i++) files[`F${i}.tsx`] = 'y'.repeat(1_000)
    const b = buildBrief({ target: 't', idea: 'i', files }, { maxChars: 3_000 })
    expect(b).toMatch(/remaining files omitted/)
  })
})

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

describe('coerceFinding', () => {
  it('validates and defaults fields', () => {
    const f = coerceFinding({ title: 'Dead button', file: 'App.tsx', line: '12', severity: 'BLOCKER', confidence: 2, category: 'nope' })
    expect(f).toMatchObject({ title: 'Dead button', file: 'App.tsx', line: 12, severity: 'blocker', confidence: 1, category: 'other' })
  })
  it('clamps confidence and coerces bad line to null', () => {
    expect(coerceFinding({ title: 't', confidence: -5, line: 'abc' })).toMatchObject({ confidence: 0, line: null })
    expect(coerceFinding({ title: 't', confidence: 'x' })!.confidence).toBe(0.5)
  })
  it('rejects a finding with neither title nor detail', () => {
    expect(coerceFinding({ file: 'App.tsx' })).toBeNull()
    expect(coerceFinding(null)).toBeNull()
    expect(coerceFinding('str')).toBeNull()
  })
  it('derives title from detail when only detail is given', () => {
    const f = coerceFinding({ detail: 'the handler is a no-op stub' })
    expect(f!.title).toBe('the handler is a no-op stub')
  })
  it('normalizes suggestion: empty string → null', () => {
    expect(coerceFinding({ title: 't', suggestion: '  ' })!.suggestion).toBeNull()
    expect(coerceFinding({ title: 't', suggestion: 'do x' })!.suggestion).toBe('do x')
    expect(coerceFinding({ title: 't' })!.suggestion).toBeNull()
  })
})

describe('extractJsonArrayText', () => {
  it('pulls from a ```json fence', () => {
    expect(extractJsonArrayText('VERDICT: approve\n```json\n[{"a":1}]\n```')).toBe('[{"a":1}]')
  })
  it('pulls from a bare fence containing an array', () => {
    expect(extractJsonArrayText('```\n[1,2]\n```')).toBe('[1,2]')
  })
  it('falls back to first balanced array, respecting nesting and strings', () => {
    expect(extractJsonArrayText('noise [ {"x": [1,2]}, "]" ] tail')).toBe('[ {"x": [1,2]}, "]" ]')
  })
  it('handles escaped quotes inside strings', () => {
    expect(extractJsonArrayText('[ "a\\"]b" ]')).toBe('[ "a\\"]b" ]')
  })
  it('returns null when there is no array', () => {
    expect(extractJsonArrayText('no brackets here')).toBeNull()
    expect(extractJsonArrayText('[ unclosed')).toBeNull()
  })
})

describe('extractFindings', () => {
  it('parses and validates each element, dropping junk', () => {
    const raw = '```json\n[{"title":"a"},{"nope":1},{"title":"b","severity":"nit"}]\n```'
    const fs = extractFindings(raw)
    expect(fs.map((f) => f.title)).toEqual(['a', 'b'])
  })
  it('returns [] for malformed JSON', () => {
    expect(extractFindings('```json\n[not json]\n```')).toEqual([])
  })
  it('returns [] when the JSON is not an array', () => {
    expect(extractFindings('```json\n{"title":"x"}\n```')).toEqual([])
  })
  it('returns [] when no array present', () => {
    expect(extractFindings('VERDICT: approve')).toEqual([])
  })
})

describe('parseReviewerOutput', () => {
  it('extracts verdict, summary, and findings', () => {
    const raw = 'VERDICT: request-changes\nSUMMARY: two lines\nof summary\n```json\n[{"title":"Dead save button","severity":"blocker","confidence":0.9}]\n```'
    const r = parseReviewerOutput('claude', raw)
    expect(r.model).toBe('claude')
    expect(r.verdict).toBe('request-changes')
    expect(r.summary).toMatch(/two lines/)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].severity).toBe('blocker')
  })
  it('defaults verdict to needs-discussion when missing/garbled', () => {
    expect(parseReviewerOutput('m', 'garbage output').verdict).toBe('needs-discussion')
  })
  it('handles an empty findings array gracefully', () => {
    const r = parseReviewerOutput('m', 'VERDICT: approve\nSUMMARY: clean\n```json\n[]\n```')
    expect(r.verdict).toBe('approve')
    expect(r.findings).toEqual([])
  })
  it('never throws on empty input', () => {
    expect(() => parseReviewerOutput('m', '')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// normalization + similarity
// ---------------------------------------------------------------------------

describe('normalizeTitle / normalizeFile', () => {
  it('normalizes case, punctuation, order; drops short tokens', () => {
    expect(normalizeTitle("The `save` Button is a No-Op!")).toBe(normalizeTitle('no op save button the is'))
  })
  it('collapses src/app/leading-slash file variants', () => {
    expect(normalizeFile('/src/App.tsx')).toBe('app.tsx')
    expect(normalizeFile('app/App.tsx')).toBe('app.tsx')
    expect(normalizeFile('App.tsx')).toBe('app.tsx')
  })
})

describe('titleSimilarity', () => {
  it('is 1 for identical, 0 for disjoint', () => {
    expect(titleSimilarity('save button broken', 'button save broken')).toBe(1)
    expect(titleSimilarity('save button broken', 'network timeout error')).toBe(0)
  })
  it('is between 0 and 1 for partial overlap', () => {
    const s = titleSimilarity('save button is broken', 'save button missing handler')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })
  it('treats two empty titles as identical', () => {
    expect(titleSimilarity('', '')).toBe(1)
    expect(titleSimilarity('save button broken', '')).toBe(0)
  })
})

describe('sameIssue', () => {
  it('matches same file + identical normalized title', () => {
    expect(sameIssue(finding({ title: 'Save button is broken' }), finding({ title: 'save button broken' }))).toBe(true)
  })
  it('matches same file + strong fuzzy overlap', () => {
    expect(
      sameIssue(finding({ title: 'save handler missing implementation' }), finding({ title: 'save handler missing body implementation' })),
    ).toBe(true)
  })
  it('matches same file + same line with modest overlap', () => {
    expect(
      sameIssue(finding({ line: 42, title: 'undefined variable analytics' }), finding({ line: 42, title: 'analytics undefined here' })),
    ).toBe(true)
  })
  it('does NOT match different files unless titles are identical', () => {
    expect(sameIssue(finding({ file: 'A.tsx', title: 'save broken' }), finding({ file: 'B.tsx', title: 'save broken' }))).toBe(true)
    expect(sameIssue(finding({ file: 'A.tsx', title: 'save broken' }), finding({ file: 'B.tsx', title: 'load broken' }))).toBe(false)
  })
  it('does NOT match unrelated findings in the same file', () => {
    expect(
      sameIssue(finding({ title: 'save button broken' }), finding({ title: 'missing responsive layout on mobile' })),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// THE MERGE — dedupe + agreement counting (the core signal)
// ---------------------------------------------------------------------------

describe('mergeFindingsLocally', () => {
  it('counts cross-model agreement for the same issue', () => {
    const reviews = [
      review('claude', [finding({ title: 'Save button is a dead no-op', confidence: 0.7 })]),
      review('qwen', [finding({ title: 'save button no-op dead', confidence: 0.9 })]),
      review('gemini', [finding({ title: 'dead save button no op', confidence: 0.6 })]),
    ]
    const merged = mergeFindingsLocally(reviews)
    expect(merged).toHaveLength(1)
    expect(merged[0].agreement).toBe(3)
    expect(merged[0].raisedBy).toEqual(['claude', 'gemini', 'qwen'])
    expect(merged[0].maxConfidence).toBe(0.9)
  })

  it('keeps distinct issues separate with agreement 1', () => {
    const reviews = [
      review('claude', [finding({ title: 'save button broken' })]),
      review('qwen', [finding({ title: 'missing dark mode toggle' })]),
    ]
    const merged = mergeFindingsLocally(reviews)
    expect(merged).toHaveLength(2)
    expect(merged.every((m) => m.agreement === 1)).toBe(true)
  })

  it('does NOT double-count the same model raising a near-dup twice', () => {
    // The same model listing two phrasings should not inflate agreement to 2.
    const reviews = [
      review('claude', [
        finding({ title: 'save button no-op dead' }),
        finding({ title: 'dead no-op save button' }),
      ]),
    ]
    const merged = mergeFindingsLocally(reviews)
    expect(merged[0].agreement).toBe(1)
    expect(merged[0].raisedBy).toEqual(['claude'])
  })

  it('escalates to the most severe severity across the cluster', () => {
    const reviews = [
      review('a', [finding({ title: 'save broken', severity: 'minor' })]),
      review('b', [finding({ title: 'save broken', severity: 'blocker' })]),
    ]
    expect(mergeFindingsLocally(reviews)[0].severity).toBe('blocker')
  })

  it('prefers the richest detail and fills missing suggestion/line', () => {
    const reviews = [
      review('a', [finding({ title: 'save broken', detail: 'short', suggestion: null, line: null })]),
      review('b', [finding({ title: 'save broken', detail: 'a much longer, better-evidenced detail', suggestion: 'wire onClick', line: 30 })]),
    ]
    const m = mergeFindingsLocally(reviews)[0]
    expect(m.detail).toMatch(/better-evidenced/)
    expect(m.suggestion).toBe('wire onClick')
    expect(m.line).toBe(30)
  })

  it('ignores findings from failed reviewers', () => {
    const reviews = [
      review('a', [finding({ title: 'x' })], { failed: true }),
      review('b', [finding({ title: 'y' })]),
    ]
    const merged = mergeFindingsLocally(reviews)
    expect(merged).toHaveLength(1)
    expect(merged[0].raisedBy).toEqual(['b'])
  })

  it('returns [] when there are no findings', () => {
    expect(mergeFindingsLocally([review('a', [])])).toEqual([])
  })
})

describe('rankFindings', () => {
  it('orders by severity, then agreement desc, then confidence desc', () => {
    const mk = (over: Partial<MergedFinding>): MergedFinding => ({
      ...finding(),
      raisedBy: [],
      agreement: 1,
      maxConfidence: 0.5,
      ...over,
    })
    const ranked = rankFindings([
      mk({ title: 'minor-lo', severity: 'minor', agreement: 1, maxConfidence: 0.2 }),
      mk({ title: 'blocker', severity: 'blocker', agreement: 1 }),
      mk({ title: 'major-2', severity: 'major', agreement: 2 }),
      mk({ title: 'major-1', severity: 'major', agreement: 1 }),
    ])
    expect(ranked.map((f) => f.title)).toEqual(['blocker', 'major-2', 'major-1', 'minor-lo'])
  })
})

// ---------------------------------------------------------------------------
// verdict derivation
// ---------------------------------------------------------------------------

describe('deriveVerdict', () => {
  const merge = (reviews: ReviewerReview[]) => mergeFindingsLocally(reviews)

  it('request-changes when a blocker is corroborated (agreement>=2)', () => {
    const reviews = [
      review('a', [finding({ title: 'boom', severity: 'blocker', confidence: 0.4 })]),
      review('b', [finding({ title: 'boom', severity: 'blocker', confidence: 0.4 })]),
    ]
    expect(deriveVerdict(reviews, merge(reviews))).toBe('request-changes')
  })

  it('request-changes when a lone blocker is high-confidence (>=0.7)', () => {
    const reviews = [review('a', [finding({ title: 'boom', severity: 'blocker', confidence: 0.9 })], { verdict: 'request-changes' })]
    expect(deriveVerdict(reviews, merge(reviews))).toBe('request-changes')
  })

  it('needs-discussion for a lone low-confidence blocker (chair discipline)', () => {
    const reviews = [review('a', [finding({ title: 'maybe boom', severity: 'blocker', confidence: 0.3 })], { verdict: 'needs-discussion' })]
    expect(deriveVerdict(reviews, merge(reviews))).toBe('needs-discussion')
  })

  it('needs-discussion when a major exists', () => {
    const reviews = [
      review('a', [finding({ title: 'meh', severity: 'major', confidence: 0.5 })], { verdict: 'approve' }),
      review('b', [], { verdict: 'approve' }),
    ]
    expect(deriveVerdict(reviews, merge(reviews))).toBe('needs-discussion')
  })

  it('request-changes when a majority of reviewers say so', () => {
    const reviews = [
      review('a', [], { verdict: 'request-changes' }),
      review('b', [], { verdict: 'request-changes' }),
      review('c', [], { verdict: 'approve' }),
    ]
    expect(deriveVerdict(reviews, merge(reviews))).toBe('request-changes')
  })

  it('approve when clean (only nits, all approve)', () => {
    const reviews = [
      review('a', [finding({ title: 'tiny', severity: 'nit', confidence: 0.9 })], { verdict: 'approve' }),
      review('b', [], { verdict: 'approve' }),
    ]
    expect(deriveVerdict(reviews, merge(reviews))).toBe('approve')
  })
})

// ---------------------------------------------------------------------------
// orchestration — runCommittee with a MOCKED runModel (no real I/O)
// ---------------------------------------------------------------------------

const SUBJECT: ReviewSubject = { target: 'gen1', idea: 'a todo app', code: 'const App = () => null' }

function mockModel(byModel: Record<string, string>, tokens = 100): RunModel {
  return vi.fn(async ({ model }) => ({ text: byModel[model] ?? 'VERDICT: approve\n```json\n[]\n```', tokens }))
}

describe('runCommittee', () => {
  it('runs the roster in parallel, merges, and returns a report', async () => {
    const rm = mockModel({
      'claude-opus-4.5': 'VERDICT: request-changes\n```json\n[{"title":"save button dead no-op","severity":"blocker","confidence":0.8,"file":"App.tsx"}]\n```',
      'qwen-2.5-coder-32b': 'VERDICT: request-changes\n```json\n[{"title":"dead no op save button","severity":"blocker","confidence":0.7,"file":"App.tsx"}]\n```',
      'gemini-2.5-pro': 'VERDICT: approve\n```json\n[]\n```',
    })
    const report = await runCommittee(SUBJECT, rm, { models: ['claude-opus-4.5', 'qwen-2.5-coder-32b', 'gemini-2.5-pro'] })
    expect(report.succeeded).toBe(3)
    expect(report.rosterSize).toBe(3)
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0].agreement).toBe(2)
    expect(report.verdict).toBe('request-changes')
    expect(report.tokensSpent).toBe(300)
    expect(rm).toHaveBeenCalledTimes(3)
  })

  it('calls each reviewer with its own independent context (same brief, no cross-talk)', async () => {
    const rm = mockModel({})
    await runCommittee(SUBJECT, rm, { models: ['m1', 'm2'] })
    const calls = (rm as any).mock.calls
    expect(calls).toHaveLength(2)
    // Same brief to both (independence = identical input, separate calls).
    expect(calls[0][0].user).toBe(calls[1][0].user)
    expect(calls[0][0].model).toBe('m1')
    expect(calls[1][0].model).toBe('m2')
  })

  it('tolerates a reviewer failing (>=1 success proceeds)', async () => {
    const rm: RunModel = vi.fn(async ({ model }) => {
      if (model === 'bad') throw new Error('502 upstream')
      return { text: 'VERDICT: approve\n```json\n[]\n```', tokens: 50 }
    })
    const report = await runCommittee(SUBJECT, rm, { models: ['good', 'bad'] })
    expect(report.succeeded).toBe(1)
    expect(report.reviewers).toEqual(['good'])
    expect(report.reviewerVerdicts.find((v) => v.model === 'bad')?.failed).toBe(true)
    expect(report.notes.some((n) => /bad failed/.test(n))).toBe(true)
  })

  it('returns an honest empty report when EVERY reviewer fails (fail-open)', async () => {
    const rm: RunModel = vi.fn(async () => {
      throw new Error('all down')
    })
    const report = await runCommittee(SUBJECT, rm, { models: ['a', 'b'] })
    expect(report.succeeded).toBe(0)
    expect(report.findings).toEqual([])
    expect(report.verdict).toBe('needs-discussion')
    expect(report.notes.some((n) => /every reviewer failed/.test(n))).toBe(true)
  })

  it('kill switch (enabled:false) yields an inert, non-blocking report and calls no models', async () => {
    const rm = mockModel({})
    const report = await runCommittee(SUBJECT, rm, { models: ['a'], enabled: false })
    expect(report.disabled).toBe(true)
    expect(report.verdict).toBe('approve') // non-blocking
    expect(rm).not.toHaveBeenCalled()
  })

  it('kill switch via env COMMITTEE_GATE_DISABLED', async () => {
    process.env.COMMITTEE_GATE_DISABLED = '1'
    const rm = mockModel({})
    const report = await runCommittee(SUBJECT, rm, { models: ['a'] })
    expect(report.disabled).toBe(true)
    expect(rm).not.toHaveBeenCalled()
  })

  it('empty roster (all-blank models) yields an inert report and calls no models', async () => {
    const rm = mockModel({})
    const report = await runCommittee(SUBJECT, rm, { models: ['', '  '] })
    expect(report.disabled).toBe(true)
    expect(report.notes.some((n) => /empty roster/.test(n))).toBe(true)
    expect(rm).not.toHaveBeenCalled()
  })

  it('runs the LLM chair when asked and under the cost cap', async () => {
    const rm: RunModel = vi.fn(async ({ system }) => {
      if (/You chair/.test(system)) return { text: '## Verdict\napprove', tokens: 20 }
      return { text: 'VERDICT: approve\n```json\n[]\n```', tokens: 10 }
    })
    const report = await runCommittee(SUBJECT, rm, { models: ['a', 'b'], useLlmChair: true, chair: 'claude-opus-4.5' })
    expect(report.chairNarrative).toMatch(/Verdict/)
    expect(report.tokensSpent).toBe(40) // 10 + 10 + 20
  })

  it('skips the LLM chair when reviewer spend exceeds the cost cap', async () => {
    const rm: RunModel = vi.fn(async () => ({ text: 'VERDICT: approve\n```json\n[]\n```', tokens: 5_000 }))
    const report = await runCommittee(SUBJECT, rm, { models: ['a', 'b'], useLlmChair: true, maxTokens: 1_000 })
    expect(report.chairNarrative).toBeUndefined()
    expect(report.notes.some((n) => /cost cap/.test(n))).toBe(true)
    // chair NOT called → only the 2 reviewer calls
    expect((rm as any).mock.calls.length).toBe(2)
  })

  it('a failing chair does not break the report (deterministic merge stands)', async () => {
    const rm: RunModel = vi.fn(async ({ system }) => {
      if (/You chair/.test(system)) throw new Error('chair down')
      return { text: 'VERDICT: approve\n```json\n[]\n```', tokens: 10 }
    })
    const report = await runCommittee(SUBJECT, rm, { models: ['a'], useLlmChair: true })
    expect(report.chairNarrative).toBeUndefined()
    expect(report.notes.some((n) => /chair .* failed/.test(n))).toBe(true)
    expect(report.verdict).toBe('approve')
  })
})

describe('buildChairInput', () => {
  it('includes the deterministic merge and each reviewer verdict', () => {
    const reviews = [review('claude', [finding({ title: 'x' })]), review('qwen', [], { failed: true })]
    const merged = mergeFindingsLocally(reviews)
    const input = buildChairInput(SUBJECT, reviews, merged)
    expect(input).toMatch(/Deterministic merge/)
    expect(input).toMatch(/raised by 1\/1/)
    expect(input).toMatch(/Reviewer 2 \(qwen\) — FAILED/)
  })
})

// ---------------------------------------------------------------------------
// offline analyzer — reviewGeneration (loadGeneration mocked)
// ---------------------------------------------------------------------------

describe('reviewGeneration (offline analyzer)', () => {
  it('loads a stored generation by chatId and reviews it', async () => {
    ;(loadGeneration as any).mockResolvedValue({
      prompt: 'a kanban board',
      generatedCode: 'const App = () => null',
      files: { 'App.tsx': 'const App = () => null' },
    })
    const rm = mockModel({
      a: 'VERDICT: approve\n```json\n[]\n```',
    })
    const report = await reviewGeneration('chat-123', rm, { models: ['a'] })
    expect(loadGeneration).toHaveBeenCalledWith('chat-123')
    expect(report.target).toBe('chat-123')
    expect(report.succeeded).toBe(1)
    // the idea/PRD (prompt) reached the brief
    expect((rm as any).mock.calls[0][0].user).toMatch(/a kanban board/)
  })

  it('returns an inert report when the generation is not found', async () => {
    ;(loadGeneration as any).mockResolvedValue(null)
    const report = await reviewGeneration('missing', mockModel({}), { models: ['a'] })
    expect(report.disabled).toBe(true)
    expect(report.notes.some((n) => /no stored generation/.test(n))).toBe(true)
  })

  it('fails open when loadGeneration throws', async () => {
    ;(loadGeneration as any).mockRejectedValue(new Error('zerodb down'))
    const report = await reviewGeneration('boom', mockModel({}), { models: ['a'] })
    expect(report.disabled).toBe(true)
    expect(report.notes.some((n) => /loadGeneration failed/.test(n))).toBe(true)
  })

  it('returns an inert report for a blank chatId (no I/O)', async () => {
    const rm = mockModel({})
    const report = await reviewGeneration('   ', rm, { models: ['a'] })
    expect(report.disabled).toBe(true)
    expect(loadGeneration).not.toHaveBeenCalled()
    expect(rm).not.toHaveBeenCalled()
  })

  it('honors the kill switch before any load', async () => {
    const rm = mockModel({})
    const report = await reviewGeneration('chat-x', rm, { models: ['a'], enabled: false })
    expect(report.disabled).toBe(true)
    expect(loadGeneration).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

describe('renderReport', () => {
  it('renders a disabled report as non-blocking', () => {
    const md = renderReport(inertReport('t', 3, ['kill switch']))
    expect(md).toMatch(/disabled/i)
    expect(md).toMatch(/Non-blocking/)
    expect(md).toMatch(/kill switch/)
  })

  it('renders findings with agreement counts and verdict', async () => {
    const reviews = [
      review('claude', [finding({ title: 'save button dead', severity: 'blocker', line: 12, suggestion: 'wire onClick', confidence: 0.8 })]),
      review('qwen', [finding({ title: 'dead save button', severity: 'blocker', confidence: 0.7 })]),
    ]
    const merged = mergeFindingsLocally(reviews)
    const report = {
      target: 'gen1',
      verdict: deriveVerdict(reviews, merged),
      reviewers: ['claude', 'qwen'],
      rosterSize: 2,
      succeeded: 2,
      reviewerVerdicts: reviews.map((r) => ({ model: r.model, verdict: r.verdict })),
      findings: merged,
      discarded: [],
      tokensSpent: 200,
      notes: [],
    }
    const md = renderReport(report)
    expect(md).toMatch(/Verdict:\*\* request-changes/)
    expect(md).toMatch(/2\/2/) // agreement
    expect(md).toMatch(/wire onClick/)
    expect(md).toMatch(/App\.tsx:12/)
  })

  it('renders a clean no-findings report', () => {
    const md = renderReport({
      target: 't',
      verdict: 'approve',
      reviewers: ['a'],
      rosterSize: 1,
      succeeded: 1,
      reviewerVerdicts: [{ model: 'a', verdict: 'approve' }],
      findings: [],
      discarded: [],
      tokensSpent: 10,
      notes: ['all good'],
    })
    expect(md).toMatch(/No findings/)
    expect(md).toMatch(/all good/)
  })

  it('includes the chair narrative when present', () => {
    const md = renderReport({
      target: 't',
      verdict: 'approve',
      reviewers: ['a'],
      rosterSize: 1,
      succeeded: 1,
      reviewerVerdicts: [],
      findings: [],
      discarded: [],
      chairNarrative: '## Verdict\napprove — clean',
      tokensSpent: 10,
      notes: [],
    })
    expect(md).toMatch(/Chair narrative/)
    expect(md).toMatch(/clean/)
  })
})
