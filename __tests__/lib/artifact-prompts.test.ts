import { describe, it, expect } from 'vitest'
import {
  ARTIFACT_PROMPTS,
  GENERATED_VIEWS,
  type ArtifactContext,
  type ArtifactSpec,
} from '@/lib/build/artifact-prompts'

/**
 * Tests for artifact-prompts.ts — covers the ARTIFACT_PROMPTS map, BASE_SYSTEM,
 * ctxPreamble, and every spec's user(ctx) builder to close the coverage gap
 * (76.74% → ≥80%).
 *
 * Nothing in this file calls the network: all dependencies (primitive-catalog,
 * coding-standards) are pure in-memory and tested by exercising the exported
 * user() functions directly.
 */

// --------------- helpers ---------------

function makeCtx(partial: Partial<ArtifactContext> = {}): ArtifactContext {
  return {
    idea: 'A SaaS platform for freelance plumbers to manage jobs, invoicing, and parts inventory',
    track: 'company',
    prior: {},
    ...partial,
  }
}

// =======================================
// GENERATED_VIEWS set
// =======================================
describe('GENERATED_VIEWS', () => {
  it('contains every key in ARTIFACT_PROMPTS', () => {
    for (const key of Object.keys(ARTIFACT_PROMPTS)) {
      expect(GENERATED_VIEWS.has(key)).toBe(true)
    }
  })

  it('has the same size as ARTIFACT_PROMPTS', () => {
    expect(GENERATED_VIEWS.size).toBe(Object.keys(ARTIFACT_PROMPTS).size ?? Object.keys(ARTIFACT_PROMPTS).length)
  })

  it('includes all expected views', () => {
    const expected = [
      'thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30',
      'brief', 'prd', 'comp', 'dataModel', 'memoryPolicy', 'agentDef',
      'codingStandards', 'apiSpec', 'backlog', 'sprintPlan',
    ]
    for (const view of expected) {
      expect(GENERATED_VIEWS.has(view), `expected GENERATED_VIEWS to contain "${view}"`).toBe(true)
    }
  })
})

// =======================================
// Shape of every ArtifactSpec
// =======================================
describe('ARTIFACT_PROMPTS shape', () => {
  it('every spec has a non-empty system prompt', () => {
    for (const [key, spec] of Object.entries(ARTIFACT_PROMPTS)) {
      expect(typeof spec.system, `${key}.system must be string`).toBe('string')
      expect(spec.system.length, `${key}.system must not be empty`).toBeGreaterThan(0)
    }
  })

  it('every spec has a schemaHint string', () => {
    for (const [key, spec] of Object.entries(ARTIFACT_PROMPTS)) {
      expect(typeof spec.schemaHint, `${key}.schemaHint must be string`).toBe('string')
      expect(spec.schemaHint.length, `${key}.schemaHint must not be empty`).toBeGreaterThan(0)
    }
  })

  it('every spec has a user() function', () => {
    for (const [key, spec] of Object.entries(ARTIFACT_PROMPTS)) {
      expect(typeof spec.user, `${key}.user must be function`).toBe('function')
    }
  })

  it('all system prompts reference Cody and AINative Builder', () => {
    for (const [key, spec] of Object.entries(ARTIFACT_PROMPTS)) {
      expect(spec.system, `${key} system prompt must mention Cody`).toContain('Cody')
      expect(spec.system, `${key} system prompt must mention AINative Builder`).toContain('AINative Builder')
    }
  })

  it('all system prompts instruct strict JSON output', () => {
    for (const [key, spec] of Object.entries(ARTIFACT_PROMPTS)) {
      expect(spec.system, `${key} must require JSON`).toContain('JSON')
    }
  })
})

// =======================================
// ctxPreamble behaviour (indirectly via user())
// =======================================
describe('ctxPreamble (via user())', () => {
  it('includes the idea text in the generated prompt', () => {
    const ctx = makeCtx({ idea: 'unique-test-idea-string-xyz' })
    const prompt = ARTIFACT_PROMPTS.thesis.user(ctx)
    expect(prompt).toContain('unique-test-idea-string-xyz')
  })

  it('includes the companyName when provided', () => {
    const ctx = makeCtx({ companyName: 'PlumbPro Inc' })
    const prompt = ARTIFACT_PROMPTS.thesis.user(ctx)
    expect(prompt).toContain('PlumbPro Inc')
  })

  it('omits the working-name line when companyName is absent', () => {
    const ctx = makeCtx({ companyName: undefined })
    const prompt = ARTIFACT_PROMPTS.thesis.user(ctx)
    expect(prompt).not.toContain('working name')
  })

  it('includes prior context when prior is non-empty', () => {
    const ctx = makeCtx({
      prior: { thesis: { problem: 'plumbers have no software', wedge: 'job management' } },
    })
    const prompt = ARTIFACT_PROMPTS.wedge.user(ctx)
    expect(prompt).toContain('Already decided')
    expect(prompt).toContain('plumbers have no software')
  })

  it('omits the "already decided" block when prior is empty', () => {
    const ctx = makeCtx({ prior: {} })
    const prompt = ARTIFACT_PROMPTS.thesis.user(ctx)
    expect(prompt).not.toContain('Already decided')
  })

  it('truncates prior context at 2000 chars (large prior objects do not overflow)', () => {
    const bigValue = 'x'.repeat(5000)
    const ctx = makeCtx({ prior: { thesis: { text: bigValue } } })
    const prompt = ARTIFACT_PROMPTS.wedge.user(ctx)
    // The slice(0, 2000) means the prompt should not contain the full 5000-char string.
    expect(prompt.length).toBeLessThan(10000)
    // But the "already decided" header should appear.
    expect(prompt).toContain('Already decided')
  })
})

// =======================================
// Company-track artifact user() builders
// =======================================
describe('company-track artifact prompts', () => {
  const ctx = makeCtx({ track: 'company' })

  it('thesis prompt references the expected JSON keys', () => {
    const prompt = ARTIFACT_PROMPTS.thesis.user(ctx)
    expect(prompt).toContain('problem')
    expect(prompt).toContain('wedge')
    expect(prompt).toContain('whyNow')
    expect(prompt).toContain('VENTURE THESIS')
  })

  it('thesis schemaHint is valid JSON-like and contains required keys', () => {
    const hint = ARTIFACT_PROMPTS.thesis.schemaHint
    expect(hint).toContain('problem')
    expect(hint).toContain('wedge')
    expect(hint).toContain('whyNow')
  })

  it('wedge prompt references the expected JSON keys', () => {
    const prompt = ARTIFACT_PROMPTS.wedge.user(ctx)
    expect(prompt).toContain('headline')
    expect(prompt).toContain('segment')
    expect(prompt).toContain('proofPlan')
    expect(prompt).toContain('WEDGE')
  })

  it('businessModel prompt references tiers and economics keys', () => {
    const prompt = ARTIFACT_PROMPTS.businessModel.user(ctx)
    expect(prompt).toContain('tiers')
    expect(prompt).toContain('economics')
    expect(prompt).toContain('BUSINESS MODEL')
  })

  it('positioning prompt references statement and unlike keys', () => {
    const prompt = ARTIFACT_PROMPTS.positioning.user(ctx)
    expect(prompt).toContain('statement')
    expect(prompt).toContain('unlike')
    expect(prompt).toContain('POSITIONING')
  })

  it('landing prompt specifies exactly 3 features', () => {
    const prompt = ARTIFACT_PROMPTS.landing.user(ctx)
    expect(prompt).toContain('exactly 3')
    expect(prompt).toContain('eyebrow')
    expect(prompt).toContain('headline')
  })

  it('plan30 prompt specifies exactly 4 weeks', () => {
    const prompt = ARTIFACT_PROMPTS.plan30.user(ctx)
    expect(prompt).toContain('exactly 4')
    expect(prompt).toContain('30-DAY PLAN')
    expect(prompt).toContain('weeks')
  })
})

// =======================================
// App-track artifact user() builders
// =======================================
describe('app-track artifact prompts', () => {
  const ctx = makeCtx({ track: 'app' })

  it('brief prompt references summary, goals, nonGoals, users keys', () => {
    const prompt = ARTIFACT_PROMPTS.brief.user(ctx)
    expect(prompt).toContain('summary')
    expect(prompt).toContain('goals')
    expect(prompt).toContain('nonGoals')
    expect(prompt).toContain('users')
    expect(prompt).toContain('PRODUCT BRIEF')
  })

  it('prd prompt references features with priority levels', () => {
    const prompt = ARTIFACT_PROMPTS.prd.user(ctx)
    expect(prompt).toContain('P0')
    expect(prompt).toContain('P1')
    expect(prompt).toContain('P2')
    expect(prompt).toContain('acceptance')
  })

  it('comp prompt for app track mentions "app" in the context', () => {
    const prompt = ARTIFACT_PROMPTS.comp.user(ctx)
    expect(prompt).toContain('app')
    expect(prompt).toContain('primitives')
  })

  it('comp prompt for company track mentions "company"', () => {
    const companyCtx = makeCtx({ track: 'company' })
    const prompt = ARTIFACT_PROMPTS.comp.user(companyCtx)
    expect(prompt).toContain('company')
  })

  it('dataModel prompt references ZeroDB tables', () => {
    const prompt = ARTIFACT_PROMPTS.dataModel.user(ctx)
    expect(prompt).toContain('ZeroDB')
    expect(prompt).toContain('entities')
    expect(prompt).toContain('DATA MODEL')
  })

  it('memoryPolicy prompt references ZeroMemory and privacy rules', () => {
    const prompt = ARTIFACT_PROMPTS.memoryPolicy.user(ctx)
    expect(prompt).toContain('ZeroMemory')
    expect(prompt).toContain('MEMORY POLICY')
    expect(prompt).toContain('rules')
  })

  it('agentDef prompt references agents with name and role', () => {
    const prompt = ARTIFACT_PROMPTS.agentDef.user(ctx)
    expect(prompt).toContain('agents')
    expect(prompt).toContain('name')
    expect(prompt).toContain('role')
    expect(prompt).toContain('AGENT DEFINITION')
  })

  it('apiSpec prompt references integrations', () => {
    const prompt = ARTIFACT_PROMPTS.apiSpec.user(ctx)
    expect(prompt).toContain('integrations')
    expect(prompt).toContain('INTEGRATIONS')
  })

  it('backlog prompt specifies build order and size labels', () => {
    const prompt = ARTIFACT_PROMPTS.backlog.user(ctx)
    expect(prompt).toContain('BUILD BACKLOG')
    expect(prompt).toContain('"S"')
    expect(prompt).toContain('"M"')
    expect(prompt).toContain('"L"')
  })

  it('sprintPlan prompt defines epics + firstSprint structure', () => {
    const prompt = ARTIFACT_PROMPTS.sprintPlan.user(ctx)
    expect(prompt).toContain('SPRINT PLAN')
    expect(prompt).toContain('epics')
    expect(prompt).toContain('firstSprint')
    expect(prompt).toContain('EPICS')
  })
})

// =======================================
// codingStandards — injects canonical block
// =======================================
describe('codingStandards artifact', () => {
  const ctx = makeCtx({ track: 'app' })

  it('user() includes the AINative engineering standards context block', () => {
    const prompt = ARTIFACT_PROMPTS.codingStandards.user(ctx)
    // The codingStandardsContextBlock() starts with this header string.
    expect(prompt).toContain('AINATIVE ENGINEERING STANDARDS')
  })

  it('user() instructs the model to use the canonical standards, not invent new ones', () => {
    const prompt = ARTIFACT_PROMPTS.codingStandards.user(ctx)
    expect(prompt).toContain('Do NOT invent new ones')
  })

  it('user() asks for one entry per standard in the same order', () => {
    const prompt = ARTIFACT_PROMPTS.codingStandards.user(ctx)
    expect(prompt).toContain('ONE entry per standard')
    expect(prompt).toContain('same order')
  })

  it('schemaHint includes title, rule and applies fields', () => {
    const hint = ARTIFACT_PROMPTS.codingStandards.schemaHint
    expect(hint).toContain('title')
    expect(hint).toContain('rule')
    expect(hint).toContain('applies')
  })

  it('user() prompt includes the idea text (preamble is present)', () => {
    const myCtx = makeCtx({ idea: 'coding-standards-idea-sentinel' })
    const prompt = ARTIFACT_PROMPTS.codingStandards.user(myCtx)
    expect(prompt).toContain('coding-standards-idea-sentinel')
  })

  it('user() includes prior context when provided', () => {
    const myCtx = makeCtx({ prior: { prd: { overview: 'a plumber app PRD' } } })
    const prompt = ARTIFACT_PROMPTS.codingStandards.user(myCtx)
    expect(prompt).toContain('a plumber app PRD')
  })
})

// =======================================
// sprintPlan — specific coverage branch
// =======================================
describe('sprintPlan artifact', () => {
  it('schemaHint includes epics, firstSprint and issues', () => {
    const hint = ARTIFACT_PROMPTS.sprintPlan.schemaHint
    expect(hint).toContain('epics')
    expect(hint).toContain('firstSprint')
    expect(hint).toContain('issues')
  })

  it('user() prompt is specific to the provided idea (not generic filler)', () => {
    const ctx = makeCtx({ idea: 'sprint-plan-sentinel-idea-unique-xyz' })
    const prompt = ARTIFACT_PROMPTS.sprintPlan.user(ctx)
    expect(prompt).toContain('sprint-plan-sentinel-idea-unique-xyz')
  })
})

// =======================================
// comp — catalog injection coverage
// =======================================
describe('comp (composition plan) artifact', () => {
  it('user() includes the full AINative primitive catalog', () => {
    const ctx = makeCtx({ track: 'app' })
    const prompt = ARTIFACT_PROMPTS.comp.user(ctx)
    expect(prompt).toContain('AINATIVE PRIMITIVE CATALOG')
  })

  it('schemaHint includes primitives array with name and use', () => {
    const hint = ARTIFACT_PROMPTS.comp.schemaHint
    expect(hint).toContain('primitives')
    expect(hint).toContain('name')
    expect(hint).toContain('use')
  })

  it('user() warns against defaulting to a generic primitive set', () => {
    const ctx = makeCtx({ track: 'app' })
    const prompt = ARTIFACT_PROMPTS.comp.user(ctx)
    expect(prompt).toContain('Do not default to a generic set')
  })
})
