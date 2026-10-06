'use client'

/** Intake screen (#222) — capture the idea in one field. Copy verbatim from 04-SCREENS §2. */

import { useEffect, useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { trackEvent } from '@/components/analytics/google-analytics'
import { getOrCreateAnonDraftToken } from '@/lib/build/anon-draft-token'

export function Intake() {
  const { state, dispatch } = useBuild()
  // Prefill from a seeded idea (funnel "Surprise me" sets state.idea before Intake
  // mounts) so the founder lands on a ready-to-edit starter idea, not a blank field.
  const [idea, setIdea] = useState(state.idea || '')
  const [naming, setNaming] = useState(false)

  // #E3.4 — offer to resume a real saved anonymous draft for this browser.
  const [resumeDraft, setResumeDraft] = useState<{ idea: string } | null>(null)
  useEffect(() => {
    const token = getOrCreateAnonDraftToken()
    fetch(`/api/build/anon-draft?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((d) => { if (d?.draft?.idea) setResumeDraft(d.draft) })
      .catch(() => { /* no resume offer — never blocks the real idea form */ })
  }, [])

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

    // #E3.2/#E3.3 — kickoff questions now sit between brand-naming and the
    // real auth-wall/START_BUILD decision (moved into KickoffQuestions.tsx,
    // which makes that call after its own 3rd question using the exact same
    // logic this screen used to run directly).
    dispatch({
      type: 'SET_BRAND_DRAFT', appSub: brand.slug, companyName: brand.name,
      brandTagline: brand.tagline, brandColor: brand.color,
    })
    dispatch({ type: 'SET_IDEA', idea })
    dispatch({ type: 'GOTO_SCREEN', screen: 'kickoff' })
  }

  // #E3.1 — idea entry is Cody's first chat message, not a form header.
  // "Idea too thin" (a single word) gets one plain follow-up before the
  // submit button is usable, instead of silently staying disabled.
  const wordCount = idea.trim() ? idea.trim().split(/\s+/).length : 0
  const tooThin = wordCount > 0 && wordCount < 2

  return (
    <div className="modernist m-intake" data-track={state.track}>
      <button className="m-back" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'fork' })}>← Back</button>
      <div className="m-chat-log">
        <p className="m-chat-cody"><span className="m-glyph">◇</span> Cody · your co-founder</p>
        <p className="m-chat-cody-turn">
          Tell me your idea in a sentence or two. I&apos;ll ask 3 quick questions, then get to work.
        </p>
        {tooThin && (
          <p className="m-chat-cody-turn" data-testid="intake-idea-too-thin">
            Tell me a bit more — what would it do, and who is it for?
          </p>
        )}
        {resumeDraft && (
          <div className="m-chat-cody-turn" data-testid="intake-resume-draft">
            <p>Pick up where you left off?</p>
            <button
              type="button"
              className="btn-primary"
              data-testid="intake-resume-continue"
              onClick={() => { dispatch({ type: 'SET_IDEA', idea: resumeDraft.idea }); setIdea(resumeDraft.idea); setResumeDraft(null) }}
            >
              Continue
            </button>
            <button
              type="button"
              className="btn-ghost"
              data-testid="intake-resume-start-over"
              onClick={() => setResumeDraft(null)}
            >
              Start over
            </button>
          </div>
        )}
      </div>
      <textarea
        className="m-intake-field"
        placeholder="Describe your idea…"
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        autoFocus
      />
      <button className="btn-primary" onClick={start} disabled={!idea.trim() || naming || tooThin}>
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
