// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { buildArtifactGraph } from '@/lib/build/artifact-graph'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — Graph (components/build/artifacts/Graph.tsx,
 * 54 lines, reached live via components/build/ArtifactRouter.tsx's 'graph'
 * registry entry — the same real view-key registry pattern already covered
 * for DesignPicker/Conflict/Wedge/RescopeIntent/Pipeline) had zero test
 * coverage. Uses the real buildArtifactGraph() from
 * lib/build/artifact-graph.ts (already independently tested in
 * artifact-graph.test.ts) to derive the real node/edge/count expectations
 * rather than hand-building a graph fixture.
 */

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: h.state }) }))

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
  h.state = {}
})

describe('Graph — real buildArtifactGraph() derivation coverage (#1204)', () => {
  it('renders the real node count and the real 0-shipped count when genuinely nothing is done', async () => {
    h.state = { track: 'app', done: {} }
    const { Graph } = await import('@/components/build/artifacts/Graph')
    render(React.createElement(Graph))

    const g = buildArtifactGraph('app', {})
    expect(host.textContent).toContain(`${g.nodes.length} artifacts`)
    expect(host.textContent).toContain('0 shipped')
  })

  it('renders the real shipped count once real nodes are genuinely marked done', async () => {
    const done = { brief: 'complete', prd: 'complete' }
    h.state = { track: 'app', done }
    const { Graph } = await import('@/components/build/artifacts/Graph')
    render(React.createElement(Graph))

    const g = buildArtifactGraph('app', done)
    const realDoneCount = g.nodes.filter((n) => n.done).length
    expect(host.textContent).toContain(`${realDoneCount} shipped`)
  })

  it('renders one real node per graph node, with the real label/category and shipped/queued status', async () => {
    const done = { brief: 'complete' }
    h.state = { track: 'app', done }
    const { Graph } = await import('@/components/build/artifacts/Graph')
    render(React.createElement(Graph))

    const g = buildArtifactGraph('app', done)
    const nodeEls = Array.from(host.querySelectorAll('.m-graph-node'))
    expect(nodeEls).toHaveLength(g.nodes.length)

    const briefNode = g.nodes.find((n) => n.id === 'brief')!
    const briefEl = nodeEls.find((el) => el.querySelector('.m-graph-node-name')?.textContent === briefNode.label)
    expect(briefEl).toBeTruthy()
    expect(briefEl!.querySelector('.st')?.textContent).toBe('shipped')
    expect(briefEl!.querySelector('.m-graph-node-cat')?.textContent).toBe(briefNode.category)

    const undoneNode = g.nodes.find((n) => !n.done)
    if (undoneNode) {
      const undoneEl = nodeEls.find((el) => el.querySelector('.m-graph-node-name')?.textContent === undoneNode.label)
      expect(undoneEl!.querySelector('.st')?.textContent).toBe('queued')
    }
  })

  it('renders one real SVG edge path per real graph edge', async () => {
    h.state = { track: 'company', done: {} }
    const { Graph } = await import('@/components/build/artifacts/Graph')
    render(React.createElement(Graph))

    const g = buildArtifactGraph('company', {})
    const paths = Array.from(host.querySelectorAll('.m-graph-edge'))
    expect(paths).toHaveLength(g.edges.length)
  })

  it('uses the real per-track graph — app vs company tracks produce genuinely different node sets', async () => {
    h.state = { track: 'app', done: {} }
    const { Graph } = await import('@/components/build/artifacts/Graph')
    render(React.createElement(Graph))

    const appG = buildArtifactGraph('app', {})
    const companyG = buildArtifactGraph('company', {})
    expect(appG.nodes.map((n) => n.id)).not.toEqual(companyG.nodes.map((n) => n.id))
    expect(host.textContent).toContain(`${appG.nodes.length} artifacts`)
  })

  it('sizes the real canvas width/height from the real graph cols/rows', async () => {
    h.state = { track: 'app', done: {} }
    const { Graph } = await import('@/components/build/artifacts/Graph')
    render(React.createElement(Graph))

    const g = buildArtifactGraph('app', {})
    const canvas = host.querySelector('.m-graph-canvas') as HTMLElement
    const expectedWidth = g.cols * (176 + 56)
    const expectedHeight = g.rows * (88 + 34)
    expect(canvas.style.minWidth).toBe(`${expectedWidth}px`)
    expect(canvas.style.height).toBe(`${expectedHeight}px`)
  })
})
