/**
 * POST /api/build/voice/token-elevenlabs — issue #1468, ElevenLabs
 * Conversational AI "talk to Cody" voice provider.
 *
 * Mints a short-lived signed WebSocket URL server-side via ElevenLabs' real
 * Conversational AI REST API (GET /v1/convai/conversation/get-signed-url,
 * authenticated with the `xi-api-key` header and an `agent_id` query
 * param). ELEVENLABS_API_KEY is a long-lived secret that must never reach
 * the browser — only the signed URL this route returns does, and that URL
 * is short-lived and scoped to one voice session.
 *
 * Mirrors app/api/build/voice/token/route.ts's (Hume) status-code
 * conventions exactly: 404 when unconfigured (so VoiceToggle can tell "not
 * configured yet" apart from "ElevenLabs is down"), 502 on mint failure or
 * an empty/falsy credential, 200 with the credential on success. Uses a
 * direct fetch() to ElevenLabs' REST API rather than pulling in the full
 * `elevenlabs` server SDK, which issue #1468 doesn't ask for.
 */

import { getElevenLabsVoiceConfig } from '@/lib/build/voice-config-elevenlabs'

export const runtime = 'nodejs'

const SIGNED_URL_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url'

export async function POST() {
  const config = getElevenLabsVoiceConfig()
  if (!config) {
    return Response.json({ ok: false, error: 'VOICE_NOT_CONFIGURED' }, { status: 404 })
  }

  try {
    const url = `${SIGNED_URL_ENDPOINT}?agent_id=${encodeURIComponent(config.agentId)}`
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'xi-api-key': config.apiKey },
    })
    if (!res.ok) {
      return Response.json({ ok: false, error: 'TOKEN_FETCH_FAILED' }, { status: 502 })
    }
    const body = await res.json().catch(() => null)
    const signedUrl = body?.signed_url
    if (!signedUrl) {
      return Response.json({ ok: false, error: 'TOKEN_FETCH_FAILED' }, { status: 502 })
    }
    return Response.json({ ok: true, signedUrl })
  } catch {
    return Response.json({ ok: false, error: 'TOKEN_FETCH_FAILED' }, { status: 502 })
  }
}
