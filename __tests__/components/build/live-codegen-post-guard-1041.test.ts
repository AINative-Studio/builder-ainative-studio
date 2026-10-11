import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * builder#1041 — Live.tsx must not fire its two codegen POSTs off stale local
 * state alone, and must not treat the new 'unverified' response as progress.
 *
 * Both POST sites gate purely on client-only reducer state:
 *
 *   if (!state.appChatId && state.idea && state.appSub) { … company-app … }
 *   if (!state.productChatId && state.idea && state.appSub) { … company-product … }
 *
 * `appChatId`/`productChatId` are legitimately empty for a genuinely live,
 * server-registered company — that is #1037's confirmed repro shape, written
 * by ordinary use on any browser that merely touched the company (a new tab, a
 * different device, a session that ended mid-build). So on every such load,
 * both POSTs fire.
 *
 * Server-side that is safe today: both routes resolve the registry first and
 * return a cached chatId (verified live on production against #1037's own
 * company `silo` — `cached: true` / `status: 'cached'`, sub-second, no
 * generation). The spend risk was the fail-open when that registry read FAILS,
 * fixed in the routes themselves (see
 * company-codegen-registry-failure-idempotency-1041.test.ts).
 *
 * What remains here is the client half: the cheap GET this screen ALREADY
 * fires for both slugs (`resolve-app`, the existing poll target) is the
 * authority on whether generation is needed. Checking it before POSTing turns
 * two speculative write requests per load into two cheap reads, and keeps the
 * genuinely-new-company path intact — a confirmed miss still POSTs.
 *
 * Deliberately a source assertion rather than a mounted render: BuildProvider
 * OOMs jsdom via useAutoplay (the same reason
 * build-context-url-sync-mount-race.test.ts and
 * live-company-app-design-system.test.ts assert on source).
 */
describe('builder#1041: Live.tsx codegen POST guards', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('the company-app POST is preceded by a resolve-app existence check, not fired off local state alone', () => {
    const idx = source.indexOf("fetch('/api/build/company-app'")
    expect(idx).toBeGreaterThan(-1)
    // The POST must sit inside a block that first consults the server for this
    // slug. The guarded helper below is that check.
    const preceding = source.slice(Math.max(0, idx - 2600), idx)
    expect(preceding).toMatch(/generateIfGenuinelyMissing|resolve-app/)
  })

  it('the company-product POST is preceded by a resolve-app existence check', () => {
    const idx = source.indexOf("fetch('/api/build/company-product'")
    expect(idx).toBeGreaterThan(-1)
    const preceding = source.slice(Math.max(0, idx - 2600), idx)
    expect(preceding).toMatch(/generateIfGenuinelyMissing|resolve-app/)
  })

  it('an unconfirmed (verified:false) resolve-app read does NOT lead to a codegen POST', () => {
    // The honest signal resolve-app already returns (#807/#832/#833). A read
    // that could not confirm the company must not buy a speculative POST.
    expect(source).toMatch(/verified\s*===\s*false|!d\?\.verified|d\?\.verified\s*===\s*false/)
  })

  it("the routes' new 'unverified' response is not mistaken for an in-flight generation", () => {
    // Both POST handlers branch on `d?.status === 'processing'` to start a
    // 5-minute poll. 'unverified' means nothing was started, so it must not
    // fall into that branch — the handlers must only poll on 'processing'.
    const appIdx = source.indexOf("fetch('/api/build/company-app'")
    const prodIdx = source.indexOf("fetch('/api/build/company-product'")
    for (const idx of [appIdx, prodIdx]) {
      const block = source.slice(idx, idx + 1400)
      expect(block).toMatch(/d\?\.status === 'processing'/)
      expect(block).not.toMatch(/d\?\.status !== 'cached'/)
    }
  })
})
