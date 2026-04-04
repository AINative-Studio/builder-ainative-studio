#!/usr/bin/env tsx
/**
 * Test script to verify:
 * 1. Preview rendering fix (demo URL in init event)
 * 2. Professional design themes are applied
 */

interface StreamEvent {
  type: 'init' | 'chunk' | 'complete' | 'build_step' | 'validation_error'
  chatId?: string
  demo?: string
  step?: string
  content?: string
  error?: string
}

async function testPreviewAndDesign() {
  console.log('🧪 Testing Preview Rendering Fix and Design Quality\n')

  const prompt = 'Create a modern tech startup landing page with a hero section, features grid, and CTA button'

  console.log(`📝 Prompt: ${prompt}\n`)
  console.log('🔄 Starting generation...\n')

  try {
    const response = await fetch('http://localhost:3000/api/chat-ws', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: prompt,
        chatId: `test-${Date.now()}`,
      }),
    })

    if (!response.ok) {
      console.error(`❌ Request failed: ${response.status} ${response.statusText}`)
      process.exit(1)
    }

    const text = await response.text()
    const lines = text.split('\n').filter(line => line.trim())

    let initEvent: any = null
    let completeEvent: any = null
    let chatId: string | null = null
    let demoUrl: string | null = null

    console.log('📡 Processing stream events...\n')

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue

      try {
        const data = JSON.parse(line.slice(6))

        if (data.type === 'init') {
          initEvent = data
          chatId = data.chatId
          demoUrl = data.demo
          console.log('✓ INIT event received')
          console.log(`  Chat ID: ${chatId}`)
          console.log(`  Demo URL: ${demoUrl || 'NOT PROVIDED'}`)
          console.log(`  Has demo in init: ${!!demoUrl ? '✅ YES' : '❌ NO'}\n`)
        }

        if (data.type === 'build_step') {
          console.log(`  Building: ${data.step}`)
        }

        if (data.type === 'complete') {
          completeEvent = data
          console.log('\n✓ COMPLETE event received')
          console.log(`  Demo URL: ${data.demo || 'NOT PROVIDED'}`)
          console.log(`  Has demo in complete: ${!!data.demo ? '✅ YES' : '❌ NO'}\n`)
        }
      } catch (e) {
        // Skip invalid JSON lines
      }
    }

    // Test 1: Verify preview URL is provided in BOTH init and complete events
    console.log('\n📊 TEST RESULTS:\n')
    console.log('═══════════════════════════════════════════════════\n')

    console.log('1️⃣  Preview URL in INIT event:')
    if (initEvent?.demo) {
      console.log('   ✅ PASS - Demo URL provided in init event')
      console.log(`   URL: ${initEvent.demo}`)
    } else {
      console.log('   ❌ FAIL - No demo URL in init event')
      console.log('   This means preview will remain blank until complete event!')
    }

    console.log('\n2️⃣  Preview URL in COMPLETE event:')
    if (completeEvent?.demo) {
      console.log('   ✅ PASS - Demo URL provided in complete event')
      console.log(`   URL: ${completeEvent.demo}`)
    } else {
      console.log('   ❌ FAIL - No demo URL in complete event')
    }

    // Test 2: Fetch and analyze the preview HTML
    if (chatId) {
      console.log('\n3️⃣  Preview HTML Content:')
      const previewUrl = `/api/preview/${chatId}`
      const previewResponse = await fetch(`http://localhost:3000${previewUrl}`)

      if (previewResponse.ok) {
        const html = await previewResponse.text()
        console.log(`   ✅ Preview HTML retrieved (${html.length} bytes)`)

        // Check for professional design theme colors
        const themeColors = {
          'Ocean Depths': ['#1a2332', '#2d8b8b', '#a8dadc', '#f1faee'],
          'Tech Innovation': ['#0066ff', '#00ffff', '#1e1e1e'],
          'Modern Minimalist': ['#36454f', '#708090', '#d3d3d3'],
          'Golden Hour': ['amber', 'orange'],
          'Forest Canopy': ['green', 'earth'],
          'Arctic Frost': ['blue', 'frost'],
          'Desert Rose': ['#c9ada7', '#ddbea9'],
          'Midnight Galaxy': ['purple', 'galaxy'],
          'Botanical Garden': ['green', 'botanical'],
        }

        console.log('\n4️⃣  Design Theme Analysis:')
        let themeDetected = false

        for (const [themeName, colors] of Object.entries(themeColors)) {
          const foundColors = colors.filter(color =>
            html.toLowerCase().includes(color.toLowerCase())
          )

          if (foundColors.length > 0) {
            console.log(`   ✅ ${themeName} theme detected!`)
            console.log(`      Colors found: ${foundColors.join(', ')}`)
            themeDetected = true
          }
        }

        if (!themeDetected) {
          console.log('   ⚠️  No professional theme colors detected')
          console.log('   Design may not be using theme guidance')
        }

        // Check for proper spacing and shadows
        const hasSpacing = html.includes('p-4') || html.includes('p-6') || html.includes('p-8')
        const hasShadows = html.includes('shadow-') || html.includes('shadow-sm') || html.includes('shadow-lg')

        console.log('\n5️⃣  Design Quality:')
        console.log(`   Proper spacing: ${hasSpacing ? '✅ YES' : '⚠️  NO'}`)
        console.log(`   Shadow effects: ${hasShadows ? '✅ YES' : '⚠️  NO'}`)

        // Print a sample of the HTML (first 500 chars)
        console.log('\n6️⃣  HTML Sample:')
        console.log('   ─────────────────────────────────────────')
        console.log('   ' + html.substring(0, 500).replace(/\n/g, '\n   ') + '...')
        console.log('   ─────────────────────────────────────────')

      } else {
        console.log(`   ❌ FAIL - Could not fetch preview: ${previewResponse.status}`)
      }
    }

    console.log('\n═══════════════════════════════════════════════════\n')

    // Final verdict
    const initHasDemo = !!initEvent?.demo
    const completeHasDemo = !!completeEvent?.demo

    if (initHasDemo && completeHasDemo) {
      console.log('🎉 SUCCESS: Preview rendering fix is working!')
      console.log('   Demo URL is provided in BOTH init and complete events.')
      console.log('   Preview should load immediately when generation starts.\n')
    } else if (!initHasDemo && completeHasDemo) {
      console.log('⚠️  PARTIAL: Preview will only show after complete event')
      console.log('   The init event needs to include demo URL for instant preview.\n')
    } else {
      console.log('❌ FAILURE: Preview rendering is broken')
      console.log('   Neither init nor complete events provide demo URL.\n')
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error)
    process.exit(1)
  }
}

// Run the test
testPreviewAndDesign()
