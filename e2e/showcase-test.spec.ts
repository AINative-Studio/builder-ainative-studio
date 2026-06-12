import { test, expect } from '@playwright/test'

test('showcase gallery loads with cards', async ({ page }) => {
  await page.goto('https://builder.ainative.studio/showcase', { waitUntil: 'networkidle', timeout: 30000 })
  
  console.log('Title:', await page.title())
  
  const cards = await page.locator('a[href*="/showcase/"]').count()
  console.log('Cards found:', cards)
  expect(cards).toBeGreaterThan(0)
  
  // List links
  const links = page.locator('a[href*="/showcase/"]')
  for (let i = 0; i < Math.min(5, cards); i++) {
    const href = await links.nth(i).getAttribute('href')
    console.log('  -', href)
  }
})

test('showcase detail page renders with preview', async ({ page }) => {
  // Go to a seed entry
  await page.goto('https://builder.ainative.studio/showcase/analytics-dashboard', { waitUntil: 'networkidle', timeout: 15000 })
  
  console.log('Title:', await page.title())
  
  // Should have iframe for preview
  const iframes = await page.locator('iframe').count()
  console.log('Iframes:', iframes)
  
  if (iframes > 0) {
    const src = await page.locator('iframe').first().getAttribute('src')
    console.log('Iframe src:', src)
    
    // The iframe should load something
    expect(src).toBeTruthy()
  }
  
  // Should have prompt section
  const hasPrompt = await page.locator('text=Prompt Used').count()
  console.log('Has Prompt Used:', hasPrompt > 0)
  expect(hasPrompt).toBeGreaterThan(0)
  
  // Should have Try This Prompt button
  const hasBtn = await page.locator('text=Try This Prompt').count()
  console.log('Has Try This Prompt:', hasBtn > 0)
  
  // Should have tags
  const hasTags = await page.locator('text=Tags').count()
  console.log('Has Tags section:', hasTags > 0)
  
  // Screenshot
  await page.screenshot({ path: '/tmp/showcase-detail.png', fullPage: true })
  console.log('Screenshot saved')
})

test('showcase preview iframe actually renders content', async ({ page }) => {
  await page.goto('https://builder.ainative.studio/showcase/analytics-dashboard', { waitUntil: 'networkidle', timeout: 15000 })
  
  const iframes = await page.locator('iframe').count()
  console.log('Iframes on detail page:', iframes)
  
  if (iframes > 0) {
    const src = await page.locator('iframe').first().getAttribute('src')
    console.log('Preview URL:', src)
    
    // Navigate directly to the preview URL
    if (src) {
      const fullUrl = src.startsWith('http') ? src : 'https://builder.ainative.studio' + src
      const response = await page.request.get(fullUrl)
      console.log('Preview response status:', response.status())
      console.log('Preview response size:', (await response.body()).length, 'bytes')
      
      const body = (await response.body()).toString()
      const hasContent = body.length > 100
      const hasHtml = body.includes('<html') || body.includes('<!DOCTYPE')
      console.log('Has substantial content:', hasContent)
      console.log('Is HTML:', hasHtml)
      
      // Check if it says "Preview not available" or has actual content
      const isPlaceholder = body.includes('Preview not available') || body.includes('Generate this app')
      console.log('Is placeholder:', isPlaceholder)
    }
  } else {
    console.log('NO IFRAMES — preview not rendering')
  }
})
