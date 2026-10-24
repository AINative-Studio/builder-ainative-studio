/**
 * ElevenLabs Conversational AI config resolver — issue #1468.
 *
 * Mirrors lib/build/voice-config.ts's (Hume, #1290) pattern: a single place
 * that reads the real env vars so callers never duplicate `process.env.X`
 * fallback chains. ElevenLabs' Conversational AI requires an API key plus
 * an Agent ID (configured in ElevenLabs' own dashboard — system prompt,
 * voice, LLM choice, tools) to mint a signed connection URL server-side via
 * their get-signed-url endpoint. ELEVENLABS_API_KEY stays server-only, same
 * posture as HUME_SECRET_KEY; the Agent ID itself is safe to expose
 * client-side but is read here server-side too since only the token route
 * needs it.
 */

export interface ElevenLabsVoiceConfig {
  apiKey: string
  agentId: string
}

/**
 * Returns the real ElevenLabs credentials when both ELEVENLABS_API_KEY and
 * ELEVENLABS_AGENT_ID are set, else null. Voice is feature-flagged off by
 * simply not configuring these — same "unconfigured means disabled, not an
 * error" posture as getVoiceConfig().
 */
export function getElevenLabsVoiceConfig(): ElevenLabsVoiceConfig | null {
  const apiKey = process.env.ELEVENLABS_API_KEY
  const agentId = process.env.ELEVENLABS_AGENT_ID
  if (!apiKey || !agentId) return null
  return { apiKey, agentId }
}

/** Whether Cody voice via ElevenLabs is configured server-side at all. */
export function elevenLabsVoiceEnabled(): boolean {
  return getElevenLabsVoiceConfig() !== null
}
