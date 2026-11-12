import { describe, it, expect } from 'vitest'
import { parse } from '@babel/parser'
import { sanitizeForSandpack } from '@/lib/code-validator'

/**
 * Regression (builder#1975): autoFixCode's truncation-recovery path counts
 * unclosed `{`/`(` and appends that many bare closers to re-balance the
 * *count* — but a `try { ... }` closed with a bare `}` (no catch/finally) is
 * its own SyntaxError ("Missing catch or finally clause") even though the
 * brace count ends up balanced. Live repro: MemoryPanel.tsx (chatId
 * pIUnAyNPc8FNYe_4nUznd) truncated mid-`try` and the old recovery path closed
 * it with 4 bare `}` lines, which still fails to parse.
 */

const parseOk = (code: string) =>
  parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })

describe('truncated try-block recovery (builder#1975)', () => {
  it('closes a try truncated mid-statement with a synthetic catch, not a bare brace', () => {
    const code = [
      "import React, { useState } from 'react';",
      'const MemoryPanel = () => {',
      "  const [rememberStatus, setRememberStatus] = useState('');",
      '',
      '  const remember = async () => {',
      '    try {',
      "      const res = await fetch('/api/memory/remember', {",
      "        method: 'POST',",
      '      });',
      '      if (res.ok) {',
      "        setRememberStatus('stored');",
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(() => parseOk(fixed)).not.toThrow()
    expect(fixed).toMatch(/\}\s*catch\s*\(/)
  })

  it('closes a try truncated one level deeper (nested arrow + try)', () => {
    const code = [
      "import React from 'react';",
      'export default function CampaignManager() {',
      '  const loadCampaigns = async () => {',
      '    try {',
      "      const res = await fetch('/api/primitive/contentworkflow/content/calendar');",
      '      const data = await res.json();',
      '      setCampaigns(data.posts || [])',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(() => parseOk(fixed)).not.toThrow()
    expect(fixed).toMatch(/\}\s*catch\s*\(/)
  })

  it('still closes a plain (non-try) truncated block with a bare brace', () => {
    const code = [
      "import React from 'react';",
      'export default function Foo() {',
      '  const items = [1, 2, 3].map((x) => {',
      '    return x * 2',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(() => parseOk(fixed)).not.toThrow()
    expect(fixed).not.toMatch(/catch/)
  })

  it('does not misidentify an identifier ending in "try" (e.g. retry) as a try block', () => {
    const code = [
      "import React from 'react';",
      'export default function Foo() {',
      '  const retry = {',
      '    count: 0,',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(() => parseOk(fixed)).not.toThrow()
    expect(fixed).not.toMatch(/catch/)
  })

  it('handles a try/catch that is already properly closed without adding an extra catch', () => {
    const code = [
      "import React from 'react';",
      'export default function Foo() {',
      '  const load = async () => {',
      '    try {',
      '      doThing()',
      '    } catch (e) {',
      '      console.error(e)',
      '    }',
      '  }',
      '  return <div>hi</div>',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(() => parseOk(fixed)).not.toThrow()
    expect(fixed.match(/catch/g) || []).toHaveLength(1)
  })
})
