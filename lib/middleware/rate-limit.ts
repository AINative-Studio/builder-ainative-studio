import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '../logger'

// Redis client for rate limiting (using Upstash Redis for Edge Runtime compatibility)
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null

// Create rate limiters with different limits
const generalRateLimit = redis
  ? new Ratelimit({
      redis: redis as any,
      limiter: Ratelimit.slidingWindow(100, '1 m'), // 100 requests per minute
      analytics: true,
      prefix: '@ratelimit/general',
    })
  : null

const generationRateLimit = redis
  ? new Ratelimit({
      redis: redis as any,
      limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute for generation
      analytics: true,
      prefix: '@ratelimit/generation',
    })
  : null

function getClientIP(request: NextRequest): string {
  // Try to get real IP from common headers
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const cfConnectingIp = request.headers.get('cf-connecting-ip')

  // Return first available IP
  if (cfConnectingIp) return cfConnectingIp
  if (realIp) return realIp
  if (forwarded) return forwarded.split(',')[0].trim()

  // Fallback to a default identifier
  return 'unknown'
}

export interface RateLimitConfig {
  limit: number
  remaining: number
  reset: number
  success: boolean
}

export async function applyRateLimit(
  request: NextRequest,
): Promise<{ success: boolean; response?: NextResponse }> {
  const pathname = request.nextUrl.pathname
  const method = request.method
  const ip = getClientIP(request)

  // Skip rate limiting in development if Redis is not configured
  if (!redis && process.env.NODE_ENV !== 'production') {
    return { success: true }
  }

  // If Redis is not configured in production, log error but allow request
  if (!redis) {
    logger.error('Redis not configured for rate limiting in production', undefined, {
      path: pathname,
      method,
      ip,
    })
    return { success: true }
  }

  try {
    // Determine which rate limiter to use
    const isGenerationEndpoint =
      pathname.includes('/api/chat') ||
      pathname.includes('/api/generate') ||
      pathname.includes('/api/chat-llama')

    const rateLimit = isGenerationEndpoint ? generationRateLimit : generalRateLimit
    const identifier = `${ip}:${isGenerationEndpoint ? 'generation' : 'general'}`

    if (!rateLimit) {
      logger.error('Rate limit not initialized', undefined, {
        path: pathname,
        method,
        ip,
      })
      return { success: true }
    }

    // Check rate limit
    const { success, limit, reset, remaining } = await rateLimit.limit(identifier)

    // Log rate limit check
    if (!success) {
      logger.warn('Rate limit exceeded', {
        ip,
        path: pathname,
        method,
        limit,
        remaining,
        reset,
        endpoint_type: isGenerationEndpoint ? 'generation' : 'general',
      })
    }

    // If rate limit exceeded, return 429 response
    if (!success) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000)

      return {
        success: false,
        response: NextResponse.json(
          {
            error: 'Too Many Requests',
            message: isGenerationEndpoint
              ? 'Generation rate limit exceeded. Please try again later.'
              : 'Rate limit exceeded. Please try again later.',
            limit,
            remaining: 0,
            reset: new Date(reset).toISOString(),
          },
          {
            status: 429,
            headers: {
              'Retry-After': retryAfter.toString(),
              'X-RateLimit-Limit': limit.toString(),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': new Date(reset).toISOString(),
            },
          },
        ),
      }
    }

    // Rate limit passed, add headers to response
    const response = NextResponse.next()
    response.headers.set('X-RateLimit-Limit', limit.toString())
    response.headers.set('X-RateLimit-Remaining', remaining.toString())
    response.headers.set('X-RateLimit-Reset', new Date(reset).toISOString())

    return { success: true, response }
  } catch (error) {
    // Log error but don't block request
    logger.error(
      'Rate limit check failed',
      error as Error,
      {
        path: pathname,
        method,
        ip,
      },
    )
    return { success: true }
  }
}

// Export rate limit status check for API routes
export async function getRateLimitStatus(
  identifier: string,
  type: 'general' | 'generation' = 'general',
): Promise<RateLimitConfig | null> {
  if (!redis) return null

  const rateLimit = type === 'generation' ? generationRateLimit : generalRateLimit
  if (!rateLimit) return null

  try {
    const result = await rateLimit.limit(identifier)
    return {
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
      success: result.success,
    }
  } catch (error) {
    logger.error('Failed to get rate limit status', error as Error, { identifier, type })
    return null
  }
}
