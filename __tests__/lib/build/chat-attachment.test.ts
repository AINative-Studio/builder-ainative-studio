import { describe, it, expect, vi } from 'vitest'
import {
  validateChatAttachment,
  isChatImageType,
  isChatDocumentType,
  buildImageContentBlock,
  buildDocumentMentionBlock,
  resolveAttachmentBlocks,
  type ChatAttachmentRef,
} from '@/lib/build/chat-attachment'

describe('validateChatAttachment (#741)', () => {
  it('accepts an image file and tags it kind: image', () => {
    const v = validateChatAttachment({ name: 'photo.png', type: 'image/png', size: 1024 })
    expect(v.ok).toBe(true)
    expect((v as any).kind).toBe('image')
  })

  it('accepts a document file and tags it kind: document', () => {
    const v = validateChatAttachment({ name: 'notes.pdf', type: 'application/pdf', size: 1024 })
    expect(v.ok).toBe(true)
    expect((v as any).kind).toBe('document')
  })

  it('rejects an unsupported file type', () => {
    const v = validateChatAttachment({ name: 'archive.zip', type: 'application/zip', size: 1024 })
    expect(v.ok).toBe(false)
  })

  it('rejects an empty file', () => {
    const v = validateChatAttachment({ name: 'photo.png', type: 'image/png', size: 0 })
    expect(v.ok).toBe(false)
  })

  it('rejects an oversized image (over the 5MB image ceiling) even though it would fit the 10MB doc ceiling', () => {
    const v = validateChatAttachment({ name: 'photo.png', type: 'image/png', size: 6 * 1024 * 1024 })
    expect(v.ok).toBe(false)
  })
})

describe('isChatImageType / isChatDocumentType', () => {
  it('classifies accepted image types', () => {
    expect(isChatImageType('image/png')).toBe(true)
    expect(isChatImageType('image/jpeg')).toBe(true)
    expect(isChatImageType('application/pdf')).toBe(false)
  })

  it('classifies accepted document types', () => {
    expect(isChatDocumentType('application/pdf')).toBe(true)
    expect(isChatDocumentType('text/csv')).toBe(true)
    expect(isChatDocumentType('image/png')).toBe(false)
  })
})

describe('buildImageContentBlock', () => {
  it('builds a real Anthropic image content block for an accepted image type', () => {
    const block = buildImageContentBlock('image/png', 'AAAA')
    expect(block).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    })
  })

  it('returns null for a non-image content type', () => {
    expect(buildImageContentBlock('application/pdf', 'AAAA')).toBeNull()
  })

  it('returns null when base64 data is empty', () => {
    expect(buildImageContentBlock('image/png', '')).toBeNull()
  })
})

describe('buildDocumentMentionBlock', () => {
  it('mentions the file name and type without fabricating content', () => {
    const attachment: ChatAttachmentRef = { fileId: 'f1', url: '/x', contentType: 'application/pdf', fileName: 'brief.pdf' }
    const block = buildDocumentMentionBlock(attachment)
    expect(block.type).toBe('text')
    expect((block as any).text).toContain('brief.pdf')
    expect((block as any).text).toContain('application/pdf')
    expect((block as any).text.toLowerCase()).toContain('cannot read its contents directly yet')
  })
})

describe('resolveAttachmentBlocks', () => {
  it('resolves an image attachment to a real image content block via the injected resolver', async () => {
    const attachment: ChatAttachmentRef = { fileId: 'f1', url: '/x', contentType: 'image/png', fileName: 'photo.png' }
    const resolver = vi.fn(async () => 'BASE64DATA')
    const blocks = await resolveAttachmentBlocks([attachment], resolver)
    expect(resolver).toHaveBeenCalledWith(attachment)
    expect(blocks).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BASE64DATA' } },
    ])
  })

  it('degrades an image attachment to a text mention when the resolver fails (expired presign etc.)', async () => {
    const attachment: ChatAttachmentRef = { fileId: 'f1', url: '/x', contentType: 'image/png', fileName: 'photo.png' }
    const resolver = vi.fn(async () => null)
    const blocks = await resolveAttachmentBlocks([attachment], resolver)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    expect((blocks[0] as any).text).toContain('photo.png')
  })

  it('degrades to a text mention when the resolver throws', async () => {
    const attachment: ChatAttachmentRef = { fileId: 'f1', url: '/x', contentType: 'image/png', fileName: 'photo.png' }
    const resolver = vi.fn(async () => { throw new Error('network') })
    const blocks = await resolveAttachmentBlocks([attachment], resolver)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })

  it('builds a text mention (never an image block) for a non-image document attachment', async () => {
    const attachment: ChatAttachmentRef = { fileId: 'f2', url: '/x', contentType: 'application/pdf', fileName: 'brief.pdf' }
    const resolver = vi.fn(async () => 'unused')
    const blocks = await resolveAttachmentBlocks([attachment], resolver)
    expect(resolver).not.toHaveBeenCalled()
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('brief.pdf') }])
  })

  it('resolves multiple attachments in order', async () => {
    const img: ChatAttachmentRef = { fileId: 'f1', url: '/x', contentType: 'image/png', fileName: 'a.png' }
    const doc: ChatAttachmentRef = { fileId: 'f2', url: '/y', contentType: 'application/pdf', fileName: 'b.pdf' }
    const resolver = vi.fn(async () => 'DATA')
    const blocks = await resolveAttachmentBlocks([img, doc], resolver)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('image')
    expect(blocks[1].type).toBe('text')
  })

  it('returns an empty array for no attachments', async () => {
    const resolver = vi.fn(async () => 'DATA')
    expect(await resolveAttachmentBlocks(undefined, resolver)).toEqual([])
    expect(await resolveAttachmentBlocks([], resolver)).toEqual([])
    expect(resolver).not.toHaveBeenCalled()
  })
})
