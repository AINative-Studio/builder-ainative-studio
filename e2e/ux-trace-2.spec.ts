import { test, expect } from '@playwright/test'
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://builder.ainative.studio'
const SHOT = 'e2e/ux-shots'

test.describe('UX trace — remaining screens + interactions', () => {
  test('Workspace (Cody building) screen renders', async ({ page }) => {
    page.on('console', m => { if (m.type()==='error') console.log(`FINDING: [ws] console.error: ${m.text().slice(0,180)}`) })
    await page.goto(`${BASE}/build?screen=ws&company=riff`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: `${SHOT}/08-workspace.png`, fullPage: true })
    const body = await page.locator('body').textContent()
    if (!body || body.trim().length < 50) console.log('FINDING: [ws] workspace screen appears empty')
  })

  test('Auth (signup) screen renders + has form', async ({ page }) => {
    page.on('console', m => { if (m.type()==='error') console.log(`FINDING: [signup] console.error: ${m.text().slice(0,180)}`) })
    await page.goto(`${BASE}/build?screen=signup`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${SHOT}/09-signup.png`, fullPage: true })
    // A signup screen must have email + password (or oauth) inputs.
    const inputs = await page.locator('input').count()
    console.log(`FINDING-INFO: [signup] ${inputs} input fields`)
    if (inputs === 0) console.log('FINDING: [signup] no input fields — auth form missing/broken')
  })

  test('Login screen renders', async ({ page }) => {
    await page.goto(`${BASE}/build?screen=login`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${SHOT}/10-login.png`, fullPage: true })
    const inputs = await page.locator('input').count()
    if (inputs === 0) console.log('FINDING: [login] no input fields — auth form missing/broken')
  })

  test('Account screen renders', async ({ page }) => {
    await page.goto(`${BASE}/build?screen=account`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${SHOT}/11-account.png`, fullPage: true })
  })

  test('Live — Ask Cody interaction', async ({ page }) => {
    page.on('response', r => { if (r.url().includes('/api/') && r.status()>=500) console.log(`FINDING: [ask] 5xx ${r.url()} -> ${r.status()}`) })
    await page.goto(`${BASE}/build?screen=live&company=riff`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.m-live-masthead').first()).toBeVisible({ timeout: 20000 })
    // Find the "Ask Cody" message input + Send.
    const msg = page.getByPlaceholder(/message cody/i)
    if (await msg.isVisible().catch(()=>false)) {
      await msg.fill('What should I build next?')
      const send = page.getByRole('button', { name: /send/i })
      await send.click()
      await page.waitForTimeout(4000)
      await page.screenshot({ path: `${SHOT}/12-ask-cody.png`, fullPage: true })
      const body = await page.locator('.m-live-col').first().textContent()
      console.log('FINDING-INFO: [ask] sent a message to Cody')
    } else {
      console.log('FINDING: [live] Ask Cody input not found')
    }
  })
})
