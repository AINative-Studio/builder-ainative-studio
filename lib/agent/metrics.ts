/**
 * Subagent Performance Metrics (Issue #9)
 *
 * Comprehensive tracking and logging of subagent performance metrics including:
 * - Execution times for design, code, and validation subagents
 * - Token usage tracking per agent and total
 * - Success/failure tracking
 * - Storage in ZeroDB for analytics
 * - Console logging for real-time monitoring
 */

import { logger } from '../logger'
import { getZeroDBClient } from '../mcp/zerodb-client'

/**
 * Token usage information per agent
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/**
 * Performance metrics for individual subagent
 */
export interface SubagentMetrics {
  agentType: 'design' | 'code' | 'validation'
  startTime: number
  endTime?: number
  duration?: number // milliseconds
  tokenUsage?: TokenUsage
  success: boolean
  errorMessage?: string
  metadata?: Record<string, any>
}

/**
 * Complete performance metrics for entire orchestrator run
 */
export interface OrchestratorMetrics {
  sessionId: string
  userId?: string
  chatId?: string
  userPrompt: string

  // Individual subagent timings
  designTime: number
  codeTime: number
  validationTime: number
  totalTime: number

  // Token usage tracking
  tokenUsage: {
    design: TokenUsage
    code: TokenUsage
    validation: TokenUsage
    total: TokenUsage
  }

  // Success tracking
  success: boolean
  designSuccess: boolean
  codeSuccess: boolean
  validationSuccess: boolean

  // Additional metadata
  model: string
  timestamp: Date
  metadata?: Record<string, any>
}

/**
 * Metrics collector for tracking subagent performance
 */
export class MetricsCollector {
  private sessionId: string
  private userId?: string
  private chatId?: string
  private userPrompt: string
  private model: string

  private subagentMetrics: Map<string, SubagentMetrics>
  private startTime: number

  constructor(sessionId: string, userPrompt: string, model: string, userId?: string, chatId?: string) {
    this.sessionId = sessionId
    this.userId = userId
    this.chatId = chatId
    this.userPrompt = userPrompt
    this.model = model
    this.subagentMetrics = new Map()
    this.startTime = Date.now()

    logger.info('📊 Metrics collector initialized', {
      sessionId: this.sessionId,
      userId: this.userId,
      chatId: this.chatId,
    })
  }

  /**
   * Start tracking a subagent execution
   */
  startSubagent(agentType: 'design' | 'code' | 'validation'): void {
    const metrics: SubagentMetrics = {
      agentType,
      startTime: Date.now(),
      success: false,
    }

    this.subagentMetrics.set(agentType, metrics)

    logger.info(`⏱️  ${agentType.toUpperCase()} subagent started`, {
      sessionId: this.sessionId,
      agentType,
    })
  }

  /**
   * End tracking a subagent execution
   */
  endSubagent(
    agentType: 'design' | 'code' | 'validation',
    success: boolean,
    tokenUsage?: TokenUsage,
    errorMessage?: string,
    metadata?: Record<string, any>
  ): void {
    const metrics = this.subagentMetrics.get(agentType)
    if (!metrics) {
      logger.warn('Attempted to end untracked subagent', { agentType })
      return
    }

    metrics.endTime = Date.now()
    metrics.duration = metrics.endTime - metrics.startTime
    metrics.success = success
    metrics.tokenUsage = tokenUsage
    metrics.errorMessage = errorMessage
    metrics.metadata = metadata

    this.subagentMetrics.set(agentType, metrics)

    logger.info(`✅ ${agentType.toUpperCase()} subagent completed`, {
      sessionId: this.sessionId,
      agentType,
      duration: metrics.duration,
      success,
      tokenUsage: tokenUsage?.totalTokens || 0,
    })
  }

  /**
   * Calculate aggregated metrics for the entire orchestrator run
   */
  private calculateAggregatedMetrics(): OrchestratorMetrics {
    const designMetrics = this.subagentMetrics.get('design')
    const codeMetrics = this.subagentMetrics.get('code')
    const validationMetrics = this.subagentMetrics.get('validation')

    // Calculate individual timings (default to 0 if not tracked)
    const designTime = designMetrics?.duration || 0
    const codeTime = codeMetrics?.duration || 0
    const validationTime = validationMetrics?.duration || 0
    const totalTime = Date.now() - this.startTime

    // Aggregate token usage
    const designTokens = designMetrics?.tokenUsage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    const codeTokens = codeMetrics?.tokenUsage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    const validationTokens = validationMetrics?.tokenUsage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

    const totalTokens: TokenUsage = {
      inputTokens: designTokens.inputTokens + codeTokens.inputTokens + validationTokens.inputTokens,
      outputTokens: designTokens.outputTokens + codeTokens.outputTokens + validationTokens.outputTokens,
      totalTokens: designTokens.totalTokens + codeTokens.totalTokens + validationTokens.totalTokens,
    }

    // Determine overall success
    const designSuccess = designMetrics?.success ?? false
    const codeSuccess = codeMetrics?.success ?? false
    const validationSuccess = validationMetrics?.success ?? false
    const overallSuccess = designSuccess && codeSuccess && validationSuccess

    return {
      sessionId: this.sessionId,
      userId: this.userId,
      chatId: this.chatId,
      userPrompt: this.userPrompt,
      designTime,
      codeTime,
      validationTime,
      totalTime,
      tokenUsage: {
        design: designTokens,
        code: codeTokens,
        validation: validationTokens,
        total: totalTokens,
      },
      success: overallSuccess,
      designSuccess,
      codeSuccess,
      validationSuccess,
      model: this.model,
      timestamp: new Date(),
      metadata: {
        designMetadata: designMetrics?.metadata,
        codeMetadata: codeMetrics?.metadata,
        validationMetadata: validationMetrics?.metadata,
      },
    }
  }

  /**
   * Log metrics to console with formatted output
   */
  logToConsole(metrics: OrchestratorMetrics): void {
    console.log('\n' + '='.repeat(80))
    console.log('📊 SUBAGENT PERFORMANCE METRICS')
    console.log('='.repeat(80))
    console.log(`Session ID: ${metrics.sessionId}`)
    console.log(`Timestamp: ${metrics.timestamp.toISOString()}`)
    console.log(`User Prompt: ${metrics.userPrompt.substring(0, 100)}...`)
    console.log(`Model: ${metrics.model}`)
    console.log(`Overall Success: ${metrics.success ? '✅ YES' : '❌ NO'}`)
    console.log('\n' + '-'.repeat(80))
    console.log('⏱️  EXECUTION TIMES')
    console.log('-'.repeat(80))
    console.log(`Design Time:     ${this.formatDuration(metrics.designTime)} ${metrics.designSuccess ? '✅' : '❌'}`)
    console.log(`Code Time:       ${this.formatDuration(metrics.codeTime)} ${metrics.codeSuccess ? '✅' : '❌'}`)
    console.log(`Validation Time: ${this.formatDuration(metrics.validationTime)} ${metrics.validationSuccess ? '✅' : '❌'}`)
    console.log(`Total Time:      ${this.formatDuration(metrics.totalTime)}`)
    console.log('\n' + '-'.repeat(80))
    console.log('🎯 TOKEN USAGE')
    console.log('-'.repeat(80))
    console.log(`Design:     ${this.formatTokens(metrics.tokenUsage.design)}`)
    console.log(`Code:       ${this.formatTokens(metrics.tokenUsage.code)}`)
    console.log(`Validation: ${this.formatTokens(metrics.tokenUsage.validation)}`)
    console.log(`TOTAL:      ${this.formatTokens(metrics.tokenUsage.total)}`)
    console.log('='.repeat(80) + '\n')
  }

  /**
   * Store metrics in ZeroDB for analytics
   */
  async storeInZeroDB(metrics: OrchestratorMetrics): Promise<boolean> {
    try {
      const zerodbClient = getZeroDBClient()

      if (!zerodbClient.isConnected()) {
        logger.warn('ZeroDB client not connected, skipping metrics storage')
        return false
      }

      // Store metrics in ZeroDB using NoSQL table
      const result = await zerodbClient.executeCRUD({
        operation: 'CREATE',
        table: 'subagent_metrics',
        data: {
          session_id: metrics.sessionId,
          user_id: metrics.userId,
          chat_id: metrics.chatId,
          user_prompt: metrics.userPrompt,
          design_time_ms: metrics.designTime,
          code_time_ms: metrics.codeTime,
          validation_time_ms: metrics.validationTime,
          total_time_ms: metrics.totalTime,
          design_tokens: metrics.tokenUsage.design.totalTokens,
          code_tokens: metrics.tokenUsage.code.totalTokens,
          validation_tokens: metrics.tokenUsage.validation.totalTokens,
          total_tokens: metrics.tokenUsage.total.totalTokens,
          success: metrics.success,
          design_success: metrics.designSuccess,
          code_success: metrics.codeSuccess,
          validation_success: metrics.validationSuccess,
          model: metrics.model,
          timestamp: metrics.timestamp.toISOString(),
          metadata: metrics.metadata,
        },
      })

      if (result.success) {
        logger.info('✅ Metrics stored in ZeroDB', {
          sessionId: metrics.sessionId,
        })
        return true
      } else {
        logger.error('Failed to store metrics in ZeroDB', new Error(result.error), {
          sessionId: metrics.sessionId,
        })
        return false
      }
    } catch (error) {
      logger.error('Error storing metrics in ZeroDB', error as Error, {
        sessionId: metrics.sessionId,
      })
      return false
    }
  }

  /**
   * Send metrics to analytics service
   * (Placeholder for future integration with analytics platforms like Mixpanel, PostHog, etc.)
   */
  async sendToAnalytics(metrics: OrchestratorMetrics): Promise<boolean> {
    try {
      // TODO: Integrate with analytics platform (Mixpanel, PostHog, Segment, etc.)
      // For now, just log that we would send to analytics
      logger.info('📈 Would send metrics to analytics platform', {
        sessionId: metrics.sessionId,
        totalTime: metrics.totalTime,
        totalTokens: metrics.tokenUsage.total.totalTokens,
        success: metrics.success,
      })

      // Example future implementation:
      // await mixpanel.track('Subagent Execution', {
      //   sessionId: metrics.sessionId,
      //   designTime: metrics.designTime,
      //   codeTime: metrics.codeTime,
      //   validationTime: metrics.validationTime,
      //   totalTime: metrics.totalTime,
      //   totalTokens: metrics.tokenUsage.total.totalTokens,
      //   success: metrics.success,
      //   model: metrics.model,
      // })

      return true
    } catch (error) {
      logger.error('Error sending metrics to analytics', error as Error, {
        sessionId: metrics.sessionId,
      })
      return false
    }
  }

  /**
   * Complete metrics collection and publish results
   */
  async complete(): Promise<OrchestratorMetrics> {
    const metrics = this.calculateAggregatedMetrics()

    // Log to console
    this.logToConsole(metrics)

    // Store in ZeroDB (async, don't wait)
    this.storeInZeroDB(metrics).catch((error) => {
      logger.error('Failed to store metrics in ZeroDB', error)
    })

    // Send to analytics (async, don't wait)
    this.sendToAnalytics(metrics).catch((error) => {
      logger.error('Failed to send metrics to analytics', error)
    })

    return metrics
  }

  /**
   * Format duration in milliseconds to human-readable string
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`
    }
    const seconds = (ms / 1000).toFixed(2)
    return `${seconds}s (${ms}ms)`
  }

  /**
   * Format token usage to human-readable string
   */
  private formatTokens(usage: TokenUsage): string {
    return `${usage.totalTokens.toLocaleString()} tokens (in: ${usage.inputTokens.toLocaleString()}, out: ${usage.outputTokens.toLocaleString()})`
  }
}

/**
 * Extract token usage from Anthropic API response
 */
export function extractTokenUsage(response: any): TokenUsage {
  if (!response || !response.usage) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    }
  }

  return {
    inputTokens: response.usage.input_tokens || 0,
    outputTokens: response.usage.output_tokens || 0,
    totalTokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0),
  }
}

/**
 * Create a new metrics collector instance
 */
export function createMetricsCollector(
  sessionId: string,
  userPrompt: string,
  model: string,
  userId?: string,
  chatId?: string
): MetricsCollector {
  return new MetricsCollector(sessionId, userPrompt, model, userId, chatId)
}
