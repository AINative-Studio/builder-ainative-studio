/**
 * Chat attachment validation + multimodal content-block building (#741) — the
 * PURE core behind "upload an image/document into the Cody chat".
 *
 * WHY: `components/build/screens/Live.tsx`'s chat had ZERO upload capability,
 * and the `/api/build/ask` system prompt explicitly told Cody "There is NO
 * in-chat file upload. This chat is text-only" — an intentional, documented
 * gap (#741). Real upload infrastructure already existed for the Media and
 * Documents panels (`lib/build/media-upload.ts`, `lib/build/document-upload.ts`,
 * `lib/build/media-schedule.ts`'s `uploadMediaFile`/`fetchFileDownload`) but was
 * never wired into the chat itself, and even once wired, the actual Claude
 * call built plain-string message content — no Anthropic multimodal image
 * blocks — so an "uploaded" image would still be invisible to Cody under the
 * hood. This module is the accept/reject decision for a chat attachment
 * (delegating to the SAME validators the Media/Documents routes use — no new
 * rules invented) plus the pure shaping of a resolved image into an Anthropic
 * `{type: 'image', source: {type: 'base64', ...}}` content block.
 *
 * The actual byte transport (uploading to ZeroDB file storage, resolving a
 * presigned download URL, fetching those bytes) stays real I/O in the route —
 * this module holds only the decisions that don't require a network, so they
 * are unit-testable without mocking fetch.
 */

import {
  validateUpload,
  ALLOWED_IMAGE_TYPES,
  type UploadValidation,
} from '@/lib/build/media-upload'
import {
  validateDocumentUpload,
  ALLOWED_DOCUMENT_TYPES,
  type DocumentUploadValidation,
} from '@/lib/build/document-upload'

/** A chat attachment as sent by the client / persisted on a turn (#741). */
export interface ChatAttachmentRef {
  fileId: string
  url: string
  contentType: string
  fileName: string
}

/** An Anthropic-compatible content block this module can produce. Mirrors the
 *  minimal shape chat-store.ts's ChatContentBlock declares (kept in sync by
 *  hand — neither module depends on the Anthropic SDK's own types). */
export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/**
 * Validate a chat-attachment upload candidate. Accepts EITHER an image
 * (`lib/build/media-upload.ts`'s rules) or a document
 * (`lib/build/document-upload.ts`'s rules) — the chat composer takes both, so
 * this tries image validation first (the common case) and falls back to
 * document validation, surfacing the document validator's rejection message
 * only when the file matched neither accepted set.
 */
export function validateChatAttachment(input: {
  name?: unknown
  type?: unknown
  size?: unknown
}): (UploadValidation | DocumentUploadValidation) & { kind?: 'image' | 'document' } {
  const image = validateUpload(input)
  if (image.ok) return { ...image, kind: 'image' }
  const doc = validateDocumentUpload(input)
  if (doc.ok) return { ...doc, kind: 'document' }
  // Neither validator accepted it — surface the document message since it
  // enumerates the broader accepted-type list (images are a subset of what
  // the chat composer accepts).
  return doc
}

/** Is this content type one of the accepted chat-attachment IMAGE types? */
export function isChatImageType(contentType: string): boolean {
  return String(contentType || '').toLowerCase() in ALLOWED_IMAGE_TYPES
}

/** Is this content type one of the accepted chat-attachment DOCUMENT types? */
export function isChatDocumentType(contentType: string): boolean {
  return String(contentType || '').toLowerCase() in ALLOWED_DOCUMENT_TYPES
}

/**
 * Build the Anthropic image content block for a resolved image attachment —
 * pure, given already-fetched base64 bytes (the route does the actual
 * fetch/encode). Returns null when the content type isn't an accepted image
 * type (defensive — the route should never call this for a non-image).
 */
export function buildImageContentBlock(contentType: string, base64Data: string): ChatContentBlock | null {
  if (!isChatImageType(contentType) || !base64Data) return null
  return { type: 'image', source: { type: 'base64', media_type: contentType, data: base64Data } }
}

/**
 * Build the text-mention block for a non-image document attachment — Cody
 * can't "see" a PDF/DOCX as an image block, so at minimum it's told the file
 * exists (name + type) and can engage with it conversationally (ask the
 * founder to describe/paste relevant content) instead of silently ignoring
 * it. Full document text-extraction is a scoped-out fast-follow (see #741).
 */
export function buildDocumentMentionBlock(attachment: ChatAttachmentRef): ChatContentBlock {
  return {
    type: 'text',
    text: `[The founder attached a document: "${attachment.fileName}" (${attachment.contentType}). ` +
      `I cannot read its contents directly yet — if I need specifics, ask the founder to paste the ` +
      `relevant text or describe what's in it.]`,
  }
}

/**
 * Resolve a list of chat attachments into Anthropic content blocks, given a
 * resolver function that fetches+base64-encodes an image attachment's bytes
 * (real I/O, injected so this stays testable). Image attachments that fail to
 * resolve (resolver returns null — e.g. the presign expired, or a transient
 * fetch failure) degrade to the same honest text-mention a document gets,
 * rather than silently dropping the attachment from Cody's context.
 */
export async function resolveAttachmentBlocks(
  attachments: ChatAttachmentRef[] | undefined,
  resolveImageBase64: (attachment: ChatAttachmentRef) => Promise<string | null>,
): Promise<ChatContentBlock[]> {
  const list = Array.isArray(attachments) ? attachments.filter((a) => a && a.fileId) : []
  const blocks: ChatContentBlock[] = []
  for (const attachment of list) {
    if (isChatImageType(attachment.contentType)) {
      const base64 = await resolveImageBase64(attachment).catch(() => null)
      const block = base64 ? buildImageContentBlock(attachment.contentType, base64) : null
      blocks.push(block || buildDocumentMentionBlock(attachment))
    } else {
      blocks.push(buildDocumentMentionBlock(attachment))
    }
  }
  return blocks
}
