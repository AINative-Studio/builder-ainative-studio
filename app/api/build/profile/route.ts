/**
 * /api/build/profile (#57) — read + save the signed-in founder's editable profile
 * (full name, email, optional social handle, content language) against the REAL
 * AINative account (core /api/v1/auth/me), so settings persist across reloads.
 *
 *   GET  → { profile } for the signed-in user (loaded from core).
 *   POST → validate + persist { fullName, email, social?, contentLanguage } to core.
 *
 * Auth: a real (non-guest) session is required — a guest has no durable account to
 * save to (respects #50's honest guest handling; the UI shows the create-account
 * prompt instead of the form). The access token comes from the SERVER session only.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { AINativeApiError } from '@/lib/ainative/types'
import { validateProfileInput, loadCoreProfile, updateCoreProfile } from '@/lib/build/profile'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Resolve a real (non-guest) session's access token, or null. */
async function realSessionToken(): Promise<string | null> {
  const session = await auth().catch(() => null)
  const type = (session as any)?.user?.type as string | undefined
  const token = (session as any)?.accessToken as string | undefined
  if (!token || type === 'guest') return null
  return token
}

export async function GET() {
  const token = await realSessionToken()
  if (!token) return Response.json({ error: 'not_signed_in' }, { status: 401 })
  try {
    const profile = await loadCoreProfile(token)
    return Response.json({ profile })
  } catch (e) {
    const status = e instanceof AINativeApiError ? e.status : 502
    // Never log the token; log only a short, safe message.
    logger.error('profile load failed', e as Error)
    return Response.json({ error: 'could not load profile' }, { status })
  }
}

export async function POST(request: NextRequest) {
  const token = await realSessionToken()
  if (!token) return Response.json({ error: 'not_signed_in' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const validation = validateProfileInput(body)
  if (!validation.ok || !validation.value) {
    return Response.json({ error: 'invalid_profile', fields: validation.errors }, { status: 400 })
  }

  try {
    const profile = await updateCoreProfile(token, validation.value)
    return Response.json({ ok: true, profile })
  } catch (e) {
    const status = e instanceof AINativeApiError ? e.status : 502
    logger.error('profile save failed', e as Error)
    // Surface core's message when it's a client error (e.g. email already taken),
    // but never echo anything token-shaped.
    const detail =
      e instanceof AINativeApiError && status < 500 ? e.message.slice(0, 160) : 'could not save profile'
    return Response.json({ error: detail }, { status })
  }
}
