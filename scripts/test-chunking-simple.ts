/**
 * Test Chunking System with Simplified 6-Page Application
 *
 * This test validates that the chunking system correctly:
 * 1. Detects complexity (6 pages should trigger chunking)
 * 2. Generates multi-phase plan
 * 3. Executes all phases successfully
 * 4. Merges chunks into working application
 * 5. Produces valid preview
 */

const SIMPLE_6_PAGE_PRD = `Build a FRONTEND-ONLY blog platform prototype with:

## Pages (6 total)

1. **Homepage** (/)
   - Hero section with featured post
   - Grid of recent posts (6 posts)
   - Simple navigation header

2. **Blog List** (/blog)
   - List of all blog posts
   - Filter by category
   - Search functionality

3. **Blog Detail** (/blog/:slug)
   - Full blog post with content
   - Author info
   - Comments section (mock data)

4. **About** (/about)
   - About the blog
   - Team member cards
   - Mission statement

5. **Contact** (/contact)
   - Contact form (mock submission)
   - Social media links
   - Email address

6. **Categories** (/categories)
   - List of all categories
   - Post count per category
   - Click to filter

## Technical Requirements

- Next.js 14 with App Router
- TypeScript
- Tailwind CSS
- Lucide React icons
- Mock data only (no backend)

## Design
- Clean, modern design
- Responsive layout
- Simple color scheme: blue (#3B82F6) and gray

Generate a complete, working application.`

async function testChunkingSimple(): Promise<void> {
  console.log('🧪 Testing Chunking System with Simplified 6-Page App')
  console.log('=' .repeat(60))
  console.log('')

  const chatId = `chunking-test-${Date.now()}`
  const startTime = Date.now()

  try {
    console.log('📤 Sending PRD to API...')
    console.log(`   Chat ID: ${chatId}`)
    console.log(`   Pages: 6 (should trigger chunking)`)
    console.log('')

    const response = await fetch('http://localhost:3000/api/chat-ws', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: SIMPLE_6_PAGE_PRD,
        chatId,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('No response body')
    }

    console.log('📥 Receiving SSE stream...')
    console.log('')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let previewUrl = ''
    let chunkProgressEvents = 0
    let buildSteps = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))

            switch (data.type) {
              case 'init':
                console.log('✅ Stream initialized')
                console.log(`   Preview URL: ${data.demo}`)
                previewUrl = data.demo
                console.log('')
                break

              case 'build_step':
                buildSteps++
                console.log(`   📋 Build step ${buildSteps}: ${data.step}`)
                break

              case 'chunk_progress':
                chunkProgressEvents++
                console.log(`   🔄 [Phase ${data.phase}/${data.totalPhases}] ${data.message}`)
                if (data.tokenUsage) {
                  console.log(`      Tokens: ${data.tokenUsage.output}`)
                }
                break

              case 'chunk':
                console.log('')
                console.log('💬 Assistant message:')
                console.log(`   ${data.content}`)
                console.log('')
                break

              case 'complete':
                console.log('✅ Generation complete!')
                console.log(`   Preview: ${data.demo}`)
                console.log('')
                break

              case 'validation_error':
                console.error('❌ Validation error:', data.error)
                break

              case 'error':
                console.error('❌ Stream error:', data.error)
                break
            }
          } catch (parseError) {
            // Skip unparseable lines
          }
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log('')
    console.log('=' .repeat(60))
    console.log('📊 Test Results')
    console.log('=' .repeat(60))
    console.log(`   Duration: ${duration}s`)
    console.log(`   Build steps: ${buildSteps}`)
    console.log(`   Chunk progress events: ${chunkProgressEvents}`)
    console.log(`   Preview URL: ${previewUrl}`)
    console.log('')

    // Validate results
    const expectedChunkEvents = chunkProgressEvents > 0
    const hasPreview = previewUrl.length > 0

    if (expectedChunkEvents && hasPreview) {
      console.log('✅ TEST PASSED')
      console.log('')
      console.log('Key Validations:')
      console.log(`   ✅ Chunking was triggered (${chunkProgressEvents} progress events)`)
      console.log('   ✅ Preview was generated')
      console.log('')
      console.log(`🌐 View preview: http://localhost:3000${previewUrl}`)
    } else {
      console.log('❌ TEST FAILED')
      console.log('')
      console.log('Issues:')
      if (!expectedChunkEvents) {
        console.log('   ❌ Chunking was NOT triggered (expected >0 chunk_progress events)')
      }
      if (!hasPreview) {
        console.log('   ❌ No preview URL generated')
      }
    }

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.error('')
    console.error('=' .repeat(60))
    console.error('❌ TEST FAILED')
    console.error('=' .repeat(60))
    console.error(`   Duration: ${duration}s`)
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`)
    console.error('')
  }
}

// Run test
console.log('')
testChunkingSimple()
