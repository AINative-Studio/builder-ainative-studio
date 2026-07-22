/**
 * Thin authenticated fetch wrapper for the AINative core API.
 * Uses the caller's AINative access token (the same JWT stored on the NextAuth
 * session, see app/(auth)/auth.ts) as a Bearer credential — identical to the
 * pattern in app/api/credits/route.ts.
 */
import { AINATIVE_API_BASE_URL } from '@/lib/constants'
import { AINativeApiError } from './types'

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** AbortSignal timeout in ms (default 20s). */
  timeoutMs?: number
}

export async function ainativeFetch<T>(
  path: string,
  accessToken: string,
  { method = 'GET', body, timeoutMs = 20_000 }: RequestOptions = {},
): Promise<T> {
  if (!accessToken) {
    throw new AINativeApiError('Missing AINative access token', 401)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${AINATIVE_API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const text = await res.text()
    const parsed = text ? safeJson(text) : null

    if (!res.ok) {
      const detail =
        (parsed && typeof parsed === 'object' && 'detail' in parsed
          ? String((parsed as any).detail)
          : null) || `AINative API ${method} ${path} failed`
      throw new AINativeApiError(detail, res.status, parsed)
    }

    return parsed as T
  } catch (err) {
    if (err instanceof AINativeApiError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AINativeApiError(`AINative API ${method} ${path} timed out`, 504)
    }
    throw new AINativeApiError(
      err instanceof Error ? err.message : 'AINative API request failed',
      502,
    )
  } finally {
    clearTimeout(timer)
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
