/**
 * /api/build/media/upload (#323 / GR-14) — upload your OWN photos into the
 * company's media library, alongside the auto-generated assets (#54).
 *
 *   POST multipart { file, companyId } → { url, asset? }
 *   GET  ?id={fileId}                  → 302 to a fresh presigned bucket URL
 *
 * POST requires a REAL signed-in account (same gate as redeploy/migrate —
 * anonymous and guest sessions get 401): a founder's photos are durable company
 * property, so they must never land under a throwaway guest scope. Validation
 * (images only: png/jpg/jpeg/webp/svg, max 5MB) is the pure media-upload module —
 * the same rules the panel runs client-side. Bytes go to the project's ZeroDB
 * file storage and the asset row goes through the SAME saveAsset/build_media
 * store the generated media pipeline uses (provider 'upload' marks it as yours),
 * so uploads appear in the MediaPanel list next to Cody's without a second store.
 *
 * GET is the durable serve path: bucket presigns expire, so the stored asset url
 * points here and we redirect to a fresh presign per request. File ids are
 * unguessable UUIDs and only accepted image types are ever served.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import { saveAsset, uploadMediaFile, fetchFileDownload } from '@/lib/build/media-schedule'
import {
  validateUpload,
  buildUploadKey,
  uploadedAssetUrl,
  isFileId,
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOAD_PROVIDER,
} from '@/lib/build/media-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // Uploads must never be anonymous — a guest scope evaporates; photos don't.
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
  const scopeKey = chatScopeKey(deriveOwnerKey(session as any), companyId)

  const file = form.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'no_file' }, { status: 400 })
  }

  // Pure validation — type (png/jpg/jpeg/webp/svg) + size (≤5MB).
  const verdict = validateUpload({ name: file.name, type: file.type, size: file.size })
  if (!verdict.ok) {
    return Response.json({ error: verdict.error, message: verdict.message }, { status: 400 })
  }

  // Trust the actual bytes over the reported size.
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: 'too_large', message: 'That photo is over 5MB — export a smaller version and try again.' },
      { status: 400 },
    )
  }

  // Bytes → the project's ZeroDB file storage, scoped under uploads/{scope-hash}/.
  const fileId = await uploadMediaFile({
    bytes,
    key: buildUploadKey(scopeKey, verdict.fileName),
    contentType: verdict.contentType,
  })
  if (!fileId) {
    return Response.json({ error: 'upload_failed', message: 'I couldn’t store that photo — try again shortly.' }, { status: 502 })
  }

  // Asset row → the SAME build_media store the generated pipeline writes to.
  const url = uploadedAssetUrl(fileId)
  const asset = await saveAsset(scopeKey, {
    mediaKind: 'image',
    url,
    prompt: `Uploaded photo: ${verdict.fileName}`,
    provider: UPLOAD_PROVIDER,
  })

  // The file exists and its url works even if the row write hiccuped — return the
  // url either way and be honest about whether it will show in the list.
  return Response.json({ url, asset: asset || undefined, saved: Boolean(asset) })
}

/** Serve an uploaded asset: redirect to a fresh presigned bucket URL. */
export async function GET(request: NextRequest) {
  const fileId = String(request.nextUrl.searchParams.get('id') || '').trim()
  if (!isFileId(fileId)) return Response.json({ error: 'bad_id' }, { status: 400 })

  const download = await fetchFileDownload(fileId)
  if (!download) return Response.json({ error: 'not_found' }, { status: 404 })
  // Only ever serve the accepted image types — this route is for photos, not a
  // general file proxy.
  if (!(download.contentType in ALLOWED_IMAGE_TYPES)) {
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
