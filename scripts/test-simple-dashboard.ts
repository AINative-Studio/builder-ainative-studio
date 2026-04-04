#!/usr/bin/env tsx

/**
 * Test Simple Dashboard Generation
 * Quick test with a simple dashboard to validate current system state
 */

const DASHBOARD_PRD = `Create a modern analytics dashboard for a SaaS application.

**Requirements:**
- Clean, professional design with solid colors (no gradients)
- Overview page with key metrics (users, revenue, growth)
- Interactive charts showing trends over time
- Recent activity feed
- Quick actions panel
- Responsive layout

**Stack:**
- Next.js 14 + TypeScript
- TailwindCSS (solid colors only)
- Recharts for data visualization
- Lucide React for icons (no emoji)

**Data:**
Use realistic mock data for:
- User count: 12,847
- Monthly revenue: $84,250
- Growth rate: +18.5%
- Activity logs (last 10 actions)
- Revenue trend (last 6 months)
- User growth trend (last 6 months)

Keep it simple, clean, and functional.`

async function testDashboardGeneration(): Promise<void> {
  console.log('🧪 Testing Simple Dashboard Generation...\n')
  console.log('📝 PRD Length:', DASHBOARD_PRD.length, 'characters\n')

  try {
    const startTime = Date.now()

    const response = await fetch('http://localhost:3000/api/chat-ws', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: DASHBOARD_PRD,
        chatId: `dashboard-test-${Date.now()}`,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    console.log('✅ Request accepted, streaming response...\n')

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let previewId = ''
    let eventCount = 0
    let lastEventType = ''
    let chunkProgressCount = 0

    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          console.log('\n✅ Stream completed successfully!')
          break
        }

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              eventCount++

              if (parsed.type !== lastEventType) {
                if (lastEventType === 'chunk') {
                  console.log() // New line after dots
                }
                console.log(`📦 Event: ${parsed.type}`)
                lastEventType = parsed.type
              }

              if (parsed.type === 'content' || parsed.type === 'chunk') {
                fullContent += parsed.content
                process.stdout.write('.')
              } else if (parsed.type === 'init') {
                previewId = parsed.chatId
                console.log(`🆔 Preview ID: ${previewId}`)
              } else if (parsed.type === 'build_step') {
                console.log(`   📋 ${parsed.step}`)
              } else if (parsed.type === 'chunk_progress') {
                chunkProgressCount++
                console.log(`   🔄 [Phase ${parsed.phase}/${parsed.totalPhases}] ${parsed.message}`)
              } else if (parsed.type === 'complete') {
                console.log(`\n✅ Generation complete!`)
                const duration = ((Date.now() - startTime) / 1000).toFixed(1)
                console.log(`⏱️  Duration: ${duration}s`)
                console.log(`📊 Content length: ${fullContent.length} characters`)
                console.log(`📦 Total events: ${eventCount}`)
              } else if (parsed.type === 'error' || parsed.type === 'validation_error') {
                console.error(`❌ Error: ${parsed.error}`)
                throw new Error(parsed.error)
              }
            } catch (e) {
              // Skip non-JSON lines
            }
          }
        }
      }
    }

    console.log(`\n📝 Conversational message length: ${fullContent.length} characters`)

    if (previewId) {
      console.log(`\n🔍 Testing preview endpoint...`)
      const previewResponse = await fetch(
        `http://localhost:3000/api/preview/${previewId}`
      )

      if (previewResponse.ok) {
        const previewHtml = await previewResponse.text()
        console.log(`✅ Preview HTML received: ${previewHtml.length} chars`)

        if (previewHtml.includes('Code Validation Error') || previewHtml.includes('Preview Expired')) {
          console.error(`❌ Preview shows error page`)
          console.error(previewHtml.substring(0, 500))
          throw new Error('Preview validation failed')
        } else {
          console.log(`✅ Preview HTML looks valid`)
          console.log(`\n${'='.repeat(80)}`)
          console.log(`🎉 TEST PASSED - Dashboard Generation Successful!`)
          console.log(`${'='.repeat(80)}`)
          console.log(`\n🌐 Preview URL: http://localhost:3000/preview/${previewId}\n`)
          console.log(`${'='.repeat(80)}`)

          // Summary
          console.log(`\n📊 Summary:`)
          console.log(`   Mode: ${chunkProgressCount > 0 ? 'Multi-pass chunking' : 'Single-pass'}`)
          console.log(`   Chunk phases: ${chunkProgressCount > 0 ? 'Yes' : 'No'}`)
          console.log(`   Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`)
          console.log(`   Status: ✅ SUCCESS`)
        }
      } else {
        throw new Error(`Preview fetch failed: ${previewResponse.status}`)
      }
    }

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error)
    process.exit(1)
  }
}

testDashboardGeneration()
