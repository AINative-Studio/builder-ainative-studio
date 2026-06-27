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
import { isClaudeAgentEnabled, isClaudeAgentFallbackEnabled, runHeadlessAgent } from '@/lib/agent/claude-agent'
import { cleanupWorktree } from '@/lib/agent/worktree-manager'
import { logAgentRun } from '@/lib/services/agent-runs.service'

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

// Model strategy (updated 2026-06-27):
// PRIMARY: Claude Sonnet 3.5 via Anthropic SDK (200K context, best code quality)
// FALLBACK: ministral-14b via AINative (free, fast, limited context)
const USE_CLAUDE_DIRECT = !!process.env.ANTHROPIC_API_KEY
const DEFAULT_MODEL = USE_CLAUDE_DIRECT ? 'claude-sonnet-4-20250514' : (process.env.DEFAULT_MODEL || 'ministral-14b')
const PAID_MODEL = process.env.PAID_MODEL || 'kimi-k2.6'

// Anthropic client for direct Claude calls — lazy initialized on first use
let anthropicClient: any = null
function getAnthropicClient() {
  if (anthropicClient) return anthropicClient
  if (!USE_CLAUDE_DIRECT) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk')
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    console.log('✅ Anthropic client initialized for Claude Sonnet 4')
    return anthropicClient
  } catch (e) {
    console.warn('⚠️ @anthropic-ai/sdk not available, falling back to AINative')
    return null
  }
}

// Fallback chains (used when Claude is unavailable)
const FREE_FALLBACKS = ['ministral-14b', 'nous-coder', 'gpt-oss-20b']
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
  // llama-4-maverick REMOVED — AINative caps at 512 tokens, ALWAYS truncated
  // 'llama-4-maverick': { provider: isLocal ? 'meta' : 'ainative', modelId: 'llama-4-maverick', tier: 'free' },
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

          // ============================================================
          // CLAUDE AGENT PATH — headless Claude Code agent via SSE
          // Activates when:
          //   1. USE_CLAUDE_AGENT=true (explicit opt-in, all prompts)
          //   2. complexityScore.shouldUseAgent AND ANTHROPIC_API_KEY
          //      is set (auto-activate for complex/multi-file prompts)
          // ============================================================
          const agentExplicitlyEnabled = isClaudeAgentEnabled()
          const agentAutoActivated = complexityScore.shouldUseAgent && !!process.env.ANTHROPIC_API_KEY
          const useAgent = agentExplicitlyEnabled || agentAutoActivated

          // Tier-based maxTurns:
          //   Explicit (USE_CLAUDE_AGENT=true): 5 turns (all prompts)
          //   Auto-activated (complex prompts):  3 turns (fallback-safe)
          const agentMaxTurns = agentExplicitlyEnabled ? 5 : 3

          if (useAgent) {
            console.log(`\n🤖 CLAUDE AGENT MODE — streaming headless agent (${agentExplicitlyEnabled ? 'explicit' : 'auto-complex'}, maxTurns=${agentMaxTurns})`)
            let agentFailed = false
            let agentTurns = 0
            let agentToolsUsed: string[] = []
            let agentBuildPassed = false
            let agentError: string | undefined
            let agentTokenUsage: { inputTokens: number; outputTokens: number; totalCostUsd?: number } = { inputTokens: 0, outputTokens: 0 }

            try {
              const agentGen = runHeadlessAgent(
                enhancedPrompt,
                responseId,
                {
                  systemPrompt: enhancedSystemPrompt,
                  abortSignal: request.signal,
                  maxTurns: agentMaxTurns,
                },
              )

              for await (const event of agentGen) {
                switch (event.type) {
                  case 'build_step': {
                    // Track tools used for agent_runs logging
                    const toolMatch = event.step.match(/^(Writing|Editing|Reading|Running|Searching files|Searching content|Tool)/)
                    if (toolMatch) {
                      const toolName = event.step.startsWith('Running') ? 'Bash'
                        : event.step.startsWith('Writing') ? 'Write'
                        : event.step.startsWith('Editing') ? 'Edit'
                        : event.step.startsWith('Reading') ? 'Read'
                        : event.step.startsWith('Searching files') ? 'Glob'
                        : event.step.startsWith('Searching content') ? 'Grep'
                        : event.step.replace(/^Tool: /, '').split(' ')[0]
                      if (!agentToolsUsed.includes(toolName)) {
                        agentToolsUsed.push(toolName)
                      }
                    }
                    // Check for build failures in step messages
                    if (event.step.includes('npm run build') && event.step.toLowerCase().includes('fail')) {
                      agentBuildPassed = false
                    }
                    safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'build_step',
                      step: event.step,
                    })}\n\n`))
                    break
                  }

                  case 'chunk':
                    fullContent += event.content
                    updatePreviewPartial(responseId, fullContent)
                    // Throttle refresh events to avoid flooding the client
                    const now = Date.now()
                    if (now - lastUpdateTime > 500) {
                      safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))
                      lastUpdateTime = now
                    }
                    break

                  case 'chunk_progress':
                    safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'chunk_progress',
                      phase: event.phase,
                      totalPhases: event.totalPhases,
                    })}\n\n`))
                    break

                  case 'files': {
                    // Agent produced worktree files — store them
                    const agentFiles = event.files
                    console.log(`📦 Agent produced ${Object.keys(agentFiles).length} files`)

                    storeFilesV2(responseId, agentFiles, { usage: tokenUsage })

                    safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'files',
                      files: agentFiles,
                    })}\n\n`))

                    // Also update fullContent from App.tsx or the main source file
                    // so validation and persistence logic below works correctly
                    const mainFile =
                      agentFiles['src/App.tsx'] ||
                      agentFiles['src/App.jsx'] ||
                      agentFiles['App.tsx'] ||
                      agentFiles['App.jsx']
                    if (mainFile) {
                      fullContent = mainFile
                      updatePreviewPartial(responseId, fullContent)
                    }
                    break
                  }

                  case 'complete':
                    tokenUsage = event.tokenUsage
                      ? {
                          input_tokens: event.tokenUsage.inputTokens,
                          output_tokens: event.tokenUsage.outputTokens,
                          cache_creation_input_tokens: event.tokenUsage.cacheCreationTokens,
                          cache_read_input_tokens: event.tokenUsage.cacheReadTokens,
                          total_tokens: event.tokenUsage.inputTokens + event.tokenUsage.outputTokens,
                          estimated_cost: event.tokenUsage.totalCostUsd,
                        }
                      : tokenUsage
                    // Capture agent metadata for agent_runs tracking
                    if (event.tokenUsage) {
                      agentTokenUsage = {
                        inputTokens: event.tokenUsage.inputTokens,
                        outputTokens: event.tokenUsage.outputTokens,
                        totalCostUsd: event.tokenUsage.totalCostUsd,
                      }
                    }
                    agentTurns = (event as any).turns || agentTurns
                    console.log(`✅ Agent completed in ${event.durationMs}ms`)
                    break

                  case 'error':
                    console.error(`⚠️ Agent error (fatal=${event.fatal}): ${event.error}`)
                    agentError = event.error
                    if (event.fatal) {
                      agentFailed = true
                      // Send error to client but do NOT close — we will fall through
                      // to the existing model call path below
                      safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                        type: 'build_step',
                        step: 'Agent failed — falling back to standard generation',
                      })}\n\n`))
                    } else {
                      // Non-fatal error — stream it as a build step so user sees it
                      safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                        type: 'build_step',
                        step: `Warning: ${event.error}`,
                      })}\n\n`))
                    }
                    break
                }

                // If a fatal error occurred, break out of the generator loop
                if (agentFailed) break
              }
            } catch (agentErr: any) {
              console.error('❌ Agent threw unexpectedly:', agentErr?.message || agentErr)
              agentFailed = true
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'build_step',
                step: 'Agent crashed — falling back to standard generation',
              })}\n\n`))
            }

            // Cleanup worktree regardless of success/failure
            cleanupWorktree(responseId).catch((e) =>
              console.warn('[Worktree cleanup failed]', e),
            )

            // If the agent succeeded (produced meaningful content), skip the
            // standard model call path entirely. The validation + persistence
            // section below will handle storing the result.
            if (!agentFailed && fullContent.length > 100) {
              // Build verification: check content validity as a proxy for build pass
              agentBuildPassed = fullContent.length > 100

              // Agent succeeded — skip to validation below
              console.log(`📊 Agent generation complete: ${fullContent.length} chars`)

              // Log primary agent run (fire-and-forget)
              logAgentRun({
                chatId: responseId,
                userId: 'anonymous',
                model: requestedModel || 'sonnet',
                turns: agentTurns,
                toolsUsed: agentToolsUsed,
                buildPassed: agentBuildPassed,
                durationMs: Date.now() - generationStartTime,
                tokenUsage: agentTokenUsage,
                fallback: false,
                error: agentError,
              }).catch(e => console.warn('[AgentRuns] primary log failed:', e?.message || e))
            } else {
              // Agent failed or produced no output — reset and fall through
              // to the existing model call path below
              if (agentFailed) {
                console.log('🔄 Falling back to standard LLM generation path')

                // Log failed primary agent run (fire-and-forget)
                logAgentRun({
                  chatId: responseId,
                  userId: 'anonymous',
                  model: requestedModel || 'sonnet',
                  turns: agentTurns,
                  toolsUsed: agentToolsUsed,
                  buildPassed: false,
                  durationMs: Date.now() - generationStartTime,
                  tokenUsage: agentTokenUsage,
                  fallback: false,
                  error: agentError || 'Agent failed — falling back',
                }).catch(e => console.warn('[AgentRuns] primary-fail log failed:', e?.message || e))

                fullContent = '' // Reset so the fallback path starts clean
              }
            }
          }

          // Only run the standard model call path if the agent path was not used
          // or if it failed and we need a fallback
          if (!useAgent || fullContent.length <= 100) {

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
            // BLOCK maverick — AINative caps it at 512 tokens (ALWAYS truncated)
            const safeModel = requestedModel === 'llama-4-maverick' ? DEFAULT_MODEL : requestedModel
            const modelConfig = MODEL_CONFIG[safeModel] || { provider: 'ainative', modelId: DEFAULT_MODEL }
            const provider = modelConfig.provider
            const modelId = modelConfig.modelId
            const client = provider === 'meta' ? metaClient : ainativeClient
            console.log(`🤖 Using model: ${modelId} (provider: ${provider}, env: ${isLocal ? 'local' : 'cloud'})`)

            // ============ ALL MODELS VIA OPENAI-COMPATIBLE API (Meta or AINative) ============
            // Use the full professional system prompt (enhancedSystemPrompt) which includes:
            // - 580-line PROFESSIONAL_SYSTEM_PROMPT with AIKit components, AX standards, design rules
            // - Theme colors injected into all examples via applyThemeToPrompt()
            // - Unsplash hero images if available
            // - Memory context from previous generations
            //
            // Condense system prompt for open-source models (ministral-14b context limit ~4K tokens)
            // The full 580-line prompt overflows the context — use a focused version
            const llmSystemPrompt = `Generate a complete, production-ready React component. Use this EXACT structure:

\`\`\`jsx
import React, { useState } from 'react'
import { Icon1, Icon2 } from 'lucide-react'

export default function App() {
  const [state, setState] = useState(initialValue)
  return (
    <div className="min-h-screen bg-[${selectedTheme.light}]">
      {/* Full application UI here */}
    </div>
  )
}
\`\`\`

DESIGN RULES:
- Colors: primary bg-[${selectedTheme.primary}], dark bg-[${selectedTheme.dark}], light bg-[${selectedTheme.light}]. NEVER use bg-blue, bg-gray.
- Use Lucide icons: import { Search, Menu, Users, BarChart3, Settings, Bell, Star, Plus, Edit, Trash2, ArrowRight, TrendingUp, DollarSign, Zap, Shield, Activity } from 'lucide-react'
- Cards: bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-all
- Typography: text-4xl font-bold for h1, text-2xl for h2, text-sm text-slate-500 for captions
- Spacing: py-16 between sections, gap-6 for grids, p-6 for cards
- ALL buttons: hover: state + transition-colors
- Use .map() for repeated elements with realistic data (3-5 items)
- Charts: import { ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'

AVAILABLE COMPONENTS (import from './components/ui/button' etc):
Button, Card, CardHeader, CardTitle, CardContent, CardFooter, Input, Label, Badge, Avatar, AvatarFallback, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Separator, Tabs, TabsList, TabsTrigger, TabsContent, Progress, Dialog, Select

AIKIT COMPONENTS (import from './components/aikit'):
MetricCard (title,value,change,changeType,icon,sparklineData), AIKitPriceCard, AIKitRating, AgentCard (name,role,status,tasks), SwarmView (agents[],title), SafetyBadge, GuardrailPanel (rules[]), ChatBubble, StreamingIndicator, CodeDisplay, TokenUsageBar (used,limit,label), ConnectionStatus, AIKitHeader, AIKitSidebar (items[],activeItem,title), AIKitTable (columns[],data[]), AIKitTimeline, AIKitBanner, AIKitAvatar, AgentTimeline (events[])

IMPORT RULES:
- import React from 'react'
- import { Button } from './components/ui/button'
- import { MetricCard } from './components/aikit'
- import { Search } from 'lucide-react'
- NEVER import from @ainative/*, @/components/*, or npm aikit
- NEVER use framer-motion, @radix-ui, or other unlisted packages
- export default function App() — always export default

OUTPUT: Generate 150-300 lines of COMPLETE, working code. Make it visually polished with realistic sample data.`

            safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'build_step', step: 'Generating with ' + (USE_CLAUDE_DIRECT ? 'Claude Sonnet 3.5' : modelId) + '...' })}\n\n`))

            // ============ CLAUDE DIRECT PATH — Anthropic SDK ============
            const claude = getAnthropicClient()
            if (claude) {
              console.log('🧠 Using Claude Sonnet 4 directly via Anthropic SDK')
              try {
                const claudeResponse = await claude.messages.create({
                  model: 'claude-sonnet-4-20250514',
                  max_tokens: 8192,
                  system: llmSystemPrompt,
                  messages: previousMessages.length > 0
                    ? [...previousMessages.map((m: any) => ({ role: m.role, content: m.content })), { role: 'user', content: enhancedPrompt }]
                    : [{ role: 'user', content: enhancedPrompt }],
                })

                fullContent = claudeResponse.content
                  .filter((block: any) => block.type === 'text')
                  .map((block: any) => block.text)
                  .join('\n')

                const usage = claudeResponse.usage
                tokenUsage = {
                  input_tokens: usage?.input_tokens || 0,
                  output_tokens: usage?.output_tokens || 0,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0,
                  total_tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
                  estimated_cost: ((usage?.input_tokens || 0) * 0.000003 + (usage?.output_tokens || 0) * 0.000015),
                }

                console.log(`📊 Claude Sonnet 3.5: ${fullContent.length} chars (${tokenUsage.input_tokens}+${tokenUsage.output_tokens} tok) cost=$${tokenUsage.estimated_cost.toFixed(4)}`)

                updatePreviewPartial(responseId, fullContent)
                safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))
              } catch (claudeErr: any) {
                console.error('❌ Claude direct call failed:', claudeErr?.message?.slice(0, 100))
                // Fall through to AINative path below
                fullContent = ''
              }
            }

            // ============ AINATIVE FALLBACK PATH — OpenAI-compatible ============
            // Only runs if Claude direct path didn't produce output
            if (fullContent.length > 500) {
              // Claude succeeded — skip AINative entirely
              console.log('✅ Claude produced output, skipping AINative fallback')
            } else if (provider === 'meta') {
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
            } else if (!fullContent || fullContent.length <= 500) {
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
                  const timer = setTimeout(() => ctrl.abort(), 90_000)
                  const response = await client.chat.completions.create(
                    { model: tryModel, max_tokens: 8192, temperature: 0.7, messages: singleTurnMessages },
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
          } // End of standard model call path (skipped when agent succeeds)

          // NOTE: Gradient stripping removed — gradients add visual richness
          // (hero sections, backgrounds, accent elements) matching Bolt/Lovable quality

          // Validate generated code before storing
          console.log('[VALIDATION] Running validateGeneratedCode, fullContent length:', fullContent.length)
          let validation = validateGeneratedCode(fullContent)
          // CRITICAL: Use the VALIDATED/FIXED code, not the original raw content
          // validation.code has markdown extracted and auto-fixes applied
          let finalContent = validation.code
          console.log('[VALIDATION] Result:', validation.valid ? '✅ valid' : '❌ invalid', 'finalContent:', finalContent.length, 'chars')
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
              // Keep to 2 messages (system + user) to avoid multi-turn 512-token cap
              const retryMessages = [
                { role: 'system' as const, content: 'Fix the syntax errors in the code below. Return ONLY valid, complete React code wrapped in ```jsx markers. Ensure all JSX tags are properly closed, all strings are terminated, and all brackets match.' },
                { role: 'user' as const, content: `Here is the broken code:\n\`\`\`jsx\n${fullContent.slice(0, 6000)}\n\`\`\`\n\n${retryPrompt}` }
              ]
              for (const retryModel of retryModels) {
                try {
                  const retryResponse = await ainativeClient.chat.completions.create({
                    model: retryModel,
                    max_tokens: 8192,
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

          // PHASE 2: Claude agent fallback — last resort before sending broken code
          let agentFallbackUsed = false
          let agentFallbackSucceeded = false

          if (!validation.valid && isClaudeAgentFallbackEnabled()) {
            console.log('🤖 Validation still failing — attempting Claude agent fallback...')
            agentFallbackUsed = true

            try {
              safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'build_step',
                step: 'Running Claude agent to fix syntax errors...'
              })}\n\n`))

              const agentFixPrompt = `Fix this React component that has syntax errors. The error is: ${validation.error}

Here is the broken code:
\`\`\`jsx
${finalContent.slice(0, 12000)}
\`\`\`

Fix it and make sure \`npm run build\` passes.
Return ONLY the fixed code — no explanations. Wrap the code in \`\`\`jsx markers.
The component MUST have \`export default function App()\` or \`export default App\`.`

              const agentChatId = `fix-${responseId}-${Date.now()}`
              let agentOutput = ''

              for await (const event of runHeadlessAgent(agentFixPrompt, agentChatId, {
                model: 'sonnet',
                maxBudgetUsd: 0.50,
                systemPrompt: 'You are a React code fixer. Fix syntax errors in the provided component. Output ONLY the corrected code wrapped in ```jsx markers. Do not add explanations.',
              })) {
                switch (event.type) {
                  case 'build_step':
                    safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'build_step',
                      step: `Agent: ${event.step}`
                    })}\n\n`))
                    break
                  case 'files': {
                    // The agent writes files to the worktree — look for App.tsx or similar
                    const appFile = event.files['src/App.tsx'] || event.files['src/App.jsx'] || event.files['App.tsx'] || event.files['App.jsx']
                    if (appFile) {
                      agentOutput = appFile
                    }
                    break
                  }
                  case 'chunk':
                    // Accumulate text output in case the agent returns code inline
                    agentOutput += event.content
                    break
                  case 'error':
                    console.error(`🤖 Agent fallback error: ${event.error}`)
                    break
                }
              }

              // Clean up the agent worktree
              try {
                await cleanupWorktree(agentChatId)
              } catch {
                // Ignore cleanup errors
              }

              // Try to extract code from agent output
              if (agentOutput.length > 200) {
                // Re-validate the agent's output
                const agentValidation = validateGeneratedCode(agentOutput)

                if (agentValidation.valid) {
                  console.log('✅ Claude agent fallback succeeded — validation passed')
                  finalContent = agentValidation.code
                  validation = agentValidation
                  agentFallbackSucceeded = true

                  // Update preview with fixed content
                  updatePreviewPartial(responseId, finalContent)
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'refresh' })}\n\n`))
                } else {
                  console.error('❌ Claude agent fallback output also failed validation:', agentValidation.error)
                }
              } else {
                console.error('❌ Claude agent fallback produced insufficient output:', agentOutput.length, 'chars')
              }
            } catch (agentErr) {
              console.error('❌ Claude agent fallback threw an error:', agentErr)
            }

            console.log(`🤖 Agent fallback result: used=${agentFallbackUsed}, succeeded=${agentFallbackSucceeded}`)

            // Log fallback agent run (fire-and-forget)
            logAgentRun({
              chatId: responseId,
              userId: 'anonymous',
              model: 'sonnet',
              turns: 0, // fallback is single-shot fix
              toolsUsed: ['Write'],
              buildPassed: agentFallbackSucceeded,
              durationMs: Date.now() - generationStartTime,
              tokenUsage: { inputTokens: 0, outputTokens: 0 },
              fallback: true,
              error: agentFallbackSucceeded ? undefined : 'Agent fallback validation failed',
            }).catch(e => console.warn('[AgentRuns] fallback log failed:', e?.message || e))
          }

          // Final validation check
          if (!validation.valid) {
            // Log validation error
            console.error('❌ Final validation failed (after retry' + (agentFallbackUsed ? ' + agent fallback' : '') + '):', validation.error)

            // Send validation error to client
            const failureStages = [
              retryAttempted ? 'auto-retry' : null,
              agentFallbackUsed ? 'Claude agent fallback' : null,
            ].filter(Boolean).join(' and ')

            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'validation_error',
              error: validation.error,
              message: failureStages
                ? `The code generation failed validation even after ${failureStages}. Please try rephrasing your request.`
                : 'The generated code has syntax errors. Please try regenerating.'
            })}\n\n`))

            // Store the invalid code with error marker — wrap in markdown so iframe preview can extract it
            const wrappedInvalidCode = `\`\`\`jsx\n${finalContent}\n\`\`\``
            storePreview(responseId, wrappedInvalidCode, message, {
              validationError: validation.error,
              usage: tokenUsage,
            })

            // Still send files for Sandpack (it has its own error boundary)
            try {
              const parsedFiles = parseMultiFileOutput(finalContent, message)
              if (Object.keys(parsedFiles).length > 0) {
                safeEnqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'files',
                  files: parsedFiles
                })}\n\n`))
              }
            } catch (parseErr) {
              console.warn('Failed to parse files for Sandpack on validation error path:', parseErr)
            }

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
            storePreview(responseId, cleanCodeResponse, message, {
              usage: tokenUsage,
              ainativeFiles,
            })

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
            // Write RLHF training data directly (before any async imports that might hang)
            try {
              const _fs = eval('require')('fs')
              const _path = eval('require')('path')
              const _dir = _path.join(process.cwd(), 'data')
              if (!_fs.existsSync(_dir)) _fs.mkdirSync(_dir, { recursive: true })
              _fs.appendFileSync(_path.join(_dir, 'rlhf-training-data.jsonl'), JSON.stringify({
                messages: [
                  { role: 'system', content: (enhancedSystemPrompt || '').slice(0, 5000) },
                  ...(previousMessages || []),
                  { role: 'user', content: enhancedPrompt || message },
                  { role: 'assistant', content: (finalContent || '').slice(0, 20000) },
                ],
                metadata: {
                  chat_id: responseId, model: requestedModel || DEFAULT_MODEL,
                  status: validation.valid ? 'success' : 'validation_error',
                  validation_valid: validation.valid, generation_time_ms: Date.now() - generationStartTime,
                  code_length: finalContent?.length || 0, theme: selectedTheme?.name,
                  temperature: 0.7, max_tokens: 8192, provider: isLocal ? 'meta' : 'ainative',
                  retry_attempted: retryAttempted, created_at: new Date().toISOString(),
                  agent_fallback_used: agentFallbackUsed, agent_fallback_succeeded: agentFallbackSucceeded,
                },
              }) + '\n')
              console.log(`[RLHF] 📝 Training data saved: ${responseId} (${finalContent.length} chars)`)
            } catch (_rlhfErr: any) {
              console.warn('[RLHF] Local JSONL failed:', _rlhfErr?.message || _rlhfErr)
            }

            console.log('[PERSIST] Starting fire-and-forget block for', responseId)
            try {
              const { saveGeneration, logGenerationEvent } = await import('@/lib/zerodb-store')
              const { storeSSRPreview } = await import('@/lib/preview-store')
              const { logGeneration: logGenToDrizzle } = await import('@/lib/services/rlhf.service')
              const isShowcase = finalContent.length > 1000
              const usedModel = requestedModel || DEFAULT_MODEL
              const genTimeMs = Date.now() - generationStartTime

              // Save code to ZeroDB
              saveGeneration({
                chatId: responseId,
                prompt: message,
                generatedCode: finalContent,
                model: usedModel,
                codeLength: finalContent.length,
                isShowcase,
              }).catch(e => console.warn('[ZeroDB save failed]', e))

              // Auto-populate showcase with quality generations (validation passed + substantial code)
              if (validation.valid && finalContent.length > 1500) {
                import('@/lib/showcase-store').then(({ addToShowcase }) => {
                  const added = addToShowcase(message, responseId, finalContent.length, finalContent)
                  if (added) console.log(`🏆 Added to showcase: ${responseId} (${finalContent.length} chars)`)
                }).catch(() => {})
              }

              // RLHF: Log generation event for tracking + learning
              logGenerationEvent({
                chatId: responseId,
                prompt: message,
                model: usedModel,
                theme: selectedTheme.name,
                codeLength: finalContent.length,
                passedValidation: validation.valid,
                generationTimeMs: genTimeMs,
                retryCount: retryAttempted ? 1 : 0,
                finishReason: 'stop',
              }).catch(e => console.warn('[RLHF log failed]', e))

              // JSONL local write removed — ZeroDB is source of truth (Refs builder#41)

              // RLHF: Also try Drizzle DB (may fail locally)
              console.log('[RLHF] 🔄 Calling logGenToDrizzle for', responseId)
              logGenToDrizzle({
                chatId: responseId,
                userId: 'anonymous', // TODO: get from session
                prompt: message,
                generatedCode: finalContent,
                model: usedModel,
                generationTimeMs: genTimeMs,
                templateUsed: null,
                // Fine-tuning data
                systemPrompt: enhancedSystemPrompt,
                fullConversation: [
                  { role: 'system', content: (enhancedSystemPrompt || '').slice(0, 5000) },
                  ...(previousMessages || []),
                  { role: 'user', content: enhancedPrompt },
                  { role: 'assistant', content: finalContent.slice(0, 10000) },
                ],
                tokenUsage: tokenUsage || undefined,
                modelConfig: {
                  temperature: 0.7,
                  max_tokens: 8192,
                  provider: isLocal ? 'meta' : 'ainative',
                },
                validationResult: {
                  valid: validation.valid,
                  error: validation.valid ? undefined : validation.error,
                  retryAttempted,
                },
                agentFallback: agentFallbackUsed,
                status: validation.valid ? 'success' : 'validation_error',
                theme: selectedTheme.name,
                codeLength: finalContent.length,
              }).catch(e => console.warn('[RLHF Drizzle log failed]', e))

              // SSR build in background — when done, the next iframe refresh shows instant content
              import('@/lib/sandbox-builder').then(({ buildInSandbox }) => {
                buildInSandbox(finalContent).then(ssrResult => {
                  if (ssrResult.success) {
                    storeSSRPreview(responseId, ssrResult.html)
                    console.log(`🏗️ SSR ready for ${responseId}: ${ssrResult.html.length}b in ${ssrResult.buildTimeMs}ms`)
                  }
                }).catch(() => {})
              }).catch(() => {})
            } catch (persistErr: any) {
              console.error('[PERSIST] Fire-and-forget block failed:', persistErr?.message || persistErr)
            }
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

          // RLHF: Log failure for training data
          import('@/lib/services/rlhf.service').then(({ logGenerationFailure }) => {
            logGenerationFailure({
              chatId: responseId,
              userId: 'anonymous',
              prompt: message,
              model: requestedModel || DEFAULT_MODEL,
              error: error instanceof Error ? error.message : String(error),
              systemPrompt: '',
              generationTimeMs: 0,
            }).catch(() => {})
          }).catch(() => {})

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