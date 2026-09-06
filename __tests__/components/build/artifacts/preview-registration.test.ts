import { describe, it, expect } from 'vitest'
import { livePreviewLabel, shouldShowShareUrl } from '@/components/build/artifacts/Preview'

/**
 * Real, live bug found via E2E verification against production (Playwright,
 * a genuine guest-driven build): register-app has a real pre-deploy parse
 * gate (builder#77) that rejects a build with a 422 when its generated code
 * has a real syntax error the server can catch even though the client-side
 * preview iframe renders fine (status:'ready'). Preview.tsx's register-app
 * effect discarded that rejection entirely (`r.ok ? r.json() : null` on a
 * non-2xx resolves to null, and nothing acted on it) — so the founder saw a
 * confident "Live in production" chip and a copyable shareable link that
 * 404s forever, because ZeroDB never got a row for it (confirmed directly:
 * 0 rows for the real company slug from this exact repro).
 */

describe('livePreviewLabel (pure)', () => {
  it('THE BUG: status=ready but registered=false shows an honest "fixing" label, never "Live in production"', () => {
    expect(livePreviewLabel('ready', false)).toBe('Fixing a generation error…')
    expect(livePreviewLabel('ready', false)).not.toBe('Live in production')
  })

  it('status=ready and registered=true shows the real "Live in production" label', () => {
    expect(livePreviewLabel('ready', true)).toBe('Live in production')
  })

  it('status=ready and registered=null (still in flight) shows "Live in production" — not yet known to be broken', () => {
    expect(livePreviewLabel('ready', null)).toBe('Live in production')
  })

  it('status=error always shows "Preview unavailable" regardless of registered', () => {
    expect(livePreviewLabel('error', null)).toBe('Preview unavailable')
    expect(livePreviewLabel('error', true)).toBe('Preview unavailable')
  })

  it('status=generating/idle shows "Building your app…"', () => {
    expect(livePreviewLabel('generating', null)).toBe('Building your app…')
    expect(livePreviewLabel('idle', null)).toBe('Building your app…')
  })
})

describe('shouldShowShareUrl (pure)', () => {
  it('THE BUG: never shows the share URL when registration was rejected (registered:false)', () => {
    expect(shouldShowShareUrl('chat-1', false, 'my-company')).toBe(false)
  })

  it('never shows the share URL while registration is still pending (registered:null)', () => {
    expect(shouldShowShareUrl('chat-1', null, 'my-company')).toBe(false)
  })

  it('shows the share URL only once registration is CONFIRMED (registered:true) with a real chatId + slug', () => {
    expect(shouldShowShareUrl('chat-1', true, 'my-company')).toBe(true)
  })

  it('never shows the share URL without a chatId or slug, even if registered:true', () => {
    expect(shouldShowShareUrl(null, true, 'my-company')).toBe(false)
    expect(shouldShowShareUrl('chat-1', true, null)).toBe(false)
    expect(shouldShowShareUrl(undefined, true, undefined)).toBe(false)
  })
})
