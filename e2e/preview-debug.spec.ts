import { test, expect } from '@playwright/test'

test('debug preview rendering', async ({ page }) => {
  await page.goto('https://builder.ainative.studio', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(3000)
  
  // Click Agent Dashboard
  const btn = page.getByText('Agent Dashboard', { exact: true }).first()
  await btn.click()
  
  console.log('Clicked, waiting...')
  
  // Wait for generation to complete
  await page.waitForTimeout(50000)
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/preview-debug.png', fullPage: true })
  
  // Debug: list all iframes
  const iframes = await page.locator('iframe').all()
  console.log('Total iframes:', iframes.length)
  for (let i = 0; i < iframes.length; i++) {
    const src = await iframes[i].getAttribute('src')
    const visible = await iframes[i].isVisible()
    const box = await iframes[i].boundingBox()
    console.log(`  iframe[${i}]: src=${src} visible=${visible} box=${JSON.stringify(box)}`)
  }
  
  // Check the page content for any preview-related elements
  const content = await page.content()
  console.log('Has WebPreviewBody:', content.includes('WebPreviewBody') || content.includes('Preview'))
  console.log('Has /api/preview:', content.includes('/api/preview'))
  console.log('Has iframe tag:', content.includes('<iframe'))
  console.log('Has demo URL:', content.includes('/preview/'))
  
  // Check console logs
  const logs: string[] = []
  page.on('console', msg => logs.push(msg.text()))
  await page.waitForTimeout(2000)
  const previewLogs = logs.filter(l => l.includes('Preview') || l.includes('preview') || l.includes('iframe') || l.includes('DEBUG'))
  console.log('Preview-related console logs:', previewLogs.length)
  previewLogs.forEach(l => console.log('  ', l))
})
