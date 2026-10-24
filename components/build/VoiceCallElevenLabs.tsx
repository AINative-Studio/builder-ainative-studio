'use client'

/**
 * VoiceCallElevenLabs (#1468) — the real ElevenLabs Conversational AI
 * connected-call UI, split out of VoiceToggle the same way VoiceCall.tsx
 * (Hume, #1290) is: VoiceToggle's availability/toggle logic (which IS unit
 * tested) never has to import a live voice SDK.
 *
 * Confirmed against @elevenlabs/react 1.19.1's real exports:
 * ConversationProvider is the context provider; useConversation() exposes
 * { status, startSession, endSession, ... }. startSession() takes a
 * PrivateWebSocketSessionConfig, i.e. { signedUrl } — never the raw API
 * key — since this only ever runs with the short-lived signed URL minted by
 * /api/build/voice/token-elevenlabs. Audio I/O (mic capture, playback) is
 * handled entirely by the SDK, same as Hume's — not hand-rolled here.
 *
 * This file is intentionally NOT unit tested, matching VoiceCall.tsx's own
 * precedent (#1290's scope note: "You cannot meaningfully unit-test a live
 * third-party voice SDK's actual audio I/O"). VoiceToggle's availability
 * gating and the token route are where the real, testable logic lives.
 */

import { useEffect } from 'react'
import { ConversationProvider, useConversation } from '@elevenlabs/react'

function Call({ signedUrl, onEnd }: { signedUrl: string; onEnd: () => void }) {
  const { status, startSession, endSession } = useConversation()

  useEffect(() => {
    try {
      startSession({ signedUrl })
    } catch {
      onEnd()
    }
    return () => {
      endSession()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="m-voice-call" data-testid="voice-call" data-status={status}>
      <button
        type="button"
        data-testid="voice-call-end"
        className="btn-ghost m-voice-toggle"
        onClick={() => {
          endSession()
          onEnd()
        }}
      >
        End voice chat
      </button>
    </div>
  )
}

export function VoiceCallElevenLabs({ signedUrl, onEnd }: { signedUrl: string; onEnd: () => void }) {
  return (
    <ConversationProvider>
      <Call signedUrl={signedUrl} onEnd={onEnd} />
    </ConversationProvider>
  )
}
