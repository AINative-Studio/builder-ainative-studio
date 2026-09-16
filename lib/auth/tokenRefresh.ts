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
 *
 * Real bug fixed live (#792, found investigating #778): a credential row
 * with NO stored `expiresAt` at all used to return `false` here — "assume
 * it's fine forever" — meaning it was NEVER proactively refreshed no matter
 * how old it actually was. This exactly matches every credential captured
 * before the #443/#664 fix started actually populating `expiresAt` (that
 * fix's own doc comment: "25/25 real stored credentials across every
 * company/primitive have NEITHER field"). Confirmed live: Fieldko's stored
 * `zerocrm` credential was genuinely dead (core's own `/api/v1/auth/me`
 * returned `401 AUTH_TOKEN_INVALID` when called with it directly) yet
 * `resolveFounderCredential` (no forceRefresh) happily returned it as if it
 * were valid. A missing `expiresAt` means "we don't know" — the safe
 * default is to assume a refresh IS needed, not that the token is eternal,
 * matching the same conservative-refresh philosophy provision/route.ts's
 * own `ASSUMED_TOKEN_LIFETIME_SECONDS` fallback already uses for this exact
 * "core's real response has no expires_in field" gap.
 */
export function shouldRefreshToken(expiresAt: number | undefined): boolean {
  if (!expiresAt) return true
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
