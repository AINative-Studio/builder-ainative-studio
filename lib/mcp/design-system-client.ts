/**
 * Design System MCP Client (US-021)
 *
 * Connects to the Design System MCP server to extract design tokens
 * from templates and validate token structures.
 *
 * Features:
 * - API-based connection with authentication
 * - Connection health check on startup
 * - Retry logic with exponential backoff (3 attempts)
 * - Error handling and graceful degradation
 */

import { logger } from '../logger'

export interface DesignTokens {
  colors: {
    primary: string
    secondary: string
    accent?: string
    background?: string
    foreground?: string
    muted?: string
    destructive?: string
  }
  typography: {
    fontFamily: string
    sizes: {
      xs?: string
      sm?: string
      base?: string
      lg?: string
      xl?: string
      '2xl'?: string
      '3xl'?: string
    }
  }
  spacing: {
    baseUnit: string
    scale: number[]
  }
  borderRadius?: {
    sm?: string
    md?: string
    lg?: string
  }
}

export interface DesignTokensResponse {
  light: DesignTokens
  dark?: DesignTokens
}

export interface MCPExtractRequest {
  templateCode: string
  extractDarkMode?: boolean
}

export interface MCPValidateRequest {
  tokens: DesignTokensResponse
}

export interface MCPValidateResponse {
  valid: boolean
  errors?: string[]
}

class DesignSystemMCPClient {
  private baseUrl: string
  private apiKey: string
  private connected: boolean = false
  private maxRetries: number = 3
  private baseDelay: number = 1000 // 1 second

  constructor() {
    this.baseUrl = process.env.DESIGN_SYSTEM_MCP_URL || 'http://localhost:8001/extract'
    this.apiKey = process.env.DESIGN_SYSTEM_MCP_API_KEY || 'ds_mcp_secret_key'

    if (!process.env.DESIGN_SYSTEM_MCP_URL) {
      logger.warn('DESIGN_SYSTEM_MCP_URL not set, using default: http://localhost:8001/extract')
    }
  }

  /**
   * Connect to the MCP server and verify health
   */
  async connect(): Promise<boolean> {
    try {
      logger.info('Connecting to Design System MCP server...')

      const healthCheck = await this.retryRequest(async () => {
        const response = await fetch(`${this.getBaseEndpoint()}/health`, {
          method: 'GET',
          headers: this.getHeaders(),
        })

        if (!response.ok) {
          throw new Error(`Health check failed: ${response.status} ${response.statusText}`)
        }

        return response.json()
      })

      this.connected = true
      logger.info('Successfully connected to Design System MCP server', { healthCheck })
      return true
    } catch (error) {
      logger.error('Failed to connect to Design System MCP server', { error })
      this.connected = false
      return false
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    this.connected = false
    logger.info('Disconnected from Design System MCP server')
  }

  /**
   * Extract design tokens from template code
   */
  async extractTokens(templateCode: string, extractDarkMode: boolean = true): Promise<DesignTokensResponse | null> {
    if (!this.connected) {
      logger.warn('MCP client not connected, attempting to connect...')
      const connected = await this.connect()
      if (!connected) {
        logger.error('Cannot extract tokens: MCP client connection failed')
        return null
      }
    }

    try {
      const response = await this.retryRequest(async () => {
        const res = await fetch(this.baseUrl, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            templateCode,
            extractDarkMode,
          } as MCPExtractRequest),
        })

        if (!res.ok) {
          throw new Error(`Token extraction failed: ${res.status} ${res.statusText}`)
        }

        return res.json()
      })

      logger.info('Successfully extracted design tokens', {
        hasLight: !!response.light,
        hasDark: !!response.dark
      })

      return response as DesignTokensResponse
    } catch (error) {
      logger.error('Failed to extract design tokens', { error })
      return null
    }
  }

  /**
   * Validate design tokens structure
   */
  async validateTokens(tokens: DesignTokensResponse): Promise<MCPValidateResponse> {
    if (!this.connected) {
      logger.warn('MCP client not connected, attempting to connect...')
      const connected = await this.connect()
      if (!connected) {
        logger.error('Cannot validate tokens: MCP client connection failed')
        return { valid: false, errors: ['MCP client not connected'] }
      }
    }

    try {
      const response = await this.retryRequest(async () => {
        const res = await fetch(`${this.getBaseEndpoint()}/validate`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({ tokens } as MCPValidateRequest),
        })

        if (!res.ok) {
          throw new Error(`Token validation failed: ${res.status} ${res.statusText}`)
        }

        return res.json()
      })

      logger.info('Token validation complete', { valid: response.valid })

      return response as MCPValidateResponse
    } catch (error) {
      logger.error('Failed to validate design tokens', { error })
      return { valid: false, errors: ['Validation request failed'] }
    }
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Get base endpoint from URL (removes /extract suffix if present)
   */
  private getBaseEndpoint(): string {
    return this.baseUrl.replace(/\/extract$/, '')
  }

  /**
   * Get common headers for API requests
   */
  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'X-Client-Version': '1.0.0',
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
        logger.error(`Request failed after ${this.maxRetries} attempts`, { error })
        throw error
      }

      const delay = this.baseDelay * Math.pow(2, attempt - 1) // Exponential backoff
      logger.warn(`Request attempt ${attempt} failed, retrying in ${delay}ms...`, { error })

      await new Promise(resolve => setTimeout(resolve, delay))
      return this.retryRequest(requestFn, attempt + 1)
    }
  }
}

// Singleton instance
let mcpClientInstance: DesignSystemMCPClient | null = null

/**
 * Get or create the MCP client instance
 */
export function getMCPClient(): DesignSystemMCPClient {
  if (!mcpClientInstance) {
    mcpClientInstance = new DesignSystemMCPClient()
  }
  return mcpClientInstance
}

/**
 * Initialize MCP client connection on app startup
 */
export async function initializeMCPClient(): Promise<boolean> {
  const client = getMCPClient()
  return client.connect()
}

export default DesignSystemMCPClient
