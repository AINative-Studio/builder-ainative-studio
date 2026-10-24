import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getElevenLabsVoiceConfig, elevenLabsVoiceEnabled } from '@/lib/build/voice-config-elevenlabs'

/**
 * #1468 — ElevenLabs Conversational AI config resolver. Mirrors
 * lib/build/voice-config.ts's (Hume, #1290) env-reading pattern: a single
 * place that turns raw env vars into a typed config, feature-flagged off by
 * simply leaving either var unset.
 */
describe('voice-config-elevenlabs', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    delete process.env.ELEVENLABS_API_KEY
    delete process.env.ELEVENLABS_AGENT_ID
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('returns null when neither ELEVENLABS_API_KEY nor ELEVENLABS_AGENT_ID is set', () => {
    expect(getElevenLabsVoiceConfig()).toBeNull()
  })

  it('returns null when only ELEVENLABS_API_KEY is set', () => {
    process.env.ELEVENLABS_API_KEY = 'el-key'
    expect(getElevenLabsVoiceConfig()).toBeNull()
  })

  it('returns null when only ELEVENLABS_AGENT_ID is set', () => {
    process.env.ELEVENLABS_AGENT_ID = 'el-agent'
    expect(getElevenLabsVoiceConfig()).toBeNull()
  })

  it('returns the real config when both vars are set', () => {
    process.env.ELEVENLABS_API_KEY = 'el-key'
    process.env.ELEVENLABS_AGENT_ID = 'el-agent'
    expect(getElevenLabsVoiceConfig()).toEqual({ apiKey: 'el-key', agentId: 'el-agent' })
  })

  it('elevenLabsVoiceEnabled mirrors getElevenLabsVoiceConfig presence', () => {
    expect(elevenLabsVoiceEnabled()).toBe(false)
    process.env.ELEVENLABS_API_KEY = 'el-key'
    process.env.ELEVENLABS_AGENT_ID = 'el-agent'
    expect(elevenLabsVoiceEnabled()).toBe(true)
  })
})
