import { describe, it, expect } from 'vitest'
import { findTruncatedFiles } from '@/lib/build/completeness-gate'

/**
 * #2013 — strict-parse truncation detector.
 *
 * findMissingLocalImports()/findUndeclaredJsxComponents() only look at
 * import/JSX-tag shape, so a file that got cut off mid-statement (no closing
 * brace, no export, nothing left to import or render) sails past both of
 * them clean. findTruncatedFiles() is the file-level backstop: a STRICT
 * Babel parse of each code file in the payload, same bar Sandpack's own
 * bundler fails a file on.
 */

describe('findTruncatedFiles', () => {
  it('returns [] for undefined/empty files map', () => {
    expect(findTruncatedFiles(undefined)).toEqual([])
    expect(findTruncatedFiles({})).toEqual([])
  })

  it('returns [] for a fully complete multi-file app', () => {
    const files = {
      '/src/App.tsx': `import Header from './components/Header'\nexport default function App(){ return <div><Header/></div> }`,
      '/src/components/Header.tsx': `export default function Header(){ return <header/> }`,
      '/src/index.css': `body { margin: 0; }`,
    }
    expect(findTruncatedFiles(files)).toEqual([])
  })

  it('flags a file cut off mid-statement (#2013 luminary repro — ContactFormSection.tsx)', () => {
    const files = {
      '/src/components/ContactFormSection.tsx': `import React, { useState } from 'react';

const ContactFormSection = () => {
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', zipCode: '', subject: '', message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
}
}`,
    }
    expect(findTruncatedFiles(files)).toEqual(['/src/components/ContactFormSection.tsx'])
  })

  it('flags a file with an unterminated string literal', () => {
    const files = {
      '/src/components/Broken.tsx': `export default function Broken(){ const s = 'never closed; return <div>{s}</div> }`,
    }
    expect(findTruncatedFiles(files)).toEqual(['/src/components/Broken.tsx'])
  })

  it('ignores non-code files (css/json/md/assets) even if they contain garbage text', () => {
    const files = {
      '/src/App.tsx': `export default function App(){ return <div/> }`,
      '/src/index.css': `this is not { valid css at all +++ ///`,
      '/package.json': `{ not valid json`,
      '/README.md': `# truncated mid senten`,
    }
    expect(findTruncatedFiles(files)).toEqual([])
  })

  it('ignores .d.ts declaration files', () => {
    const files = {
      '/src/types.d.ts': `declare module 'foo' { export const x:`,
    }
    expect(findTruncatedFiles(files)).toEqual([])
  })

  it('does not flag an intentionally emptied comment-only stub file (real convention, company "younova")', () => {
    const files = {
      '/src/components/Sidebar.tsx': `// Removed as AIKitSidebar is used in App.tsx\n`,
      '/src/components/ActivityTimeline.tsx': `// Removed as AIKitTimeline is used in App.tsx\n`,
    }
    expect(findTruncatedFiles(files)).toEqual([])
  })

  it('does not flag a file using plain top-level await/return (allowed, not a truncation signal)', () => {
    const files = {
      '/src/components/TopLevel.tsx': `export default function X(){ return null }\nreturn 1;`,
    }
    expect(findTruncatedFiles(files)).toEqual([])
  })

  it('flags a .tsx file that already has an export (patched in by fixMissingExports) but never reached its own return/JSX — SIGNAL 3, real repro: luminary\'s ContactFormSection.tsx after export-repair', () => {
    const files = {
      '/src/components/ContactFormSection.tsx': `import React, { useState } from 'react';

export const ContactFormSection = () => {
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', zipCode: '', subject: '', message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
}
}`,
    }
    expect(findTruncatedFiles(files)).toEqual(['/src/components/ContactFormSection.tsx'])
  })

  it('does not flag stubTruncatedFiles()\'s own safe `() => null` stub when re-scanned post-build (overnight loop repro, luminary ContactFormSection.tsx after self-heal)', () => {
    const files = {
      '/src/components/ContactFormSection.tsx': `import React from 'react'\n// Auto-stubbed (#2022): this generated file was cut off mid-generation and failed to parse.\nexport const ContactFormSection = () => null\n`,
    }
    expect(findTruncatedFiles(files)).toEqual([])
  })

  it('still flags a block-bodied arrow with no return/JSX (the real SIGNAL 3 case stays caught)', () => {
    const files = {
      '/src/components/Broken.tsx': `import React from 'react'\nexport const Broken = () => {\n  const x = 1\n}\n`,
    }
    expect(findTruncatedFiles(files)).toEqual(['/src/components/Broken.tsx'])
  })

  it('does not flag a finished .tsx component that implicitly returns JSX with no explicit `return` keyword', () => {
    const files = {
      '/src/components/Footer.tsx': `const Footer = () => (\n  <footer className="site-footer">Real footer</footer>\n)\nexport default Footer`,
    }
    expect(findTruncatedFiles(files)).toEqual([])
  })

  it('does not flag a finished .tsx component using a bare fragment with no explicit `return` keyword', () => {
    const files = {
      '/src/components/Wrapper.tsx': `const Wrapper = ({ children }) => (<>{children}</>)\nexport default Wrapper`,
    }
    expect(findTruncatedFiles(files)).toEqual([])
  })

  it('does not flag a legitimate re-export barrel with no return/JSX of its own', () => {
    const files = {
      '/src/components/Card.tsx': `export { default } from './ui/Card'`,
      '/src/components/Icons.tsx': `export * from './icons/generated'`,
    }
    expect(findTruncatedFiles(files)).toEqual([])
  })

  it('does not flag a non-rendering .ts module that legitimately has neither return nor JSX', () => {
    const files = {
      '/src/components/Colors.ts': `export const Colors = { navy: '#0F1F4D', gold: '#C9A227' }`,
    }
    expect(findTruncatedFiles(files)).toEqual([])
  })

  it('flags multiple broken files and leaves clean ones out of the result', () => {
    const files = {
      '/src/App.tsx': `export default function App(){ return <div/> }`,
      '/src/components/A.tsx': `export default function A(){ return <div>`,
      '/src/components/B.tsx': `export default function B(){ return <div/> }`,
      '/src/components/C.tsx': `const C = () => { const x = {`,
    }
    expect(findTruncatedFiles(files)).toEqual(['/src/components/A.tsx', '/src/components/C.tsx'])
  })
})
