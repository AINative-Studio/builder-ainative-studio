/**
 * /api/build/documents/upload (#399) — upload a reference document (PDF/TXT/MD/
 * DOC/DOCX/CSV) into the company's workspace.
 *
 *   POST multipart { file, companyId } → { url, document? }
 *   GET  ?id={fileId}                  → 302 to a fresh presigned bucket URL
 *
 * WHY: Cody's own chat responses (app/api/build/ask/route.ts) reference the
 * founder dropping reference docs into the workspace — investigated this
 * session and confirmed there is no hardcoded "drop docs" string to edit; it's
 * emergent LLM phrasing referencing a capability that genuinely didn't exist.
 * This route is that capability, mirroring app/api/build/media/upload/route.ts's
 * exact auth + storage pattern for image uploads, generalized to documents.
 *
 * POST requires a REAL signed-in account (same gate as media upload/redeploy/
 * migrate — anonymous and guest sessions get 401): an uploaded reference doc is
 * durable company property, so it must never land under a throwaway guest scope.
 * Validation (accepted types, 10MB max) is the pure document-upload module — see
 * lib/build/document-upload.ts. Bytes go to the project's ZeroDB file storage
 * (media-schedule.ts's uploadMediaFile — already fully generic, no new storage
 * transport needed) and a lightweight reference row goes into the SAME
 * build_documents store the Documents panel already lists (document-store.ts),
 * so an uploaded doc appears in the founder's real Documents library next to
 * Cody's generated Research/Roadmap/Mission entries — no new UI surface needed.
 *
 * GET is the durable serve path: bucket presigns expire, so the stored file's
 * url points here and we redirect to a fresh presign per request. File ids are
 * unguessable UUIDs and only accepted document types are ever served.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import { uploadMediaFile, fetchFileDownload } from '@/lib/build/media-schedule'
import { createDocument } from '@/lib/build/document-store'
import {
  validateDocumentUpload,
  buildDocumentUploadKey,
  uploadedDocumentUrl,
  documentRowForUpload,
  isDocumentFileId,
  UPLOADED_DOC_TYPE,
  MAX_DOCUMENT_UPLOAD_BYTES,
} from '@/lib/build/document-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // Uploads must never be anonymous — a guest scope evaporates; reference docs don't.
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

  // Pure validation — accepted document types + size ceiling.
  const verdict = validateDocumentUpload({ name: file.name, type: file.type, size: file.size })
  if (!verdict.ok) {
    return Response.json({ error: verdict.error, message: verdict.message }, { status: 400 })
  }

  // Trust the actual bytes over the reported size.
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_UPLOAD_BYTES) {
    return Response.json(
      { error: 'too_large', message: 'That file is over 10MB — trim it down and try again.' },
      { status: 400 },
    )
  }

  // Bytes → the project's ZeroDB file storage, scoped under doc-uploads/{scope-hash}/.
  const fileId = await uploadMediaFile({
    bytes,
    key: buildDocumentUploadKey(scopeKey, verdict.fileName),
    contentType: verdict.contentType,
  })
  if (!fileId) {
    return Response.json({ error: 'upload_failed', message: 'I couldn’t store that file — try again shortly.' }, { status: 502 })
  }

  // Reference row → the SAME build_documents store the Documents panel already
  // lists (best-effort — a row-write hiccup must never hide that the file itself
  // uploaded successfully; the url below works either way).
  const url = uploadedDocumentUrl(fileId)
  const { title, content } = documentRowForUpload({ fileName: verdict.fileName, url, sizeBytes: bytes.byteLength })
  const document = await createDocument(scopeKey, { title, content, type: UPLOADED_DOC_TYPE })

  return Response.json({ url, document: document || undefined, saved: Boolean(document) })
}

/** Serve an uploaded document: redirect to a fresh presigned bucket URL. */
export async function GET(request: NextRequest) {
  const id = String(request.nextUrl.searchParams.get('id') || '').trim()
  if (!isDocumentFileId(id)) {
    return Response.json({ error: 'invalid_id' }, { status: 400 })
  }
  const download = await fetchFileDownload(id)
  if (!download?.url) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return Response.redirect(download.url, 302)
}
