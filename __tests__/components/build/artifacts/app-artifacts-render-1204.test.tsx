// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — app-artifacts.tsx (components/build/artifacts/
 * app-artifacts.tsx, 281 lines, reached live via
 * components/build/ArtifactRouter.tsx <- components/build/screens/
 * Workspace.tsx) had zero test coverage. 11 pure-presentational artifact
 * bodies, each sharing the same real shape: useGen(view) -> shimmer while
 * pending, real generated data once it lands, or a realistic static example
 * + a real error banner once generation has failed.
 *
 * useGen itself is already independently tested
 * (__tests__/lib/build/gen-helpers.test.ts) and is a thin read over
 * useBuild() context — mocked here at that real context boundary so this
 * file verifies only app-artifacts.tsx's own per-view rendering of
 * useGen's real {data, error} shape.
 */

const h = vi.hoisted(() => ({ generated: {} as Record<string, any>, genError: {} as Record<string, string> }))
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: { generated: h.generated, genError: h.genError } }),
}))

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  h.generated = {}
  h.genError = {}
})

describe('app-artifacts — real per-view generation-state rendering coverage (#1204)', () => {
  it('Brief: shows the real shimmer while pending (no data, no error)', async () => {
    const { Brief } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(Brief))
    expect(host.textContent).toContain('Cody is drafting this from your idea')
  })

  it('Brief: renders real generated data once it lands', async () => {
    h.generated.brief = { summary: 'Real summary', goals: ['Real goal 1'], nonGoals: ['Real non-goal'], users: ['Real users'] }
    const { Brief } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(Brief))
    expect(host.textContent).toContain('Real summary')
    expect(host.textContent).toContain('Real goal 1')
    expect(host.textContent).toContain('ASSUMPTION')
  })

  it('Brief: on a real genError with no data, shows the real error banner AND the static fallback (never a blank artifact)', async () => {
    h.genError.brief = 'rate_limited'
    const { Brief } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(Brief))
    expect(host.textContent).toContain('Generation failed (rate_limited)')
    expect(host.textContent).toContain('A private answer engine')
  })

  it('Prd: renders the real features table with real priority chips', async () => {
    h.generated.prd = { overview: 'Real overview', features: [{ name: 'Real feature', desc: 'Real desc', priority: 'P2' }], acceptance: ['Real acceptance'] }
    const { Prd } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(Prd))
    expect(host.querySelector('table')).not.toBeNull()
    expect(host.textContent).toContain('Real feature')
    expect(host.textContent).toContain('P2')
  })

  it('Comp: wires a real primitive tooltip title attribute when getPrimitiveTooltip recognizes the name', async () => {
    h.generated.comp = { summary: 'Real comp summary', primitives: [{ name: 'ZeroDB · Vectors', use: 'Real use' }] }
    const { Comp } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(Comp))
    const chip = Array.from(host.querySelectorAll('.m-chip')).find((el) => el.textContent === 'ZeroDB · Vectors')
    expect(chip?.getAttribute('title')).toMatch(/yours, on your own API/)
  })

  it('Comp: never sets a title attribute for an unrecognized primitive name', async () => {
    h.generated.comp = { summary: 'x', primitives: [{ name: 'Totally Made Up Primitive', use: 'y' }] }
    const { Comp } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(Comp))
    const chip = Array.from(host.querySelectorAll('.m-chip')).find((el) => el.textContent === 'Totally Made Up Primitive')
    expect(chip?.hasAttribute('title')).toBe(false)
  })

  it('DataModel: renders real entities with their real fields', async () => {
    h.generated.dataModel = { summary: 'Real summary', entities: [{ name: 'Widget', fields: ['id · uuid', 'name · text'] }] }
    const { DataModel } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(DataModel))
    expect(host.textContent).toContain('Widget')
    expect(host.textContent).toContain('id · uuid')
  })

  it('MemoryPolicy: renders real summary and real rules', async () => {
    h.generated.memoryPolicy = { summary: 'Real memory summary', rules: ['Real rule 1', 'Real rule 2'] }
    const { MemoryPolicy } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(MemoryPolicy))
    expect(host.textContent).toContain('Real memory summary')
    expect(host.textContent).toContain('Real rule 1')
  })

  it('AgentDef: renders real agent name/role pairs', async () => {
    h.generated.agentDef = { summary: 'Real agent summary', agents: [{ name: 'Real Agent', role: 'Real role' }] }
    const { AgentDef } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(AgentDef))
    expect(host.textContent).toContain('Real Agent')
    expect(host.textContent).toContain('Real role')
  })

  it('CodingStandards: the real fallback (once a genError has already been set, per useGen\'s own real gate) mirrors the CANONICAL CODING_STANDARDS list, never invented per-idea', async () => {
    h.genError.codingStandards = 'timeout'
    const { CODING_STANDARDS } = await import('@/lib/build/coding-standards')
    const { CodingStandards } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(CodingStandards))
    expect(host.textContent).toContain(CODING_STANDARDS[0].title)
    expect(host.textContent).toContain(CODING_STANDARDS[0].rule)
  })

  it('CodingStandards: renders a real evidence Tag only when a real standard carries `applies`', async () => {
    h.generated.codingStandards = { summary: 'x', standards: [{ title: 'Real Title', rule: 'Real rule', applies: 'PR #999' }] }
    const { CodingStandards } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(CodingStandards))
    expect(host.textContent).toContain('PR #999')
  })

  it('SprintPlan: renders real epics and the real first-sprint checklist', async () => {
    h.generated.sprintPlan = { summary: 'x', epics: [{ name: 'Real Epic', goal: 'Real goal', issues: ['Real issue'] }], firstSprint: ['Real first item'] }
    const { SprintPlan } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(SprintPlan))
    expect(host.textContent).toContain('Real Epic')
    expect(host.textContent).toContain('Real first item')
  })

  it('ApiSpec: renders real integrations each marked real "Wired"', async () => {
    h.generated.apiSpec = { summary: 'x', integrations: [{ name: 'Real Integration', why: 'Real why' }] }
    const { ApiSpec } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(ApiSpec))
    expect(host.textContent).toContain('Real Integration')
    expect(host.textContent).toContain('Wired')
  })

  it('Backlog: renders real items cycling through the real fixed agent list by index', async () => {
    h.generated.backlog = { summary: 'x', items: [{ title: 'Item A', size: 'S' }, { title: 'Item B', size: 'M' }] }
    const { Backlog } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(Backlog))
    const rows = host.querySelectorAll('tbody tr')
    expect(rows.length).toBe(2)
    expect(rows[0].textContent).toContain('Backend')
    expect(rows[1].textContent).toContain('Frontend')
  })

  it('Infra: is a static checklist that never calls useGen (renders the same regardless of generated/genError state)', async () => {
    const { Infra } = await import('@/components/build/artifacts/app-artifacts')
    render(React.createElement(Infra))
    expect(host.textContent).toContain('ZeroDB project')
    expect(host.textContent).toContain('OAuth 2.1 + PKCE')
  })

  it('APP_ARTIFACT_BODIES: the real registry maps every expected view key to a real, distinct component', async () => {
    const { APP_ARTIFACT_BODIES } = await import('@/components/build/artifacts/app-artifacts')
    const expectedKeys = ['brief', 'prd', 'comp', 'dataModel', 'memoryPolicy', 'agentDef', 'codingStandards', 'apiSpec', 'backlog', 'sprintPlan', 'infra']
    expect(Object.keys(APP_ARTIFACT_BODIES).sort()).toEqual(expectedKeys.sort())
    expectedKeys.forEach((key) => expect(typeof APP_ARTIFACT_BODIES[key]).toBe('function'))
  })
})
