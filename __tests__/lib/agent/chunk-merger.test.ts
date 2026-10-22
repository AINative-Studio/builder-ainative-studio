import { describe, it, expect } from 'vitest'
import { mergeChunks, validateMergedCode, getMergeSummary } from '@/lib/agent/chunk-merger'
import type { GeneratedChunk } from '@/lib/agent/multi-pass-generator'

function makeChunk(overrides: Partial<GeneratedChunk>): GeneratedChunk {
  return {
    chunkId: 'chunk-1',
    phase: 1,
    phaseType: 'core',
    code: '',
    rawResponse: '',
    tokenUsage: { input: 0, output: 0, total: 0 },
    success: true,
    validationPassed: true,
    generationTime: 0,
    ...overrides,
  }
}

function padLines(code: string, minLines: number): string {
  const current = code.split('\n').length
  if (current >= minLines) return code
  const filler = Array.from({ length: minLines - current }, (_, i) => `// filler line ${i}`).join('\n')
  return `${code}\n${filler}`
}

describe('mergeChunks', () => {
  it('throws when no core chunk exists', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({ phase: 2, phaseType: 'feature', code: 'const Feature = () => null' }),
    ]
    expect(() => mergeChunks(chunks)).toThrowError(
      'Core structure (Phase 1) failed or is missing - cannot merge',
    )
  })

  it('throws when core chunk exists but failed', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({ phase: 1, phaseType: 'core', code: 'function App() {}', success: false }),
    ]
    expect(() => mergeChunks(chunks)).toThrowError(
      'Core structure (Phase 1) failed or is missing - cannot merge',
    )
  })

  it('merges a successful core chunk alone', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({ phase: 1, phaseType: 'core', code: 'function App() { return null }' }),
    ]
    const result = mergeChunks(chunks)
    expect(result).toContain('function App()')
    // No markers should remain after cleanup.
    expect(result).not.toContain('=====')
  })

  it('appends successful feature chunks and skips failed ones', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({ phase: 1, phaseType: 'core', code: 'function App() {}' }),
      makeChunk({
        phase: 2,
        phaseType: 'feature',
        chunkId: 'feat-ok',
        code: 'function FeatureOk() {}',
        success: true,
      }),
      makeChunk({
        phase: 2,
        phaseType: 'feature',
        chunkId: 'feat-fail',
        code: 'function FeatureFail() {}',
        success: false,
      }),
    ]
    const result = mergeChunks(chunks)
    expect(result).toContain('FeatureOk')
    expect(result).not.toContain('FeatureFail')
  })

  it('applies a successful integration chunk', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({ phase: 1, phaseType: 'core', code: 'function App() {}' }),
      makeChunk({
        phase: 3,
        phaseType: 'integration',
        chunkId: 'integ',
        code: 'function Integration() {}',
        success: true,
      }),
    ]
    const result = mergeChunks(chunks)
    expect(result).toContain('Integration')
  })

  it('skips a failed integration chunk entirely (not an error)', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({ phase: 1, phaseType: 'core', code: 'function App() {}' }),
      makeChunk({
        phase: 3,
        phaseType: 'integration',
        chunkId: 'integ-fail',
        code: 'function IntegrationFail() {}',
        success: false,
      }),
    ]
    const result = mergeChunks(chunks)
    expect(result).not.toContain('IntegrationFail')
  })

  it('removes merge marker lines during cleanup', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({ phase: 1, phaseType: 'core', code: 'function App() {}' }),
      makeChunk({
        phase: 2,
        phaseType: 'feature',
        chunkId: 'feat',
        code: 'function Feature() {}',
        success: true,
      }),
      makeChunk({
        phase: 3,
        phaseType: 'integration',
        chunkId: 'integ',
        code: 'function Integration() {}',
        success: true,
      }),
    ]
    const result = mergeChunks(chunks)
    expect(result).not.toMatch(/\/\/ ===== .* =====/)
    expect(result).toContain('function App()')
    expect(result).toContain('function Feature()')
    expect(result).toContain('function Integration()')
  })

  it('collapses 3+ consecutive newlines down to exactly 2', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({
        phase: 1,
        phaseType: 'core',
        code: 'function App() {}\n\n\n\n\nconst x = 1',
      }),
    ]
    const result = mergeChunks(chunks)
    expect(result).not.toMatch(/\n{3,}/)
    expect(result).toContain('function App() {}\n\nconst x = 1')
  })

  it('merges two imports from the same source with different named imports into one line', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({
        phase: 1,
        phaseType: 'core',
        code: "import { Alpha } from 'shared-lib'\nfunction App() {}",
      }),
      makeChunk({
        phase: 2,
        phaseType: 'feature',
        chunkId: 'feat',
        code: "import { Beta } from 'shared-lib'\nfunction Feature() {}",
        success: true,
      }),
    ]
    const result = mergeChunks(chunks)
    const importLines = result.split('\n').filter(l => l.trim().startsWith('import ') && l.includes('shared-lib'))
    expect(importLines).toHaveLength(1)
    expect(importLines[0]).toContain('Alpha')
    expect(importLines[0]).toContain('Beta')
    expect(importLines[0]).toMatch(/^import \{ Alpha, Beta \} from 'shared-lib'$/)
  })

  it('merges a default import with a named import from the same source', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({
        phase: 1,
        phaseType: 'core',
        code: "import React from 'react'\nfunction App() {}",
      }),
      makeChunk({
        phase: 2,
        phaseType: 'feature',
        chunkId: 'feat',
        code: "import { useState } from 'react'\nfunction Feature() {}",
        success: true,
      }),
    ]
    const result = mergeChunks(chunks)
    const importLines = result.split('\n').filter(l => l.trim().startsWith('import ') && l.includes("'react'"))
    expect(importLines).toHaveLength(1)
    expect(importLines[0]).toBe("import React, { useState } from 'react'")
  })

  it('leaves unparseable import lines (no matching from clause) untouched as non-import lines', () => {
    const weirdImport = "import something strange"
    const chunks: GeneratedChunk[] = [
      makeChunk({
        phase: 1,
        phaseType: 'core',
        code: `${weirdImport}\nfunction App() {}`,
      }),
    ]
    const result = mergeChunks(chunks)
    expect(result).toContain(weirdImport)
  })

  it('migrates all deduplicated imports to the top, keeping non-import line order', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({
        phase: 1,
        phaseType: 'core',
        code: "function App() {}\nimport { A } from 'mod-a'\nconst z = 1",
      }),
      makeChunk({
        phase: 2,
        phaseType: 'feature',
        chunkId: 'feat',
        code: "import { B } from 'mod-b'\nconst y = 2",
        success: true,
      }),
    ]
    const result = mergeChunks(chunks)
    const lines = result.split('\n').filter(l => l.trim().length > 0)
    const importIdxA = lines.findIndex(l => l.includes("mod-a"))
    const importIdxB = lines.findIndex(l => l.includes("mod-b"))
    const nonImportIdx = lines.findIndex(l => l.includes('function App'))
    expect(importIdxA).toBeLessThan(nonImportIdx)
    expect(importIdxB).toBeLessThan(nonImportIdx)
  })
})

describe('validateMergedCode', () => {
  it('computes totalLines, importCount, and componentCount for a function-style component', () => {
    const code = padLines("import React from 'react'\nfunction Dashboard() {\n  return null\n}", 100)
    const result = validateMergedCode(code)
    expect(result.stats.totalLines).toBe(code.split('\n').length)
    expect(result.stats.importCount).toBe(1)
    expect(result.stats.componentCount).toBe(1)
  })

  it('detects a const-arrow-style component', () => {
    const code = padLines("import React from 'react'\nconst MyComponent = () => {\n  return null\n}", 100)
    const result = validateMergedCode(code)
    expect(result.stats.componentCount).toBe(1)
  })

  it('reports zero components when neither pattern is present', () => {
    const code = padLines("import React from 'react'\nconst x = 1\nconst y = 2", 100)
    const result = validateMergedCode(code)
    expect(result.stats.componentCount).toBe(0)
  })

  it('warns when the merged code is too short (under 100 lines)', () => {
    const code = "import React from 'react'\nfunction Dashboard() { return null }"
    const result = validateMergedCode(code)
    expect(result.warnings).toContain('Merged code seems too short - possible merge failure')
  })

  it('warns when there are no components', () => {
    const code = padLines("import React from 'react'\nconst x = 1", 100)
    const result = validateMergedCode(code)
    expect(result.warnings).toContain('No components found in merged code')
  })

  it('warns when there are no imports', () => {
    const code = padLines("function Dashboard() { return null }", 100)
    const result = validateMergedCode(code)
    expect(result.warnings).toContain('No imports found - this is unusual')
  })

  it('produces zero warnings when big enough, with imports and components', () => {
    const code = padLines("import React from 'react'\nfunction Dashboard() { return null }", 100)
    const result = validateMergedCode(code)
    expect(result.warnings).toHaveLength(0)
    expect(result.isValid).toBe(true)
  })

  it('detects duplicate component definitions (same function name twice)', () => {
    const code = padLines(
      "import React from 'react'\nfunction Foo() { return 1 }\nfunction Foo() { return 2 }",
      100,
    )
    const result = validateMergedCode(code)
    const dupWarning = result.warnings.find(w => w.startsWith('Duplicate component definitions:'))
    expect(dupWarning).toBeDefined()
    expect(dupWarning).toContain('Foo')
  })

  it('detects duplicate component definitions across function and const-arrow styles', () => {
    const code = padLines(
      "import React from 'react'\nfunction Foo() { return 1 }\nconst Foo = () => { return 2 }",
      100,
    )
    const result = validateMergedCode(code)
    const dupWarning = result.warnings.find(w => w.startsWith('Duplicate component definitions:'))
    expect(dupWarning).toBeDefined()
    expect(dupWarning).toContain('Foo')
  })

  it('isValid is true when only a "no components" warning is present (no failure text)', () => {
    const code = padLines("import React from 'react'\nconst x = 1", 100)
    const result = validateMergedCode(code)
    expect(result.warnings).toEqual(['No components found in merged code'])
    expect(result.isValid).toBe(true)
  })

  it('isValid is true when only a "no imports" warning is present', () => {
    const code = padLines("function Dashboard() { return null }", 100)
    const result = validateMergedCode(code)
    expect(result.warnings).toEqual(['No imports found - this is unusual'])
    expect(result.isValid).toBe(true)
  })

  it('isValid is true when only a duplicate-component warning is present', () => {
    const code = padLines(
      "import React from 'react'\nfunction Foo() { return 1 }\nfunction Foo() { return 2 }",
      100,
    )
    const result = validateMergedCode(code)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('Duplicate component definitions')
    expect(result.isValid).toBe(true)
  })

  it('isValid is false when a too-short warning is present', () => {
    const code = "import React from 'react'\nfunction Dashboard() { return null }"
    const result = validateMergedCode(code)
    expect(result.isValid).toBe(false)
  })

  it('is false when both too-short and no-components warnings fire together', () => {
    const code = "const x = 1"
    const result = validateMergedCode(code)
    expect(result.warnings).toContain('Merged code seems too short - possible merge failure')
    expect(result.warnings).toContain('No components found in merged code')
    expect(result.isValid).toBe(false)
  })
})

describe('getMergeSummary', () => {
  it('includes header, chunk counts, stats, and Passed status with no warnings', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({ phase: 1, phaseType: 'core', success: true }),
      makeChunk({ phase: 2, phaseType: 'feature', chunkId: 'f1', success: true }),
      makeChunk({ phase: 2, phaseType: 'feature', chunkId: 'f2', success: false }),
    ]
    const mergedCode = padLines("import React from 'react'\nfunction Dashboard() { return null }", 100)
    const summary = getMergeSummary(chunks, mergedCode)

    expect(summary).toContain('🔀 Merge Summary:')
    expect(summary).toContain('Chunks Merged: 2/3')
    expect(summary).toContain(`Total Lines: ${mergedCode.split('\n').length}`)
    expect(summary).toContain('Components: 1')
    expect(summary).toContain('Imports: 1')
    expect(summary).toContain('Validation: ✅ Passed')
    expect(summary).not.toContain('Warnings:')
  })

  it('lists warnings with "Has warnings" status when validation fails', () => {
    const chunks: GeneratedChunk[] = [makeChunk({ phase: 1, phaseType: 'core', success: true })]
    const mergedCode = 'const x = 1'
    const summary = getMergeSummary(chunks, mergedCode)

    expect(summary).toContain('Validation: ⚠️ Has warnings')
    expect(summary).toContain('⚠️  Warnings:')
    expect(summary).toContain('   - Merged code seems too short - possible merge failure')
    expect(summary).toContain('   - No components found in merged code')
    expect(summary).toContain('   - No imports found - this is unusual')
  })

  it('reflects the correct successful/total chunk counts for a mixed set', () => {
    const chunks: GeneratedChunk[] = [
      makeChunk({ phase: 1, phaseType: 'core', chunkId: 'core', success: true }),
      makeChunk({ phase: 2, phaseType: 'feature', chunkId: 'f1', success: false }),
      makeChunk({ phase: 2, phaseType: 'feature', chunkId: 'f2', success: false }),
      makeChunk({ phase: 3, phaseType: 'integration', chunkId: 'integ', success: true }),
    ]
    const mergedCode = padLines("import React from 'react'\nfunction Dashboard() { return null }", 100)
    const summary = getMergeSummary(chunks, mergedCode)
    expect(summary).toContain('Chunks Merged: 2/4')
  })
})
