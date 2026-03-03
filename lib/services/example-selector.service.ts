/**
 * Example Selector Service (US-029)
 *
 * Implements semantic similarity matching using embeddings to select
 * the most relevant few-shot examples for a given user prompt.
 */

import OpenAI from 'openai'
import { db } from '../db/connection'
import { few_shot_examples, type FewShotExample } from '../db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '../logger'
import { getRedisClient } from '../redis'

export interface ExampleWithScore extends FewShotExample {
  similarityScore: number
}

export interface ExampleSelectionResult {
  examples: ExampleWithScore[]
  method: 'semantic' | 'fallback'
  selectionTimeMs: number
}

// Similarity threshold for semantic matching
const SIMILARITY_THRESHOLD = 0.7
const MAX_EXAMPLES = 3
const CACHE_TTL = 3600 // 1 hour in seconds

/**
 * Generate embedding for text using OpenAI
 *
 * @param text Text to generate embedding for
 * @returns Embedding vector
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const openai = new OpenAI({ apiKey })

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small', // Smaller, faster model
    input: text,
    encoding_format: 'float'
  })

  return response.data[0].embedding
}

/**
 * Calculate cosine similarity between two vectors
 *
 * @param vecA First vector
 * @param vecB Second vector
 * @returns Similarity score (0-1)
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have same length')
  }

  let dotProduct = 0
  let magnitudeA = 0
  let magnitudeB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    magnitudeA += vecA[i] * vecA[i]
    magnitudeB += vecB[i] * vecB[i]
  }

  magnitudeA = Math.sqrt(magnitudeA)
  magnitudeB = Math.sqrt(magnitudeB)

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0
  }

  return dotProduct / (magnitudeA * magnitudeB)
}

/**
 * Get cached embedding from Redis
 *
 * @param key Cache key
 * @returns Cached embedding or null
 */
async function getCachedEmbedding(key: string): Promise<number[] | null> {
  try {
    const redis = getRedisClient()
    const cached = await redis.get(key)

    if (cached) {
      return JSON.parse(cached) as number[]
    }
  } catch (error) {
    logger.warn('Failed to get cached embedding', { error, key })
  }

  return null
}

/**
 * Cache embedding in Redis
 *
 * @param key Cache key
 * @param embedding Embedding to cache
 */
async function cacheEmbedding(key: string, embedding: number[]): Promise<void> {
  try {
    const redis = getRedisClient()
    await redis.setex(key, CACHE_TTL, JSON.stringify(embedding))
  } catch (error) {
    logger.warn('Failed to cache embedding', { error, key })
  }
}

/**
 * Get or generate embedding with caching
 *
 * @param text Text to get embedding for
 * @param cacheKey Optional cache key
 * @returns Embedding vector
 */
async function getOrGenerateEmbedding(
  text: string,
  cacheKey?: string
): Promise<number[]> {
  // Try to get from cache first
  if (cacheKey) {
    const cached = await getCachedEmbedding(cacheKey)
    if (cached) {
      logger.info('Using cached embedding', { cacheKey })
      return cached
    }
  }

  // Generate new embedding
  const embedding = await generateEmbedding(text)

  // Cache it
  if (cacheKey) {
    await cacheEmbedding(cacheKey, embedding)
  }

  return embedding
}

/**
 * Select examples using semantic similarity
 *
 * @param userPrompt User's prompt
 * @param category Optional category to filter examples
 * @returns Selected examples with scores
 */
export async function selectExamplesBySimilarity(
  userPrompt: string,
  category?: string
): Promise<ExampleSelectionResult> {
  const startTime = Date.now()

  try {
    // Get all examples (filtered by category if provided)
    const allExamples = category
      ? await db
          .select()
          .from(few_shot_examples)
          .where(eq(few_shot_examples.category, category))
      : await db.select().from(few_shot_examples)

    if (allExamples.length === 0) {
      logger.warn('No examples found', { category })
      return {
        examples: [],
        method: 'fallback',
        selectionTimeMs: Date.now() - startTime
      }
    }

    // Generate embedding for user prompt
    const userEmbedding = await getOrGenerateEmbedding(userPrompt)

    // Calculate similarity scores for all examples
    const examplesWithScores: ExampleWithScore[] = []

    for (const example of allExamples) {
      // Get or generate embedding for example prompt
      const exampleEmbedding = await getOrGenerateEmbedding(
        example.prompt,
        `embedding:${example.id}`
      )

      // Calculate similarity
      const score = cosineSimilarity(userEmbedding, exampleEmbedding)

      examplesWithScores.push({
        ...example,
        similarityScore: score
      })
    }

    // Sort by similarity (highest first)
    examplesWithScores.sort((a, b) => b.similarityScore - a.similarityScore)

    // Filter by threshold and take top N
    const relevantExamples = examplesWithScores
      .filter(ex => ex.similarityScore >= SIMILARITY_THRESHOLD)
      .slice(0, MAX_EXAMPLES)

    const selectionTimeMs = Date.now() - startTime

    // If no examples meet threshold, use fallback
    if (relevantExamples.length === 0) {
      logger.info('No examples above similarity threshold, using fallback', {
        threshold: SIMILARITY_THRESHOLD,
        bestScore: examplesWithScores[0]?.similarityScore || 0
      })

      return selectExamplesFallback(category, selectionTimeMs)
    }

    logger.info('Examples selected by semantic similarity', {
      count: relevantExamples.length,
      scores: relevantExamples.map(ex => ex.similarityScore),
      selectionTimeMs
    })

    return {
      examples: relevantExamples,
      method: 'semantic',
      selectionTimeMs
    }
  } catch (error) {
    logger.error('Semantic selection failed, using fallback', { error })
    return selectExamplesFallback(category, Date.now() - startTime)
  }
}

/**
 * Fallback example selection (random from category)
 *
 * @param category Category to select from
 * @param elapsedTimeMs Time already elapsed
 * @returns Selected examples
 */
async function selectExamplesFallback(
  category?: string,
  elapsedTimeMs = 0
): Promise<ExampleSelectionResult> {
  const startTime = Date.now()

  try {
    // Get all examples from category (or random category if not specified)
    const query = category
      ? db
          .select()
          .from(few_shot_examples)
          .where(eq(few_shot_examples.category, category))
      : db.select().from(few_shot_examples)

    const allExamples = await query

    if (allExamples.length === 0) {
      return {
        examples: [],
        method: 'fallback',
        selectionTimeMs: Date.now() - startTime + elapsedTimeMs
      }
    }

    // Shuffle and take top N
    const shuffled = [...allExamples].sort(() => Math.random() - 0.5)
    const selected = shuffled.slice(0, MAX_EXAMPLES)

    const examplesWithScores = selected.map(ex => ({
      ...ex,
      similarityScore: 0 // No similarity score for fallback
    }))

    logger.info('Examples selected by fallback', {
      count: examplesWithScores.length,
      category
    })

    return {
      examples: examplesWithScores,
      method: 'fallback',
      selectionTimeMs: Date.now() - startTime + elapsedTimeMs
    }
  } catch (error) {
    logger.error('Fallback selection failed', { error })
    return {
      examples: [],
      method: 'fallback',
      selectionTimeMs: Date.now() - startTime + elapsedTimeMs
    }
  }
}

/**
 * Format examples for prompt injection
 *
 * @param examples Examples to format
 * @returns Formatted examples text
 */
export function formatExamplesForPrompt(examples: ExampleWithScore[]): string {
  if (examples.length === 0) {
    return ''
  }

  const formattedExamples = examples.map((ex, index) => {
    return `
EXAMPLE ${index + 1} (${ex.category}):

USER PROMPT: "${ex.prompt}"

GOOD OUTPUT:
\`\`\`jsx
${ex.good_output}
\`\`\`

WHY THIS IS GOOD: ${ex.explanation}
`
  })

  return `
FEW-SHOT EXAMPLES:
The following examples demonstrate best practices for generating React components:

${formattedExamples.join('\n---\n')}

Follow these patterns and best practices in your generated code.
`
}
