'use client'

/**
 * Company Track artifact bodies (#224, wired #207).
 *
 * These render REAL generated content from state.generated[view] (produced by
 * /api/build/artifact from the founder's idea). While an artifact is still
 * generating (not yet in state.generated), we show a shimmer placeholder.
 *
 * A founder's first look at their product must never read as broken or
 * generic — Cody is framed as a co-founder still working the problem, not a
 * system throwing an error. So a view that has NEVER produced content keeps
 * retrying automatically in the background (useGenAutoRetry) and shows the
 * calm GenStuck state, never silently-fallback placeholder copy or a raw
 * error, while it fights for a real draft. GenError (a small inline note) only
 * ever appears for the minor case where content ALREADY exists and a
 * follow-up regenerate/edit attempt failed — the founder still has their
 * previous good draft on screen the whole time.
 */

import type { ReactNode } from 'react'
import { useBuild } from '@/contexts/build-context'
import { Section, Tag, Generating, GenError, GenStuck, useGenAutoRetry } from '@/components/build/artifacts/gen-helpers'

export const Thesis = () => {
  const { data, error, stuck, retrying, retry } = useGenAutoRetry<{
    meta: string; problem: string; problemTag?: string; who: string; whoTag?: string; wedge: string; whyNow: string
  }>('thesis')
  if (!data && !stuck) return <Generating lines={5} />
  if (!data && stuck) return <GenStuck onRetry={retry} retrying={retrying} />
  const d = data!
  return (
    <>
      {error && <GenError error={error} />}
      <p className="m-artifact-meta m-mono">{d.meta}</p>
      <Section h="The problem">{d.problem} {d.problemTag && <Tag kind="evidence">{d.problemTag}</Tag>}</Section>
      <Section h="Who feels it most">{d.who} {d.whoTag && <Tag kind="assumption">{d.whoTag}</Tag>}</Section>
      <Section h="The wedge">{d.wedge}</Section>
      <Section h="Why now">{d.whyNow}</Section>
    </>
  )
}

export const BusinessModel = () => {
  const { data, error, stuck, retrying, retry } = useGenAutoRetry<{ tiers: Array<{ plan: string; price: string; for: string }>; economics: string[] }>('businessModel')
  if (!data && !stuck) return <Generating lines={4} />
  if (!data && stuck) return <GenStuck onRetry={retry} retrying={retrying} />
  const d = data!
  return (
    <>
      {error && <GenError error={error} />}
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
  const { data, error, stuck, retrying, retry } = useGenAutoRetry<{ statement: string; unlike: string[] }>('positioning')
  if (!data && !stuck) return <Generating lines={3} />
  if (!data && stuck) return <GenStuck onRetry={retry} retrying={retrying} />
  const d = data!
  return (
    <>
      {error && <GenError error={error} />}
      <blockquote className="m-pullquote m-artifact">{d.statement}</blockquote>
      <Section h="Unlike the alternatives"><ul className="m-list">{(d.unlike || []).map((u, i) => <li key={i}>{u}</li>)}</ul></Section>
    </>
  )
}

export const Landing = () => {
  const { data, error, stuck, retrying, retry } = useGenAutoRetry<{ eyebrow: string; headline: string; sub: string; features: Array<{ h: string; d: string }> }>('landing')
  if (!data && !stuck) return <Generating lines={4} />
  // The free, top-of-funnel artifact prospects see before ever paying — this is
  // the ONE view where "never show broken" matters most. No fallback copy, no
  // error banner: hold the calm GenStuck state until a real draft lands.
  if (!data && stuck) return <GenStuck onRetry={retry} retrying={retrying} />
  const d = data!
  return (
    <div className="m-landing-preview">
      {error && <GenError error={error} />}
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
  const { data, error, stuck, retrying, retry } = useGenAutoRetry<{ weeks: Array<{ w: string; d: string }> }>('plan30')
  if (!data && !stuck) return <Generating lines={4} />
  if (!data && stuck) return <GenStuck onRetry={retry} retrying={retrying} />
  const weeks = data!.weeks
  return (
    <>
      {error && <GenError error={error} />}
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
