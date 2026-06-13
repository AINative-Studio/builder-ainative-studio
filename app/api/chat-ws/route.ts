import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { nanoid } from 'nanoid'
import { verifyAndEnhancePrompt } from '@/lib/component-verifier'
import { PROFESSIONAL_SYSTEM_PROMPT } from '@/lib/professional-prompt'
import { enhancePromptWithMockData } from '@/lib/mock-data-generator'
import { updatePreviewPartial, storePreview, getChatData } from '@/lib/preview-store'
import { validateGeneratedCode } from '@/lib/code-validator'
import { stripGradients } from '@/lib/gradient-blocker'
import { fetchContextualImages, formatImagesForPrompt, getFallbackImages } from '@/lib/services/unsplash.service'
import { extractComponentCode } from '@/lib/agent/component-generation-tool'
import { addComponentToMemory, formatMemoryForPrompt } from '@/lib/services/memory.service'
import { runOrchestratorAgent } from '@/lib/agent/subagents'
import { parsePRDForBuildSteps } from '@/lib/prd-parser'
import { analyzeComplexity, getComplexityReport } from '@/lib/agent/complexity-analyzer'
import { createChunkPlan, getChunkPlanSummary } from '@/lib/agent/chunk-planner'
import { executeChunkPlan, getGenerationSummary } from '@/lib/agent/multi-pass-generator'
import { mergeChunks, getMergeSummary } from '@/lib/agent/chunk-merger'
import { generateAINativeFileSet } from '@/lib/ainative-file-generator'
import { selectTheme, formatThemeForPrompt, applyThemeToPrompt } from '@/lib/theme-system'
import { parseMultiFileOutput } from '@/lib/multi-file-parser'
import { storeFiles as storeFilesV2 } from '@/lib/preview-store-v2'
import { logModelConfiguration } from '@/lib/config/model-validator'

// Log model configuration on first module load
logModelConfiguration()

// Use Meta API ONLY when explicitly enabled via USE_META_API=true
// Default to AINative API which is more reliable
const isLocal = process.env.USE_META_API === 'true'

// Meta Llama API client (for local development / benchmarking)
const metaClient = new OpenAI({
  apiKey: process.env.META_API_KEY || '',
  baseURL: process.env.META_BASE_URL || 'https://api.llama.com/compat/v1',
})

// AINative API client
// Use AINATIVE_API_URL to override (e.g. for direct core access)
const ainativeBaseURL = (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/v1'
const ainativeClient = new OpenAI({
  apiKey: process.env.AINATIVE_API_KEY || process.env.API_Key || process.env.ZERODB_API_KEY || '',
  baseURL: ainativeBaseURL,
})

// Get the appropriate client based on environment
function getLLMClient(): OpenAI {
  return isLocal ? metaClient : ainativeClient
}

// Model strategy (benchmarked 2026-06-13):
// FREE: nous-coder (16s, 9K chars, best theme compliance)
// PAID: kimi-k2.6 (71s, 23K chars, best quality — via DigitalOcean)
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'nous-coder'
const PAID_MODEL = process.env.PAID_MODEL || 'kimi-k2.6'

// Fallback chains by tier
const FREE_FALLBACKS = ['nous-coder', 'gpt-oss-20b', 'ministral-14b', 'llama-4-maverick']
const PAID_FALLBACKS = ['kimi-k2.6', 'nous-coder', 'nemotron-70b', 'ministral-14b']

// Model routing config — all models route through AINative API
const MODEL_CONFIG: Record<string, { provider: 'meta' | 'ainative'; modelId: string; tier: 'free' | 'paid' }> = {
  // === PAID TIER — best quality, longer output ===
  'kimi-k2.6': { provider: 'ainative', modelId: 'kimi-k2.6', tier: 'paid' },
  'kimi-k2': { provider: 'ainative', modelId: 'kimi-k2', tier: 'paid' },
  'nemotron-70b': { provider: 'ainative', modelId: 'nemotron-70b', tier: 'paid' },
  // === FREE TIER — fast, reliable ===
  'nous-coder': { provider: 'ainative', modelId: 'nous-coder', tier: 'free' },
  'gpt-oss-20b': { provider: 'ainative', modelId: 'gpt-oss-20b', tier: 'free' },
  'ministral-14b': { provider: 'ainative', modelId: 'ministral-14b', tier: 'free' },
  'llama-4-maverick': { provider: isLocal ? 'meta' : 'ainative', modelId: 'llama-4-maverick', tier: 'free' },
  'nemotron-super-49b': { provider: 'ainative', modelId: 'nemotron-super-49b', tier: 'free' },
  'cohere-command': { provider: 'ainative', modelId: 'cohere-command', tier: 'free' },
  // === INTERMITTENT — may come back online ===
  'codestral-22b': { provider: 'ainative', modelId: 'codestral-22b', tier: 'free' },
  'devstral': { provider: 'ainative', modelId: 'devstral', tier: 'free' },
  'deepseek-v3': { provider: 'ainative', modelId: 'deepseek-v3', tier: 'free' },
  'qwen3-32b': { provider: 'ainative', modelId: 'qwen3-32b', tier: 'free' },
}

export async function POST(request: NextRequest) {
  try {
    const { message, chatId, model: requestedModel } = await request.json()

    if (!message) {
      return Response.json({ error: 'Message is required' }, { status: 400 })
    }

    // Get previous messages if this is a continuation
    let previousMessages: Array<{ role: 'user' | 'assistant', content: string }> = []
    if (chatId) {
      const chatData = getChatData(chatId)
      if (chatData && chatData.messages) {
        previousMessages = chatData.messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      }
    }

    const responseId = chatId || nanoid()

    // Create streaming response with REAL progress updates
    console.log('Starting LLAMA WebSocket-style streaming...')

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        // Helper to safely enqueue data (prevents "Controller is already closed" errors)
        const safeEnqueue = (data: Uint8Array) => {
          try {
            controller.enqueue(data)
          } catch (error) {
            // Silently ignore controller closed errors (client disconnected)
          }
        }

        // Send SSE keepalive every 15s to prevent Railway/HTTP2 from closing the stream
        // during long AI generation (can take 60-120s for complex apps)
        let keepaliveActive = true
        const keepaliveInterval = setInterval(() => {
          if (!keepaliveActive) return
          try { controller.enqueue(encoder.encode(': keepalive\n\n')) } catch (_) { /* closed */ }
        }, 15_000)

        try {
          let fullContent = ''
          let lastUpdateTime = Date.now()
          const generationStartTime = Date.now()
          let tokenUsage: any = undefined

          // Send initial metadata
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'init',
            chatId: responseId,
            demo: `/preview/${responseId}`
          })}\n\n`))

          // Parse user message to generate dynamic build steps
          const prdAnalysis = parsePRDForBuildSteps(message)
          console.log('📋 PRD Analysis:', {
            pages: prdAnalysis.pages,
            components: prdAnalysis.components,
            features: prdAnalysis.features,
            buildSteps: prdAnalysis.buildSteps
          })

          // Analyze complexity to determine if chunking is needed
          const complexityScore = analyzeComplexity(prdAnalysis, message)
          console.log('\n' + getComplexityReport(complexityScore))

          // Send dynamic build steps to client
          for (const step of prdAnalysis.buildSteps) {
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'build_step',
              step
            })}\n\n`))
            // Small delay to make steps visible (200ms between steps)
            await new Promise(resolve => setTimeout(resolve, 200))
          }

          const { enhancedPrompt: componentVerifiedPrompt } = verifyAndEnhancePrompt(message)

          // REAL STEP 2: Enhance with mock data (only for new chats)
          const shouldEnhance = previousMessages.length === 0
          let enhancedPrompt = componentVerifiedPrompt

          if (shouldEnhance) {
            enhancedPrompt = enhancePromptWithMockData(componentVerifiedPrompt)
          }

          // Skip Unsplash images — adds latency and open-source models ignore URLs
          // Use CSS gradients + blur glows instead (already in the theme prompt)
          const imagePrompt = ''

          // Build conversation messages
          const conversationMessages = [
            ...previousMessages,
            { role: 'user' as const, content: enhancedPrompt }
          ]

          // Select a color theme based on the prompt (variety instead of same purple every time)
          const selectedTheme = selectTheme(message)
          const themePrompt = formatThemeForPrompt(selectedTheme)
          console.log(`🎨 Theme selected: ${selectedTheme.name} (${selectedTheme.primary})`)

          // Build enhanced system prompt with theme + images + memory context
          // applyThemeToPrompt replaces THEME_PRIMARY/SECONDARY/ACCENT/DARK placeholders
          // so all code examples in the prompt use the actual selected theme colors
          const memoryContext = formatMemoryForPrompt(responseId)
          const themedPrompt = applyThemeToPrompt(PROFESSIONAL_SYSTEM_PROMPT, selectedTheme)
          const enhancedSystemPrompt = themedPrompt + themePrompt + imagePrompt + memoryContext

          // CHUNKING SYSTEM: Route to multi-pass generation if complexity requires it
          if (complexityScore.requiresChunking && previousMessages.length === 0) {
            console.log('\n🔄 COMPLEX APPLICATION DETECTED - Using multi-pass chunking strategy')
            console.log(`   Strategy: ${complexityScore.chunkingStrategy}`)
            console.log(`   Estimated tokens: ${complexityScore.estimatedTokens.toLocaleString()}`)

            // Create chunk plan
            const chunkPlan = createChunkPlan(message, prdAnalysis, complexityScore)
            console.log('\n' + getChunkPlanSummary(chunkPlan))

            // Execute chunk plan with progress streaming
            const chunks = await executeChunkPlan(
              chunkPlan,
              getLLMClient(),
              DEFAULT_MODEL,
              (phase, totalPhases, message, data) => {
                // Stream chunk progress to client
                safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'chunk_progress',
                  phase,
                  totalPhases,
                  message,
                  ...data
                })}\n\n`))

                console.log(`   [Phase ${phase}/${totalPhases}] ${message}`)
              }
            )

            // Log generation summary
            console.log('\n' + getGenerationSummary(chunks))

            // Merge all chunks into final application
            console.log('\n🔀 Merging chunks...')
            fullContent = mergeChunks(chunks)

            // Log merge summary
            console.log('\n' + getMergeSummary(chunks, fullContent))

            // Update preview with merged code
            updatePreviewPartial(responseId, fullContent)

            // Calculate total token usage from all chunks
            tokenUsage = {
              input_tokens: chunks.reduce((sum, c) => sum + c.tokenUsage.input, 0),
              output_tokens: chunks.reduce((sum, c) => sum + c.tokenUsage.output, 0),
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              total_tokens: chunks.reduce((sum, c) => sum + c.tokenUsage.total, 0),
              estimated_cost: 0 // Will be calculated below
            }

            tokenUsage.estimated_cost = (tokenUsage.input_tokens * 0.003 + tokenUsage.output_tokens * 0.015) / 1000

            console.log(`\n📊 TOTAL TOKEN USAGE (Multi-Pass):`)
            console.log(`   Input tokens: ${tokenUsage.input_tokens}`)
            console.log(`   Output tokens: ${tokenUsage.output_tokens}`)
            console.log(`   Total tokens: ${tokenUsage.total_tokens}`)
            console.log(`   Estimated cost: $${tokenUsage.estimated_cost.toFixed(4)}`)

          } else {
            // Use single-pass generation for simple applications or continuations
            console.log('\n✅ Simple application - Using single-pass generation')

            // Check if subagents mode is enabled
            const useSubagents = process.env.USE_SUBAGENTS === 'true'

          if (useSubagents) {
            // Use Subagents orchestrator for complex multi-step generation
            const orchestratorResult = await runOrchestratorAgent(
              enhancedPrompt,
              enhancedSystemPrompt,
              memoryContext
            )

            if (orchestratorResult.success) {
              fullContent = orchestratorResult.componentCode

              // Update preview store (but don't send code to chat client)
              updatePreviewPartial(responseId, fullContent)
            } else {
              throw new Error('Subagent orchestration failed')
            }
          } else {
            // Route to correct provider based on selected model
            const modelConfig = MODEL_CONFIG[requestedModel] || { provider: 'ainative', modelId: DEFAULT_MODEL }
            const provider = modelConfig.provider
            const modelId = modelConfig.modelId
            const client = provider === 'meta' ? metaClient : ainativeClient
            console.log(`🤖 Using model: ${modelId} (provider: ${provider}, env: ${isLocal ? 'local' : 'cloud'})`)

            // ============ ALL MODELS VIA OPENAI-COMPATIBLE API (Meta or AINative) ============
            // Compact system prompt focused on design quality + theme colors.
            // Open-source models (codestral, devstral, etc.) ignore long prompts.
            // Theme colors are injected directly into examples so the model copies them.
            const llmSystemPrompt = `You are a senior React developer. Generate a COMPLETE, SINGLE-FILE React functional component.

⚠️ CRITICAL: Use ONLY these hex colors — NEVER use bg-blue-*, bg-gray-*, bg-indigo-*, bg-purple-*:
PRIMARY: ${selectedTheme.primary} | DARK: ${selectedTheme.dark} | SECONDARY: ${selectedTheme.secondary} | LIGHT BG: ${selectedTheme.light} | ACCENT: ${selectedTheme.accent}
Buttons: bg-[${selectedTheme.primary}] | Hero: bg-gradient-to-br from-[${selectedTheme.dark}] to-[${selectedTheme.primary}]/20 | Page: bg-[${selectedTheme.light}]

RULES:
1. Output REACT code wrapped in \`\`\`jsx markers. No explanations.
2. import React and hooks at top. ONE default export function. ALL code in ONE file.
3. Use Tailwind CSS classes. Use useState/useEffect for interactivity.
⚠️ KEEP CODE UNDER 200 LINES. Do NOT generate overly long components. Be concise — use map() for repeated elements, keep JSX compact.
4. Use Lucide React icons (import from 'lucide-react'). NEVER use emoji as icons.
5. Available: recharts (ResponsiveContainer, LineChart, BarChart, PieChart, etc.), lucide-react icons.
6. ALL components below are available as globals — use them directly, NO import needed.
7. CRITICAL: Use the DATABASE API below for ALL data — NO hardcoded mock data arrays.

DATABASE API — ZeroDB (use fetch for all data operations):
The app has a built-in database at /api/db/{table}. Use it for CRUD:

// LOAD data on mount:
const [items, setItems] = useState([]);
const [loading, setLoading] = useState(true);
useEffect(() => {
  fetch('/api/db/myapp_items').then(r => r.json()).then(data => {
    setItems((data.data || []).map(r => ({ id: r.row_id, ...r.row_data })));
    setLoading(false);
  }).catch(() => setLoading(false));
}, []);

// CREATE:
const addItem = async (item) => {
  const res = await fetch('/api/db/myapp_items', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(item) });
  const data = await res.json();
  setItems(prev => [...prev, { id: data.row_id, ...item }]);
};

// DELETE:
const deleteItem = async (id) => {
  await fetch('/api/db/myapp_items?id=' + id, { method: 'DELETE' });
  setItems(prev => prev.filter(i => i.id !== id));
};

TABLE NAMING: Use the app name as prefix. E.g. for a todo app: "todo_items", for CRM: "crm_contacts".
LOADING STATE: Show <Skeleton /> or <SkeletonCard /> while loading is true.
EMPTY STATE: Show <EmptyState icon={<Inbox />} title="No items yet" /> when items array is empty.
SEED DATA: On first load, if items are empty, auto-insert 3-5 seed rows so the app isn't blank.

AIKIT COMPONENTS (use these instead of building from scratch):
- MetricCard: <MetricCard title="Revenue" value="USD 84K" change="+12.5%" changeType="positive" sparklineData={[10,20,15,30,25,40]} icon={<DollarSign />} />
- AIKitPriceCard: <AIKitPriceCard name="Pro" price="USD 29" period="/month" features={['Feature 1']} popular={true} cta="Start Trial" />
- AIKitRating: <AIKitRating value={4.7} max={5} showValue reviews={1200} />
- AIKitProductCard: <AIKitProductCard name="Product" price={99} originalPrice={129} badge="Sale" rating={4.5} reviews={500} onAddToCart={fn} />
- AIKitTable: <AIKitTable columns={[{key:'name', label:'Name'}]} data={rows} onSort={fn} />
- AIKitSidebar: <AIKitSidebar items={[{icon, label, id}]} activeItem="dashboard" onItemClick={fn} title="App" />
- AIKitHeader: <AIKitHeader title="App" navItems={[{label, href}]} onSearch={fn} />
- AIKitTimeline: <AIKitTimeline items={[{title, description, time, color}]} />
- AIKitAvatar: <AIKitAvatar name="John" status="online" size="md" />
- ChatBubble: <ChatBubble role="assistant" name="AI" timestamp="2m ago">Message</ChatBubble>
- AgentCard: <AgentCard name="DataBot" role="ETL Agent" status="active" tasks={24} model="claude-sonnet-4" />
- SafetyBadge: <SafetyBadge score={95} /> — AI safety trust score
- Skeleton/SkeletonCard: loading states
- EmptyState: <EmptyState icon={<Inbox />} title="No data" description="..." />

WHEN TO USE AIKIT (MANDATORY):
- Stats/KPIs → MetricCard (NOT plain text in cards)
- Pricing → AIKitPriceCard (NOT custom divs)
- Ratings → AIKitRating (NOT custom stars)
- Products → AIKitProductCard (NOT custom cards)
- Data tables → AIKitTable (NOT custom tables)
- Dashboards → AIKitSidebar + AIKitHeader + MetricCard
- AI/Agent UIs → AgentCard, ChatBubble, SafetyBadge
- Loading → Skeleton/SkeletonCard
- Empty → EmptyState

⚠️ MANDATORY COLOR THEME — ${selectedTheme.name.toUpperCase()} — NEVER USE bg-blue-*, bg-gray-*, bg-indigo-*:

Every element MUST use Tailwind arbitrary value syntax with these exact hex codes:

// PAGE WRAPPER — use this exact class:
<div className="min-h-screen bg-[${selectedTheme.light}]">

// NAVIGATION — sticky frosted glass:
<nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">

// HERO SECTION — dark gradient with glow:
<section className="relative min-h-[600px] bg-gradient-to-br from-[${selectedTheme.dark}] via-[${selectedTheme.dark}] to-[${selectedTheme.primary}]/20 overflow-hidden">
  <div className="absolute inset-0">
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[${selectedTheme.primary}]/15 rounded-full blur-[100px]" />
  </div>
  <h1 className="text-5xl font-extrabold text-white">Headline <span className="text-[${selectedTheme.primary}]">accent</span></h1>
  <button className="bg-[${selectedTheme.primary}] hover:bg-[${selectedTheme.primaryHover}] text-white px-8 py-3 rounded-lg font-semibold shadow-lg shadow-[${selectedTheme.primary}]/25 transition-all">CTA</button>
</section>

// CARDS — white on light bg:
<div className="bg-white border border-slate-200 shadow-sm rounded-xl p-6 hover:shadow-md transition-all">
  <div className="w-12 h-12 rounded-xl bg-[${selectedTheme.primary}]/10 flex items-center justify-center mb-4">
    <Icon className="w-6 h-6 text-[${selectedTheme.primary}]" />
  </div>
</div>

// DARK SECTION — use for CTA or features:
<section className="bg-[${selectedTheme.dark}] text-white py-20">
  <span className="bg-[${selectedTheme.primary}]/10 text-[${selectedTheme.primary}] border border-[${selectedTheme.primary}]/20 px-3 py-1 rounded-full text-sm">Badge</span>
</section>

// ALTERNATE SECTIONS: bg-[${selectedTheme.light}] → bg-white → bg-[${selectedTheme.dark}] → bg-white

LAYOUT VARIETY — make each app unique:
- Landing: hero + stats (MetricCard) + features grid + pricing (AIKitPriceCard) + testimonials + CTA
- Dashboard: AIKitSidebar + AIKitHeader + MetricCard grid + charts + AIKitTable
- E-commerce: header + product grid (AIKitProductCard) + filters + cart sidebar
- AI/Agent: AgentCard grid + ChatBubble conversation + SafetyBadge + AIKitTimeline

AX (AGENT EXPERIENCE) — MANDATORY on every page:
1. Wrap page in <main aria-label="App Name - description">
2. Add aria-label to every <nav>, <section>, <header>, <footer>
3. EXACTLY ONE <h1> per page. Sections use <h2>, subsections <h3>.
4. Add data-agent-role="navigation|content|form|metric" to key elements
5. Add data-agent-action="click|navigate|search|filter" to interactive elements
6. Add data-agent-context="descriptive-id" to every interactive element
7. Add hidden JSON-LD: <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "WebApplication", name: "App Name", description: "..." }) }} />
8. Add skip nav link as first element: <a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to main content</a>

STRUCTURE:
\`\`\`jsx
import React, { useState, useEffect } from 'react'
import { Icon1, Icon2, Plus, Trash2 } from 'lucide-react'

// Seed data — auto-inserted on first load if DB is empty
const SEED_DATA = [
  { name: "Item 1", status: "active", value: 100 },
  { name: "Item 2", status: "pending", value: 200 },
  { name: "Item 3", status: "completed", value: 150 },
];

export default function AppName() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Load from database on mount
  useEffect(() => {
    fetch('/api/db/appname_items')
      .then(r => r.json())
      .then(data => {
        const rows = (data.data || []).map(r => ({ id: r.row_id, ...r.row_data }));
        if (rows.length === 0) {
          // Seed the database on first use
          Promise.all(SEED_DATA.map(item =>
            fetch('/api/db/appname_items', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(item) })
              .then(r => r.json()).then(d => ({ id: d.row_id, ...item }))
          )).then(seeded => { setItems(seeded); setLoading(false); });
        } else {
          setItems(rows);
          setLoading(false);
        }
      })
      .catch(() => { setItems(SEED_DATA.map((d,i) => ({id:i,...d}))); setLoading(false); });
  }, []);

  return (
    <main aria-label="App Name" className="min-h-screen bg-[${selectedTheme.light}]">
      {loading ? <SkeletonCard lines={3} showAvatar /> : items.length === 0 ? <EmptyState icon={<Inbox />} title="No items" /> : (
        <div>{/* Render items with AIKit components */}</div>
      )}
    </main>
  )
}
\`\`\``

            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'build_step', step: 'Generating with ' + modelId + '...' })}\n\n`))

            // Use non-streaming for AINative (streaming returns empty), streaming for Meta
            if (provider === 'meta') {
              try {
                const stream = await client.chat.completions.create({
                  model: modelId,
                  messages: [
                    { role: 'system', content: llmSystemPrompt },
                    ...conversationMessages,
                  ],
                  max_tokens: 16000,
                  temperature: 0.7,
                  stream: true,
                })

                for await (const chunk of stream) {
                  const content = chunk.choices?.[0]?.delta?.content || ''
                  if (content) {
                    fullContent += content
                    updatePreviewPartial(responseId, fullContent)
                    const now = Date.now()
                    if (now - lastUpdateTime > 500) {
                      safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))
                      lastUpdateTime = now
                    }
                  }
                }
              } catch (streamError: any) {
                // Meta streaming failed — fall back to AINative non-streaming
                console.log(`⚠️ Meta streaming failed (${streamError?.message}), falling back to AINative`)
                const fallbackResponse = await ainativeClient.chat.completions.create({
                  model: modelId,
                  max_tokens: 16000,
                  temperature: 0.7,
                  messages: [
                    { role: 'system', content: llmSystemPrompt },
                    ...conversationMessages,
                  ],
                })
                fullContent = fallbackResponse.choices?.[0]?.message?.content || ''
              }
            } else {
              // AINative: single-turn generation (system+user only)
              // Multi-turn conversations get capped at 512 tokens by the API
              // Single-turn with system message gets full output (~1500-2500 tokens)
              console.log(`📡 Calling AINative API (single-turn): ${modelId}`)

              // Single-turn call with fallback chain
              // CRITICAL: Only system+user messages (2 messages). Multi-turn (>2) triggers 512-token cap.
              // Use tier-appropriate fallback chain
              const modelTier = MODEL_CONFIG[requestedModel]?.tier || 'free'
              const MODELS_TO_TRY = modelTier === 'paid'
                ? [modelId, ...PAID_FALLBACKS.filter(m => m !== modelId)]
                : [modelId, ...FREE_FALLBACKS.filter(m => m !== modelId)]
              const singleTurnMessages = [
                { role: 'system' as const, content: llmSystemPrompt },
                // Merge conversation history into a single user message to keep it 2-message single-turn
                { role: 'user' as const, content: previousMessages.length > 0
                  ? `Previous context:\n${previousMessages.map(m => `${m.role}: ${m.content}`).join('\n')}\n\nNew request: ${enhancedPrompt}`
                  : enhancedPrompt
                },
              ]

              for (const tryModel of MODELS_TO_TRY) {
                try {
                  const ctrl = new AbortController()
                  const timer = setTimeout(() => ctrl.abort(), 60_000)
                  const response = await client.chat.completions.create(
                    { model: tryModel, max_tokens: 4096, temperature: 0.7, messages: singleTurnMessages },
                    { signal: ctrl.signal }
                  )
                  clearTimeout(timer)

                  fullContent = response.choices?.[0]?.message?.content || ''
                  const tokens = response.usage?.completion_tokens || 0
                  const finish = response.choices?.[0]?.finish_reason
                  console.log(`📊 ${tryModel}: ${fullContent.length} chars (${tokens} tok) finish=${finish}`)

                  // Handle truncation: if finish_reason=length, close the component
                  if (finish === 'length' && fullContent.length > 500) {
                    console.log('⚠️ Output truncated — applying closure fix')
                    // Find the last complete JSX line and close from there
                    const lines = fullContent.split('\n')
                    let cutPoint = lines.length
                    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
                      const line = lines[i].trim()
                      if (line.endsWith('>') || line.endsWith('/>') || line.endsWith('}') || line.endsWith(');')) {
                        cutPoint = i + 1
                        break
                      }
                    }
                    fullContent = lines.slice(0, cutPoint).join('\n')
                    // Count unclosed braces/parens and close them
                    const ob = (fullContent.match(/\{/g) || []).length
                    const cb = (fullContent.match(/\}/g) || []).length
                    const op = (fullContent.match(/\(/g) || []).length
                    const cp = (fullContent.match(/\)/g) || []).length
                    let closure = '\n'
                    for (let i = 0; i < op - cp; i++) closure += ')'
                    if (op > cp) closure += ';\n'
                    for (let i = 0; i < ob - cb; i++) closure += '}\n'
                    // Ensure there's a default export
                    if (!fullContent.includes('export default')) {
                      const funcMatch = fullContent.match(/(?:function|const)\s+([A-Z]\w+)/)
                      if (funcMatch) closure += `\nexport default ${funcMatch[1]};\n`
                    }
                    fullContent += closure
                    console.log(`📊 Truncation fixed: added ${ob-cb} braces, ${op-cp} parens`)
                  }

                  updatePreviewPartial(responseId, fullContent)
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))

                  if (fullContent.length > 500) break // Good enough output
                  console.log(`⚠️ Output too short (${fullContent.length} chars), trying next model...`)
                } catch (err: any) {
                  const isTimeout = err?.name === 'AbortError' || err?.message?.includes('aborted')
                  console.log(`⚠️ ${tryModel} failed: ${isTimeout ? 'timeout' : err?.status || err?.message?.substring(0, 80)}`)
                  if (MODELS_TO_TRY.indexOf(tryModel) === MODELS_TO_TRY.length - 1) {
                    console.log('❌ All models failed')
                  }
                }
              }

              console.log(`📊 Final response: ${fullContent.length} chars`)
            }

            updatePreviewPartial(responseId, fullContent)
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))

            tokenUsage = {
              input_tokens: 0, output_tokens: 0,
              cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
              total_tokens: 0,
              estimated_cost: 0
            }

            console.log(`📊 ${modelId} generation complete: ${fullContent.length} chars`)

          } // End of provider routing + subagents else
          } // End of chunking else (single-pass)

          // NOTE: Gradient stripping removed — gradients add visual richness
          // (hero sections, backgrounds, accent elements) matching Bolt/Lovable quality

          // Validate generated code before storing
          let validation = validateGeneratedCode(fullContent)
          // CRITICAL: Use the VALIDATED/FIXED code, not the original raw content
          // validation.code has markdown extracted and auto-fixes applied
          let finalContent = validation.code
          let retryAttempted = false

          // AUTO-RETRY: If validation fails, automatically retry once with error feedback
          if (!validation.valid) {
            console.error('⚠️ Initial validation failed:', validation.error)
            console.log('🔄 Auto-retrying with error feedback...')

            try {
              // Build retry prompt with specific error details
              const retryPrompt = `The previous code generation had a syntax error that needs to be fixed:

ERROR: ${validation.error}

INVALID CODE:
${validation.code}

Please regenerate the component with these requirements:
1. Fix the syntax error: ${validation.error}
2. Avoid using invalid JavaScript identifiers (like 1px, 2em as variable names)
3. Ensure all JSX is valid and properly closed
4. Make sure the component function is properly defined and exported
5. Use only valid JavaScript/JSX syntax
6. Return ONLY the code wrapped in \`\`\`jsx and \`\`\` markers.

Generate a corrected version of: ${message}`

              // Try retry with fallback chain
              const retryModels = [DEFAULT_MODEL, 'gpt-oss-20b', 'ministral-14b']
              let retryContent = ''
              const retryMessages = [
                { role: 'system' as const, content: 'Fix the syntax errors in the code below. Return ONLY valid, complete React code wrapped in ```jsx markers. Ensure all JSX tags are properly closed, all strings are terminated, and all brackets match.' },
                ...previousMessages,
                { role: 'user' as const, content: enhancedPrompt },
                { role: 'assistant' as const, content: fullContent },
                { role: 'user' as const, content: retryPrompt }
              ]
              for (const retryModel of retryModels) {
                try {
                  const retryResponse = await ainativeClient.chat.completions.create({
                    model: retryModel,
                    max_tokens: 4096,
                    temperature: 0.7,
                    messages: retryMessages,
                  })
                  retryContent = retryResponse.choices?.[0]?.message?.content || ''
                  if (retryContent.length > 500) {
                    console.log(`✅ Retry succeeded with ${retryModel}: ${retryContent.length} chars`)
                    break
                  }
                } catch (retryErr: any) {
                  console.log(`⚠️ Retry with ${retryModel} failed: ${retryErr?.status || retryErr?.message?.substring(0, 50)}`)
                }
              }

              // Validate retry result
              const retryValidation = validateGeneratedCode(retryContent)

              if (retryValidation.valid) {
                console.log('✅ Auto-retry succeeded! Validation passed.')
                finalContent = retryContent
                validation = retryValidation
                retryAttempted = true

                // Update preview with fixed content
                updatePreviewPartial(responseId, finalContent)
              } else {
                console.error('❌ Auto-retry failed validation:', retryValidation.error)
              }
            } catch (retryError) {
              console.error('Auto-retry API call failed:', retryError)
            }
          }

          // Final validation check
          if (!validation.valid) {
            // Log validation error
            console.error('❌ Final validation failed (after retry):', validation.error)

            // Send validation error to client
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'validation_error',
              error: validation.error,
              message: retryAttempted
                ? 'The code generation failed validation even after auto-retry. Please try rephrasing your request.'
                : 'The generated code has syntax errors. Please try regenerating.'
            })}\n\n`))

            // Store the invalid code with error marker
            storePreview(responseId, finalContent, message, { validationError: validation.error, usage: tokenUsage })

            // Send completion with error flag
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'complete',
              chatId: responseId,
              demo: `/preview/${responseId}`,
              hasValidationError: true
            })}\n\n`))
          } else {
            // Format assistant response for better conversation continuity
            // Store ONLY the code in a clean markdown wrapper (prevents PRD injection)
            // The user message is stored separately, we don't need to include it in the preview content
            const cleanCodeResponse = `\`\`\`jsx\n${finalContent}\n\`\`\``

            // Generate AINative file set (robots.txt, sitemap.xml, llms.txt, etc.)
            const ainativeFiles = generateAINativeFileSet(message, finalContent)
            console.log(`📁 Generated ${Object.keys(ainativeFiles).length} AINative files`)

            // Store clean code response + AINative files (legacy preview)
            storePreview(responseId, cleanCodeResponse, message, { usage: tokenUsage, ainativeFiles })

            // Parse into multi-file output for Sandpack
            const parsedFiles = parseMultiFileOutput(finalContent, message)
            console.log(`📦 Parsed ${Object.keys(parsedFiles).length} files for Sandpack:`, Object.keys(parsedFiles))

            // Store in V2 store
            storeFilesV2(responseId, parsedFiles, { usage: tokenUsage })

            // Send files to client for Sandpack preview
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'files',
              files: parsedFiles
            })}\n\n`))

            // Save to conversation memory for context
            addComponentToMemory(responseId, message, finalContent)

            // Send a clean conversational message to the chat (without code)
            // Make it context-aware based on what the user actually requested
            let itemType = 'component'
            let itemName = ''

            // Determine what was actually requested from PRD analysis
            if (prdAnalysis.pages.length > 0) {
              // Pages have {name, route} structure, extract just the names
              const pageNames = prdAnalysis.pages.map(p => p.name.replace(' Page', '').replace(' Interface', ''))
              itemType = prdAnalysis.pages.length > 1 ? 'pages' : 'page'
              itemName = pageNames.join(' and ')
            } else if (prdAnalysis.features.length > 0) {
              itemType = prdAnalysis.features.length > 1 ? 'features' : 'feature'
              itemName = prdAnalysis.features.join(' and ')
            } else if (prdAnalysis.components.length > 0) {
              itemType = prdAnalysis.components.length > 1 ? 'components' : 'component'
              itemName = prdAnalysis.components.map(c => c.replace(' Component', '')).join(' and ')
            }

            const conversationalMessage = previousMessages.length === 0
              ? (itemName
                  ? `I've created your ${itemName} and it's ready in the preview! Take a look at what I built for you.`
                  : `I've created your ${itemType} and it's ready in the preview! Take a look at what I built for you.`)
              : (itemName
                  ? `I've updated the ${itemName} based on your request. Check out the changes in the preview!`
                  : `I've updated the ${itemType} based on your request. Check out the changes in the preview!`)

            // Send the conversational message to display in chat
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'chunk',
              content: conversationalMessage
            })}\n\n`))

            // Send completion event
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'complete',
              chatId: responseId,
              demo: `/preview/${responseId}`
            })}\n\n`))

            // Persist + RLHF logging + SSR build (fire-and-forget, non-blocking)
            try {
              const { saveGeneration, logGenerationEvent } = await import('@/lib/zerodb-store')
              const { addToShowcase } = await import('@/lib/showcase-store')
              const { storeSSRPreview } = await import('@/lib/preview-store')
              const isShowcase = finalContent.length > 1000

              // Save code to ZeroDB
              saveGeneration({
                chatId: responseId,
                prompt: message,
                generatedCode: finalContent,
                model: requestedModel || DEFAULT_MODEL,
                codeLength: finalContent.length,
                isShowcase,
              }).catch(e => console.warn('[ZeroDB save failed]', e))

              // RLHF: Log generation event for tracking + learning
              logGenerationEvent({
                chatId: responseId,
                prompt: message,
                model: requestedModel || DEFAULT_MODEL,
                theme: selectedTheme.name,
                codeLength: finalContent.length,
                passedValidation: validation.valid,
                generationTimeMs: Date.now() - generationStartTime,
                retryCount: retryAttempted ? 1 : 0,
                finishReason: 'stop',
              }).catch(e => console.warn('[RLHF log failed]', e))

              // Showcase auto-populate disabled — creates junk entries
              // addToShowcase(message, responseId, finalContent.length, finalContent)

              // SSR build in background — when done, the next iframe refresh shows instant content
              import('@/lib/sandbox-builder').then(({ buildInSandbox }) => {
                buildInSandbox(finalContent).then(ssrResult => {
                  if (ssrResult.success) {
                    storeSSRPreview(responseId, ssrResult.html)
                    console.log(`🏗️ SSR ready for ${responseId}: ${ssrResult.html.length}b in ${ssrResult.buildTimeMs}ms`)
                  }
                }).catch(() => {})
              }).catch(() => {})
            } catch (_) {}
          }

          keepaliveActive = false
          clearInterval(keepaliveInterval)
          try { controller.close() } catch (_) { /* already closed */ }
        } catch (error) {
          console.error('Streaming error:', error)
          keepaliveActive = false
          clearInterval(keepaliveInterval)
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: 'Stream failed'
          })}\n\n`))
          try { controller.close() } catch (_) { /* already closed */ }
        }
      }
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      }
    })

  } catch (error) {
    console.error('Chat WebSocket API Error:', error)
    return Response.json({ error: 'Failed to process request' }, { status: 500 })
  }
}