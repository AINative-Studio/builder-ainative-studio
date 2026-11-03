import { describe, it, expect } from 'vitest'
import { parseMultiFileOutput, stripTrailingProse } from '@/lib/multi-file-parser'

/**
 * Real production bug (customer-reported, "shoplo", 2026-11-03):
 * `parseMultiFileOutput`'s main loop appends every line until the NEXT
 * `// --- FILE:` marker into the current file's content — but the LAST file
 * in the output has no following marker to bound it. When the model appends
 * a trailing chat-style summary after finishing the real code (a markdown
 * `---` rule, then "**Key Points**" + a bullet list), that commentary was
 * captured verbatim into the last file's stored content, producing a
 * guaranteed Babel "Unexpected token" at render. Confirmed live via
 * GET /api/generation/{chatId}/files against the real broken company.
 */
describe('stripTrailingProse (unit)', () => {
  it('drops a trailing "---" + Key Points summary after balanced code (the real shoplo shape)', () => {
    const content = [
      "import React from 'react';",
      'export default function Footer() {',
      '  return (',
      '    <footer className="py-12">',
      '      <p>© 2026 Shoplo. All rights reserved.</p>',
      '    </footer>',
      '  );',
      '}',
      '---',
      '',
      '**Key Points**',
      '',
      '- Mobile-first design: used responsive Tailwind grids and flex layouts.',
      '- Accent color `#6C47FF` is applied to key UI elements.',
    ].join('\n')

    const result = stripTrailingProse(content)
    expect(result).not.toContain('Key Points')
    expect(result).not.toContain('Mobile-first design')
    expect(result).toContain('export default function Footer')
    expect(result.trim().endsWith('}')).toBe(true)
  })

  it('drops a bare trailing "---" with nothing after it (the real shoplo App.tsx shape — leftover file-separator artifact)', () => {
    const content = [
      "import React from 'react';",
      "import Footer from './components/Footer';",
      'export default function App() {',
      '  return (',
      '    <div>',
      '      <Footer />',
      '    </div>',
      '  );',
      '}',
      '---',
    ].join('\n')

    const result = stripTrailingProse(content)
    expect(result).not.toMatch(/---\s*$/)
    expect(result).toContain('export default function App')
    expect(result.trim().endsWith('}')).toBe(true)
  })

  it('leaves content with no trailing markdown rule untouched', () => {
    const content = [
      "import React from 'react';",
      'export default function App() {',
      '  return <div>hi</div>;',
      '}',
    ].join('\n')

    expect(stripTrailingProse(content)).toBe(content)
  })

  it('does not strip a markdown-rule-shaped STRING that appears inside already-balanced code', () => {
    const content = [
      "import React from 'react';",
      'export default function App() {',
      "  const divider = '---';",
      '  return <div>{divider}</div>;',
      '}',
    ].join('\n')

    // The rule-detector only matches a `---` on its OWN line (`\n---\n`), so
    // a `'---'` embedded in a statement is never a candidate split point.
    expect(stripTrailingProse(content)).toBe(content)
  })

  it('leaves content alone when the code before the rule does not balance (ambiguous — never guess)', () => {
    const content = [
      "import React from 'react';",
      'export default function App() {',
      '  const obj = { a: 1;', // stray unmatched `{`
      '  return <div>hi</div>;',
      '}',
      '---',
      '**Key Points**',
      '- something',
    ].join('\n')

    // Braces do not balance before the rule — fix must not guess which part
    // is "real", so it leaves the content exactly as given.
    expect(stripTrailingProse(content)).toBe(content)
  })

  it('leaves content alone when what follows the rule does not look like prose', () => {
    const content = [
      "import React from 'react';",
      'export default function App() {',
      '  return <div>hi</div>;',
      '}',
      '---',
      "console.log('not actually prose, still code-shaped')",
    ].join('\n')

    expect(stripTrailingProse(content)).toBe(content)
  })
})

describe('parseMultiFileOutput: strips trailing chat commentary from the last file (integration)', () => {
  it('the real shoplo repro: Footer.tsx no longer carries the trailing Key Points summary', () => {
    const raw = [
      '// --- FILE: /src/App.tsx ---',
      "import React from 'react';",
      "import Footer from './components/Footer';",
      'export default function App() {',
      '  return <Footer />;',
      '}',
      '// --- FILE: /src/components/Footer.tsx ---',
      "import React from 'react';",
      'export default function Footer() {',
      '  return (',
      '    <footer className="py-12">',
      '      <p>© 2026 Shoplo. All rights reserved.</p>',
      '    </footer>',
      '  );',
      '}',
      '---',
      '',
      '**Key Points**',
      '',
      '- Mobile-first design: used responsive Tailwind grids and flex layouts.',
      '- Accent color `#6C47FF` is applied to key UI elements.',
      '',
      'This code can be dropped into a standard React setup.',
    ].join('\n')

    const files = parseMultiFileOutput(raw, 'test prompt')

    expect(files['/src/components/Footer.tsx']).not.toContain('Key Points')
    expect(files['/src/components/Footer.tsx']).not.toContain('Mobile-first design')
    expect(files['/src/components/Footer.tsx']).toContain('export default function Footer')
    expect(files['/src/components/Footer.tsx'].trim().endsWith('}')).toBe(true)
  })
})
