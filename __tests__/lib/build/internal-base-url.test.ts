import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { internalBaseUrl } from '@/lib/build/internal-base-url'

/**
 * #1102/#1113 — real bug found live: company-app/route.ts's detached
 * landing-page generation silently vanished twice in a row (zero
 * deployment-health stages ever recorded for either attempt), consistent
 * with the exact same self-referential-public-edge failure #1110/#1111
 * already found and fixed for a sibling route (nightly-loop-sequence) —
 * calling the service's own PUBLIC domain from a server-side fetch() back
 * into itself is unreliable; Railway's private internal network isn't.
 */
describe('internalBaseUrl (#1102/#1113, proven fix pattern from #1110/#1111)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    delete process.env.RAILWAY_PRIVATE_DOMAIN
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.PORT
  })
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('prefers RAILWAY_PRIVATE_DOMAIN over the public origin when set', () => {
    process.env.RAILWAY_PRIVATE_DOMAIN = 'builder-ainative-studio.railway.internal'
    process.env.NEXT_PUBLIC_APP_URL = 'https://builder.ainative.studio'
    const result = internalBaseUrl('https://builder.ainative.studio/api/build/company-app')
    expect(result).toBe('http://builder-ainative-studio.railway.internal:3000')
  })

  it('uses process.env.PORT when set, not the hardcoded 3000 default', () => {
    process.env.RAILWAY_PRIVATE_DOMAIN = 'builder-ainative-studio.railway.internal'
    process.env.PORT = '8080'
    const result = internalBaseUrl('https://builder.ainative.studio/x')
    expect(result).toBe('http://builder-ainative-studio.railway.internal:8080')
  })

  it('falls back to NEXT_PUBLIC_APP_URL when no private domain is set (local dev)', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://builder.ainative.studio'
    const result = internalBaseUrl('http://localhost:3000/api/build/company-app')
    expect(result).toBe('https://builder.ainative.studio')
  })

  it('falls back to the request URL origin when neither env var is set', () => {
    const result = internalBaseUrl('http://localhost:3000/api/build/company-app')
    expect(result).toBe('http://localhost:3000')
  })
})
