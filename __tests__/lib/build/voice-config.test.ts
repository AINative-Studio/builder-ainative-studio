import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getVoiceConfig, voiceEnabled } from '@/lib/build/voice-config'

/**
 * #1290 — Hume EVI voice config resolver. Mirrors the env-reading pattern
 * lib/build/claude-completion.ts already uses: a single place that turns
 * raw env vars into a typed config, feature-flagged off by simply leaving
 * either var unset.
 */
describe('voice-config', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    delete process.env.HUME_API_KEY
    delete process.env.HUME_SECRET_KEY
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('returns null when neither HUME_API_KEY nor HUME_SECRET_KEY is set', () => {
    expect(getVoiceConfig()).toBeNull()
  })

  it('returns null when only HUME_API_KEY is set', () => {
    process.env.HUME_API_KEY = 'hume-key'
    expect(getVoiceConfig()).toBeNull()
  })

  it('returns null when only HUME_SECRET_KEY is set', () => {
    process.env.HUME_SECRET_KEY = 'hume-secret'
    expect(getVoiceConfig()).toBeNull()
  })

  it('returns the real config when both vars are set', () => {
    process.env.HUME_API_KEY = 'hume-key'
    process.env.HUME_SECRET_KEY = 'hume-secret'
    expect(getVoiceConfig()).toEqual({ apiKey: 'hume-key', secretKey: 'hume-secret' })
  })

  it('voiceEnabled mirrors getVoiceConfig presence', () => {
    expect(voiceEnabled()).toBe(false)
    process.env.HUME_API_KEY = 'hume-key'
    process.env.HUME_SECRET_KEY = 'hume-secret'
    expect(voiceEnabled()).toBe(true)
  })
})
