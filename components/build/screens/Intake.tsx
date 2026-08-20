'use client'

/** Intake screen (#222) — capture the idea in one field. Copy verbatim from 04-SCREENS §2. */

import { useState } from 'react'
import { useBuild } from '@/contexts/build-context'

export function Intake() {
  const { state, dispatch } = useBuild()
  const [idea, setIdea] = useState('')
  const [naming, setNaming] = useState(false)

  const start = async () => {
    if (!idea.trim() || naming) return
    setNaming(true)
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
    dispatch({
      type: 'START_BUILD', idea,
      appSub: brand.slug, companyName: brand.name,
      brandTagline: brand.tagline, brandColor: brand.color,
    })
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
      <p className="m-helper">
        You&apos;ll answer ~2 quick questions while I build · I&apos;ll name your company and give it a live preview URL.
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
