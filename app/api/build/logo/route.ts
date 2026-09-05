/**
 * /api/build/logo (#492) — upload the founder's OWN logo / brand mark, distinct
 * from Auto Media's general photo library (#54/#323).
 *
 *   POST multipart { file, companyId } → { url } | { error, message? }
 *   GET  ?companyId=…                  → { url } | { url: null }   (current logo)
 *   GET  ?id={fileId}                  → 302 to a fresh presigned bucket URL
 *
 * POST requires a REAL signed-in account that OWNS the company (same gate as
 * redeploy/secrets — #63) — a founder's brand mark is durable company property,
 * not a throwaway guest asset. Validation (images only: png/jpg/jpeg/webp/svg,
 * max 2MB) is the pure logo-upload module — the same rules the panel runs
 * client-side. Bytes go to the SAME ZeroDB file storage Auto Media already uses
 * (uploadMediaFile), but the resulting url is persisted directly on the
 * company's AppEntry (setAppLogo) rather than the shared build_media library —
 * a logo is a single, durable brand asset, not one photo among many.
 *
 * SCOPE (#492, documented honestly): this persists the upload and makes it
 * available to the founder's dashboard. It does NOT yet push the logo into an
 * already-deployed company's live generated site — see logo-upload.ts's header
 * comment for why that's separate, real infra work rather than something this
 * route can safely do today.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import { resolveApp, setAppLogo } from '@/lib/build/app-registry'
import { uploadMediaFile, fetchFileDownload } from '@/lib/build/media-schedule'
import {
  validateLogoUpload,
  buildLogoKey,
  logoAssetUrl,
  isFileId,
  ALLOWED_LOGO_TYPES,
  MAX_LOGO_BYTES,
} from '@/lib/build/logo-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET — the current logo url for a company, or a serve-redirect for a file id. */
export async function GET(request: NextRequest) {
  const fileId = String(request.nextUrl.searchParams.get('id') || '').trim()
  if (fileId) {
    if (!isFileId(fileId)) return Response.json({ error: 'bad_id' }, { status: 400 })
    const download = await fetchFileDownload(fileId)
    if (!download) return Response.json({ error: 'not_found' }, { status: 404 })
    if (!(download.contentType in ALLOWED_LOGO_TYPES)) {
      return Response.json({ error: 'unsupported_type' }, { status: 415 })
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: download.url,
        // Presigns expire — keep caching short so a stale redirect never sticks.
        'Cache-Control': 'private, max-age=300',
      },
    })
  }

  const companyId = String(request.nextUrl.searchParams.get('companyId') || '').slice(0, 80).trim()
  if (!companyId) return Response.json({ error: 'missing_company' }, { status: 400 })
  const entry = await resolveApp(companyId).catch(() => null)
  return Response.json({ url: entry?.logoUrl || null })
}

/** POST — upload a new logo and persist it as the company's brand mark. */
export async function POST(request: NextRequest) {
  // Uploads must never be anonymous — a guest scope evaporates; a brand mark doesn't.
  const session = await auth().catch(() => null)
  const email = (session as any)?.user?.email as string | undefined
  const type = (session as any)?.user?.type as string | undefined
  if (!email || type === 'guest') {
    return Response.json({ error: 'not_signed_in' }, { status: 401 })
  }

  const form = await request.formData().catch(() => null)
  if (!form) return Response.json({ error: 'invalid_form' }, { status: 400 })

  const companyId = String(form.get('companyId') || '').slice(0, 80).trim()
  if (!companyId) return Response.json({ error: 'missing_company' }, { status: 400 })

  // Owner-only: the signed-in account must own this company (mirrors redeploy/secrets).
  const entry = await resolveApp(companyId).catch(() => null)
  if (!entry) return Response.json({ error: 'company not found' }, { status: 404 })
  const owner = deriveOwnerKey(session as any)
  if (!entry.ownerEmail || entry.ownerEmail.trim().toLowerCase() !== owner) {
    return Response.json({ error: 'not_owner' }, { status: 403 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'no_file' }, { status: 400 })
  }

  // Pure validation — type (png/jpg/jpeg/webp/svg) + size (≤2MB).
  const verdict = validateLogoUpload({ name: file.name, type: file.type, size: file.size })
  if (!verdict.ok) {
    return Response.json({ error: verdict.error, message: verdict.message }, { status: 400 })
  }

  // Trust the actual bytes over the reported size.
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) {
    return Response.json(
      { error: 'too_large', message: 'That logo is over 2MB — export a smaller version and try again.' },
      { status: 400 },
    )
  }

  // Bytes → the project's ZeroDB file storage, scoped under logos/{scope-hash}/.
  const scopeKey = chatScopeKey(owner, companyId)
  const fileId = await uploadMediaFile({
    bytes,
    key: buildLogoKey(scopeKey, verdict.fileName),
    contentType: verdict.contentType,
  })
  if (!fileId) {
    return Response.json({ error: 'upload_failed', message: 'I couldn’t store that logo — try again shortly.' }, { status: 502 })
  }

  const url = logoAssetUrl(fileId)
  const saved = await setAppLogo(companyId, { logoUrl: url, logoFileId: fileId })

  // The file exists and its url works even if the registry write hiccuped —
  // return the url either way and be honest about whether it's durably saved.
  return Response.json({ url, saved })
}
