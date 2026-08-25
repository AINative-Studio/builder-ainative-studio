import { describe, it, expect } from 'vitest'
import {
  BUYER_QUESTIONS,
  BRANDS,
  answerMentionsBrand,
  countBrandMentions,
  computeResults,
  buildReport,
  formatShare,
  formatMarkdownReport,
  reportDateSlug,
  extractDataForSeoAnswers,
  type BrandDef,
} from '@/lib/growth/llm-mention-tracker'

const byKey = (key: string): BrandDef =>
  BRANDS.find((b) => b.key === key) as BrandDef

describe('llm-mention-tracker (#47)', () => {
  describe('question set', () => {
    it('defines exactly 10 buyer questions', () => {
      expect(BUYER_QUESTIONS).toHaveLength(10)
    })

    it('names no tracked brands (brand-free questions)', () => {
      const joined = BUYER_QUESTIONS.join(' ').toLowerCase()
      for (const brand of BRANDS) {
        for (const alias of brand.aliases) {
          expect(joined).not.toContain(alias.toLowerCase())
        }
      }
    })

    it('mentions AI/build in every question (on-topic)', () => {
      for (const q of BUYER_QUESTIONS) {
        expect(q.toLowerCase()).toMatch(/ai|app|startup|saas|mvp|product/)
      }
    })
  })

  describe('brand definitions', () => {
    it('marks exactly one primary brand (Builder)', () => {
      const primaries = BRANDS.filter((b) => b.primary)
      expect(primaries).toHaveLength(1)
      expect(primaries[0].key).toBe('builder')
    })

    it('tracks all five competitor set brands', () => {
      expect(BRANDS.map((b) => b.key).sort()).toEqual(
        ['bolt', 'builder', 'lovable', 'polsia', 'replit'].sort()
      )
    })
  })

  describe('answerMentionsBrand', () => {
    it('matches an alias case-insensitively as a whole word', () => {
      expect(answerMentionsBrand('Try Polsia today', byKey('polsia'))).toBe(true)
      expect(answerMentionsBrand('try POLSIA today', byKey('polsia'))).toBe(true)
    })

    it('matches AINative for the Builder brand', () => {
      expect(
        answerMentionsBrand('Use AINative Builder to ship fast', byKey('builder'))
      ).toBe(true)
      expect(answerMentionsBrand('go to ainative.studio', byKey('builder'))).toBe(
        true
      )
    })

    it('does NOT count the generic word "builder" as an AINative mention', () => {
      expect(
        answerMentionsBrand('any app builder or website builder', byKey('builder'))
      ).toBe(false)
    })

    it('does not match a brand embedded in a larger word', () => {
      expect(answerMentionsBrand('replitx is unrelated', byKey('replit'))).toBe(
        false
      )
      expect(answerMentionsBrand('boltage meter', byKey('bolt'))).toBe(false)
    })

    it('matches brand tokens with dots (bolt.new, lovable.dev)', () => {
      expect(answerMentionsBrand('check out bolt.new', byKey('bolt'))).toBe(true)
      expect(answerMentionsBrand('lovable.dev is nice', byKey('lovable'))).toBe(
        true
      )
    })

    it('matches a brand surrounded by punctuation', () => {
      expect(answerMentionsBrand('(Replit) and others.', byKey('replit'))).toBe(
        true
      )
    })

    it('returns false for empty/undefined answers', () => {
      expect(answerMentionsBrand('', byKey('polsia'))).toBe(false)
      expect(
        answerMentionsBrand(undefined as unknown as string, byKey('polsia'))
      ).toBe(false)
    })
  })

  describe('countBrandMentions', () => {
    it('counts each answer at most once per brand', () => {
      const answers = ['Polsia, Polsia, and Polsia are great']
      const counts = countBrandMentions(answers)
      expect(counts.polsia).toBe(1)
    })

    it('counts across multiple answers', () => {
      const answers = [
        'I recommend Replit and Lovable.',
        'Bolt.new is fast.',
        'AINative Builder deploys the app.',
        'No brand here at all.',
      ]
      const counts = countBrandMentions(answers)
      expect(counts).toEqual({
        builder: 1,
        polsia: 0,
        lovable: 1,
        replit: 1,
        bolt: 1,
      })
    })

    it('initializes every brand to zero even with empty input', () => {
      const counts = countBrandMentions([])
      expect(counts).toEqual({
        builder: 0,
        polsia: 0,
        lovable: 0,
        replit: 0,
        bolt: 0,
      })
    })
  })

  describe('computeResults', () => {
    const answers = [
      'Use AINative Builder.',
      'Use AINative Builder or Replit.',
      'Try Polsia.',
      'Nothing relevant.',
    ]

    it('computes mentions and share out of total answers', () => {
      const results = computeResults(answers)
      const builder = results.find((r) => r.key === 'builder')!
      expect(builder.mentions).toBe(2)
      expect(builder.share).toBe(0.5) // 2 / 4
      expect(builder.primary).toBe(true)
    })

    it('respects an explicit total denominator ("out of 50")', () => {
      const results = computeResults(['Try Polsia.'], BRANDS, 50)
      const polsia = results.find((r) => r.key === 'polsia')!
      expect(polsia.mentions).toBe(1)
      expect(polsia.share).toBe(0.02) // 1 / 50
    })

    it('yields zero share when total is zero (no divide-by-zero)', () => {
      const results = computeResults([], BRANDS, 0)
      for (const r of results) {
        expect(r.mentions).toBe(0)
        expect(r.share).toBe(0)
      }
    })
  })

  describe('buildReport', () => {
    const answers = [
      'AINative Builder and Replit.',
      'AINative Builder alone.',
      'Polsia here.',
    ]
    const report = buildReport({
      date: '2026-08-24',
      source: 'direct-llm',
      model: 'claude-sonnet-4',
      questions: 10,
      runsPerQuestion: 5,
      answers,
      notes: 'test run',
    })

    it('carries through metadata and total answers', () => {
      expect(report.date).toBe('2026-08-24')
      expect(report.source).toBe('direct-llm')
      expect(report.model).toBe('claude-sonnet-4')
      expect(report.questions).toBe(10)
      expect(report.runsPerQuestion).toBe(5)
      expect(report.totalAnswers).toBe(3)
      expect(report.notes).toBe('test run')
    })

    it('sorts results by mentions descending', () => {
      const mentions = report.results.map((r) => r.mentions)
      const sorted = [...mentions].sort((a, b) => b - a)
      expect(mentions).toEqual(sorted)
      expect(report.results[0].key).toBe('builder') // 2 mentions, top
    })
  })

  describe('formatShare', () => {
    it('formats a fraction as a percentage with one decimal', () => {
      expect(formatShare(0.24)).toBe('24.0%')
      expect(formatShare(0)).toBe('0.0%')
      expect(formatShare(1)).toBe('100.0%')
    })
  })

  describe('formatMarkdownReport', () => {
    const report = buildReport({
      date: '2026-08-24',
      source: 'dataforseo',
      model: 'dataforseo:gpt-4o',
      questions: 10,
      runsPerQuestion: 5,
      answers: ['AINative Builder wins.', 'Polsia here.'],
      notes: 'baseline',
    })
    const md = formatMarkdownReport(report)

    it('includes a dated title and the sample size', () => {
      expect(md).toContain('# LLM Mention Tracker — 2026-08-24')
      expect(md).toContain('10 questions × 5 runs')
    })

    it('renders a markdown table with a row per brand', () => {
      expect(md).toContain('| Brand | Mentions (out of 2) | Share |')
      // primary brand bolded
      expect(md).toContain('**Builder (AINative)**')
      // one data row per brand + header + separator
      const rows = md.split('\n').filter((l) => l.startsWith('| '))
      expect(rows.length).toBe(BRANDS.length + 1) // + header row
    })

    it('includes notes as a blockquote when present', () => {
      expect(md).toContain('> baseline')
    })
  })

  describe('reportDateSlug', () => {
    it('renders a YYYY-MM-DD slug', () => {
      expect(reportDateSlug(new Date('2026-08-24T12:34:56Z'))).toBe('2026-08-24')
    })
  })

  describe('extractDataForSeoAnswers', () => {
    it('pulls item.text out of the nested tasks/result/items envelope', () => {
      const body = {
        tasks: [
          {
            result: [
              {
                items: [
                  { type: 'message', text: 'Try Replit or Lovable.' },
                  { type: 'message', text: 'AINative Builder deploys it.' },
                ],
              },
            ],
          },
        ],
      }
      expect(extractDataForSeoAnswers(body)).toEqual([
        'Try Replit or Lovable.',
        'AINative Builder deploys it.',
      ])
    })

    it('pulls text out of item.sections[]', () => {
      const body = {
        tasks: [
          {
            result: [
              {
                items: [
                  { sections: [{ text: 'Polsia is one option.' }, { text: '' }] },
                ],
              },
            ],
          },
        ],
      }
      expect(extractDataForSeoAnswers(body)).toEqual(['Polsia is one option.'])
    })

    it('returns [] for malformed / empty payloads', () => {
      expect(extractDataForSeoAnswers(undefined)).toEqual([])
      expect(extractDataForSeoAnswers({})).toEqual([])
      expect(extractDataForSeoAnswers({ tasks: 'nope' })).toEqual([])
      expect(extractDataForSeoAnswers({ tasks: [{}] })).toEqual([])
      expect(extractDataForSeoAnswers({ tasks: [{ result: [{}] }] })).toEqual([])
    })

    it('feeds directly into the counter for an end-to-end count', () => {
      const body = {
        tasks: [
          {
            result: [
              {
                items: [
                  { text: 'I would use Replit.' },
                  { text: 'Bolt.new and AINative Builder.' },
                ],
              },
            ],
          },
        ],
      }
      const answers = extractDataForSeoAnswers(body)
      const counts = countBrandMentions(answers)
      expect(counts.replit).toBe(1)
      expect(counts.bolt).toBe(1)
      expect(counts.builder).toBe(1)
      expect(counts.polsia).toBe(0)
    })
  })
})
