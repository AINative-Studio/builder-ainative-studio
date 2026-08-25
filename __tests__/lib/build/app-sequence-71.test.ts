/**
 * #71 — App-track sequence wiring for the two new artifacts.
 *
 * Properties under test:
 *   - APP_VIEWS gains codingStandards (after agentDef, before backlog) and
 *     sprintPlan (after backlog), preserving the rest of the composition order,
 *   - both new views have generation prompts (so autoplay's prose path runs them),
 *   - the codingStandards prompt is GROUNDED in the canonical standards (not
 *     hallucinated), and sprintPlan makes EPICS explicit,
 *   - titles + graph categories + composition edges are wired for both.
 */

import { describe, it, expect } from 'vitest'
import { APP_VIEWS, trackViews } from '@/lib/build/state'
import { ARTIFACT_PROMPTS, GENERATED_VIEWS, type ArtifactContext } from '@/lib/build/artifact-prompts'
import { ARTIFACT_TITLES } from '@/lib/build/titles'
import { ARTIFACT_CATEGORY, buildArtifactGraph } from '@/lib/build/artifact-graph'
import { codingStandardsContextBlock } from '@/lib/build/coding-standards'

const ctx = (over: Partial<ArtifactContext> = {}): ArtifactContext => ({
  idea: 'a scheduling app for dog groomers',
  track: 'app',
  prior: {},
  ...over,
})

describe('app sequence wiring (#71)', () => {
  it('places codingStandards after agentDef and before backlog', () => {
    const views = [...APP_VIEWS] as string[]
    expect(views.indexOf('codingStandards')).toBe(views.indexOf('agentDef') + 1)
    expect(views.indexOf('codingStandards')).toBeLessThan(views.indexOf('backlog'))
  })

  it('places sprintPlan after backlog and before swarm', () => {
    const views = [...APP_VIEWS] as string[]
    expect(views.indexOf('sprintPlan')).toBe(views.indexOf('backlog') + 1)
    expect(views.indexOf('sprintPlan')).toBeLessThan(views.indexOf('swarm'))
  })

  it('keeps the full expected App-track order', () => {
    expect([...APP_VIEWS]).toEqual([
      'brief', 'prd', 'comp', 'dataModel', 'memoryPolicy',
      'agentDef', 'codingStandards', 'apiSpec', 'backlog', 'sprintPlan',
      'swarm', 'infra', 'preview',
    ])
  })

  it('exposes both new views via trackViews(app)', () => {
    const views = trackViews('app')
    expect(views).toContain('codingStandards')
    expect(views).toContain('sprintPlan')
  })

  it('both new views are generated (autoplay prose path picks them up)', () => {
    expect(GENERATED_VIEWS.has('codingStandards')).toBe(true)
    expect(GENERATED_VIEWS.has('sprintPlan')).toBe(true)
    expect(ARTIFACT_PROMPTS.codingStandards).toBeTruthy()
    expect(ARTIFACT_PROMPTS.sprintPlan).toBeTruthy()
  })

  it('codingStandards prompt injects the canonical standards block (grounded, not hallucinated)', () => {
    const user = ARTIFACT_PROMPTS.codingStandards.user(ctx())
    expect(user).toContain(codingStandardsContextBlock())
    expect(user).toContain('Do NOT invent new ones')
    // schema carries per-standard title/rule/applies
    expect(ARTIFACT_PROMPTS.codingStandards.schemaHint).toContain('standards')
    expect(ARTIFACT_PROMPTS.codingStandards.schemaHint).toContain('applies')
  })

  it('sprintPlan prompt makes EPICS explicit and scopes a first sprint', () => {
    const user = ARTIFACT_PROMPTS.sprintPlan.user(ctx())
    expect(user.toUpperCase()).toContain('EPIC')
    expect(user).toContain('firstSprint')
    expect(ARTIFACT_PROMPTS.sprintPlan.schemaHint).toContain('epics')
    expect(ARTIFACT_PROMPTS.sprintPlan.schemaHint).toContain('firstSprint')
  })

  it('has titles + categories for both new views', () => {
    expect(ARTIFACT_TITLES.codingStandards).toBeTruthy()
    expect(ARTIFACT_TITLES.sprintPlan).toBeTruthy()
    expect(ARTIFACT_CATEGORY.codingStandards).toBe('Delivery')
    expect(ARTIFACT_CATEGORY.sprintPlan).toBe('Delivery')
  })

  it('wires composition edges so the swarm draws from both new artifacts', () => {
    const g = buildArtifactGraph('app')
    const ids = new Set(g.nodes.map((n) => n.id))
    expect(ids.has('codingStandards')).toBe(true)
    expect(ids.has('sprintPlan')).toBe(true)
    expect(g.edges).toContainEqual({ from: 'agentDef', to: 'codingStandards' })
    expect(g.edges).toContainEqual({ from: 'backlog', to: 'sprintPlan' })
    expect(g.edges).toContainEqual({ from: 'sprintPlan', to: 'swarm' })
    expect(g.edges).toContainEqual({ from: 'codingStandards', to: 'swarm' })
  })
})
