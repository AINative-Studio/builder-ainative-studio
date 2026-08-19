'use client'

/** Intake screen (#222) — capture the idea in one field. Copy verbatim from 04-SCREENS §2. */

import { useState } from 'react'
import { useBuild } from '@/contexts/build-context'

function slugify(s: string): string {
  return (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)) || 'app'
}

export function Intake() {
  const { state, dispatch } = useBuild()
  const [idea, setIdea] = useState('')
  const appSub = idea ? slugify(idea) : 'your-app'

  const start = () => {
    if (!idea.trim()) return
    dispatch({ type: 'START_BUILD', idea, appSub: slugify(idea), companyName: deriveName(idea) })
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
        You&apos;ll answer ~2 quick questions while I build · staging goes live at {appSub}.ainative.studio
      </p>
      <button className="btn-primary" onClick={start} disabled={!idea.trim()}>Let Cody build it →</button>
    </div>
  )
}

function deriveName(idea: string): string {
  const words = idea.trim().split(/\s+/).slice(0, 3)
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Your Company'
}
