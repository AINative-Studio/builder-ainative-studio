'use client'

/**
 * Cody chat panel (#BLD-06.1) — the persistent right-hand panel replacing
 * the old Artifacts rail drawer. This story ships the panel SHELL only: a
 * real, visible, always-on chat surface that reacts to the current
 * artifact. The guided conversation itself (step summaries, Q&A, revise,
 * save/restore) is BLD-06.2 through BLD-06.4's scope, not this one's —
 * the input below is honestly disabled rather than wired to fake behavior
 * that doesn't exist yet.
 */

import { useBuild } from '@/contexts/build-context'

export function CodyChatPanel() {
  const { state } = useBuild()

  return (
    <div className="m-cody-chat-panel" data-testid="cody-chat-panel" aria-label="Cody chat">
      <div className="m-cody-chat-header m-mono">
        <span className="m-glyph">◇</span> Cody
      </div>
      <div className="m-cody-chat-log">
        <p className="m-cody-chat-line">You&apos;re on <span className="m-mono">{state.view}</span>.</p>
      </div>
      <div className="m-cody-chat-input-row">
        <input
          className="m-cody-chat-input"
          data-testid="cody-chat-input"
          type="text"
          placeholder="Guided Q&A coming soon"
          disabled
        />
      </div>
    </div>
  )
}
