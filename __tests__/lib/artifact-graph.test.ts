import { describe, it, expect } from 'vitest'
import { buildArtifactGraph, traceImpact, ARTIFACT_CATEGORY } from '@/lib/build/artifact-graph'

describe('artifact-graph (#234)', () => {
  describe('buildArtifactGraph', () => {
    it('builds a node per artifact in the App track, in composition order', () => {
      const g = buildArtifactGraph('app')
      expect(g.nodes.map((n) => n.id).slice(0, 3)).toEqual(['brief', 'prd', 'comp'])
      expect(g.nodes.find((n) => n.id === 'preview')).toBeTruthy()
      // columns increase left→right
      expect(g.nodes[0].col).toBe(0)
      expect(g.nodes[g.nodes.length - 1].col).toBe(g.nodes.length - 1)
    })

    it('builds the Company track nodes', () => {
      const g = buildArtifactGraph('company')
      expect(g.nodes.map((n) => n.id)).toEqual([
        'thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30',
      ])
    })

    it('only emits edges whose both ends are in the track', () => {
      const g = buildArtifactGraph('company')
      const ids = new Set(g.nodes.map((n) => n.id))
      for (const e of g.edges) {
        expect(ids.has(e.from)).toBe(true)
        expect(ids.has(e.to)).toBe(true)
      }
      // a known real edge exists
      expect(g.edges).toContainEqual({ from: 'thesis', to: 'wedge' })
    })

    it('marks nodes done from the doneMap', () => {
      const g = buildArtifactGraph('app', { brief: 'done', prd: 'done' })
      expect(g.nodes.find((n) => n.id === 'brief')!.done).toBe(true)
      expect(g.nodes.find((n) => n.id === 'comp')!.done).toBe(false)
    })

    it('tags each node with a category', () => {
      const g = buildArtifactGraph('company')
      expect(g.nodes.find((n) => n.id === 'thesis')!.category).toBe('Thesis')
      expect(g.nodes.find((n) => n.id === 'landing')!.category).toBe('Brand & Distribution')
    })
  })

  describe('traceImpact', () => {
    it('classifies direct dependents as Breaking, 2-hops as Needs update', () => {
      // Company: wedge → businessModel (breaking), businessModel → plan30 (needs update)
      const impact = traceImpact('company', 'wedge')
      const bm = impact.find((i) => i.view === 'businessModel')
      const plan = impact.find((i) => i.view === 'plan30')
      expect(bm?.kind).toBe('Breaking')
      expect(plan?.kind).toBe('Needs update')
    })

    it('returns downstream artifacts only (not the changed one)', () => {
      const impact = traceImpact('company', 'wedge')
      expect(impact.find((i) => i.view === 'wedge')).toBeUndefined()
      expect(impact.find((i) => i.view === 'thesis')).toBeUndefined() // upstream, not affected
      expect(impact.length).toBeGreaterThan(0)
    })

    it('every impact item has a human-readable why + label', () => {
      const impact = traceImpact('company', 'wedge')
      for (const i of impact) {
        expect(i.why.length).toBeGreaterThan(3)
        expect(i.label.length).toBeGreaterThan(1)
      }
    })
  })

  it('every artifact view has a category', () => {
    for (const v of ['brief', 'prd', 'thesis', 'wedge', 'landing', 'pipeline', 'preview']) {
      expect(ARTIFACT_CATEGORY[v]).toBeTruthy()
    }
  })
})
