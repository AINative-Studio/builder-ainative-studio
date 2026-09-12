import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real gap (found live, issue #660): Live.tsx's real-product-generation
 * trigger (POST /api/build/company-product) and the Company track's real
 * landing-page trigger (POST /api/build/company-app) both gate on
 * `state.idea && state.appSub` — client-only reducer state that a fresh
 * page load, new tab, bookmark, or returning founder days later never has
 * populated. Confirmed live: 20/20 real companies on the account owner's
 * own account had never once had product generation run, because no real
 * session had ever stayed on the single in-memory Live-screen session long
 * enough for it to fire.
 *
 * Fix: a new effect hydrates state.idea/state.appSub from the server
 * registry (via /api/build/resolve-app's new `idea` field) whenever
 * state.idea is empty, and the generation-trigger effect's dependency array
 * now includes state.idea/state.appSub so it re-fires once hydration lands.
 */
describe('Live screen — idea hydration from the server registry (#660)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('hydrates state.idea from /api/build/resolve-app when state.idea is empty', () => {
    const idx = source.indexOf('if (state.idea || !companyId) return')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 500)
    expect(nearby).toMatch(/\/api\/build\/resolve-app\?slug=/)
    expect(nearby).toMatch(/RESTORE_BUILD/)
    expect(nearby).toMatch(/d\.idea/)
  })

  it('the generation-trigger effect re-runs once idea/appSub are hydrated (dependency array includes them)', () => {
    const idx = source.indexOf("fetch(`/api/build/nightshift?companyId=")
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 1200)
    expect(nearby).toMatch(/\[companyId,\s*state\.idea,\s*state\.appSub\]/)
  })

  it('the real landing-page + product-generation POSTs still gate on both fields (never fabricates a build for an unknown idea)', () => {
    const appIdx = source.indexOf('if (!state.appChatId && state.idea && state.appSub)')
    const productIdx = source.indexOf('if (!state.productChatId && state.idea && state.appSub)')
    expect(appIdx).toBeGreaterThan(-1)
    expect(productIdx).toBeGreaterThan(-1)
  })
})
