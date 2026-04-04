#!/usr/bin/env tsx

/**
 * Debug script to check what code was actually generated
 */

async function debugPreview(previewId: string) {
  console.log(`\n🔍 Fetching raw code for preview: ${previewId}\n`)

  try {
    // Fetch the preview HTML
    const response = await fetch(`http://localhost:3000/api/preview/${previewId}`)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const html = await response.text()

    // Extract the component code from the script tag
    const codeMatch = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)

    if (!codeMatch) {
      console.error('❌ No component code found in preview HTML')
      return
    }

    const fullScript = codeMatch[1]

    // Find where the actual component code starts (after all the setup)
    const componentCodeMatch = fullScript.match(/\/\/ Insert the component code\s+([\s\S]*?)console\.log\('\[Preview\] Component code executed/);

    if (!componentCodeMatch) {
      console.error('❌ Could not extract component code')
      console.log('\nFull script length:', fullScript.length, 'characters')
      return
    }

    const componentCode = componentCodeMatch[1].trim()

    console.log('📝 Component Code:')
    console.log('='.repeat(80))
    console.log(componentCode.substring(0, 2000)) // First 2000 chars
    console.log('='.repeat(80))
    console.log(`\nTotal length: ${componentCode.length} characters`)

    // Check for component function definitions
    const functionMatches = componentCode.match(/function\s+([A-Z][a-zA-Z0-9]*)/g)
    const constMatches = componentCode.match(/const\s+([A-Z][a-zA-Z0-9]*)\s*=/g)

    console.log('\n📋 Component definitions found:')
    if (functionMatches) {
      console.log('  Functions:', functionMatches.join(', '))
    }
    if (constMatches) {
      console.log('  Consts:', constMatches.join(', '))
    }

    // Check if components are exposed to window
    const windowExposures = componentCode.match(/window\.([A-Z][a-zA-Z0-9]*)\s*=/g)
    if (windowExposures) {
      console.log('\n✅ Window exposures:', windowExposures.join(', '))
    } else {
      console.log('\n❌ No window exposures found!')
    }

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

const previewId = process.argv[2] || 'bay-view-1772576598413'
debugPreview(previewId)
