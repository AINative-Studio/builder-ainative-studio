import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)

/**
 * Issue #6 — Install and Integrate AIKit Components.
 *
 * Verifies that the builder now consumes the official `@ainative/ai-kit`
 * library for AI message rendering instead of the previously vendored
 * components, and that the local shim modules re-export the library so existing
 * import paths keep working.
 */

const root = path.resolve(__dirname, '../..')

function read(rel: string): string {
  return readFileSync(path.join(root, rel), 'utf-8')
}

describe('@ainative/ai-kit dependency', () => {
  it('is declared as a dependency at the pinned version', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.dependencies['@ainative/ai-kit']).toBe('0.2.0')
  })

  it('pins @ainative/ai-kit-core so the workspace:* transitive dep resolves', () => {
    const pkg = JSON.parse(read('package.json'))
    // The published ai-kit@0.2.0 declares its core dep as `workspace:*`, which
    // cannot resolve outside the source monorepo. We pin it explicitly and add
    // a pnpm override so installs succeed.
    expect(pkg.dependencies['@ainative/ai-kit-core']).toBe('0.2.0')
    expect(pkg.pnpm?.overrides?.['@ainative/ai-kit>@ainative/ai-kit-core']).toBe('0.2.0')
  })

  it('resolves the installed library and ships its dist bundle', () => {
    // The library resolves from node_modules (install succeeded despite the
    // upstream workspace:* core dependency).
    const entry = require.resolve('@ainative/ai-kit')
    expect(entry).toContain('@ainative/ai-kit')
    // The ESM bundle Next/webpack loads must exist at the resolved entry.
    expect(() => readFileSync(entry, 'utf-8')).not.toThrow()
  })

  it('exports the components used by the builder chat UI', () => {
    // Assert against the built type declarations so we do not trigger the deep
    // react-syntax-highlighter CJS import (unsupported by Node's ESM loader,
    // but resolved fine by the Next/webpack build). The entry resolves to
    // …/@ainative/ai-kit/dist/index.mjs; the .d.ts sits beside it.
    const entry = require.resolve('@ainative/ai-kit')
    const dts = readFileSync(path.join(path.dirname(entry), 'index.d.ts'), 'utf-8')
    for (const name of [
      'StreamingMessage',
      'StreamingIndicator',
      'CodeBlock',
      'MarkdownRenderer',
    ]) {
      expect(dts, `missing export: ${name}`).toContain(name)
    }
  })
})

describe('local aikit shims re-export the library', () => {
  it('StreamingMessage re-exports from @ainative/ai-kit', () => {
    const src = read('components/aikit/StreamingMessage.tsx')
    expect(src).toContain("from '@ainative/ai-kit'")
    expect(src).toContain('StreamingMessage')
    expect(src).toContain('as default')
  })

  it('CodeBlock re-exports from @ainative/ai-kit', () => {
    const src = read('components/aikit/CodeBlock.tsx')
    expect(src).toContain("from '@ainative/ai-kit'")
    expect(src).toContain('CodeBlock')
  })

  it('StreamingIndicator re-exports from @ainative/ai-kit', () => {
    const src = read('components/aikit/StreamingIndicator.tsx')
    expect(src).toContain("from '@ainative/ai-kit'")
    expect(src).toContain('StreamingIndicator')
  })
})

describe('chat UI wiring', () => {
  it('chat-messages imports StreamingMessage directly from @ainative/ai-kit', () => {
    const src = read('components/chat/chat-messages.tsx')
    expect(src).toContain("import { StreamingMessage } from '@ainative/ai-kit'")
    // The old vendored import path must be gone.
    expect(src).not.toContain("from '@/components/aikit/StreamingMessage'")
  })

  it('still renders StreamingMessage for each chat message', () => {
    const src = read('components/chat/chat-messages.tsx')
    expect(src).toContain('<StreamingMessage')
    // Core props remain wired to the library component.
    expect(src).toContain('streamingState=')
    expect(src).toContain('enableMarkdown={true}')
  })
})

describe('ai-kit-core browser stub', () => {
  it('exists so the Node-only core package stays out of client bundles', () => {
    const src = read('lib/aikit/ai-kit-core-browser-stub.ts')
    expect(src).toContain('class AIStream')
  })

  it('is aliased for both turbopack and webpack in next.config', () => {
    const src = read('next.config.ts')
    expect(src).toContain('ai-kit-core-browser-stub')
    expect(src).toContain("'@ainative/ai-kit-core'")
    expect(src).toContain('turbopack')
    expect(src).toContain('webpack')
  })
})
