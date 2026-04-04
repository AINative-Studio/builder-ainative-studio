/**
 * Test Google Stitch API Integration
 *
 * This script tests the Google Stitch MCP client to verify:
 * 1. API key authentication works
 * 2. Screen generation endpoint is accessible
 * 3. Generated code can be retrieved
 */

import { config } from 'dotenv'
import { getGoogleStitchClient } from '../lib/mcp/google-stitch-client'

// Load environment variables
config()

async function testGoogleStitchIntegration() {
  console.log('🧪 Testing Google Stitch API Integration...\n')

  const client = getGoogleStitchClient()

  // Test 1: Check if API key is configured
  console.log('📋 Step 1: Checking API key configuration...')
  if (!client.isConfigured()) {
    console.log('❌ ERROR: GOOGLE_STITCH_API_KEY not found in environment')
    console.log('   Please ensure GOOGLE_STITCH_API_KEY is set in your .env file')
    process.exit(1)
  }
  console.log(`✅ API key configured: ${process.env.GOOGLE_STITCH_API_KEY?.substring(0, 10)}...`)

  // Test 2: Connect to the API
  console.log('\n📋 Step 2: Connecting to Google Stitch API...')
  const connected = await client.connect()
  if (connected) {
    console.log('✅ Successfully connected to Google Stitch API')
  } else {
    console.log('⚠️  Connection check failed (this may be expected if health endpoint is not available)')
    console.log('   Continuing with generation test...')
  }

  // Test 3: Test simple screen generation
  console.log('\n📋 Step 3: Testing screen generation...')
  console.log('   Prompt: "Create a simple landing page with a hero section and call-to-action button"')

  try {
    const result = await client.generateScreen({
      prompt: 'Create a simple landing page with a hero section and call-to-action button',
      style: 'modern',
      includeCode: true,
    })

    if (result.success) {
      console.log('✅ Screen generation successful!')
      console.log(`   Screen ID: ${result.screenId || 'N/A'}`)
      console.log(`   Preview URL: ${result.previewUrl || 'N/A'}`)
      console.log(`   Code length: ${result.code?.length || 0} characters`)

      if (result.code) {
        console.log('\n📝 Generated code preview (first 500 chars):')
        console.log('─'.repeat(80))
        console.log(result.code.substring(0, 500))
        console.log('─'.repeat(80))
      }

      // Test 4: If we got a screen ID, try to fetch the code
      if (result.screenId) {
        console.log('\n📋 Step 4: Testing code retrieval...')
        const codeResult = await client.getScreenCode(result.screenId)

        if (codeResult.success) {
          console.log('✅ Code retrieval successful!')
          console.log(`   HTML length: ${codeResult.html?.length || 0} characters`)
          console.log(`   CSS length: ${codeResult.css?.length || 0} characters`)
          console.log(`   JS length: ${codeResult.javascript?.length || 0} characters`)
        } else {
          console.log(`⚠️  Code retrieval failed: ${codeResult.error}`)
        }
      }

      console.log('\n' + '='.repeat(80))
      console.log('🎉 TEST PASSED - Google Stitch Integration Working!')
      console.log('='.repeat(80))

    } else {
      console.log(`❌ Screen generation failed: ${result.error}`)
      console.log('\n📝 Troubleshooting tips:')
      console.log('   1. Verify the API key is correct')
      console.log('   2. Check if the API endpoint URL is correct')
      console.log('   3. Ensure you have access to Google Stitch API')
      console.log('   4. The API endpoint format might be different - check documentation')
      console.log('\n❌ TEST FAILED')
      process.exit(1)
    }

  } catch (error) {
    console.log(`❌ Error during testing: ${error instanceof Error ? error.message : 'Unknown error'}`)
    console.log('\n📝 Error details:')
    console.error(error)
    console.log('\n❌ TEST FAILED')
    process.exit(1)
  }

  // Disconnect
  await client.disconnect()
}

// Run the test
testGoogleStitchIntegration()
  .then(() => {
    console.log('\n✅ All tests completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Unexpected error:', error)
    process.exit(1)
  })
