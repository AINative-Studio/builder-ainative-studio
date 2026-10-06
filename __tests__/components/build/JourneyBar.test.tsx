// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const mockState = {
  track: 'app' as const,
  view: 'brief',
  done: { design: 'done', brief: 'done' },
  auto: false,
  screen: 'workspace',
  designStepDone: true,
  builtCompany: false,
  builtMVP: false,
  railOpen: false,
  indexOpen: false,
}
const goViewMock = vi.fn()
const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: mockState,
    views: ['design', 'brief', 'prd', 'comp', 'dataModel', 'memoryPolicy', 'agentDef', 'codingStandards', 'apiSpec', 'backlog', 'sprintPlan', 'swarm', 'infra', 'preview'],
    goView: goViewMock,
    dispatch: dispatchMock,
    woven: 2,
    totalPrimitives: 10,
  }),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }))

import { JourneyBar } from '@/components/build/JourneyBar'

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
  vi.clearAllMocks()
})

describe('JourneyBar (#BLD-06.1)', () => {
  it('renders the App track phase labels, not the Company labels', () => {
    render(React.createElement(JourneyBar))
    expect(host.textContent).toContain('Design')
    expect(host.textContent).not.toContain('Company')
  })

  it('renders the full artifact chip row beneath the phase row', () => {
    render(React.createElement(JourneyBar))
    expect(host.querySelectorAll('.m-crumb').length).toBe(14) // full APP_VIEWS length
  })

  it('marks a done artifact chip as done, the current one as current', () => {
    render(React.createElement(JourneyBar))
    const briefChip = Array.from(host.querySelectorAll('.m-crumb')).find((el) => el.textContent === 'brief') as HTMLButtonElement
    expect(briefChip.className).toContain('is-current')
    const designChip = Array.from(host.querySelectorAll('.m-crumb')).find((el) => el.textContent === 'design') as HTMLButtonElement
    expect(designChip.className).toContain('is-done')
  })

  it('clicking a done, non-current chip calls goView', () => {
    render(React.createElement(JourneyBar))
    const designChip = Array.from(host.querySelectorAll('.m-crumb')).find((el) => el.textContent === 'design') as HTMLButtonElement
    act(() => { designChip.click() })
    expect(goViewMock).toHaveBeenCalledWith('design')
  })

  it('does not render the old Artifacts-rail toggle button', () => {
    render(React.createElement(JourneyBar))
    expect(host.textContent).not.toMatch(/Artifacts · \d/)
  })
})
