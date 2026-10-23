/**
 * Gated E2E session-restore seam for stage-gated Live panels (#1198).
 *
 * The problem this closes: Tasks, Versions, Ask-Cody chat, Documents, Media,
 * AutoMode, Website, pitch-deck export, and primitive tooltips on the Live
 * dashboard only render real content once a build reaches Live stage in an
 * ACTIVE session — Builder's own build state is localStorage-only (see
 * contexts/build-context.tsx's `saveBuildState`/`loadBuildState`, #284).
 * Playwright cannot "restore" a Live-stage company by navigating to a bare
 * URL, because there is nothing server-side to restore FROM — every prior
 * attempt had to drive a full, slow, flaky real generation per spec.
 *
 * This is NOT a new production route, API, or middleware allowlist entry —
 * deliberately, so there is nothing new for a production visitor to ever
 * reach (the whole point of "gated/non-production-exposed" from #1198's
 * acceptance criteria). It composes two mechanisms that already ship to
 * production today, unchanged:
 *
 *   1. The real `?screen=live&company={slug}` deep link
 *      (contexts/build-context.tsx's deep-link effect) — already how a
 *      returning founder's own bookmark/email link opens their dashboard.
 *   2. Browser localStorage under the `ainative_build_<slug>` key
 *      (`buildStateStorageKey`/`PersistedBuildState`, exported from
 *      contexts/build-context.tsx specifically for this seam) — already how
 *      that same deep link restores WITHOUT re-running generation when the
 *      browser already holds a cache (builder#1037's `isSavedBuildStateComplete`
 *      path is exactly "trust a sufficiently-complete local cache, skip the
 *      network check").
 *
 * In other words: any real founder's own browser, after their own real
 * generation once completed, already holds exactly this localStorage entry
 * and already restores through exactly this deep link on every subsequent
 * visit. This helper reproduces that SAME real, already-shipped founder
 * experience for a Playwright context, using a REAL authenticated session
 * (real login against E2E_TEST_EMAIL/E2E_TEST_PASSWORD) and a REAL, already
 * fully-generated company (seeded by #1197's full-onboarding-provision.spec.ts
 * against the real API — never a fabricated DB row). Nothing here bypasses
 * auth, fabricates server-side state, or creates a code path a production
 * visitor could hit: a signed-out visitor still gets Auth.tsx's real sign-in
 * gate, and a signed-in visitor with no such localStorage entry still either
 * sees "building your site…" or triggers the real resolve-app verification —
 * identical to today's behavior for every real founder.
 */
import type { Page } from '@playwright/test'
import {
  buildStateStorageKey,
  type PersistedBuildState,
} from '@/contexts/build-context'

export interface SeedCompanyFixture {
  /** The company's slug — contexts/build-context.tsx's `appSub`/`companyId`. */
  slug: string
  companyName?: string
  idea?: string
  /** 'company' (default) matches the Company track #1197 seeds via the real
   *  My Companies → Fork → "Build a Company →" path. */
  track?: 'app' | 'company'
  appChatId?: string
  productChatId?: string
  brandTagline?: string
  brandColor?: string
}

/**
 * Pure builder for the exact payload `saveBuildState` would have written for
 * a real, completed company — extracted so the shape is unit-testable
 * without Playwright or a DOM. Deliberately mirrors
 * `PersistedBuildState`'s field list; TypeScript's structural typing means
 * this function fails to compile the moment that list changes in a way this
 * fixture doesn't account for, so the two can't silently drift apart.
 *
 * Defaults every field to the real "fully built, Live-stage" values a
 * completed Company-track build leaves behind (`builtCompany: true`,
 * `done`/`generated` covering all 7 COMPANY_VIEWS) — a caller only needs to
 * supply the fields that make this fixture a specific real company.
 */
export function buildSeedPayload(fixture: SeedCompanyFixture): PersistedBuildState {
  const track = fixture.track ?? 'company'
  const companyViews = ['design', 'thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30']
  const appViews = [
    'design', 'brief', 'prd', 'comp', 'dataModel', 'memoryPolicy',
    'agentDef', 'codingStandards', 'apiSpec', 'backlog', 'sprintPlan', 'swarm', 'infra', 'preview',
  ]
  const views = track === 'app' ? appViews : companyViews
  // `generated` holds the real artifact content (lib/build/state.ts:
  // `Record<string, unknown>`) — a short placeholder string is enough to
  // mark a view as genuinely generated. `done` holds a real status STRING
  // per view (lib/build/state.ts's COMPLETE_ARTIFACT reducer case writes
  // `'done'` by default), not a boolean.
  const generated: Record<string, unknown> = {}
  const done: Record<string, string> = {}
  for (const v of views) {
    generated[v] = `seeded-${v}-artifact`
    done[v] = 'done'
  }

  return {
    generated,
    done,
    genError: {},
    builtCompany: track === 'company',
    builtMVP: track === 'app',
    wedgePicked: 'confirmed',
    answers: {},
    companyName: fixture.companyName ?? fixture.slug,
    idea: fixture.idea ?? `A test company seeded for E2E verification (${fixture.slug})`,
    appSub: fixture.slug,
    brandTagline: fixture.brandTagline ?? '',
    brandColor: fixture.brandColor ?? '',
    appChatId: fixture.appChatId ?? '',
    productChatId: fixture.productChatId ?? '',
    activePlan: '',
    enrolled: false,
    track,
    sawPreview: true,
    designSystemId: '',
    designStepDone: true,
  }
}

/**
 * Log in for real against E2E_TEST_EMAIL/E2E_TEST_PASSWORD — same real auth
 * gate (Auth.tsx, next-auth's credentials signIn) every founder goes
 * through. No production code path is skipped; this is identical to what
 * e2e/full-onboarding-provision.spec.ts's own `login()` does.
 */
export async function loginRealTestAccount(page: Page, baseUrl: string, email: string, password: string): Promise<void> {
  await page.goto(`${baseUrl}/build?screen=login`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="auth-email"]').fill(email)
  await page.locator('[data-testid="auth-password"]').fill(password)
  await page.locator('[data-testid="auth-submit"]').click()
  // Real post-login destination is either My Companies (account has
  // companies) or the Fork front door (it doesn't yet) — see
  // full-onboarding-provision.spec.ts's login() for why both are valid.
  const myCompanies = page.getByText('My companies')
  const forkFrontDoor = page.getByText("Don't build from scratch.")
  await myCompanies.or(forkFrontDoor).waitFor({ state: 'visible', timeout: 15_000 })
}

/**
 * The gated E2E session-restore seam itself (#1198's acceptance criteria).
 *
 * Logs in with a REAL authenticated session, seeds this ONE browser
 * context's localStorage with the real company's persisted build state
 * (under the exact key/shape the app itself reads — `buildStateStorageKey`/
 * `PersistedBuildState`), then follows the app's own real
 * `?screen=live&company={slug}` deep link. The Live dashboard mounts with a
 * real, server-backed `companyId` — TasksPanel/VersionsPanel/DocumentsPanel/
 * MediaPanel/AutoModePanel all fetch and render that company's REAL
 * persisted server data, exactly as they would for the founder who actually
 * built it. No fixture here ever touches the server directly; it only
 * primes the SAME client-side cache a real completed build leaves behind.
 */
export async function restoreLiveSession(
  page: Page,
  opts: {
    baseUrl: string
    email: string
    password: string
    fixture: SeedCompanyFixture
  },
): Promise<void> {
  await loginRealTestAccount(page, opts.baseUrl, opts.email, opts.password)

  const key = buildStateStorageKey(opts.fixture.slug)
  const payload = buildSeedPayload(opts.fixture)
  await page.evaluate(
    ({ key, payload }) => {
      window.localStorage.setItem(key, JSON.stringify(payload))
    },
    { key, payload },
  )

  const url = new URL(`${opts.baseUrl}/build`)
  url.searchParams.set('screen', 'live')
  url.searchParams.set('company', opts.fixture.slug)
  if (opts.fixture.track) url.searchParams.set('track', opts.fixture.track)
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
}
