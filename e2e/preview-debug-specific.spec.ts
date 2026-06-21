import { test } from '@playwright/test'

const URLS = [
  'https://builder.ainative.studio/api/preview/qW0U13ZYFZ8G19RGOYihy', // ExpenseTracker (blank)
  'https://builder.ainative.studio/api/preview/q8hvqPmLNpNyM191FFgkd', // Finance Portfolio (no renderable code)
]

for (const url of URLS) {
  const id = url.split('/').pop()!
  test(`preview ${id}`, async ({ page }) => {
    const errors: string[] = []
    const logs: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
      else logs.push(msg.text())
    })
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message))

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(12000)

    console.log(`\n=== ${id} ===`)
    for (const l of logs) {
      if (l.includes('[Preview]') || l.includes('Babel') || l.includes('error')) {
        console.log('LOG:', l.substring(0, 300))
      }
    }
    for (const e of errors) {
      console.log('ERR:', e.substring(0, 300))
    }
    const root = await page.evaluate(() => document.getElementById('root')?.innerHTML?.substring(0, 500) || 'EMPTY')
    console.log('ROOT:', root.substring(0, 300))
  })
}
