#!/usr/bin/env tsx

/**
 * Test with COMPLEX prompt to verify real-world generation works
 */

async function testComplexGeneration(): Promise<void> {
  console.log('🧪 Testing complex component generation...\n')

  const complexPrompt = "Create a modern pricing table with 3 tiers (Basic, Pro, Enterprise) that shows monthly and annual pricing with a toggle"

  try {
    console.log(`📝 Prompt: "${complexPrompt}"`)
    console.log('📡 Sending request to http://localhost:3000/api/chat-ws\n')

    const response = await fetch('http://localhost:3000/api/chat-ws', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: complexPrompt,
        chatId: `test-complex-${Date.now()}`,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    console.log('✅ Request accepted, streaming response...\n')

    // Read the streaming response
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let previewId = ''
    let eventCount = 0

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

              if (parsed.type === 'content' || parsed.type === 'chunk') {
                fullContent += parsed.content
                process.stdout.write('.')
              } else if (parsed.type === 'init') {
                previewId = parsed.chatId
                console.log(`🆔 Preview ID: ${previewId}`)
              } else if (parsed.type === 'complete') {
                console.log(`\n✅ Generation complete!`)
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

    if (fullContent.length === 0) {
      throw new Error('No content received from generation')
    }

    console.log(`\n📝 Final content length: ${fullContent.length} characters`)

    if (previewId) {
      // Test preview endpoint
      console.log(`\n🔍 Testing preview endpoint...`)
      const previewResponse = await fetch(
        `http://localhost:3000/api/preview/${previewId}`
      )

      if (previewResponse.ok) {
        const previewHtml = await previewResponse.text()
        console.log(`✅ Preview HTML received: ${previewHtml.length} chars`)

        // Check if it's an error page
        if (previewHtml.includes('Code Validation Error') || previewHtml.includes('Preview Expired')) {
          console.error(`❌ Preview shows error page`)
          console.error(previewHtml.substring(0, 500))
          throw new Error('Preview validation failed')
        } else {
          console.log(`✅ Preview HTML looks valid (contains component code)`)
          console.log(`\n🌐 Preview URL: http://localhost:3000/preview/${previewId}`)
        }
      } else {
        throw new Error(`Preview fetch failed: ${previewResponse.status}`)
      }
    }

    console.log('\n✅ TEST PASSED - Complex generation works!')
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error)
    process.exit(1)
  }
}

testComplexGeneration()
