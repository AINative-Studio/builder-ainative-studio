import { describe, it, expect } from 'vitest'
import { parse } from '@babel/parser'
import { sanitizeForSandpack, validateJavaScriptCode } from '@/lib/code-validator'

/**
 * Regression (builder#2193): autoFixCode's truncation-recovery branch
 * decides "this code is truncated mid-expression" by counting raw `{`/`}`/
 * `(`/`)` characters across the WHOLE file text, including inside string
 * literals. A string that itself contains an unbalanced paren/brace
 * character — e.g. a model-generated `metadata.description` that was cut
 * off mid-parenthetical ("... for roofing contractors (run") — is not a
 * real code-structure imbalance, but the raw count misreads it as one. That
 * wrongly enters the repair branch, which chops real trailing lines off an
 * otherwise 100%-valid file and splices in synthetic closing brackets,
 * actively corrupting it. Live repro: two sampled companies' persisted
 * /app/layout.tsx (both carrying this exact truncated-description shape)
 * failed real validateJavaScriptCode() with a false "Unexpected token" at
 * the file's own closing brace.
 */
describe('autoFixCode truncation heuristic ignores string-literal content (builder#2193)', () => {
  const layoutWithDanglingParenInString = [
    "import type { Metadata } from 'next'",
    "import { Inter } from 'next/font/google'",
    "import './globals.css'",
    '',
    "const inter = Inter({ subsets: ['latin'] })",
    '',
    'export const metadata: Metadata = {',
    "  title: 'this — Ecommerce Application',",
    "  description: 'A real company for this idea: A B2B sales CRM for roofing contractors (run',",
    "  metadataBase: new URL('https://this.app'),",
    '}',
    '',
    'export default function RootLayout({ children }: { children: React.ReactNode }) {',
    '  return (',
    '    <html lang="en">',
    '      <body className={inter.className}>{children}</body>',
    '    </html>',
    '  )',
    '}',
  ].join('\n')

  it('does not truncate or mutate a complete file whose string content has an unbalanced paren', () => {
    const fixed = sanitizeForSandpack(layoutWithDanglingParenInString)
    expect(fixed).toBe(layoutWithDanglingParenInString)
    expect(() => parse(fixed, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow()
  })

  it('validateJavaScriptCode reports this file as valid, not a catastrophic parse failure', () => {
    const result = validateJavaScriptCode(layoutWithDanglingParenInString, { importsStripped: false, lenient: true })
    expect(result.valid).toBe(true)
  })

  it('still repairs a genuinely truncated file (unbalanced in real code, not just string content)', () => {
    const trulyTruncated = [
      "import React from 'react';",
      'export default function Foo() {',
      '  const items = [1, 2, 3].map((x) => {',
      '    return x * 2',
    ].join('\n')

    const fixed = sanitizeForSandpack(trulyTruncated)
    expect(() => parse(fixed, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow()
    expect(fixed).not.toBe(trulyTruncated)
  })
})
