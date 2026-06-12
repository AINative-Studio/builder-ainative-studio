import { test, expect } from '@playwright/test'

test('showcase preview iframe renders visible content', async ({ page }) => {
  // Go to showcase detail
  await page.goto('https://builder.ainative.studio/showcase/saas-pricing-page', { waitUntil: 'networkidle', timeout: 15000 })
  
  // Wait for iframe to fully render
  await page.waitForTimeout(5000)
  
  // Check iframe exists and is visible
  const iframe = page.locator('iframe').first()
  const visible = await iframe.isVisible()
  const box = await iframe.boundingBox()
  console.log('Iframe visible:', visible, 'Box:', JSON.stringify(box))
  expect(visible).toBe(true)
  
  // Check iframe content is NOT "refused to connect"
  const frame = page.frameLocator('iframe').first()
  const bodyText = await frame.locator('body').textContent({ timeout: 10000 }).catch(() => 'LOAD_FAILED')
  console.log('Frame body length:', bodyText?.length)
  console.log('Has pricing content:', bodyText?.includes('Free') || bodyText?.includes('Pro') || bodyText?.includes('pricing'))
  expect(bodyText?.length).toBeGreaterThan(50)
  
  await page.screenshot({ path: '/tmp/showcase-final.png', fullPage: false })
  console.log('Screenshot: /tmp/showcase-final.png')
})

test('builder preview iframe renders after generation', async ({ page }) => {
  await page.goto('https://builder.ainative.studio', { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(3000)
  
  // Click Agent Dashboard
  const btn = page.getByText('Agent Dashboard', { exact: true }).first()
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()
  
  // Wait for generation
  console.log('Generating...')
  await page.waitForTimeout(45000)
  
  // Check iframe
  const iframes = await page.locator('iframe').all()
  console.log('Iframes:', iframes.length)
  
  if (iframes.length > 0) {
    const src = await iframes[0].getAttribute('src')
    const visible = await iframes[0].isVisible()
    console.log('Preview iframe src:', src, 'visible:', visible)
    
    // Check iframe content loads
    if (visible && src) {
      const response = await page.request.get('https://builder.ainative.studio' + src)
      console.log('Preview response:', response.status(), response.headers()['x-frame-options'])
      const body = await response.text()
      console.log('Preview body size:', body.length)
      console.log('Has React code:', body.includes('React') || body.includes('createElement'))
    }
  }
  
  await page.screenshot({ path: '/tmp/builder-preview-final.png', fullPage: false })
  console.log('Screenshot: /tmp/builder-preview-final.png')
  
  expect(iframes.length).toBeGreaterThan(0)
})
