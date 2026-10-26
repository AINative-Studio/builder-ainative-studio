import { describe, it, expect } from 'vitest'
import { sanitizeForSandpack, validateGeneratedCode } from '@/lib/code-validator'

/**
 * #1559/#1565 real bug, single-file path: a generated handler's native,
 * synchronous alert()/confirm()/prompt() call freezes the entire preview tab
 * until manually dismissed. PR #1565 fixed this for the Sandpack multi-file
 * pipeline (lib/sandpack/build-files.ts's fixNativeDialogCalls), but the
 * SINGLE-FILE Babel preview (app/api/preview/[id]/route.ts, via
 * sanitizeForSandpack/validateGeneratedCode's shared autoFixCode) was left
 * uncovered — confirmed live: `flipsight` renders via this exact path and
 * still hung on "Get Early Access" after #1565 deployed. This ports the same
 * fix logic into autoFixCode so both preview paths are covered.
 */
describe('code-validator — autoFixCode neutralizes blocking native dialogs (#1559, single-file path)', () => {
  it('sanitizeForSandpack rewrites a bare alert() call to the non-blocking shim', () => {
    const code = [
      "import React, { useState } from 'react'",
      'export default function App() {',
      "  const [email, setEmail] = useState('')",
      '  const handleEarlyAccess = () => {',
      '    if (email.trim()) {',
      "      alert(`Thanks for signing up! We'll send early access info to ${email}`)",
      "      setEmail('')",
      '    }',
      '  }',
      '  return (<button onClick={handleEarlyAccess}>Get Early Access</button>)',
      '}',
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain('__previewSafeAlert(`Thanks')
    expect(fixed).not.toMatch(/(?<![.\w$])alert\(/)
    expect(fixed).toContain('function __previewSafeAlert(message)')
  })

  it('rewrites window.alert() the same way as a bare alert()', () => {
    const code = [
      "import React from 'react'",
      "export default function App() { return (<button onClick={() => window.alert('hi')}>Go</button>) }",
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain("__previewSafeAlert('hi')")
    expect(fixed).not.toMatch(/window\.alert\(/)
  })

  it('rewrites confirm() and prompt(), preserving the shim signature', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const onDelete = () => {',
      "    if (confirm('Are you sure?')) { console.log('deleted') }",
      '  }',
      '  const onRename = () => {',
      "    const name = prompt('New name', 'Untitled')",
      '  }',
      '  return (<div><button onClick={onDelete}>Delete</button><button onClick={onRename}>Rename</button></div>)',
      '}',
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain("__previewSafeConfirm('Are you sure?')")
    expect(fixed).toContain("__previewSafePrompt('New name', 'Untitled')")
    expect(fixed).toContain('function __previewSafeConfirm(message)')
    expect(fixed).toContain('function __previewSafePrompt(message, defaultValue)')
  })

  it('does not touch a method call named alert/confirm on another object', () => {
    const code = [
      "import React from 'react'",
      "const toast = { alert: (msg) => console.log(msg) }",
      "export default function App() { return (<button onClick={() => toast.alert('hi')}>Go</button>) }",
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain("toast.alert('hi')")
    expect(fixed).not.toContain('__previewSafeAlert')
  })

  it('leaves code with no dialog calls completely untouched by this fix', () => {
    const code = [
      "import React from 'react'",
      'export default function App() { return (<div>hello</div>) }',
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed).not.toContain('__previewSafe')
  })

  it('inserts the shim after a leading "use client" directive, not before it', () => {
    const code = [
      "'use client'",
      "import React from 'react'",
      "export default function App() { return (<button onClick={() => alert('hi')}>Go</button>) }",
    ].join('\n')
    const fixed = sanitizeForSandpack(code)
    expect(fixed.split('\n')[0]).toBe("'use client'")
    expect(fixed).toContain('__previewSafeAlert')
  })

  it('THE BUG: validateGeneratedCode (the real preview route call path) also neutralizes alert() — the flipsight repro', () => {
    const raw = [
      '```jsx',
      "import React, { useState } from 'react'",
      'export default function App() {',
      "  const [email, setEmail] = useState('')",
      '  const handleEarlyAccess = async (e) => {',
      '    e.preventDefault()',
      "    await fetch('/api/db/waitlist', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ email }) }).catch(()=>{})",
      "    alert(\"You're on the list!\")",
      "    setEmail('')",
      '  }',
      '  return (<form onSubmit={handleEarlyAccess}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} /></form>)',
      '}',
      '```',
    ].join('\n')
    const result = validateGeneratedCode(raw)
    expect(result.code).not.toMatch(/(?<![.\w$])alert\(/)
    expect(result.code).toContain('__previewSafeAlert')
    expect(result.fixes).toContain('Neutralized blocking native alert()/confirm()/prompt() call(s) — a real browser dialog freezes the entire preview tab until manually dismissed (#1559)')
  })
})
