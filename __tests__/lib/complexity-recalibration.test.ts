/**
 * #342 — complexity-analyzer recalibration threshold tests.
 *
 * The bug: parsePRDForBuildSteps only finds pages/features in STRUCTURED PRDs.
 * A raw multi-feature idea ("a CRM with contacts, deals, invoicing, and
 * reports") parsed to near-zero counts, so requiresChunking never fired and
 * the multi-pass planner sat dormant — every complex idea went single-shot.
 *
 * These tests pin the recalibrated thresholds against REAL example ideas,
 * exercising the exact pipeline chat-ws runs:
 *   parsePRDForBuildSteps(idea) → analyzeComplexity(analysis, idea)
 *
 * Calibration contract:
 *   - multi-FEATURE raw ideas (archetype + 2+ named surfaces, 4+ surfaces,
 *     or an explicit multi-page ask) → multi-pass fires
 *   - TERSE archetypes ("a dashboard") → NO chunking (they stay on the proven
 *     cheaper single-shot multi-file path, #293) but rank at least medium
 *   - simple ideas → nothing fires
 *   - structured PRDs with >5 explicit pages → still fire (regression guard)
 */
import { describe, it, expect } from 'vitest'
import {
  analyzeComplexity,
  augmentPRDAnalysisForChunking,
  getComplexityReport,
} from '../../lib/agent/complexity-analyzer'
import { parsePRDForBuildSteps } from '../../lib/prd-parser'
import { createChunkPlan } from '../../lib/agent/chunk-planner'

function scoreIdea(idea: string) {
  return analyzeComplexity(parsePRDForBuildSteps(idea), idea)
}

// ---------------------------------------------------------------------------
// Multi-feature raw ideas → multi-pass FIRES
// ---------------------------------------------------------------------------

const MULTI_FEATURE_IDEAS = [
  'A CRM for my landscaping business with contact management, a deal pipeline, invoicing, and a reports dashboard',
  'A project management tool with a kanban board, calendar view, team chat, and analytics',
  'An online store with a product catalog, shopping cart, checkout, and an orders dashboard',
  'An admin panel with a data table, charts, user settings, and an activity feed',
  'A booking system with a calendar, customer profiles, a payments dashboard and an inbox',
  'A multi-page app for a fitness studio with class schedules and member profiles',
]

describe('#342: multi-feature raw ideas fire the multi-pass planner', () => {
  for (const idea of MULTI_FEATURE_IDEAS) {
    it(`fires for: "${idea.slice(0, 60)}..."`, () => {
      const score = scoreIdea(idea)
      expect(score.multiFeatureIdea).toBe(true)
      expect(score.requiresChunking).toBe(true)
      expect(score.overallComplexity).toBe('complex')
      expect(score.chunkingStrategy).not.toBe('none')
    })
  }

  it('multi-feature ideas route to the strong path (shouldUseAgent)', () => {
    for (const idea of MULTI_FEATURE_IDEAS) {
      expect(scoreIdea(idea).shouldUseAgent).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Terse archetypes → NO chunking (single-shot multi-file is the cheaper
// proven path, #293), but ranked at least medium for model selection
// ---------------------------------------------------------------------------

const TERSE_ARCHETYPES = [
  'a CRM to track deals and customers',
  'an analytics dashboard',
  'an online store to sell products',
  'a project management app',
]

describe('#342: terse archetypes do NOT over-fire chunking', () => {
  for (const idea of TERSE_ARCHETYPES) {
    it(`no chunking for terse: "${idea}"`, () => {
      const score = scoreIdea(idea)
      expect(score.requiresChunking).toBe(false)
      expect(score.namesArchetype).toBe(true)
      // But they are NOT scored "simple" anymore (the original under-count bug)
      expect(score.overallComplexity).not.toBe('simple')
    })
  }

  it('a landing page that merely MENTIONS an archetype does not fire chunking', () => {
    const score = scoreIdea('a landing page for my CRM startup')
    expect(score.requiresChunking).toBe(false)
    expect(score.multiFeatureIdea).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Simple ideas → nothing fires (fast single-file Babel path preserved)
// ---------------------------------------------------------------------------

const SIMPLE_IDEAS = [
  'a simple counter app with an increment button',
  'a todo list where you can add and remove tasks',
  'a tip calculator',
  'a pomodoro timer',
  'a notes app to write and save notes',
  'a landing page for a coffee shop with hero, features, pricing, and footer',
]

describe('#342: simple ideas stay on the fast single-shot path', () => {
  for (const idea of SIMPLE_IDEAS) {
    it(`nothing fires for: "${idea}"`, () => {
      const score = scoreIdea(idea)
      expect(score.multiFeatureIdea).toBe(false)
      expect(score.requiresChunking).toBe(false)
      expect(score.namesArchetype).toBe(false)
    })
  }
})

// ---------------------------------------------------------------------------
// Structured PRDs — pre-#342 behavior preserved
// ---------------------------------------------------------------------------

describe('#342: structured PRDs keep firing (regression guard)', () => {
  const structuredPRD = [
    'Build this app with the following pages:',
    '1. **Homepage** (/)',
    '2. **Products** (/products)',
    '3. **Product Detail** (/products/detail)',
    '4. **Cart** (/cart)',
    '5. **Checkout** (/checkout)',
    '6. **Profile** (/profile)',
    '7. **Settings** (/settings)',
  ].join('\n')

  it('a 7-page explicit PRD still requires chunking', () => {
    const analysis = parsePRDForBuildSteps(structuredPRD)
    expect(analysis.pages.length).toBe(7)
    const score = analyzeComplexity(analysis, structuredPRD)
    expect(score.requiresChunking).toBe(true)
  })

  it('token-heavy PRDs still fire on the token threshold', () => {
    const bigPRD = [
      'Pages:',
      ...Array.from({ length: 9 }, (_, i) => `${i + 1}. **Page ${i + 1}** (/page-${i + 1})`),
    ].join('\n')
    const score = analyzeComplexity(parsePRDForBuildSteps(bigPRD), bigPRD)
    expect(score.estimatedTokens).toBeGreaterThan(10000)
    expect(score.requiresChunking).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Augmentation: the chunk planner must get real feature phases for raw ideas
// ---------------------------------------------------------------------------

describe('#342: augmentPRDAnalysisForChunking gives the planner real material', () => {
  const idea = MULTI_FEATURE_IDEAS[0] // landscaping CRM

  it('adds surface-derived pages to a sparse analysis', () => {
    const sparse = parsePRDForBuildSteps(idea)
    const augmented = augmentPRDAnalysisForChunking(sparse, idea)
    expect(augmented.pages.length).toBeGreaterThan(sparse.pages.length)
    expect(augmented.pages.length).toBeGreaterThanOrEqual(3)
    // Pure: input untouched
    expect(sparse.pages.length).toBe(parsePRDForBuildSteps(idea).pages.length)
  })

  it('does not duplicate routes the parser already found', () => {
    const sparse = parsePRDForBuildSteps(idea)
    const augmented = augmentPRDAnalysisForChunking(sparse, idea)
    const routes = augmented.pages.map((p) => p.route)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('is a no-op for ideas naming zero surfaces', () => {
    const simple = parsePRDForBuildSteps('a tip calculator')
    expect(augmentPRDAnalysisForChunking(simple, 'a tip calculator')).toBe(simple)
  })

  it('the resulting chunk plan has at least one FEATURE phase (not degenerate)', () => {
    const sparse = parsePRDForBuildSteps(idea)
    const score = analyzeComplexity(sparse, idea)
    const augmented = augmentPRDAnalysisForChunking(sparse, idea)
    const plan = createChunkPlan(idea, augmented, score)
    const featurePhases = plan.phases.filter((p) => p.phaseType === 'feature')
    expect(featurePhases.length).toBeGreaterThanOrEqual(1)
    expect(plan.phases[0].phaseType).toBe('core')
    expect(plan.phases[plan.phases.length - 1].phaseType).toBe('integration')
  })
})

// ---------------------------------------------------------------------------
// Report includes the new signals
// ---------------------------------------------------------------------------

describe('#342: complexity report surfaces the idea signals', () => {
  it('reports surfaces + archetype + multi-feature verdict', () => {
    const report = getComplexityReport(scoreIdea(MULTI_FEATURE_IDEAS[0]))
    expect(report).toContain('Idea Surfaces:')
    expect(report).toContain('names a complex archetype')
    expect(report).toContain('Multi-feature Idea: yes')
  })
})
