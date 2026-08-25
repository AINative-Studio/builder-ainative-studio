import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  captureAttribution,
  getGclid,
  getUtm,
  getRefCode,
  getFbc,
  getFbp,
} from '@/lib/build/attribution'

/**
 * lib/build/attribution — client-side ad-click / referral attribution (#207, #59).
 *
 * Strategy: jsdom isn't available (vitest env=node), so we stub document and window
 * on globalThis. Each test manages its own cookie jar via a simple string variable,
 * and restores globals via afterEach so tests are fully isolated.
 *
 * Contracts verified:
 *  - gclid / gbraid / wbraid → ax_gclid cookie (flat, last-click wins / clobber on new click)
 *  - ?ref → ax_ref cookie (first-ref wins, no-clobber once set)
 *  - ?fbclid → _fbc in `fb.1.<ts>.<fbclid>` format (no-clobber once set)
 *  - utm_* → ax_utm as JSON (flat url params → nested object)
 *  - getGclid / getUtm / getRefCode / getFbc / getFbp read back correct values
 *  - Missing document/window → no-op (SSR safety)
 *  - setCookie guards: no-op for empty value
 */

// ---------- Cookie jar helpers ----------

/** A fake cookie jar backed by a plain string, mimicking document.cookie semantics. */
function makeCookieJar() {
  let jar = ''

  const documentStub = {
    get cookie() {
      return jar
    },
    set cookie(raw: string) {
      // Parse the assignment: `name=value; path=/; max-age=NNN; SameSite=Lax`
      // Only the first `name=value` pair goes into the jar.
      const firstPair = raw.split(';')[0].trim()
      const eqIdx = firstPair.indexOf('=')
      if (eqIdx === -1) return
      const name = firstPair.slice(0, eqIdx)
      const value = firstPair.slice(eqIdx + 1)
      // Replace existing entry for this name, or append.
      const existing = jar
        .split('; ')
        .filter((c) => !c.startsWith(`${name}=`))
        .filter(Boolean)
      existing.push(`${name}=${value}`)
      jar = existing.join('; ')
    },
  }

  return { documentStub, getJar: () => jar, setJar: (v: string) => { jar = v } }
}

// ---------- Setup / Teardown ----------

let cookieJar: ReturnType<typeof makeCookieJar>

beforeEach(() => {
  cookieJar = makeCookieJar()
  // Stub document
  vi.stubGlobal('document', cookieJar.documentStub)
  // Default window.location.search to empty
  vi.stubGlobal('window', { location: { search: '' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------- getGclid ----------

describe('getGclid()', () => {
  it('returns undefined when no ax_gclid cookie is set', () => {
    expect(getGclid()).toBeUndefined()
  })

  it('returns the stored gclid after captureAttribution writes it', () => {
    vi.stubGlobal('window', { location: { search: '?gclid=GCLID_ABC123' } })
    captureAttribution()
    expect(getGclid()).toBe('GCLID_ABC123')
  })

  it('returns undefined when document is undefined (SSR)', () => {
    vi.stubGlobal('document', undefined)
    expect(getGclid()).toBeUndefined()
  })

  it('URL-decodes a percent-encoded gclid value', () => {
    // Manually seed the jar with a percent-encoded value
    cookieJar.setJar('ax_gclid=hello%20world')
    expect(getGclid()).toBe('hello world')
  })
})

// ---------- captureAttribution — gclid variants ----------

describe('captureAttribution() — gclid / gbraid / wbraid', () => {
  it('stores gclid from ?gclid= param', () => {
    vi.stubGlobal('window', { location: { search: '?gclid=Cj0GCLID' } })
    captureAttribution()
    expect(getGclid()).toBe('Cj0GCLID')
  })

  it('stores gbraid when gclid is absent', () => {
    vi.stubGlobal('window', { location: { search: '?gbraid=GBRAID_VAL' } })
    captureAttribution()
    expect(getGclid()).toBe('GBRAID_VAL')
  })

  it('stores wbraid when gclid and gbraid are absent', () => {
    vi.stubGlobal('window', { location: { search: '?wbraid=WBRAID_VAL' } })
    captureAttribution()
    expect(getGclid()).toBe('WBRAID_VAL')
  })

  it('prefers gclid over gbraid when both are present', () => {
    vi.stubGlobal('window', { location: { search: '?gclid=FIRST&gbraid=SECOND' } })
    captureAttribution()
    expect(getGclid()).toBe('FIRST')
  })

  it('clobbers an existing ax_gclid on a new ad-click (last click wins)', () => {
    // First ad click
    vi.stubGlobal('window', { location: { search: '?gclid=OLD_GCLID' } })
    captureAttribution()
    expect(getGclid()).toBe('OLD_GCLID')
    // Second ad click
    vi.stubGlobal('window', { location: { search: '?gclid=NEW_GCLID' } })
    captureAttribution()
    expect(getGclid()).toBe('NEW_GCLID')
  })

  it('does NOT write ax_gclid when no gclid/gbraid/wbraid param is present', () => {
    vi.stubGlobal('window', { location: { search: '?utm_source=google' } })
    captureAttribution()
    expect(getGclid()).toBeUndefined()
  })

  it('does NOT write ax_gclid for an empty string param value', () => {
    vi.stubGlobal('window', { location: { search: '?gclid=' } })
    captureAttribution()
    // setCookie guards against empty values
    expect(getGclid()).toBeUndefined()
  })

  it('is a no-op when window is undefined (SSR)', () => {
    vi.stubGlobal('window', undefined)
    // Must not throw
    expect(() => captureAttribution()).not.toThrow()
  })
})

// ---------- captureAttribution — utm ----------

describe('captureAttribution() — utm params', () => {
  it('stores utm_source in the ax_utm JSON cookie', () => {
    vi.stubGlobal('window', { location: { search: '?utm_source=google' } })
    captureAttribution()
    const utm = getUtm()
    expect(utm).toMatchObject({ utm_source: 'google' })
  })

  it('captures all five utm params into a single JSON object', () => {
    vi.stubGlobal('window', {
      location: {
        search:
          '?utm_source=google&utm_medium=cpc&utm_campaign=builders&utm_term=ai+app&utm_content=banner',
      },
    })
    captureAttribution()
    expect(getUtm()).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'builders',
      utm_term: 'ai app',
      utm_content: 'banner',
    })
  })

  it('stores only the utm params that are present (partial set)', () => {
    vi.stubGlobal('window', { location: { search: '?utm_source=email&utm_campaign=launch' } })
    captureAttribution()
    const utm = getUtm()
    expect(utm).toEqual({ utm_source: 'email', utm_campaign: 'launch' })
    expect(utm.utm_medium).toBeUndefined()
  })

  it('does NOT write ax_utm cookie when no utm params are present', () => {
    vi.stubGlobal('window', { location: { search: '?gclid=XYZ' } })
    captureAttribution()
    expect(getUtm()).toEqual({})
  })

  it('clobbers an existing ax_utm when new utm params arrive (last click wins)', () => {
    vi.stubGlobal('window', { location: { search: '?utm_source=old' } })
    captureAttribution()
    vi.stubGlobal('window', { location: { search: '?utm_source=new&utm_campaign=relaunch' } })
    captureAttribution()
    expect(getUtm()).toEqual({ utm_source: 'new', utm_campaign: 'relaunch' })
  })
})

describe('getUtm() — default/error cases', () => {
  it('returns {} when document is undefined (SSR)', () => {
    vi.stubGlobal('document', undefined)
    expect(getUtm()).toEqual({})
  })

  it('returns {} when the ax_utm cookie contains malformed JSON', () => {
    cookieJar.setJar('ax_utm=NOT_JSON')
    expect(getUtm()).toEqual({})
  })

  it('returns {} when no ax_utm cookie exists', () => {
    expect(getUtm()).toEqual({})
  })
})

// ---------- captureAttribution — ref (#59) ----------

describe('captureAttribution() — referral code (?ref=)', () => {
  it('stores the ref code in ax_ref on first landing', () => {
    vi.stubGlobal('window', { location: { search: '?ref=REFCODE42' } })
    captureAttribution()
    expect(getRefCode()).toBe('REFCODE42')
  })

  it('does NOT clobber an existing ax_ref (first shared link wins)', () => {
    // Seed an existing ref
    cookieJar.setJar('ax_ref=ORIGINAL_REF')
    // New page load with a different ref
    vi.stubGlobal('window', { location: { search: '?ref=NEW_REF' } })
    captureAttribution()
    // ax_ref must remain the original
    expect(getRefCode()).toBe('ORIGINAL_REF')
  })

  it('does NOT write ax_ref when ?ref param is absent', () => {
    vi.stubGlobal('window', { location: { search: '?gclid=XYZ' } })
    captureAttribution()
    expect(getRefCode()).toBeUndefined()
  })

  it('does NOT write ax_ref for an empty ref param', () => {
    vi.stubGlobal('window', { location: { search: '?ref=' } })
    captureAttribution()
    expect(getRefCode()).toBeUndefined()
  })
})

describe('getRefCode()', () => {
  it('returns undefined when document is undefined (SSR)', () => {
    vi.stubGlobal('document', undefined)
    expect(getRefCode()).toBeUndefined()
  })
})

// ---------- captureAttribution — fbclid → _fbc ----------

describe('captureAttribution() — Meta fbclid → _fbc', () => {
  it('writes _fbc in fb.1.<ts>.<fbclid> format', () => {
    const before = Date.now()
    vi.stubGlobal('window', { location: { search: '?fbclid=FB_CLICK_ID' } })
    captureAttribution()
    const after = Date.now()
    const fbc = getFbc()
    expect(fbc).toBeDefined()
    // Format: fb.1.<epoch_ms>.<fbclid>
    const parts = fbc!.split('.')
    expect(parts[0]).toBe('fb')
    expect(parts[1]).toBe('1')
    const ts = parseInt(parts[2], 10)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
    expect(parts[3]).toBe('FB_CLICK_ID')
  })

  it('does NOT clobber an existing _fbc (first Meta click wins)', () => {
    // Seed an existing _fbc
    cookieJar.setJar('_fbc=fb.1.1000.OLD_FBC')
    vi.stubGlobal('window', { location: { search: '?fbclid=NEW_FBC' } })
    captureAttribution()
    expect(getFbc()).toBe('fb.1.1000.OLD_FBC')
  })

  it('does NOT write _fbc when fbclid param is absent', () => {
    vi.stubGlobal('window', { location: { search: '?gclid=XYZ' } })
    captureAttribution()
    expect(getFbc()).toBeUndefined()
  })

  it('does NOT write _fbc for an empty fbclid param', () => {
    vi.stubGlobal('window', { location: { search: '?fbclid=' } })
    captureAttribution()
    expect(getFbc()).toBeUndefined()
  })
})

describe('getFbc()', () => {
  it('returns undefined when document is undefined (SSR)', () => {
    vi.stubGlobal('document', undefined)
    expect(getFbc()).toBeUndefined()
  })

  it('returns undefined when no _fbc cookie exists', () => {
    expect(getFbc()).toBeUndefined()
  })
})

// ---------- getFbp ----------

describe('getFbp()', () => {
  it('returns undefined when no _fbp cookie exists', () => {
    expect(getFbp()).toBeUndefined()
  })

  it('returns the _fbp value when it is present (set externally by fbq)', () => {
    cookieJar.setJar('_fbp=fb.1.1234567890.999888777')
    expect(getFbp()).toBe('fb.1.1234567890.999888777')
  })

  it('returns undefined when document is undefined (SSR)', () => {
    vi.stubGlobal('document', undefined)
    expect(getFbp()).toBeUndefined()
  })
})

// ---------- Multi-param landing (integration-style) ----------

describe('captureAttribution() — multi-param landing page', () => {
  it('captures gclid + utm + fbclid + ref all from a single URL', () => {
    vi.stubGlobal('window', {
      location: {
        search:
          '?gclid=GCLID_XYZ&utm_source=google&utm_medium=cpc&fbclid=FB123&ref=REFCODE',
      },
    })
    captureAttribution()

    expect(getGclid()).toBe('GCLID_XYZ')
    expect(getUtm()).toMatchObject({ utm_source: 'google', utm_medium: 'cpc' })
    expect(getRefCode()).toBe('REFCODE')
    const fbc = getFbc()
    expect(fbc).toMatch(/^fb\.1\.\d+\.FB123$/)
  })

  it('handles URL with no attribution params gracefully — all getters return empty/undefined', () => {
    vi.stubGlobal('window', { location: { search: '?page=home' } })
    captureAttribution()
    expect(getGclid()).toBeUndefined()
    expect(getUtm()).toEqual({})
    expect(getRefCode()).toBeUndefined()
    expect(getFbc()).toBeUndefined()
  })
})
