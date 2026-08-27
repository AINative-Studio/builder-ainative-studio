'use client'

/** Intake screen (#222) — capture the idea in one field. Copy verbatim from 04-SCREENS §2. */

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useBuild } from '@/contexts/build-context'
import { trackEvent } from '@/components/analytics/google-analytics'
import { decideLimitAction } from '@/lib/build/value-moment'

export function Intake() {
  const { state, dispatch } = useBuild()
  const { status: sessionStatus } = useSession()
  // Prefill from a seeded idea (funnel "Surprise me" sets state.idea before Intake
  // mounts) so the founder lands on a ready-to-edit starter idea, not a blank field.
  const [idea, setIdea] = useState(state.idea || '')
  const [naming, setNaming] = useState(false)

  const start = async () => {
    if (!idea.trim() || naming) return
    setNaming(true)
    // GA4 funnel step 1 — the founder submitted their idea. `track` = app|company.
    trackEvent('idea_submitted', 'funnel', state.track, undefined)
    // Generate a REAL brand (name/slug/tagline/color) from the idea — not the
    // first 3 words of the sentence. (FIX-1)
    let brand = { name: '', slug: 'app', tagline: '', color: '#2f6d86' }
    try {
      const res = await fetch('/api/build/brand', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, track: state.track }),
      })
      const d = await res.json()
      if (d?.slug) brand = { name: d.name || '', slug: d.slug, tagline: d.tagline || '', color: d.color || '#2f6d86' }
    } catch { /* fall back below */ }
    if (!brand.name) brand.name = fallbackName(idea)

    // Auth wall (#dashboard-ux): an anonymous founder must register BEFORE any
    // generation runs — we never spend LLM tokens on an un-registered visitor.
    // Stash the idea/brand and route to signup; after they register + verify and
    // land back, the deferred build fires (see build-context). Naming already
    // happened above (cheap brand call) so the signup screen can greet the company.
    if (sessionStatus !== 'authenticated') {
      trackEvent('idea_gated_signup', 'funnel', state.track, undefined)
      dispatch({
        type: 'DEFER_BUILD', idea,
        appSub: brand.slug, companyName: brand.name,
        brandTagline: brand.tagline, brandColor: brand.color,
      })
      return
    }

    // Freemium enforcement (#dashboard-ux): record a build against the founder's
    // allowance. If the free/starter limit is exhausted, route to pricing instead
    // of starting a build. Fails OPEN on any error (metering never hard-blocks).
    // The idea/track let the SERVER compute this build's composed primitives for
    // the ecosystem-runway bonus (#324 GR-15) — the bonus is never client-decided.
    let runwayNote = ''
    try {
      const res = await fetch('/api/build/credits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: brand.slug, idea, track: state.track }),
      })
      if (res.status === 402) {
        trackEvent('build_limit_reached', 'funnel', state.track, undefined)
        // Value-moment gate (#310/#311 GR-01/GR-02): a founder who has NEVER
        // seen a working preview is not routed to the pay gate — the build
        // proceeds (fail toward value; the server's value guarantee allows the
        // first visible build too). Only after the value moment does the limit
        // route to pricing.
        if (decideLimitAction({ limitReached: true, sawPreview: state.sawPreview }) === 'pricing') {
          dispatch({ type: 'GOTO_SCREEN', screen: 'pricing' })
          setNaming(false)
          return
        }
      }
      const d = await res.json().catch(() => null)
      if (typeof d?.ecosystem?.message === 'string') runwayNote = d.ecosystem.message
    } catch { /* fail open — proceed with the build */ }

    dispatch({
      type: 'START_BUILD', idea,
      appSub: brand.slug, companyName: brand.name,
      brandTagline: brand.tagline, brandColor: brand.color,
    })
    // Surface the earned ecosystem-runway bonus in the workspace (#324 GR-15).
    // Dispatched AFTER START_BUILD so a new-build reset can't clobber the note.
    dispatch({ type: 'SET_RUNWAY_NOTE', note: runwayNote })
  }

  return (
    <div className="modernist m-intake" data-track={state.track}>
      <button className="m-back" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'fork' })}>← Back</button>
      <p className="m-cody-line"><span className="m-glyph">◇</span> Cody · your technical co-founder</p>
      <h1 className="m-h1">Tell me what we&apos;re building.</h1>
      <p className="m-sub">
        I&apos;ll draft everything — brief, PRD, data model, a backlog, then put a swarm of agents to work and
        provision the infrastructure. I&apos;ll only stop to ask you the calls that actually change the product.
      </p>
      <textarea
        className="m-intake-field"
        placeholder="Describe your idea…"
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        autoFocus
      />
      {/* #319 GR-10 — step-numbered microcopy for a founder with zero prior context. */}
      <p className="m-helper m-mono">
        Step 1 of 2 — describe your idea in one sentence. I do everything else.
      </p>
      <p className="m-helper">
        Step 2 happens while I build — you&apos;ll answer ~2 quick questions · I&apos;ll name your company and give it a live preview URL.
      </p>
      <button className="btn-primary" onClick={start} disabled={!idea.trim() || naming}>
        {naming ? 'Naming your company…' : 'Let Cody build it →'}
      </button>
    </div>
  )
}

// Fallback name only when brand generation fails — strip the "I want to build a"
// preamble and take the first meaningful word, so we never show "I Want To".
function fallbackName(idea: string): string {
  const cleaned = idea.trim().replace(/^(i\s+want\s+to\s+build|i\s+want\s+to|build|create|make|a|an|the)\s+/gi, '')
  const w = cleaned.split(/\s+/)[0] || 'Cody'
  return w.charAt(0).toUpperCase() + w.slice(1)
}
