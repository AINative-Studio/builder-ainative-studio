import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRunSequence = vi.fn()
const mockIsE2BEnabled = vi.fn()

vi.mock('@/lib/build/e2b-sandbox', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/e2b-sandbox')>('@/lib/build/e2b-sandbox')
  return {
    ...actual,
    runSequenceInE2BSandbox: (...args: any[]) => mockRunSequence(...args),
    isE2BEnabled: (...args: any[]) => mockIsE2BEnabled(...args),
  }
})

import { buildInSandbox } from '@/lib/sandbox-builder'

const REAL_HTML = '<div class="app"><h1>Hello Founder</h1></div>'

const SIMPLE_COMPONENT = `
export default function App() {
  return <div className="app"><h1>Hello Founder</h1></div>
}
`

describe('buildInSandbox — E2B-isolated SSR render (#916)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an honest failure (never a crash or the dead Railway call) when E2B is not configured', async () => {
    mockIsE2BEnabled.mockReturnValue(false)

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(mockRunSequence).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.html).toBe('')
    expect(result.error).toBeTruthy()
    expect(typeof result.buildTimeMs).toBe('number')
  })

  it('SSR renders a real component via E2B and returns self-contained HTML', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
      files: { 'output.html': REAL_HTML },
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(mockRunSequence).toHaveBeenCalledOnce()
    expect(result.success).toBe(true)
    expect(result.html).toContain(REAL_HTML)
    expect(result.html).toContain('<!DOCTYPE html>')
    expect(result.html).toContain('tailwindcss.com')
    expect(result.error).toBeUndefined()
    expect(typeof result.buildTimeMs).toBe('number')
  })

  it('strips a markdown code fence before sending the component into the sandbox', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
      files: { 'output.html': REAL_HTML },
    })

    const fenced = '```tsx\n' + SIMPLE_COMPONENT + '\n```'
    const result = await buildInSandbox(fenced)

    expect(result.success).toBe(true)
    const [, , options] = mockRunSequence.mock.calls[0]
    // The files map passed to the sandbox should not still contain the fence markers.
    const filesArg = mockRunSequence.mock.calls[0][0]
    const writtenSource = Object.values(filesArg).find((v) => typeof v === 'string' && (v as string).includes('Hello Founder'))
    expect(writtenSource).toBeDefined()
    expect(writtenSource).not.toContain('```')
  })

  it('degrades to {success:false} when sandbox creation itself fails', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [],
      files: {},
      sandboxError: 'quota exceeded',
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.html).toBe('')
    expect(result.error).toMatch(/quota exceeded/)
  })

  it('degrades to {success:false} when the render command exits non-zero', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: 1, stdout: '', stderr: 'ReferenceError: X is not defined', timedOut: false },
      ],
      files: {},
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.html).toBe('')
    expect(result.error).toBeTruthy()
  })

  it('degrades to {success:false} when the render command times out', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: null, stdout: '', stderr: '', timedOut: true },
      ],
      files: {},
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/timed out/i)
  })

  it('degrades to {success:false} when the install step fails', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 1, stdout: '', stderr: 'ENOTFOUND registry.npmjs.org', timedOut: false },
      ],
      files: {},
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('reports a timeout-specific reason when the install step itself times out', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: null, stdout: '', stderr: '', timedOut: true },
      ],
      files: {},
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/npm install timed out/)
  })

  it('degrades to {success:false} when the install step succeeds but no render result exists at all', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
      files: {},
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/did not produce a result/)
  })

  it('degrades to {success:false} when the render step reported success but produced no readable output file', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
      files: {},
    })

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('degrades to {success:false} instead of throwing when runSequenceInE2BSandbox itself rejects', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockRejectedValue(new Error('unexpected SDK failure'))

    const result = await buildInSandbox(SIMPLE_COMPONENT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/unexpected SDK failure/)
  })

  it('never references the dead Railway host anywhere in the source file', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/sandbox-builder.ts'), 'utf8')
    expect(src).not.toContain('amusing-curiosity')
    expect(src).not.toContain('SANDBOX_EXECUTOR_URL')
  })

  it('detects a non-default export component name and still renders successfully', async () => {
    mockIsE2BEnabled.mockReturnValue(true)
    mockRunSequence.mockResolvedValue({
      commandResults: [
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      ],
      files: { 'output.html': '<section>Dashboard</section>' },
    })

    const namedComponent = `
export default function FounderDashboard() {
  return <section>Dashboard</section>
}
`
    const result = await buildInSandbox(namedComponent)
    expect(result.success).toBe(true)
    expect(result.html).toContain('Dashboard')
  })
})
