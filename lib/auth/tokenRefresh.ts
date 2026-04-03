/**
 * Token refresh utility for AINative authentication.
 * Proactively refreshes tokens before expiry.
 * Ported from cody-cli patterns (src/bridge/jwtUtils.ts)
 */

const REFRESH_BUFFER_MS = 5 * 60 * 1000 // 5 minutes before expiry
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

interface TokenInfo {
  accessToken: string
  refreshToken?: string
  expiresAt?: number // Unix timestamp in ms
}

interface RefreshResult {
  accessToken: string
  refreshToken?: string
  expiresIn?: number // seconds
}

/**
 * Check if a token should be refreshed (within 5 min of expiry).
 */
export function shouldRefreshToken(expiresAt: number | undefined): boolean {
  if (!expiresAt) return false
  return Date.now() >= expiresAt - REFRESH_BUFFER_MS
}

/**
 * Refresh an AINative token with exponential backoff.
 */
export async function refreshAINativeToken(
  refreshToken: string,
  apiUrl?: string,
): Promise<RefreshResult | null> {
  const baseUrl = apiUrl || process.env.AINATIVE_API_URL || 'https://api.ainative.studio'

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })

      if (!response.ok) {
        if (response.status === 401) {
          // Refresh token is invalid/expired - can't recover
          return null
        }
        throw new Error(`Refresh failed with status ${response.status}`)
      }

      const data = await response.json()
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      }
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES - 1
      if (isLastAttempt) {
        console.error('[token-refresh] All retries exhausted:', error)
        return null
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  return null
}

/**
 * Proactively refresh a token if it's close to expiry.
 * Returns the original token info if no refresh is needed,
 * or updated token info after a successful refresh.
 */
export async function maybeRefreshToken(token: TokenInfo): Promise<TokenInfo> {
  if (!shouldRefreshToken(token.expiresAt)) {
    return token
  }

  if (!token.refreshToken) {
    return token
  }

  const result = await refreshAINativeToken(token.refreshToken)
  if (!result) {
    return token // Keep existing token, will fail on next API call
  }

  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken || token.refreshToken,
    expiresAt: result.expiresIn
      ? Date.now() + result.expiresIn * 1000
      : token.expiresAt,
  }
}
