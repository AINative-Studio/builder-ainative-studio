/**
 * Hume EVI (Empathic Voice Interface) config resolver — issue #1290.
 *
 * Matches the pattern already used by lib/build/claude-completion.ts and
 * lib/env-check.ts: a single place that reads the real env vars so callers
 * never duplicate `process.env.X` fallback chains.
 *
 * Hume's own Next.js quickstart (confirmed against their real
 * hume-api-examples repo, evi/evi-next-js-app-router-quickstart) requires
 * TWO server-side secrets — an API key AND a secret key — used together to
 * mint a short-lived access token via the `hume` SDK's fetchAccessToken().
 * Neither value is ever sent to the browser; only the minted access token
 * is, and only on request from our own /api/build/voice/token route.
 */

export interface VoiceConfig {
  apiKey: string
  secretKey: string
}

/**
 * Returns the real Hume credentials when both HUME_API_KEY and
 * HUME_SECRET_KEY are set, else null. Voice is feature-flagged off by
 * simply not configuring these — no separate on/off flag needed, matching
 * how ZeroVoice's own provisioning gate (zeroVoiceProvisionEnabled) treats
 * "unconfigured" as "disabled" rather than erroring.
 */
export function getVoiceConfig(): VoiceConfig | null {
  const apiKey = process.env.HUME_API_KEY
  const secretKey = process.env.HUME_SECRET_KEY
  if (!apiKey || !secretKey) return null
  return { apiKey, secretKey }
}

/** Whether Cody voice is configured server-side at all. */
export function voiceEnabled(): boolean {
  return getVoiceConfig() !== null
}
