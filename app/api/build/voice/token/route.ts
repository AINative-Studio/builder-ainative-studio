/**
 * POST /api/build/voice/token — issue #1290, "talk to Cody" voice feature.
 *
 * Mints a short-lived Hume EVI access token server-side via the real `hume`
 * TypeScript SDK's fetchAccessToken(), per Hume's own Next.js quickstart
 * (confirmed against HumeAI/hume-api-examples,
 * evi/evi-next-js-app-router-quickstart/app/page.tsx). HUME_API_KEY and
 * HUME_SECRET_KEY are long-lived secrets that must never reach the browser —
 * only the access token this route returns does, and that token is
 * short-lived and scoped to voice-session auth only.
 *
 * Feature-flagged off by configuration: when either env var is unset this
 * returns 404 rather than 500, so a caller (VoiceToggle) can tell "not
 * configured yet" apart from "Hume is down" without parsing error text.
 */

import { fetchAccessToken } from 'hume'

export const runtime = 'nodejs'

export async function POST() {
  const apiKey = process.env.HUME_API_KEY
  const secretKey = process.env.HUME_SECRET_KEY
  if (!apiKey || !secretKey) {
    return Response.json({ ok: false, error: 'VOICE_NOT_CONFIGURED' }, { status: 404 })
  }

  try {
    const accessToken = await fetchAccessToken({ apiKey, secretKey })
    if (!accessToken) {
      return Response.json({ ok: false, error: 'TOKEN_FETCH_FAILED' }, { status: 502 })
    }
    return Response.json({ ok: true, accessToken })
  } catch {
    return Response.json({ ok: false, error: 'TOKEN_FETCH_FAILED' }, { status: 502 })
  }
}
