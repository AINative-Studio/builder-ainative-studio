/**
 * /api/build/ask/attachment (#741) — upload a file the founder wants to share
 * with Cody directly IN the chat, distinct from the Media/Documents side-panel
 * uploads (`app/api/build/media/upload`, `app/api/build/documents/upload`),
 * which land in those panels rather than the conversation itself.
 *
 *   POST multipart { file, companyId, chatId? } → { fileId, url, contentType, fileName }
 *
 * Reuses the SAME real upload infrastructure those two routes use — no new
 * storage mechanism: `validateChatAttachment` (lib/build/chat-attachment.ts,
 * itself delegating to the exact `validateUpload`/`validateDocumentUpload`
 * rules those routes enforce) then `uploadMediaFile` (lib/build/media-schedule.ts)
 * for the real ZeroDB file-storage transport. The returned `fileId`/`url` are
 * later resolved back to bytes (images only, for real Anthropic multimodal
 * content blocks) or referenced by name (documents) in `/api/build/ask`.
 *
 * POST requires a REAL signed-in account — identical 401-for-anon/guest gate
 * as `media/upload/route.ts`: a chat attachment is durable company data (it's
 * persisted on the chat turn), never throwaway guest state.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import { uploadMediaFile } from '@/lib/build/media-schedule'
import { validateChatAttachment } from '@/lib/build/chat-attachment'
import { buildUploadKey, uploadedAssetUrl, MAX_UPLOAD_BYTES } from '@/lib/build/media-upload'
import { buildDocumentUploadKey, uploadedDocumentUrl, MAX_DOCUMENT_UPLOAD_BYTES } from '@/lib/build/document-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // Attachments must never be anonymous — a guest scope evaporates; a chat
  // attachment persisted on a turn is durable company data.
  const session = await auth().catch(() => null)
  const email = (session as any)?.user?.email as string | undefined
  const type = (session as any)?.user?.type as string | undefined
  if (!email || type === 'guest') {
    return Response.json({ error: 'not_signed_in' }, { status: 401 })
  }

  const form = await request.formData().catch(() => null)
  if (!form) return Response.json({ error: 'invalid_form' }, { status: 400 })

  // Scoped identically to media/upload's scopeKey derivation — chatId wins
  // over companyId when present, matching /api/build/ask's own precedence
  // (a company with multiple build threads keeps attachments distinct).
  const companyId = String(form.get('chatId') || form.get('companyId') || '').slice(0, 80).trim()
  if (!companyId) return Response.json({ error: 'missing_company' }, { status: 400 })
  const scopeKey = chatScopeKey(deriveOwnerKey(session as any), companyId)

  const file = form.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'no_file' }, { status: 400 })
  }

  // Pure validation — image (png/jpg/jpeg/webp/svg, ≤5MB) OR document
  // (pdf/txt/md/doc/docx/csv, ≤10MB), the exact rules the two existing panels
  // already enforce.
  const verdict = validateChatAttachment({ name: file.name, type: file.type, size: file.size })
  if (!verdict.ok) {
    return Response.json({ error: verdict.error, message: verdict.message }, { status: 400 })
  }

  const maxBytes = verdict.kind === 'document' ? MAX_DOCUMENT_UPLOAD_BYTES : MAX_UPLOAD_BYTES
  // Trust the actual bytes over the reported size.
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    return Response.json(
      { error: 'too_large', message: `That file is over ${Math.round(maxBytes / (1024 * 1024))}MB — try a smaller one.` },
      { status: 400 },
    )
  }

  // Bytes → the project's ZeroDB file storage. Distinct key prefix per kind
  // (chat-uploads/ vs doc-chat-uploads/) so chat attachments never collide
  // with the Media/Documents panels' own uploads/ and doc-uploads/ prefixes,
  // even though all three share the same underlying files bucket/API.
  const key = verdict.kind === 'document'
    ? `doc-${buildDocumentUploadKey(scopeKey, verdict.fileName)}`
    : `chat-${buildUploadKey(scopeKey, verdict.fileName)}`
  const fileId = await uploadMediaFile({ bytes, key, contentType: verdict.contentType })
  if (!fileId) {
    return Response.json({ error: 'upload_failed', message: 'I couldn’t store that file — try again shortly.' }, { status: 502 })
  }

  const url = verdict.kind === 'document' ? uploadedDocumentUrl(fileId) : uploadedAssetUrl(fileId)
  return Response.json({
    fileId,
    url,
    contentType: verdict.contentType,
    fileName: verdict.fileName,
  })
}
