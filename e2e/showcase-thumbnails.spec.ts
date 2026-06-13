import { test, expect } from '@playwright/test'

test('showcase cards show live preview thumbnails', async ({ page }) => {
  await page.goto('https://builder.ainative.studio/showcase', { waitUntil: 'networkidle', timeout: 15000 })
  
  // Wait for iframes to start loading
  await page.waitForTimeout(5000)
  
  // Count iframes (each card should have one)
  const iframes = await page.locator('iframe').count()
  console.log('Preview iframes:', iframes)
  
  // Check first iframe has content
  if (iframes > 0) {
    const src = await page.locator('iframe').first().getAttribute('src')
    console.log('First iframe src:', src)
    const visible = await page.locator('iframe').first().isVisible()
    console.log('First iframe visible:', visible)
  }
  
  await page.screenshot({ path: '/tmp/showcase-thumbnails.png', fullPage: false })
  console.log('Screenshot saved')
  
  expect(iframes).toBeGreaterThan(0)
})
