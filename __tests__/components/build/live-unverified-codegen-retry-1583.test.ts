import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * builder#1583 — an UNCONFIRMED read in Live.tsx's codegen-trigger path used
 * to be a permanent dead end, not just a correctly-cautious non-action.
 *
 * #1041 (live-codegen-post-guard-1041.test.ts) correctly established that an
 * `unverified`/unconfirmed read must NEVER be treated as "buy a generation"
 * or "an in-flight generation is progressing" — both would risk a wasted
 * spend or a false progress signal. But that fix's `return`/no-op on the
 * unconfirmed case had a real, confirmed-live side effect: nothing EVER
 * re-asked the question. A transient ZeroDB registry hiccup on the FIRST
 * read (generateIfGenuinelyMissing's own resolve-app call), or an
 * `unverified` response from company-app/company-product's own POST (their
 * registry/pending-state reads failing to confirm), left the founder's
 * "building your site…" / "building your product…" messaging frozen
 * forever — confirmed live on a real company (`roast-pilot`) stuck 35+
 * minutes past both the 13-minute server-side AbortSignal ceiling AND the
 * already-widened 20-minute client poll budget, with zero further network
 * activity the whole time.
 *
 * Fix: both the pre-generation existence check (generateIfGenuinelyMissing)
 * and the two POST-response handlers (company-app, company-product) now
 * retry on an unconfirmed/unverified result — bounded, not an infinite
 * loop — instead of silently stopping. Still never polls or regenerates on
 * an unconfirmed read; it only ever re-asks the SAME confirming question
 * again later.
 *
 * Deliberately a source assertion rather than a mounted render: BuildProvider
 * OOMs jsdom via useAutoplay (the same documented reason #1041's own test
 * file, build-context-url-sync-mount-race.test.ts, and
 * live-company-app-design-system.test.ts all assert on source instead).
 */
describe('builder#1583: an unconfirmed codegen-trigger read retries instead of stopping forever', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('generateIfGenuinelyMissing retries (not just returns) on an unconfirmed resolve-app read', () => {
    const idx = source.indexOf('const generateIfGenuinelyMissing = (')
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, idx + 2200)
    // Still gates on the same unconfirmed condition #1041 established.
    expect(block).toMatch(/!d\s*\|\|\s*d\.verified\s*===\s*false/)
    // But now schedules a retry rather than ending there.
    expect(block).toMatch(/setTimeout/)
    expect(block).toMatch(/generateIfGenuinelyMissing\(/)
    // Bounded — a real cap exists, not an unconditional retry forever.
    expect(block).toMatch(/retryAttempt/)
  })

  it('a network-level failure (fetch itself rejects) ALSO retries, not just a non-ok response', () => {
    const idx = source.indexOf('const generateIfGenuinelyMissing = (')
    const block = source.slice(idx, idx + 2600)
    const catchIdx = block.indexOf('.catch(')
    expect(catchIdx).toBeGreaterThan(-1)
    const catchBlock = block.slice(catchIdx, catchIdx + 400)
    expect(catchBlock).toMatch(/setTimeout/)
  })

  it('the company-app POST response handles status "unverified" with a real retry, not a silent no-op', () => {
    const idx = source.indexOf("fetch('/api/build/company-app'")
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, idx + 2200)
    // The existing #1041 'processing' branch must still be there, unchanged.
    expect(block).toMatch(/d\?\.status === 'processing'/)
    // And now a distinct 'unverified' branch that actually does something.
    expect(block).toMatch(/d\?\.status === 'unverified'/)
    const unverifiedIdx = block.indexOf("d?.status === 'unverified'")
    const unverifiedBlock = block.slice(unverifiedIdx, unverifiedIdx + 400)
    expect(unverifiedBlock).toMatch(/setTimeout/)
    expect(unverifiedBlock).toMatch(/generateIfGenuinelyMissing/)
  })

  it('the company-product POST response handles status "unverified" with a real retry, not a silent no-op', () => {
    const idx = source.indexOf("fetch('/api/build/company-product'")
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, idx + 2200)
    expect(block).toMatch(/d\?\.status === 'processing'/)
    expect(block).toMatch(/d\?\.status === 'unverified'/)
    const unverifiedIdx = block.indexOf("d?.status === 'unverified'")
    const unverifiedBlock = block.slice(unverifiedIdx, unverifiedIdx + 400)
    expect(unverifiedBlock).toMatch(/setTimeout/)
    expect(unverifiedBlock).toMatch(/generateIfGenuinelyMissing/)
  })

  it('the unverified retry path still does NOT treat unverified as in-flight progress (#1041 intact)', () => {
    // #1041's own regression guard: never read `status !== 'cached'` as a
    // green light to poll. The new 'unverified' branch is a SEPARATE,
    // explicit check from the 'processing' poll-trigger — not a fallback
    // catch-all that could accidentally swallow unexpected future statuses
    // into a poll loop.
    const appIdx = source.indexOf("fetch('/api/build/company-app'")
    const prodIdx = source.indexOf("fetch('/api/build/company-product'")
    for (const idx of [appIdx, prodIdx]) {
      const block = source.slice(idx, idx + 2200)
      expect(block).not.toMatch(/d\?\.status !== 'cached'/)
    }
  })
})
