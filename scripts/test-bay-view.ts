#!/usr/bin/env tsx

/**
 * Test Bay View Digital Newspaper PRD
 * Complex real-world application with multiple pages and features
 */

const BAY_VIEW_PRD = `Build a FRONTEND-ONLY clickable prototype for:

San Francisco Bay View — Future Digital Newspaper

This is NOT a technology showcase.
Do NOT create pages describing infrastructure or AI systems.
Do NOT explain the tech stack in the UI.

The prototype must showcase the end-user experience of a modern digital newspaper where:

- Articles can be read OR listened to
- Podcasts are generated from articles
- Readers can search 50 years of archives
- Readers can talk to the archive through a clean chat + voice interface
- Sponsors and advertisers are integrated in helpful, non-intrusive ways

The technology must feel invisible.
The experience must feel real.

-----------------------------------
STACK (required)
-----------------------------------

- Next.js 14 (App Router) + TypeScript
- TailwindCSS
- Framer Motion (subtle transitions only)
- Minimal Three.js (only for subtle polish if needed)
- Web Audio API for subtle waveform animation
- Recharts for optional internal insights page

No backend.
No real API calls.
No real Stripe.
No real Hume.
Use mock data only in /lib/mockData.ts.

-----------------------------------
DESIGN SYSTEM
-----------------------------------

Use these colors with restraint (white space dominates):

--color-primary: #3D7317;
--color-secondary: #3B591D;
--color-neutral-dark: #26241F;
--color-warm-light: #BF8F65;
--color-warm-medium: #8C5637;

Typography:
- Headlines: Playfair Display
- Body: Inter
- Chat/Transcript: IBM Plex Mono

Tone:
Modern, editorial, institutional, confident.

No hype.
No flashy animations.
No gimmicks.

-----------------------------------
CORE USER EXPERIENCE
-----------------------------------

1) Homepage — Modern News Feed
2) Article Page — Read + Listen
3) Podcast Hub
4) Archive Search
5) Ask Bay View (Chat + Voice Modal)
6) Subscription Page
7) Optional Insights Page (secondary)

Everything must be connected and clickable.

-----------------------------------
HOMEPAGE
-----------------------------------

- Feature story with "Read" and "Listen" buttons
- News grid layout
- Trending topics
- Latest audio episodes

Every article card must include a small "Listen" option.

No mention of AI in homepage copy.

-----------------------------------
ARTICLE PAGE
-----------------------------------

- Strong editorial layout
- "Listen to this article" at top
- Clean audio player with subtle waveform
- Related coverage panel
- "Ask Bay View about this topic" button

-----------------------------------
PODCAST PAGE
-----------------------------------

- "Bay View Audio"
- Episodes generated from articles (mock mapping)
- Clean playback UI
- Subtle sponsor labeling

-----------------------------------
ARCHIVE PAGE
-----------------------------------

- Large search bar
- Relevance-based results (mock)
- Timeline filter
- Topic tags

-----------------------------------
ASK BAY VIEW CHAT MODAL
-----------------------------------

Floating button bottom right.

Supports:
- Text input
- Voice input (simulated)

Voice mode:
- Subtle listening animation
- Transcript appears
- Calm text response
- Optional audio playback
- Include cited article links

Must feel like speaking to an archive librarian.

-----------------------------------
SUBSCRIPTION FLOW
-----------------------------------

3 tiers:
- Digital
- Supporter
- Research

Trigger paywall modal from at least one premium action.

Simulate checkout confirmation.

-----------------------------------
AI NATIVE AD UNITS (IMPORTANT)
-----------------------------------

Throughout the site, intelligently integrate sponsor and advertiser placements that are:

- Non-intrusive
- Contextually relevant
- Visually consistent
- Helpful to users
- Clearly labeled as Sponsored

DO NOT use traditional banner ads.

Instead implement:

1) Inline sponsored story blocks within feed
2) "Related Sponsor" module within article page
3) Sponsored podcast segment labels
4) Context-aware sponsor recommendations in archive results
5) Helpful service recommendations tied to article topics

For each placement:
- Make it native to the layout
- Ensure it enhances the reading/listening experience
- Avoid popups or disruptive overlays
- Avoid autoplay ads
- Avoid flashing visuals

Ads should feel like:
Helpful recommendations connected to the content.

-----------------------------------
MOTION RULES
-----------------------------------

- 200–350ms transitions
- Subtle fades and gentle scale
- No dramatic motion
- No parallax theatrics

-----------------------------------
DELIVERABLE
-----------------------------------

Generate full Next.js project structure with working routes, mock data rendering, audio playback simulation, chat modal logic (mock), and integrated native ad units as described.

The final prototype must feel like:
A real, modern digital newspaper — not a vendor presentation.`

async function testBayViewGeneration(): Promise<void> {
  console.log('🧪 Testing Bay View Digital Newspaper Generation...\n')
  console.log('📝 PRD Length:', BAY_VIEW_PRD.length, 'characters\n')

  try {
    const startTime = Date.now()

    const response = await fetch('http://localhost:3000/api/chat-ws', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: BAY_VIEW_PRD,
        chatId: `bay-view-${Date.now()}`,
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

    if (fullContent.length === 0) {
      console.log('\n⚠️  No conversational content (this is normal - code sent separately)')
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
          console.log(`🎉 FINAL PREVIEW URL`)
          console.log(`${'='.repeat(80)}`)
          console.log(`\n🌐 http://localhost:3000/preview/${previewId}\n`)
          console.log(`${'='.repeat(80)}`)
        }
      } else {
        throw new Error(`Preview fetch failed: ${previewResponse.status}`)
      }
    }

    console.log('\n✅ TEST PASSED - Bay View generation completed successfully!')
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error)
    process.exit(1)
  }
}

testBayViewGeneration()
