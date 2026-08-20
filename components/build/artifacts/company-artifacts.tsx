'use client'

/**
 * Company Track artifact bodies (#224, wired #207).
 *
 * These now render REAL generated content from state.generated[view] (produced
 * by /api/build/artifact from the founder's idea). While an artifact is still
 * generating (not yet in state.generated), we show a shimmer placeholder; on
 * generation failure we show the error + the static example so the shell never
 * looks broken. Structure/classes match 04-SCREENS §15-20.
 */

import type { ReactNode } from 'react'
import { useBuild } from '@/contexts/build-context'
import { Section, Tag, Generating, useGen } from '@/components/build/artifacts/gen-helpers'

export const Thesis = () => {
  const { data, error } = useGen<{
    meta: string; problem: string; problemTag?: string; who: string; whoTag?: string; wedge: string; whyNow: string
  }>('thesis')
  if (!data && !error) return <Generating lines={5} />
  const d = data ?? {
    meta: 'The company\'s home artifact — it grows as evidence lands',
    problem: 'Teams can\'t find answers buried in their own tools.', problemTag: 'EVIDENCE · 3 interviews',
    who: 'High-SKU ops teams with fragmented knowledge.', whoTag: 'ASSUMPTION · sizing TBD',
    wedge: 'Start where the pain is sharpest: support teams answering the same questions daily.',
    whyNow: 'Retrieval + agents finally make a private, cited answer engine viable at team scale.',
  }
  return (
    <>
      {error && <p className="m-artifact-meta m-mono is-error">Generation failed ({error}) — showing an example.</p>}
      <p className="m-artifact-meta m-mono">{d.meta}</p>
      <Section h="The problem">{d.problem} {d.problemTag && <Tag kind="evidence">{d.problemTag}</Tag>}</Section>
      <Section h="Who feels it most">{d.who} {d.whoTag && <Tag kind="assumption">{d.whoTag}</Tag>}</Section>
      <Section h="The wedge">{d.wedge}</Section>
      <Section h="Why now">{d.whyNow}</Section>
    </>
  )
}

export const BusinessModel = () => {
  const { data, error } = useGen<{ tiers: Array<{ plan: string; price: string; for: string }>; economics: string[] }>('businessModel')
  if (!data && !error) return <Generating lines={4} />
  const d = data ?? {
    tiers: [
      { plan: 'Team', price: '$20/seat/mo', for: 'Small teams' },
      { plan: 'Business', price: '$40/seat/mo', for: 'Multi-team' },
      { plan: 'Enterprise', price: 'Custom', for: 'Security + SSO' },
    ],
    economics: ['~85% gross margin (inference + storage the main cost drivers)', 'Land on one team, expand across the org'],
  }
  return (
    <>
      {error && <p className="m-artifact-meta m-mono is-error">Generation failed ({error}) — showing an example.</p>}
      <table className="m-table">
        <thead><tr><th>Plan</th><th>Price</th><th>For</th></tr></thead>
        <tbody>
          {(d.tiers || []).map((t, i) => (
            <tr key={i}><td>{t.plan}</td><td>{t.price}</td><td>{t.for}</td></tr>
          ))}
        </tbody>
      </table>
      <Section h="Unit economics"><ul className="m-list">{(d.economics || []).map((e, i) => <li key={i}>{e}</li>)}</ul></Section>
    </>
  )
}

export const Positioning = () => {
  const { data, error } = useGen<{ statement: string; unlike: string[] }>('positioning')
  if (!data && !error) return <Generating lines={3} />
  const d = data ?? {
    statement: 'For teams drowning in their own knowledge, this is the answer engine that replies from your own tools — with citations — so no one hunts for what already exists.',
    unlike: ['Not public search — answers only from your data', 'Not a wiki — no one maintains it', 'Always cited — never a guess'],
  }
  return (
    <>
      {error && <p className="m-artifact-meta m-mono is-error">Generation failed ({error}) — showing an example.</p>}
      <blockquote className="m-pullquote m-artifact">{d.statement}</blockquote>
      <Section h="Unlike the alternatives"><ul className="m-list">{(d.unlike || []).map((u, i) => <li key={i}>{u}</li>)}</ul></Section>
    </>
  )
}

export const Landing = () => {
  const { data, error } = useGen<{ eyebrow: string; headline: string; sub: string; features: Array<{ h: string; d: string }> }>('landing')
  if (!data && !error) return <Generating lines={4} />
  const d = data ?? {
    eyebrow: 'YOUR COMPANY', headline: 'Ask your company anything.',
    sub: 'Cited answers from your own tools — private, current, instant.',
    features: [{ h: 'Cited', d: 'Every answer shows its sources' }, { h: 'Current', d: 'Reads your live tools' }, { h: 'Private', d: 'Never leaves your data' }],
  }
  return (
    <div className="m-landing-preview">
      {error && <p className="m-artifact-meta m-mono is-error">Generation failed ({error}) — showing an example.</p>}
      <span className="m-eyebrow">{d.eyebrow}</span>
      <h2 className="m-artifact m-landing-h">{d.headline}</h2>
      <p className="m-sub">{d.sub}</p>
      <div className="m-landing-ctas"><button className="btn-primary">Get early access</button><button className="btn-secondary">See a demo</button></div>
      <div className="m-landing-features m-seams">
        {(d.features || []).map((f, i) => (
          <div key={i} className="m-landing-feat"><strong>{f.h}</strong><p>{f.d}</p></div>
        ))}
      </div>
    </div>
  )
}

export const Plan30 = () => {
  const { dispatch } = useBuild()
  const { data, error } = useGen<{ weeks: Array<{ w: string; d: string }> }>('plan30')
  if (!data && !error) return <Generating lines={4} />
  const weeks = data?.weeks ?? [
    { w: 'Week 1', d: 'Connect first data sources, ship to 1 design-partner team' },
    { w: 'Week 2', d: 'Tune retrieval on real queries, add citations UI' },
    { w: 'Week 3', d: 'Open to 3 more teams, wire the sales pipeline' },
    { w: 'Week 4', d: 'First paid conversion, turn on the nightly agent loop' },
  ]
  return (
    <>
      {error && <p className="m-artifact-meta m-mono is-error">Generation failed ({error}) — showing an example.</p>}
      <div className="m-week-grid m-seams">
        {weeks.map((wk, i) => (
          <div key={i} className="m-week"><div className="m-mono m-week-h">{wk.w}</div><p>{wk.d}</p></div>
        ))}
      </div>
      <div className="m-cody-banner" style={{ marginTop: 24 }}>
        <p><span className="m-glyph">◇</span> The company scaffolding is complete. Want to see it live?</p>
        <button className="btn-primary" onClick={() => dispatch({ type: 'COMPANY_DONE' })}>See it live →</button>
      </div>
    </>
  )
}

export const COMPANY_ARTIFACT_BODIES: Record<string, () => ReactNode> = {
  thesis: Thesis, businessModel: BusinessModel, positioning: Positioning, landing: Landing, plan30: Plan30,
}
