'use client'

/**
 * FeedbackPulse (#332 DATA-1) — the one-line rating strip shown after every
 * generation, wired to the existing RLHF pipeline (/api/rlhf/submit-feedback →
 * ZeroDB). Mounted under the Preview artifact once the app is ready, and on
 * the Live screen once the company is built.
 *
 * Typographic only (◇ ✓ — no icon libraries, no thumbs). Never blocks the
 * flow: submission is fire-and-forget, the strip is dismissible, and each
 * generation is asked exactly once per browser (lib/build/feedback-capture).
 */

import { useEffect, useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import {
  browserStorage,
  buildFeedbackPayload,
  markRated,
  shouldShowPulse,
  type FeedbackContext,
  type FeedbackSurface,
} from '@/lib/build/feedback-capture'

type Phase = 'ask' | 'reason' | 'done' | 'hidden'

export function FeedbackPulse({ surface, chatId }: { surface: FeedbackSurface; chatId?: string }) {
  const { state } = useBuild()

  const ctx: FeedbackContext = {
    chatId: chatId || state.appChatId,
    slug: state.appSub,
    idea: state.idea,
    track: state.track,
    view: state.view,
    surface,
  }

  // Start hidden; hydrate against real localStorage on the client so SSR and
  // an already-rated generation never flash the question.
  const [phase, setPhase] = useState<Phase>('hidden')
  const [reason, setReason] = useState('')

  const ctxId = ctx.chatId || ctx.slug || ''
  useEffect(() => {
    setPhase(shouldShowPulse(browserStorage(), { chatId: chatId || state.appChatId, slug: state.appSub }) ? 'ask' : 'hidden')
    // Re-evaluate only when the generation identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxId])

  const submit = (positive: boolean, feedbackText = '') => {
    const payload = buildFeedbackPayload(ctx, positive, feedbackText)
    if (payload) {
      // Fire-and-forget — a failed save must never interrupt the founder.
      fetch('/api/rlhf/submit-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
      markRated(browserStorage(), ctx)
    }
    setPhase('done')
  }

  if (phase === 'hidden') return null

  if (phase === 'done') {
    return (
      <div className="m-feedback-pulse is-done m-mono" data-testid="feedback-pulse-done">
        <span className="m-glyph">✓</span> Noted — this trains Cody.
      </div>
    )
  }

  if (phase === 'reason') {
    return (
      <div className="m-feedback-pulse m-mono" data-testid="feedback-pulse-reason">
        <span className="m-feedback-q"><span className="m-glyph">◇</span> What was off?</span>
        <input
          className="m-feedback-input"
          data-testid="feedback-reason-input"
          type="text"
          placeholder="One line is plenty"
          value={reason}
          autoFocus
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit(false, reason)}
          aria-label="What was off about this build"
        />
        <button className="m-feedback-btn" data-testid="feedback-send" onClick={() => submit(false, reason)}>Send →</button>
        <button className="m-feedback-dismiss" data-testid="feedback-skip" onClick={() => submit(false)}>Skip</button>
      </div>
    )
  }

  return (
    <div className="m-feedback-pulse m-mono" data-testid="feedback-pulse">
      <span className="m-feedback-q"><span className="m-glyph">◇</span> Was this what you asked for?</span>
      <button className="m-feedback-btn" data-testid="feedback-yes" onClick={() => submit(true)}>Yes ✓</button>
      <button className="m-feedback-btn" data-testid="feedback-no" onClick={() => setPhase('reason')}>No</button>
      <button className="m-feedback-dismiss" data-testid="feedback-dismiss" aria-label="Dismiss" onClick={() => setPhase('hidden')}>Dismiss</button>
    </div>
  )
}
