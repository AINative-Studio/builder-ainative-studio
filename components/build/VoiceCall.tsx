'use client'

/**
 * VoiceCall (#1290) — the real Hume EVI connected-call UI, split out of
 * VoiceToggle so VoiceToggle's availability/toggle logic (which IS unit
 * tested) never has to import the live @humeai/voice-react SDK.
 *
 * Confirmed against Hume's own Next.js quickstart
 * (HumeAI/hume-api-examples, evi/evi-next-js-app-router-quickstart):
 * VoiceProvider is the context provider; useVoice() exposes { status,
 * connect, disconnect, messages, isMuted, mute, unmute }. connect() takes
 * { auth: { type: 'accessToken', value } } — never the raw API key — since
 * this only ever runs with the short-lived token minted by
 * /api/build/voice/token.
 *
 * This file is intentionally NOT unit tested (per #1290's own scope: "You
 * cannot meaningfully unit-test a live third-party voice SDK's actual audio
 * I/O") — VoiceToggle's availability gating and the token route are where
 * the real, testable logic lives.
 */

import { useEffect } from 'react'
import { VoiceProvider, useVoice } from '@humeai/voice-react'

function Call({ accessToken, onEnd }: { accessToken: string; onEnd: () => void }) {
  const { status, connect, disconnect } = useVoice()

  useEffect(() => {
    connect({ auth: { type: 'accessToken', value: accessToken } }).catch(() => onEnd())
    return () => {
      disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="m-voice-call" data-testid="voice-call" data-status={status.value}>
      <button
        type="button"
        data-testid="voice-call-end"
        className="btn-ghost m-voice-toggle"
        onClick={() => {
          disconnect()
          onEnd()
        }}
      >
        End voice chat
      </button>
    </div>
  )
}

export function VoiceCall({ accessToken, onEnd }: { accessToken: string; onEnd: () => void }) {
  return (
    <VoiceProvider>
      <Call accessToken={accessToken} onEnd={onEnd} />
    </VoiceProvider>
  )
}
