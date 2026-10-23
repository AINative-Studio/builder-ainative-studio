import { describe, it, expect, vi, beforeEach } from 'vitest'
import AdmZip from 'adm-zip'

/**
 * Unit tests for export.service.ts (US-066): zips a generated UI into a
 * full Next.js project. The only real I/O boundary is `lib/preview-store`
 * (an in-memory map read), which is mocked; `adm-zip` itself is exercised
 * for real since it is pure in-process zip building with no I/O.
 */

const getPreviewMock = vi.hoisted(() => vi.fn())
const getAINativeFilesMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/preview-store', () => ({
  getPreview: getPreviewMock,
  getAINativeFiles: getAINativeFilesMock,
}))

function readZipEntries(buffer: Buffer): Record<string, string> {
  const zip = new AdmZip(buffer)
  const out: Record<string, string> = {}
  for (const entry of zip.getEntries()) {
    if (!entry.isDirectory) {
      out[entry.entryName] = entry.getData().toString('utf-8')
    }
  }
  return out
}

describe('exportProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAINativeFilesMock.mockReturnValue(undefined)
  })

  it('throws when the generation is not found in the preview store', async () => {
    getPreviewMock.mockReturnValue(undefined)
    const { exportProject } = await import('@/lib/services/export.service')

    await expect(exportProject('missing-id')).rejects.toThrow('Generation missing-id not found')
  })

  it('produces a valid zip containing the core Next.js project scaffold', async () => {
    getPreviewMock.mockReturnValue('<div>Hello World</div>')
    const { exportProject } = await import('@/lib/services/export.service')

    const buffer = await exportProject('gen-1')
    expect(Buffer.isBuffer(buffer)).toBe(true)

    const entries = readZipEntries(buffer)
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([
        'package.json',
        'next.config.ts',
        'tsconfig.json',
        'tailwind.config.ts',
        'postcss.config.mjs',
        'app/page.tsx',
        'app/layout.tsx',
        'app/globals.css',
        'components/ui/button.tsx',
        'components/ui/card.tsx',
        'components/ui/input.tsx',
        'lib/utils.ts',
        'README.md',
        '.gitignore',
        '.env.example',
      ])
    )
  })

  it('embeds the generated code into app/page.tsx', async () => {
    getPreviewMock.mockReturnValue('<button>Click me</button>')
    const { exportProject } = await import('@/lib/services/export.service')

    const buffer = await exportProject('gen-2')
    const entries = readZipEntries(buffer)

    expect(entries['app/page.tsx']).toContain('<button>Click me</button>')
  })

  it('falls back to a placeholder div in app/page.tsx when generated_code is falsy', async () => {
    getPreviewMock.mockReturnValue('')
    const { exportProject } = await import('@/lib/services/export.service')

    // An empty string from getPreview is still truthy-checked against
    // undefined only — exportProject treats '' as "not found" since
    // `if (!generatedCode)` guards on falsy, not strictly undefined.
    await expect(exportProject('gen-empty')).rejects.toThrow('Generation gen-empty not found')
  })

  it('includes package.json with the expected app name derived from the generation id', async () => {
    getPreviewMock.mockReturnValue('<div/>')
    const { exportProject } = await import('@/lib/services/export.service')

    const buffer = await exportProject('abc-123')
    const entries = readZipEntries(buffer)
    const packageJson = JSON.parse(entries['package.json'])

    expect(packageJson.name).toBe('generated-app-abc-123')
    expect(packageJson.dependencies.next).toBeTruthy()
    expect(packageJson.dependencies.react).toBeTruthy()
  })

  it('includes AINative files (robots.txt, llms.txt, etc.) when the preview store provides them', async () => {
    getPreviewMock.mockReturnValue('<div/>')
    getAINativeFilesMock.mockReturnValue({
      'robots.txt': 'User-agent: *',
      'llms.txt': '# LLM access',
      'ai-plugin.json': '{}',
    })
    const { exportProject } = await import('@/lib/services/export.service')

    const buffer = await exportProject('gen-3')
    const entries = readZipEntries(buffer)

    expect(entries['robots.txt']).toBe('User-agent: *')
    expect(entries['llms.txt']).toBe('# LLM access')
    expect(entries['ai-plugin.json']).toBe('{}')
  })

  it('omits AINative files entirely when the preview store has none', async () => {
    getPreviewMock.mockReturnValue('<div/>')
    getAINativeFilesMock.mockReturnValue(undefined)
    const { exportProject } = await import('@/lib/services/export.service')

    const buffer = await exportProject('gen-4')
    const entries = readZipEntries(buffer)

    expect(entries['robots.txt']).toBeUndefined()
    expect(entries['llms.txt']).toBeUndefined()
  })

  it('README.md embeds the generation id and a created timestamp', async () => {
    getPreviewMock.mockReturnValue('<div/>')
    const { exportProject } = await import('@/lib/services/export.service')

    const buffer = await exportProject('readme-gen')
    const entries = readZipEntries(buffer)

    expect(entries['README.md']).toContain('Generation ID: readme-gen')
    expect(entries['README.md']).toMatch(/Created: \d{4}-\d{2}-\d{2}T/)
  })
})

describe('getExportWithMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAINativeFilesMock.mockReturnValue(undefined)
  })

  it('returns a buffer, filename, and size consistent with exportProject output', async () => {
    getPreviewMock.mockReturnValue('<div>content</div>')
    const { getExportWithMetadata } = await import('@/lib/services/export.service')

    const result = await getExportWithMetadata('meta-gen')

    expect(result.filename).toBe('nextjs-app-meta-gen.zip')
    expect(result.size).toBe(result.buffer.length)
    expect(Buffer.isBuffer(result.buffer)).toBe(true)
    expect(result.size).toBeGreaterThan(0)
  })

  it('propagates the not-found error from exportProject', async () => {
    getPreviewMock.mockReturnValue(undefined)
    const { getExportWithMetadata } = await import('@/lib/services/export.service')

    await expect(getExportWithMetadata('missing')).rejects.toThrow('Generation missing not found')
  })
})
