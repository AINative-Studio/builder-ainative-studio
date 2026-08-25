/**
 * /api/build/secrets (#63.B) — runtime secrets / env vars for a company's app.
 *
 * View / add / edit / delete the environment variables the founder's DEPLOYED app
 * reads at runtime (API keys + credentials), persisted as Railway service variables
 * on the company's per-company service.
 *
 * SECURITY:
 *  - Owner-only: a REAL (non-guest) session that OWNS the company. Secrets are the
 *    keys to the founder's app — never readable/writable cross-owner or by a guest.
 *  - Values are MASKED on read (maskSecrets) — the plaintext never leaves the server.
 *  - Values are NEVER logged (we log the variable NAME + action only).
 *  - Platform-reserved variables (COMPANY_SLUG / ZERODB_PROJECT_ID) are read-only.
 *
 *   GET    ?companyId=…                 → { ok, secrets: MaskedSecret[] }
 *   POST   { companyId, name, value }   → { ok }            (add or edit)
 *   DELETE { companyId, name }          → { ok }            (delete)
 *
 * AX (#63): agent-accessible — a founder's agent can manage its app's secrets.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey } from '@/lib/build/chat-store'
import { resolveApp, type AppEntry } from '@/lib/build/app-registry'
import {
  listServiceVariables,
  upsertServiceVariable,
  deleteServiceVariable,
  maskSecrets,
  isValidSecretName,
  isReservedSecretName,
} from '@/lib/build/railway-deploy'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Resolve + authorize the company for the current session. Returns the entry on
 * success, or a Response to short-circuit with (401/403/404/400). Shared by all
 * three verbs so the owner-only + service checks are identical.
 */
async function authorizeCompany(
  session: unknown,
  companyId: string,
): Promise<{ entry: AppEntry; serviceId: string } | Response> {
  const type = (session as any)?.user?.type as string | undefined
  const email = (session as any)?.user?.email as string | undefined
  if (!email || type === 'guest') {
    return Response.json({ error: 'not_signed_in' }, { status: 401 })
  }
  if (!companyId) return Response.json({ error: 'companyId required' }, { status: 400 })

  const entry = await resolveApp(companyId).catch(() => null)
  if (!entry) return Response.json({ error: 'company not found' }, { status: 404 })

  const owner = deriveOwnerKey(session as any)
  if (!entry.ownerEmail || entry.ownerEmail.trim().toLowerCase() !== owner) {
    return Response.json({ error: 'not_owner' }, { status: 403 })
  }
  const serviceId = entry.railwayServiceId
  if (!serviceId) {
    return Response.json({ error: 'no dedicated service for secrets' }, { status: 400 })
  }
  return { entry, serviceId }
}

/** GET — list the app's runtime secrets, MASKED. */
export async function GET(request: NextRequest) {
  const session = await auth().catch(() => null)
  const companyId = String(request.nextUrl.searchParams.get('companyId') || request.nextUrl.searchParams.get('slug') || '').slice(0, 80).trim()
  const authed = await authorizeCompany(session, companyId)
  if (authed instanceof Response) return authed

  const result = await listServiceVariables(authed.serviceId)
  if (!result.ok) {
    // Disabled/unconfigured Railway → honest empty list, not an error, so the panel
    // renders with a "no secrets yet / not available in this environment" state.
    return Response.json({ ok: true, secrets: [], available: false, reason: result.reason })
  }
  return Response.json({ ok: true, secrets: maskSecrets(result.variables), available: true })
}

/** POST — add or edit a runtime secret. Value is never logged. */
export async function POST(request: NextRequest) {
  const session = await auth().catch(() => null)
  const body = await request.json().catch(() => null)
  const companyId = String(body?.companyId || body?.slug || '').slice(0, 80).trim()
  const name = String(body?.name || '').trim()
  const value = typeof body?.value === 'string' ? body.value : ''

  const authed = await authorizeCompany(session, companyId)
  if (authed instanceof Response) return authed

  if (!isValidSecretName(name)) return Response.json({ error: 'invalid name' }, { status: 400 })
  if (isReservedSecretName(name)) return Response.json({ error: 'reserved name' }, { status: 400 })

  const result = await upsertServiceVariable(authed.serviceId, name, value)
  if (!result.ok) {
    logger.error('secret upsert failed', new Error(result.reason || 'upsert failed'))
    return Response.json({ error: result.reason || 'could not save secret' }, { status: 502 })
  }
  // Log the NAME + action only — NEVER the value.
  logger.info('secret upserted', { companyId, name })
  return Response.json({ ok: true })
}

/** DELETE — remove a runtime secret. */
export async function DELETE(request: NextRequest) {
  const session = await auth().catch(() => null)
  const body = await request.json().catch(() => null)
  const companyId = String(body?.companyId || body?.slug || '').slice(0, 80).trim()
  const name = String(body?.name || '').trim()

  const authed = await authorizeCompany(session, companyId)
  if (authed instanceof Response) return authed

  if (!isValidSecretName(name)) return Response.json({ error: 'invalid name' }, { status: 400 })
  if (isReservedSecretName(name)) return Response.json({ error: 'reserved name' }, { status: 400 })

  const result = await deleteServiceVariable(authed.serviceId, name)
  if (!result.ok) {
    logger.error('secret delete failed', new Error(result.reason || 'delete failed'))
    return Response.json({ error: result.reason || 'could not delete secret' }, { status: 502 })
  }
  logger.info('secret deleted', { companyId, name })
  return Response.json({ ok: true })
}
