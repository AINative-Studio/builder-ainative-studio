import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * #1559 (`huddle`, live): a generated handler's native, synchronous
 * alert()/confirm()/prompt() call freezes the entire preview tab until
 * dismissed, and reads as a broken unstyled popup on an otherwise
 * professional page. buildSandpackFiles() rewrites these calls in-place to
 * a non-blocking shim so the preview never freezes.
 */
describe('buildSandpackFiles — fixNativeDialogCalls neutralizes blocking native dialogs', () => {
  it('rewrites a bare alert() call to the non-blocking shim', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
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
      ].join('\n'),
    })
    const code = built['/src/App.tsx']
    expect(code).toContain('__sandpackSafeAlert(`Thanks')
    expect(code).not.toMatch(/(?<![.\w$])alert\(/)
    expect(code).toContain('function __sandpackSafeAlert(message)')
  })

  it('rewrites window.alert() the same way as a bare alert()', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import React from 'react'",
        "export default function App() { return (<button onClick={() => window.alert('hi')}>Go</button>) }",
      ].join('\n'),
    })
    expect(built['/src/App.tsx']).toContain("__sandpackSafeAlert('hi')")
    expect(built['/src/App.tsx']).not.toMatch(/window\.alert\(/)
  })

  it('rewrites confirm() and prompt(), preserving the shim signature', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
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
      ].join('\n'),
    })
    const code = built['/src/App.tsx']
    expect(code).toContain("__sandpackSafeConfirm('Are you sure?')")
    expect(code).toContain("__sandpackSafePrompt('New name', 'Untitled')")
    expect(code).toContain('function __sandpackSafeConfirm(message)')
    expect(code).toContain('function __sandpackSafePrompt(message, defaultValue)')
  })

  it('does not touch a method call named alert/confirm on another object', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import React from 'react'",
        'const toast = { alert: (msg: string) => console.log(msg) }',
        "export default function App() { return (<button onClick={() => toast.alert('hi')}>Go</button>) }",
      ].join('\n'),
    })
    const code = built['/src/App.tsx']
    expect(code).toContain("toast.alert('hi')")
    expect(code).not.toContain('__sandpackSafeAlert')
  })

  it('leaves a file with no dialog calls completely untouched', () => {
    const files = {
      '/src/App.tsx': [
        "import React from 'react'",
        'export default function App() { return (<div>hello</div>) }',
      ].join('\n'),
    }
    const built = buildSandpackFiles(files)
    expect(built['/src/App.tsx']).toBe(files['/src/App.tsx'])
  })

  it('inserts the shim after a leading "use client" directive, not before it', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "'use client'",
        "import React from 'react'",
        "export default function App() { return (<button onClick={() => alert('hi')}>Go</button>) }",
      ].join('\n'),
    })
    const code = built['/src/App.tsx']
    expect(code.split('\n')[0]).toBe("'use client'")
    expect(code).toContain('__sandpackSafeAlert')
  })
})
