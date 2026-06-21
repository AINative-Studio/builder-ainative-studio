import { test } from '@playwright/test'

test('capture preview console', async ({ page }) => {
  const errors: string[] = []
  const logs: string[] = []
  page.on('console', msg => {
    const text = msg.text()
    if (msg.type() === 'error') errors.push(text)
    else logs.push(text)
  })
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message))

  await page.goto('https://builder.ainative.studio/api/preview/yjoECcJYbTiiqezIb1kd9', {
    waitUntil: 'networkidle',
    timeout: 30000
  }).catch(() => {})
  await page.waitForTimeout(15000)

  console.log('=== LOGS ===')
  logs.forEach(l => console.log(l.substring(0, 300)))
  console.log('=== ERRORS ===')
  errors.forEach(e => console.log(e.substring(0, 300)))

  const root = await page.evaluate(() => document.getElementById('root')?.innerHTML?.substring(0, 500) || 'ROOT_EMPTY')
  const loader = await page.evaluate(() => document.getElementById('loading-indicator')?.style.display || 'NO_LOADER')
  console.log('=== ROOT ===', root)
  console.log('=== LOADER ===', loader)
})
