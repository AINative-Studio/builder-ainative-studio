import OpenAI from 'openai'
import { getRedisClient } from '@/lib/redis'
import { logger } from '@/lib/logger'

// Initialize OpenAI only if API key is available
let openai: OpenAI | null = null
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
}

// Keyword mapping for different template categories
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  dashboard: [
    'dashboard',
    'analytics',
    'metrics',
    'admin panel',
    'overview',
    'statistics',
    'charts',
    'graphs',
    'kpi',
    'monitoring',
    'saas',
  ],
  ecommerce: [
    'product',
    'shop',
    'store',
    'cart',
    'checkout',
    'buy',
    'ecommerce',
    'marketplace',
    'catalog',
    'inventory',
    'payment',
  ],
  landing: [
    'landing page',
    'hero',
    'marketing',
    'cta',
    'sign up',
    'pricing',
    'testimonials',
    'features',
    'conversion',
    'promo',
  ],
  admin: [
    'admin',
    'manage',
    'crud',
    'table',
    'edit',
    'delete',
    'create',
    'update',
    'management',
    'cms',
    'content',
  ],
  blog: [
    'blog',
    'article',
    'post',
    'news',
    'content',
    'publishing',
    'writing',
    'journal',
    'magazine',
  ],
}

export interface TemplateMatchResult {
  templateId?: string
  templateCategory?: string
  confidence: number
  matchType: 'keyword' | 'semantic' | 'combined' | 'none'
}

export interface TemplateEmbedding {
  templateId: string
  category: string
  embedding: number[]
}

/**
 * Template Matcher Service
 *
 * Implements semantic matching to suggest templates based on user prompts.
 * Uses a combination of keyword matching and OpenAI embeddings for fuzzy matching.
 */
export class TemplateMatcherService {
  private redisClient: ReturnType<typeof getRedisClient> | null = null

  constructor() {
    this.initRedis()
  }

  private async initRedis() {
    try {
      this.redisClient = getRedisClient()
    } catch (error) {
      logger.warn('Redis not available for template matcher, caching disabled', { error })
    }
  }

  /**
   * Calculate keyword matching score for a prompt against a category
   */
  private calculateKeywordScore(prompt: string, category: string): number {
    const normalizedPrompt = prompt.toLowerCase()
    const keywords = CATEGORY_KEYWORDS[category] || []

    let matchCount = 0
    let totalWeight = 0

    keywords.forEach((keyword, index) => {
      // Give higher weight to earlier keywords (they're more important)
      const weight = keywords.length - index

      if (normalizedPrompt.includes(keyword)) {
        matchCount += weight
      }
      totalWeight += weight
    })

    return totalWeight > 0 ? matchCount / totalWeight : 0
  }

  /**
   * Generate embedding for a text using OpenAI
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    if (!openai) {
      throw new Error('OpenAI client not initialized. OPENAI_API_KEY not set.')
    }

    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      })

      return response.data[0].embedding
    } catch (error) {
      logger.error('Failed to generate embedding', { error, text })
      throw new Error('Failed to generate embedding')
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have same length')
    }

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  /**
   * Get or create cached embedding for a template category
   */
  private async getCategoryEmbedding(category: string): Promise<number[]> {
    const cacheKey = `template-category-embedding:${category}`

    // Try to get from cache
    if (this.redisClient) {
      try {
        const cached = await this.redisClient.get(cacheKey)
        if (cached) {
          return JSON.parse(cached)
        }
      } catch (error) {
        logger.warn('Failed to get category embedding from cache', { error, category })
      }
    }

    // Generate description for category
    const descriptions: Record<string, string> = {
      dashboard: 'A comprehensive dashboard with metrics, charts, analytics, and data visualization for monitoring business KPIs and statistics',
      ecommerce: 'An e-commerce product page with product catalog, shopping cart, filters, and checkout functionality for online stores',
      landing: 'A marketing landing page with hero section, features, testimonials, pricing plans, and call-to-action buttons',
      admin: 'An admin panel with CRUD operations, data tables, search and filter functionality for content management',
      blog: 'A blog layout with article listings, categories, tags, search functionality, and pagination for content publishing',
    }

    const description = descriptions[category] || category
    const embedding = await this.generateEmbedding(description)

    // Cache the embedding
    if (this.redisClient) {
      try {
        await this.redisClient.setex(cacheKey, 86400, JSON.stringify(embedding)) // Cache for 24 hours
      } catch (error) {
        logger.warn('Failed to cache category embedding', { error, category })
      }
    }

    return embedding
  }

  /**
   * Calculate semantic similarity score using embeddings
   */
  private async calculateSemanticScore(
    prompt: string,
    category: string
  ): Promise<number> {
    try {
      const [promptEmbedding, categoryEmbedding] = await Promise.all([
        this.generateEmbedding(prompt),
        this.getCategoryEmbedding(category),
      ])

      const similarity = this.cosineSimilarity(promptEmbedding, categoryEmbedding)

      // Normalize similarity from [-1, 1] to [0, 1]
      return (similarity + 1) / 2
    } catch (error) {
      logger.error('Failed to calculate semantic score', { error, prompt, category })
      return 0
    }
  }

  /**
   * Match a user prompt to the best template category
   *
   * @param prompt - User's natural language prompt
   * @param useSemanticMatching - Whether to use AI embeddings (default: true)
   * @returns Template match result with confidence score
   */
  async matchTemplate(
    prompt: string,
    useSemanticMatching: boolean = true
  ): Promise<TemplateMatchResult> {
    const startTime = Date.now()

    try {
      const categories = Object.keys(CATEGORY_KEYWORDS)
      const scores: Array<{
        category: string
        keywordScore: number
        semanticScore: number
        combinedScore: number
      }> = []

      // Calculate scores for each category
      for (const category of categories) {
        const keywordScore = this.calculateKeywordScore(prompt, category)

        let semanticScore = 0
        let combinedScore = keywordScore

        if (useSemanticMatching) {
          semanticScore = await this.calculateSemanticScore(prompt, category)
          // Combined score: 60% keyword, 40% semantic
          combinedScore = keywordScore * 0.6 + semanticScore * 0.4
        }

        scores.push({
          category,
          keywordScore,
          semanticScore,
          combinedScore,
        })
      }

      // Sort by combined score
      scores.sort((a, b) => b.combinedScore - a.combinedScore)

      const bestMatch = scores[0]
      const confidence = bestMatch.combinedScore
      const threshold = 0.7

      const elapsedTime = Date.now() - startTime

      logger.info('Template matching completed', {
        prompt: prompt.substring(0, 100),
        bestCategory: bestMatch.category,
        confidence,
        keywordScore: bestMatch.keywordScore,
        semanticScore: bestMatch.semanticScore,
        elapsedTime,
        allScores: scores,
      })

      // Return match only if confidence is above threshold
      if (confidence >= threshold) {
        return {
          templateCategory: bestMatch.category,
          confidence,
          matchType: useSemanticMatching ? 'combined' : 'keyword',
        }
      }

      return {
        confidence: 0,
        matchType: 'none',
      }
    } catch (error) {
      logger.error('Template matching failed', { error, prompt })
      return {
        confidence: 0,
        matchType: 'none',
      }
    }
  }

  /**
   * Get keyword suggestions for improving template matching
   */
  getKeywordSuggestions(category: string): string[] {
    return CATEGORY_KEYWORDS[category] || []
  }

  /**
   * Pre-warm the embedding cache for all categories
   * Should be called during application startup
   */
  async warmCache(): Promise<void> {
    logger.info('Warming template embedding cache')

    const categories = Object.keys(CATEGORY_KEYWORDS)
    await Promise.all(
      categories.map((category) => this.getCategoryEmbedding(category))
    )

    logger.info('Template embedding cache warmed', { categories })
  }
}

// Singleton instance
let templateMatcherInstance: TemplateMatcherService | null = null

export function getTemplateMatcherService(): TemplateMatcherService {
  if (!templateMatcherInstance) {
    templateMatcherInstance = new TemplateMatcherService()
  }
  return templateMatcherInstance
}
