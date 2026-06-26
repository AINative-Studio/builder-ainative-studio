// @ts-nocheck
import {
  getInsightsFromZeroDB,
  submitFeedbackToZeroDB,
  type ZeroDBInsightsQuery,
  type ZeroDBInsightsResponse,
} from '@/lib/services/zerodb-rlhf.service'

export interface GenerationData {
  chatId: string
  userId: string
  prompt: string
  generatedCode: string
  promptVersionId?: string | null
  model: string
  templateUsed?: string | null
  generationTimeMs: number
  // RLHF fine-tuning fields
  systemPrompt?: string
  fullConversation?: Array<{ role: string; content: string }>
  tokenUsage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
  modelConfig?: {
    temperature?: number
    max_tokens?: number
    provider?: string
  }
  validationResult?: {
    valid: boolean
    error?: string
    retryAttempted?: boolean
  }
  status?: 'success' | 'validation_error' | 'failure'
  theme?: string
  codeLength?: number
  // Agent-powered generation fields (builder#57)
  agentPowered?: boolean
  agentTurns?: number
  agentBuildPassed?: boolean
  agentToolsUsed?: string[]
  agentFallback?: boolean
  agentDurationMs?: number
}

export interface FeedbackData {
  generationId: string
  rating: number
  feedbackText?: string
  wasEdited: boolean
  iterations: number
  editChangesSummary?: {
    linesAdded?: number
    linesRemoved?: number
    componentsChanged?: string[]
    styleChanges?: string[]
  }
}

export interface InsightsQuery {
  timeRange: '1d' | '7d' | '30d'
  groupBy?: 'promptVersion' | 'model' | 'template' | 'day' | 'week' | 'month'
  promptVersionId?: string
}

export interface InsightsResponse {
  summary: {
    avgRating: number
    totalGenerations: number
    firstPassSuccessRate: number
    editRate: number
    avgGenerationTimeMs: number
    p50LatencyMs: number
    p95LatencyMs: number
    p99LatencyMs: number
  }
  breakdown: Array<{
    key: string
    label: string
    avgRating: number
    count: number
    firstPassSuccessRate: number
    editRate: number
    avgGenerationTimeMs: number
  }>
  topEditPatterns?: Array<{
    pattern: string
    count: number
    percentage: number
  }>
}

// Log a new generation — captures full training data for fine-tuning
export async function logGeneration(data: GenerationData): Promise<string> {
  // Always log to ZeroDB for fine-tuning data (more fields, no schema migration needed)
  logGenerationToZeroDB(data).catch(err => {
    console.warn('[RLHF] ZeroDB log failed:', err?.message || err)
  })

  // Feed generation outcome into intelligence loop (every generation, not just feedback)
  const validationScore = data.validationResult?.valid ? 1.0 : 0.0
  const codeQualityScore = Math.min((data.codeLength || 0) / 10000, 1.0) // 10K chars = 1.0
  const overallScore = (validationScore * 0.6) + (codeQualityScore * 0.4)

  // Build context — include agent-specific fields when generation was agent-powered (builder#57)
  const loopContext: Record<string, any> = {
    type: 'generation',
    chatId: data.chatId,
    model: data.model,
    codeLength: data.codeLength || 0,
    validationValid: data.validationResult?.valid ?? true,
    retryAttempted: data.validationResult?.retryAttempted || false,
    generationTimeMs: data.generationTimeMs,
    theme: data.theme,
    status: data.status || 'success',
  }

  if (data.agentPowered) {
    loopContext.agentPowered = true
    loopContext.agentTurns = data.agentTurns ?? 0
    loopContext.buildPassed = data.agentBuildPassed ?? false
    loopContext.toolsUsed = data.agentToolsUsed ?? []
    loopContext.agentFallback = data.agentFallback ?? false
    loopContext.agentDurationMs = data.agentDurationMs ?? 0
  }

  sendToIntelligenceLoop({
    agentId: data.agentPowered ? 'builder-headless-agent' : 'builder-component-gen',
    score: overallScore,
    context: loopContext,
  }).catch(() => {})

  return crypto.randomUUID()
}

// Log generation failure — captures failed attempts for debugging and training
export async function logGenerationFailure(data: {
  chatId: string
  userId: string
  prompt: string
  model: string
  error: string
  systemPrompt?: string
  generationTimeMs: number
  retryCount?: number
}): Promise<void> {
  logGenerationToZeroDB({
    chatId: data.chatId,
    userId: data.userId,
    prompt: data.prompt,
    generatedCode: '',
    model: data.model,
    generationTimeMs: data.generationTimeMs,
    status: 'failure',
    validationResult: {
      valid: false,
      error: data.error,
      retryAttempted: (data.retryCount || 0) > 0,
    },
    systemPrompt: data.systemPrompt,
  }).catch(err => {
    console.warn('[RLHF] Failed to log generation failure:', err?.message || err)
  })
}

// Write training data to ZeroDB
async function logGenerationToZeroDB(data: GenerationData): Promise<void> {
  console.log(`[RLHF] logGenerationToZeroDB called for ${data.chatId}`)

  try {
    const apiKey = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''
    const projectId = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
    if (!apiKey) return

    const baseUrl = process.env.AINATIVE_API_URL || process.env.ZERODB_BASE_URL || 'https://api.ainative.studio'
    const row = {
      chat_id: data.chatId, user_id: data.userId, prompt: data.prompt,
      generated_code: data.generatedCode?.slice(0, 50000) || '',
      system_prompt: data.systemPrompt?.slice(0, 10000) || '',
      full_conversation: JSON.stringify(data.fullConversation || []),
      model: data.model, template_used: data.templateUsed || null,
      generation_time_ms: data.generationTimeMs, status: data.status || 'success',
      input_tokens: data.tokenUsage?.input_tokens || 0,
      output_tokens: data.tokenUsage?.output_tokens || 0,
      total_tokens: data.tokenUsage?.total_tokens || 0,
      temperature: data.modelConfig?.temperature || 0.7,
      max_tokens: data.modelConfig?.max_tokens || 8192,
      provider: data.modelConfig?.provider || 'ainative',
      validation_valid: data.validationResult?.valid ?? true,
      validation_error: data.validationResult?.error || null,
      retry_attempted: data.validationResult?.retryAttempted || false,
      theme: data.theme || null,
      code_length: data.codeLength || data.generatedCode?.length || 0,
      created_at: new Date().toISOString(),
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/database/tables/rlhf_training_data/rows`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ row_data: row }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (res.ok) console.log(`[RLHF] ✅ ZeroDB: ${data.chatId}`)
    else console.warn(`[RLHF] ZeroDB ${res.status}`)
  } catch (err: any) {
    console.warn(`[RLHF] ZeroDB: ${err?.name || 'error'}`)
  }
}

// Submit user feedback — writes to ZeroDB (no Drizzle dependency)
export async function submitFeedback(data: FeedbackData): Promise<string> {
  try {
    const feedbackId = await submitFeedbackToZeroDB({
      generationId: data.generationId,
      rating: data.rating,
      feedbackText: data.feedbackText,
      wasEdited: data.wasEdited,
      iterations: data.iterations,
      editChangesSummary: data.editChangesSummary,
    })

    // Feed into AINative intelligence loop (Refs builder#40)
    sendToIntelligenceLoop({
      agentId: 'builder-component-gen',
      score: data.rating / 5, // normalize 1-5 to 0-1
      context: {
        generationId: data.generationId,
        rating: data.rating,
        wasEdited: data.wasEdited,
        iterations: data.iterations,
        feedbackText: data.feedbackText?.slice(0, 100),
      },
    }).catch(() => {})

    return feedbackId
  } catch (error) {
    console.warn('[RLHF] submitFeedback failed:', {
      generationId: data.generationId,
      error,
    })
    return 'feedback-placeholder'
  }
}

// Wire builder feedback into AINative intelligence loop (Refs builder#40)
async function sendToIntelligenceLoop(data: {
  agentId: string
  score: number
  context: Record<string, any>
}): Promise<void> {
  try {
    const apiUrl = process.env.AINATIVE_API_URL || process.env.NEXT_PUBLIC_API_BASE || 'https://api.ainative.studio'
    const apiKey = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''
    if (!apiKey) return

    // Build memory content — richer description for agent-powered runs (builder#57)
    const isAgent = data.context.agentPowered === true
    const contentParts = [`Builder agent ${data.agentId} scored ${data.score.toFixed(2)}`]
    if (isAgent) {
      contentParts.push(
        `[headless-agent] turns=${data.context.agentTurns}`,
        `buildPassed=${data.context.buildPassed}`,
        `tools=${(data.context.toolsUsed || []).join(',')}`,
        `fallback=${data.context.agentFallback}`,
        `durationMs=${data.context.agentDurationMs}`,
      )
    }
    contentParts.push(JSON.stringify(data.context).slice(0, 200))

    const tags = ['builder', 'rlhf', data.agentId, 'intelligence-loop']
    if (isAgent) tags.push('headless-agent')

    // 1. Store as ZeroMemory for episodic consolidation
    await fetch(`${apiUrl}/api/v1/public/memory/v2/remember`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: contentParts.join(' | '),
        tags,
        importance: data.score < 0.5 ? 0.8 : 0.5,
        metadata: { agent: data.agentId, score: data.score, source: 'builder.ainative.studio', ...data.context },
      }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Best-effort — never block the builder
  }
}

// Get insights — reads from ZeroDB (no Drizzle dependency)
export async function getInsights(
  query: InsightsQuery,
): Promise<InsightsResponse> {
  return getInsightsFromZeroDB(query)
}

// Get active prompt version for A/B testing
// Returns null to use default prompt — prompt_versions will be migrated to ZeroDB in a future phase
export async function getActivePromptVersion(
  _type: string,
): Promise<{ id: string; content: string; version: string } | null> {
  return null
}
