import { test, expect } from '@playwright/test'

test('showcase detail page renders preview in iframe', async ({ page }) => {
  await page.goto('https://builder.ainative.studio/showcase/saas-pricing-page', { waitUntil: 'networkidle', timeout: 15000 })
  
  // Wait for iframe to load
  await page.waitForTimeout(5000)
  
  const iframes = await page.locator('iframe').all()
  console.log('Iframes found:', iframes.length)
  
  for (let i = 0; i < iframes.length; i++) {
    const src = await iframes[i].getAttribute('src')
    const visible = await iframes[i].isVisible()
    const box = await iframes[i].boundingBox()
    console.log(`  iframe[${i}]: src=${src} visible=${visible} box=${JSON.stringify(box)}`)
  }
  
  expect(iframes.length).toBeGreaterThan(0)
  
  // Check the iframe content loads (not "refused to connect")
  const frame = page.frameLocator('iframe').first()
  const frameContent = await frame.locator('body').textContent({ timeout: 10000 }).catch(() => 'FAILED')
  console.log('Frame content length:', frameContent?.length || 0)
  console.log('Has real content:', frameContent !== 'FAILED' && (frameContent?.length || 0) > 50)
  
  await page.screenshot({ path: '/tmp/showcase-iframe-test.png', fullPage: false })
  console.log('Screenshot saved')
})
