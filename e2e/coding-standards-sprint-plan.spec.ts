import { test, expect } from '@playwright/test'

/**
 * #71 — the two new App-track artifacts (Engineering Standards / Definition of
 * Done + Sprint Plan) must appear in the /build workflow and render.
 *
 * We pre-seed the per-company build state in localStorage (the #284 persistence
 * path) so the deep-link restores real generated artifact content, then jump
 * straight to each view (?screen=ws&company=&track=app&view=). This exercises the
 * real artifact router + Modernist render layout deterministically, without
 * driving a full (slow, model-dependent) codegen build.
 */
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

const SLUG = 'e2e-71'

// Real generated shapes matching the codingStandards + sprintPlan schemas.
const SEED = {
  idea: 'a scheduling app for dog groomers',
  appSub: SLUG,
  companyName: SLUG,
  track: 'app',
  done: { codingStandards: 'done', sprintPlan: 'done' },
  genError: {},
  generated: {
    codingStandards: {
      summary: 'Cody builds this app to the AINative engineering standards — the same Definition of Done he was trained on.',
      standards: [
        { title: 'Test-Driven Development (TDD + BDD)', rule: 'Tests first, then code.', applies: 'Cover the booking flow with BDD specs before building it.' },
        { title: '>=80% coverage, tests actually executed', rule: 'Minimum 80% coverage, run with proof.', applies: 'Gate the scheduling engine at 80%.' },
        { title: 'Primitives-first composition', rule: 'Compose real AINative primitives you own.', applies: 'Use ZeroDB for appointments, not a bespoke store.' },
        { title: 'No AI attribution', rule: 'Zero AI tool attribution in commits or PRs.', applies: 'Commits reference the issue only.' },
      ],
    },
    sprintPlan: {
      summary: 'Cody grouped the backlog into epics and scoped the first sprint.',
      epics: [
        { name: 'Booking core', goal: 'Groomers can schedule appointments', issues: ['Appointment model', 'Calendar view'] },
        { name: 'Client CRM', goal: 'Track dogs and owners', issues: ['Client profiles', 'Pet records'] },
      ],
      firstSprint: ['Appointment model', 'Calendar view', 'Client profiles'],
    },
  },
}

test.beforeEach(async ({ page }) => {
  // Seed BEFORE any app JS runs so the deep-link restore reads it.
  await page.addInitScript(
    ([slug, seed]) => {
      window.localStorage.setItem(`ainative_build_${slug}`, JSON.stringify(seed))
    },
    [SLUG, SEED] as const,
  )
})

test('Engineering Standards artifact appears in /build and renders the Definition of Done', async ({ page }) => {
  await page.goto(`${BASE}/build?screen=ws&company=${SLUG}&track=app&view=codingStandards`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(2500)

  // The artifact title (from ARTIFACT_TITLES) confirms the view is wired + routed.
  await expect(page.getByText('Engineering Standards', { exact: false }).first()).toBeVisible({ timeout: 15_000 })

  // The Definition of Done surfaces the real AINative standards.
  const body = await page.locator('body').innerText()
  expect(body).toMatch(/Test-Driven Development|TDD/i)
  expect(body).toMatch(/80%/)
  expect(body).toMatch(/primitives/i)
  expect(body).toMatch(/attribution/i)
})

test('Sprint Plan artifact appears in /build and renders epics + a first sprint', async ({ page }) => {
  await page.goto(`${BASE}/build?screen=ws&company=${SLUG}&track=app&view=sprintPlan`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(2500)

  await expect(page.getByText('Sprint Plan', { exact: false }).first()).toBeVisible({ timeout: 15_000 })

  // Sprint Plan makes EPICS explicit (backlog was issues-only) and scopes a first sprint.
  const body = await page.locator('body').innerText()
  expect(body).toMatch(/Epics/i)
  expect(body).toMatch(/First sprint/i)
  expect(body).toMatch(/Booking core/i)
})
