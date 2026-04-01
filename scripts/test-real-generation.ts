#!/usr/bin/env tsx

/**
 * Test real component generation through the API
 * Simulates a user typing a creative prompt and getting a preview
 */

const TEST_PROMPTS = [
  "Build me a cryptocurrency trading dashboard with live price charts",
  "Create a recipe finder app with ingredient filters and cooking timers",
  "Make a fitness tracker with workout logging and progress graphs",
]

async function testGeneration(prompt: string): Promise<void> {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`🧪 Testing: ${prompt}`)
  console.log('='.repeat(80))

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
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    // Read the streaming response
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let previewId = ''

    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)

              if (parsed.type === 'content') {
                fullContent += parsed.content
              } else if (parsed.type === 'preview_update') {
                previewId = parsed.previewId
                console.log(`📦 Preview ID: ${previewId}`)
              } else if (parsed.type === 'error') {
                console.error(`❌ Error: ${parsed.error}`)
              }
            } catch (e) {
              // Skip non-JSON lines
            }
          }
        }
      }
    }

    console.log(`\n✅ Generation completed!`)
    console.log(`📊 Content length: ${fullContent.length} characters`)

    if (previewId) {
      // Test preview endpoint
      console.log(`\n🔍 Testing preview endpoint...`)
      const previewResponse = await fetch(
        `http://localhost:3000/api/preview/${previewId}`
      )

      if (previewResponse.ok) {
        const previewData = await previewResponse.json()
        console.log(`✅ Preview validation: ${previewData.validation.valid ? 'PASSED' : 'FAILED'}`)

        if (!previewData.validation.valid) {
          console.error(`❌ Validation error: ${previewData.validation.error}`)
        } else if (previewData.validation.fixes && previewData.validation.fixes.length > 0) {
          console.log(`🔧 Auto-fixes applied:`)
          previewData.validation.fixes.forEach((fix: string) => {
            console.log(`   - ${fix}`)
          })
        }

        console.log(`📝 Code snippet (first 200 chars):`)
        console.log(previewData.code.substring(0, 200))
        console.log(`\n🌐 Preview URL: http://localhost:3000/preview/${previewId}`)
      } else {
        console.error(`❌ Preview fetch failed: ${previewResponse.status}`)
      }
    }
  } catch (error) {
    console.error(`❌ Test failed:`, error)
  }
}

async function main() {
  console.log('🚀 Real Generation Test - Simulating User Input')
  console.log(`Testing ${TEST_PROMPTS.length} creative prompts...\n`)

  for (const prompt of TEST_PROMPTS) {
    await testGeneration(prompt)
    await new Promise(resolve => setTimeout(resolve, 2000)) // Wait between tests
  }

  console.log(`\n${'='.repeat(80)}`)
  console.log('🎉 All tests completed!')
  console.log('='.repeat(80))
}

main().catch(console.error)
