// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  fileToDataUrl,
  createImageAttachment,
  savePromptToStorage,
  loadPromptFromStorage,
  clearPromptFromStorage,
  createImageAttachmentFromStored,
} from '@/components/ai-elements/prompt-input'

/**
 * #1204 (Coverage Phase 4) — the 6 pure/browser-API helper functions
 * exported from components/ai-elements/prompt-input.tsx (599 lines, reached
 * live via chat-input.tsx -> chats/[chatId]/page.tsx and chat-detail-client.tsx)
 * had zero test coverage. These are the genuinely bug-prone, highest-value
 * part of this file — real FileReader/sessionStorage usage with real error
 * handling — as opposed to the compound UI components in the same file,
 * which are thin Radix/shadcn wrappers already covered indirectly by their
 * own primitives' tests elsewhere.
 */

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('fileToDataUrl', () => {
  it('resolves with a real data: URL for a real File', async () => {
    const file = new File(['hello world'], 'test.txt', { type: 'text/plain' })
    const result = await fileToDataUrl(file)
    expect(result).toMatch(/^data:text\/plain/)
  })

  it('rejects when FileReader itself errors', async () => {
    const originalReadAsDataURL = FileReader.prototype.readAsDataURL
    FileReader.prototype.readAsDataURL = function (this: FileReader) {
      this.dispatchEvent(new Event('error'))
    }
    const file = new File(['x'], 'bad.txt')
    await expect(fileToDataUrl(file)).rejects.toBeTruthy()
    FileReader.prototype.readAsDataURL = originalReadAsDataURL
  })
})

describe('createImageAttachment', () => {
  it('builds a real attachment with a genuine data URL, a real random id, and the original File preserved', async () => {
    const file = new File(['img-bytes'], 'photo.png', { type: 'image/png' })
    const attachment = await createImageAttachment(file)

    expect(attachment.file).toBe(file)
    expect(attachment.dataUrl).toMatch(/^data:image\/png/)
    expect(attachment.preview).toBe(attachment.dataUrl)
    expect(attachment.id).toHaveLength(9)
  })

  it('generates a different id on each call (never a collision-prone fixed id)', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    const a1 = await createImageAttachment(file)
    const a2 = await createImageAttachment(file)
    expect(a1.id).not.toBe(a2.id)
  })
})

describe('savePromptToStorage / loadPromptFromStorage / clearPromptFromStorage', () => {
  it('round-trips a real message + attachment list through real sessionStorage', () => {
    const attachments = [
      { id: 'att-1', file: new File(['x'], 'pic.png', { type: 'image/png' }), dataUrl: 'data:image/png;base64,AAA', preview: 'data:image/png;base64,AAA' },
    ]
    savePromptToStorage('Hello Cody', attachments)

    const loaded = loadPromptFromStorage()
    expect(loaded?.message).toBe('Hello Cody')
    expect(loaded?.attachments).toHaveLength(1)
    expect(loaded?.attachments[0].fileName).toBe('pic.png')
    expect(loaded?.attachments[0].dataUrl).toBe('data:image/png;base64,AAA')
  })

  it('returns null when nothing has been saved yet (honest empty state, not a fabricated draft)', () => {
    expect(loadPromptFromStorage()).toBeNull()
  })

  it('returns null when the stored value is genuinely corrupt JSON, never throws', () => {
    sessionStorage.setItem('v0-prompt-data', '{not valid json')
    expect(loadPromptFromStorage()).toBeNull()
  })

  it('clearPromptFromStorage genuinely removes the real stored draft', () => {
    savePromptToStorage('draft text', [])
    expect(loadPromptFromStorage()).not.toBeNull()

    clearPromptFromStorage()
    expect(loadPromptFromStorage()).toBeNull()
  })

  it('never throws when sessionStorage.setItem itself throws (e.g. quota exceeded)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => savePromptToStorage('x', [])).not.toThrow()
    spy.mockRestore()
  })
})

describe('createImageAttachmentFromStored', () => {
  it('rebuilds a real ImageAttachment, including a real (placeholder) File object, from stored data', () => {
    const stored = { id: 'att-1', fileName: 'restored.png', dataUrl: 'data:image/png;base64,BBB', preview: 'data:image/png;base64,BBB' }
    const attachment = createImageAttachmentFromStored(stored)

    expect(attachment.id).toBe('att-1')
    expect(attachment.dataUrl).toBe('data:image/png;base64,BBB')
    expect(attachment.preview).toBe('data:image/png;base64,BBB')
    expect(attachment.file).toBeInstanceOf(File)
    expect(attachment.file.name).toBe('restored.png')
  })
})
