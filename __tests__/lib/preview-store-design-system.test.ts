import { describe, it, expect } from 'vitest'
import { storePreview, getChatData } from '@/lib/preview-store'

/**
 * Design System Picker (#593) — the second half of font loading. A single-
 * file generated App.tsx has no real <head> to inject a font <link> into, so
 * the actual font-loading mechanism is the preview route's static HTML
 * wrapper (app/api/preview/[id]/route.ts), which is a SEPARATE request keyed
 * only by the preview id. This round-trips designSystemId through
 * storePreview -> chatStore -> getChatData so that route can look up which
 * system was chosen and load its real fonts instead of the previously
 * hardcoded Inter+Poppins for every preview.
 */
describe('preview-store — designSystemId round-trip (#593)', () => {
  it('storePreview persists designSystemId, readable via getChatData', () => {
    const id = `test-ds-${Date.now()}-a`
    storePreview(id, 'content', 'a message', { designSystemId: 'cody' })
    expect(getChatData(id)?.designSystemId).toBe('cody')
  })

  it('is undefined when no design system was chosen — the route falls back to the default fonts', () => {
    const id = `test-ds-${Date.now()}-b`
    storePreview(id, 'content', 'a message', {})
    expect(getChatData(id)?.designSystemId).toBeUndefined()
  })

  it('is undefined with no metadata argument at all (pre-existing callers unaffected)', () => {
    const id = `test-ds-${Date.now()}-c`
    storePreview(id, 'content', 'a message')
    expect(getChatData(id)?.designSystemId).toBeUndefined()
  })

  it('a later storePreview call without designSystemId does not clobber an earlier chosen one', () => {
    const id = `test-ds-${Date.now()}-d`
    storePreview(id, 'first content', 'first message', { designSystemId: 'outrun' })
    storePreview(id, 'second content (e.g. a refinement pass)', undefined, {})
    expect(getChatData(id)?.designSystemId).toBe('outrun')
  })
})
