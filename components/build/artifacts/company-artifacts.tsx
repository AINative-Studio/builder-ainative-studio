'use client'

/** Company Track artifact bodies (#224). Copy/structure from 04-SCREENS §15-20. */

import type { ReactNode } from 'react'
import { useBuild } from '@/contexts/build-context'

function Section({ h, children }: { h: string; children: ReactNode }) {
  return (
    <section className="m-sec">
      <h2 className="m-artifact m-sec-h">{h}</h2>
      <div className="m-sec-body">{children}</div>
    </section>
  )
}
function Tag({ kind, children }: { kind: 'assumption' | 'evidence'; children: ReactNode }) {
  return <span className={`m-inline-tag is-${kind} m-mono`}>{children}</span>
}

export const Thesis = () => (
  <>
    <p className="m-artifact-meta m-mono">The company&apos;s home artifact — it grows as evidence lands</p>
    <Section h="The problem">Teams can&apos;t find answers buried in their own tools. <Tag kind="evidence">EVIDENCE · 3 interviews</Tag></Section>
    <Section h="Who feels it most">High-SKU ops teams with fragmented knowledge. <Tag kind="assumption">ASSUMPTION · sizing TBD</Tag></Section>
    <Section h="The wedge">Start where the pain is sharpest: support teams answering the same questions daily.</Section>
    <Section h="Why now">Retrieval + agents finally make a private, cited answer engine viable at team scale.</Section>
  </>
)

export const BusinessModel = () => (
  <>
    <table className="m-table">
      <thead><tr><th>Plan</th><th>Price</th><th>For</th></tr></thead>
      <tbody>
        <tr><td>Team</td><td>$20/seat/mo</td><td>Small teams</td></tr>
        <tr><td>Business</td><td>$40/seat/mo</td><td>Multi-team</td></tr>
        <tr><td>Enterprise</td><td>Custom</td><td>Security + SSO</td></tr>
      </tbody>
    </table>
    <Section h="Unit economics"><ul className="m-list"><li>~85% gross margin (inference + storage the main cost drivers)</li><li>Land on one team, expand across the org</li></ul></Section>
  </>
)

export const Positioning = () => (
  <>
    <blockquote className="m-pullquote m-artifact">
      For teams drowning in their own knowledge, this is the answer engine that replies from your own
      tools — with citations — so no one hunts for what already exists.
    </blockquote>
    <Section h="Unlike the alternatives"><ul className="m-list"><li>Not public search — answers only from your data</li><li>Not a wiki — no one maintains it</li><li>Always cited — never a guess</li></ul></Section>
  </>
)

export const Landing = () => (
  <div className="m-landing-preview">
    <span className="m-eyebrow">YOUR COMPANY</span>
    <h2 className="m-artifact m-landing-h">Ask your company anything.</h2>
    <p className="m-sub">Cited answers from your own tools — private, current, instant.</p>
    <div className="m-landing-ctas"><button className="btn-primary">Get early access</button><button className="btn-secondary">See a demo</button></div>
    <div className="m-landing-features m-seams">
      {[['Cited', 'Every answer shows its sources'], ['Current', 'Reads your live tools'], ['Private', 'Never leaves your data']].map(([h, d]) => (
        <div key={h} className="m-landing-feat"><strong>{h}</strong><p>{d}</p></div>
      ))}
    </div>
  </div>
)

export const Plan30 = () => {
  const { dispatch } = useBuild()
  return (
    <>
      <div className="m-week-grid m-seams">
        {[['Week 1', 'Connect first data sources, ship to 1 design-partner team'],
          ['Week 2', 'Tune retrieval on real queries, add citations UI'],
          ['Week 3', 'Open to 3 more teams, wire the sales pipeline'],
          ['Week 4', 'First paid conversion, turn on the nightly agent loop']].map(([w, d]) => (
          <div key={w} className="m-week"><div className="m-mono m-week-h">{w}</div><p>{d}</p></div>
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
