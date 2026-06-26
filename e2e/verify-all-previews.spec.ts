/**
 * Verify every showcase preview renders — like a human clicking each one
 * Reports which are working, blank, or errored
 */
import { test } from '@playwright/test'

test('verify all showcase previews', async ({ page }) => {
  // Get all showcase entries
  const res = await page.request.get('https://builder.ainative.studio/api/showcase?limit=100')
  const data = await res.json()
  const entries = (data.entries || []).filter(
    (e: any) => e.chatId && e.generatedCode && e.generatedCode.length > 2000
  )

  console.log(`\nTesting ${entries.length} previews...\n`)

  const results: { ok: string[], blank: string[], error: string[] } = { ok: [], blank: [], error: [] }

  for (const entry of entries) {
    const url = `https://builder.ainative.studio/api/preview/${entry.chatId}`
    const title = (entry.title || '?').substring(0, 35)

    const errors: string[] = []
    page.on('pageerror', err => errors.push(err.message))

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 })
      await page.waitForTimeout(8000)

      const rootHtml = await page.evaluate(() => {
        const root = document.getElementById('root')
        return root?.innerHTML || ''
      })

      const loaderVisible = await page.evaluate(() => {
        const loader = document.getElementById('loading-indicator')
        return loader ? loader.style.display !== 'none' : false
      })

      // Check content quality
      const hasRealContent = rootHtml.length > 100 && !rootHtml.includes('data-component=') && !rootHtml.includes('CalendarDay')
      const hasError = rootHtml.includes('Error') || rootHtml.includes('error') || errors.length > 0
      const isBlank = rootHtml.length < 50 || rootHtml.includes('Preview Expired')
      const isStub = rootHtml.includes('data-component=') // Fallback stub rendered

      if (hasRealContent && !hasError && !isStub) {
        results.ok.push(`${entry.chatId}|${title}`)
        console.log(`✅ ${title.padEnd(35)} ${rootHtml.length} chars`)
      } else if (hasError || errors.length > 0) {
        const errMsg = errors[0]?.substring(0, 80) || 'unknown'
        results.error.push(`${entry.chatId}|${title}|${errMsg}`)
        console.log(`❌ ${title.padEnd(35)} ERROR: ${errMsg}`)
      } else {
        results.blank.push(`${entry.chatId}|${title}`)
        console.log(`⬜ ${title.padEnd(35)} BLANK (${rootHtml.length} chars, stub=${isStub})`)
      }
    } catch (navErr: any) {
      results.error.push(`${entry.chatId}|${title}|timeout`)
      console.log(`❌ ${title.padEnd(35)} TIMEOUT`)
    }

    // Clear error listeners
    page.removeAllListeners('pageerror')
  }

  console.log(`\n=== RESULTS ===`)
  console.log(`✅ Working: ${results.ok.length}`)
  console.log(`⬜ Blank:   ${results.blank.length}`)
  console.log(`❌ Error:   ${results.error.length}`)

  if (results.blank.length > 0) {
    console.log(`\nBlank entries:`)
    results.blank.forEach(b => console.log(`  ${b}`))
  }
  if (results.error.length > 0) {
    console.log(`\nError entries:`)
    results.error.forEach(e => console.log(`  ${e}`))
  }
})
