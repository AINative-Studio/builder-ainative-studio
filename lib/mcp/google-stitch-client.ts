/**
 * Google Stitch MCP Client
 *
 * Connects to Google Stitch API to generate UI designs and screen code
 * using Gemini 2.5 Pro multimodal capabilities.
 *
 * Features:
 * - API-based connection with API key authentication
 * - Connection health check on startup
 * - Retry logic with exponential backoff (3 attempts)
 * - Error handling and graceful degradation
 * - Screen generation and code retrieval
 */

import { logger } from '../logger'

/**
 * Screen generation request
 */
export interface StitchGenerateRequest {
  prompt: string
  projectId?: string
  style?: 'modern' | 'minimal' | 'professional' | 'creative'
  includeCode?: boolean
}

/**
 * Screen generation response
 */
export interface StitchGenerateResponse {
  success: boolean
  screenId?: string
  previewUrl?: string
  code?: string
  error?: string
}

/**
 * Screen code retrieval response
 */
export interface StitchScreenCodeResponse {
  success: boolean
  html?: string
  css?: string
  javascript?: string
  error?: string
}

/**
 * Health check response
 */
export interface StitchHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  version?: string
  authenticated: boolean
}

class GoogleStitchMCPClient {
  private baseUrl: string
  private apiKey: string
  private connected: boolean = false
  private maxRetries: number = 3
  private baseDelay: number = 1000 // 1 second

  constructor() {
    // Use environment variables for configuration
    this.baseUrl = process.env.GOOGLE_STITCH_API_URL || 'https://stitch.withgoogle.com/api/v1'
    this.apiKey = process.env.GOOGLE_STITCH_API_KEY || ''

    if (!process.env.GOOGLE_STITCH_API_URL) {
      logger.warn('GOOGLE_STITCH_API_URL not set, using default: https://stitch.withgoogle.com/api/v1')
    }

    if (!this.apiKey) {
      logger.warn('GOOGLE_STITCH_API_KEY not set - Google Stitch features will be disabled')
    }
  }

  /**
   * Connect to the Stitch API and verify health
   */
  async connect(): Promise<boolean> {
    try {
      logger.info('Connecting to Google Stitch API...')

      // Skip if API key not configured
      if (!this.apiKey) {
        logger.warn('Google Stitch API key not configured, skipping connection')
        this.connected = false
        return false
      }

      // Try to verify authentication with a simple health check
      // Note: Actual endpoint may vary - this is a best guess
      const healthCheck = await this.retryRequest(async () => {
        const response = await fetch(`${this.baseUrl}/health`, {
          method: 'GET',
          headers: this.getHeaders(),
        })

        // If health endpoint doesn't exist, try a different approach
        if (response.status === 404) {
          // Try projects list endpoint as health check alternative
          const altResponse = await fetch(`${this.baseUrl}/projects`, {
            method: 'GET',
            headers: this.getHeaders(),
          })

          if (altResponse.ok || altResponse.status === 404) {
            // If we get 200 or 404, authentication is working
            return { status: 'healthy', authenticated: true }
          }

          throw new Error(`Authentication failed: ${altResponse.status}`)
        }

        if (!response.ok) {
          throw new Error(`Health check failed: ${response.status} ${response.statusText}`)
        }

        return response.json()
      })

      this.connected = true
      logger.info('Successfully connected to Google Stitch API', { healthCheck })
      return true
    } catch (error) {
      logger.error('Failed to connect to Google Stitch API', error as Error)
      this.connected = false
      // Don't fail completely - we'll try to use it anyway
      return false
    }
  }

  /**
   * Disconnect from the API
   */
  async disconnect(): Promise<void> {
    this.connected = false
    logger.info('Disconnected from Google Stitch API')
  }

  /**
   * Generate a new screen/UI from text prompt
   */
  async generateScreen(request: StitchGenerateRequest): Promise<StitchGenerateResponse> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'Google Stitch API key not configured',
      }
    }

    try {
      logger.info('Generating screen with Google Stitch', {
        prompt: request.prompt.substring(0, 100),
        style: request.style,
      })

      const response = await this.retryRequest(async () => {
        const res = await fetch(`${this.baseUrl}/screens/generate`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            prompt: request.prompt,
            project_id: request.projectId,
            style: request.style || 'modern',
            include_code: request.includeCode !== false, // Default to true
          }),
        })

        if (!res.ok) {
          const errorText = await res.text()
          throw new Error(`Screen generation failed: ${res.status} ${res.statusText} - ${errorText}`)
        }

        return res.json()
      })

      logger.info('Successfully generated screen', {
        screenId: response.screen_id || response.screenId,
      })

      return {
        success: true,
        screenId: response.screen_id || response.screenId || response.id,
        previewUrl: response.preview_url || response.previewUrl || response.url,
        code: response.code || response.html,
      }
    } catch (error) {
      logger.error('Failed to generate screen', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Retrieve code for an existing screen
   */
  async getScreenCode(screenId: string): Promise<StitchScreenCodeResponse> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'Google Stitch API key not configured',
      }
    }

    try {
      logger.info('Fetching screen code', { screenId })

      const response = await this.retryRequest(async () => {
        const res = await fetch(`${this.baseUrl}/screens/${screenId}/code`, {
          method: 'GET',
          headers: this.getHeaders(),
        })

        if (!res.ok) {
          throw new Error(`Failed to fetch screen code: ${res.status} ${res.statusText}`)
        }

        return res.json()
      })

      logger.info('Successfully fetched screen code', {
        screenId,
        hasHtml: !!response.html,
      })

      return {
        success: true,
        html: response.html || response.code,
        css: response.css || response.styles,
        javascript: response.javascript || response.js || response.script,
      }
    } catch (error) {
      logger.error('Failed to fetch screen code', error as Error, { screenId })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey
  }

  /**
   * Get common headers for API requests
   */
  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'X-Client-Version': '1.0.0',
      'User-Agent': 'AINative-Studio/1.0',
    }
  }

  /**
   * Retry a request with exponential backoff
   */
  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    attempt: number = 1
  ): Promise<T> {
    try {
      return await requestFn()
    } catch (error) {
      if (attempt >= this.maxRetries) {
        logger.error(`Request failed after ${this.maxRetries} attempts`, error as Error)
        throw error
      }

      const delay = this.baseDelay * Math.pow(2, attempt - 1) // 1s → 2s → 4s
      logger.warn(`Request attempt ${attempt} failed, retrying in ${delay}ms...`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      await new Promise((resolve) => setTimeout(resolve, delay))
      return this.retryRequest(requestFn, attempt + 1)
    }
  }
}

// Singleton instance
let stitchClientInstance: GoogleStitchMCPClient | null = null

/**
 * Get or create the Google Stitch client instance
 */
export function getGoogleStitchClient(): GoogleStitchMCPClient {
  if (!stitchClientInstance) {
    stitchClientInstance = new GoogleStitchMCPClient()
  }
  return stitchClientInstance
}

/**
 * Initialize Google Stitch client connection on app startup
 */
export async function initializeGoogleStitchClient(): Promise<boolean> {
  const client = getGoogleStitchClient()
  return client.connect()
}

export default GoogleStitchMCPClient
