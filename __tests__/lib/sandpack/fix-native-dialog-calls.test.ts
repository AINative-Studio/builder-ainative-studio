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
    expect(code).toContain('__previewSafeAlert(`Thanks')
    expect(code).not.toMatch(/(?<![.\w$])alert\(/)
    expect(code).toContain('function __previewSafeAlert(message)')
  })

  it('rewrites window.alert() the same way as a bare alert()', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import React from 'react'",
        "export default function App() { return (<button onClick={() => window.alert('hi')}>Go</button>) }",
      ].join('\n'),
    })
    expect(built['/src/App.tsx']).toContain("__previewSafeAlert('hi')")
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
    expect(code).toContain("__previewSafeConfirm('Are you sure?')")
    expect(code).toContain("__previewSafePrompt('New name', 'Untitled')")
    expect(code).toContain('function __previewSafeConfirm(message)')
    expect(code).toContain('function __previewSafePrompt(message, defaultValue)')
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
    expect(code).not.toContain('__previewSafeAlert')
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
    expect(code).toContain('__previewSafeAlert')
  })

  /**
   * Real bug found live (shoplo repair, 2026-11-04): a stored generation can
   * ALREADY call __previewSafeAlert directly — no raw alert()/confirm()/
   * prompt() left for dialogCallRe to match — e.g. a repair pass restoring
   * known-correct, already-sanitized source. The old guard
   * (`if (!dialogCallRe.test(code)) continue`) skipped these files entirely,
   * so the shim function was never injected and the call crashed at runtime:
   * "__previewSafeAlert is not defined". lib/code-validator.ts's parse gate
   * (#1780) correctly treats the name as a known global, but that's a STATIC
   * check — it never guaranteed a real runtime definition exists in the
   * bundle, which is this function's job.
   */
  it('injects the shim when the file ALREADY calls __previewSafeAlert directly (no raw alert() left to rewrite)', () => {
    const built = buildSandpackFiles({
      '/src/components/Pricing.tsx': [
        "import React from 'react'",
        'export default function Pricing() {',
        '  const handleSelect = (tier) => {',
        '    __previewSafeAlert(`You selected the ${tier} plan!`)',
        '  }',
        "  return (<button onClick={() => handleSelect('Pro')}>Select Pro</button>)",
        '}',
      ].join('\n'),
    })
    const code = built['/src/components/Pricing.tsx']
    expect(code).toContain('function __previewSafeAlert(message)')
    expect(code).toContain('__previewSafeAlert(`You selected')
  })

  it('injects all three shims when a file calls __previewSafeConfirm/__previewSafePrompt directly', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import React from 'react'",
        'export default function App() {',
        "  const onDelete = () => { if (__previewSafeConfirm('Sure?')) { __previewSafeAlert('Deleted') } }",
        "  const onRename = () => { const name = __previewSafePrompt('Name?', 'default') }",
        '  return (<div><button onClick={onDelete}>Delete</button></div>)',
        '}',
      ].join('\n'),
    })
    const code = built['/src/App.tsx']
    expect(code).toContain('function __previewSafeAlert(message)')
    expect(code).toContain('function __previewSafeConfirm(message)')
    expect(code).toContain('function __previewSafePrompt(message, defaultValue)')
  })

  /**
   * #1921: `alreadyDefined` used to be decided from raw, unmasked text, so
   * a COMMENT merely mentioning the shim's function signature made the
   * function wrongly believe a real definition already existed — skipping
   * injection of the real SHIM even though the real alert() call just got
   * rewritten to call it, leaving "__previewSafeAlert is not defined" at
   * runtime.
   */
  it('still injects the real shim when only a COMMENT mentions the shim function signature', () => {
    const built = buildSandpackFiles({
      '/src/components/Pricing.tsx': [
        "import React from 'react'",
        "// NOTE: an older draft defined its own helper here:",
        "// function __previewSafeAlert(msg) { console.log(msg) }",
        'export default function Pricing() {',
        '  const handleSelect = (tier) => {',
        '    alert(`You selected the ${tier} plan!`)',
        '  }',
        "  return (<button onClick={() => handleSelect('Pro')}>Select Pro</button>)",
        '}',
      ].join('\n'),
    })
    const code = built['/src/components/Pricing.tsx']
    expect(code).toContain('function __previewSafeAlert(message)')
    expect(code).toContain('__previewSafeAlert(`You selected')
    expect(code).not.toMatch(/(?<![.\w$])alert\(/)
  })

  /**
   * #1921: a comment that only *mentions* alert( with no real call anywhere
   * used to still match the unmasked scan and get "rewritten" in place,
   * corrupting the comment's own text. The comment text must be left
   * untouched since there is no real dialog call in the file.
   */
  it('leaves a comment that only mentions alert( untouched when there is no real call', () => {
    const files = {
      '/src/App.tsx': [
        "import React from 'react'",
        '// this used to call alert(message) before we switched to a toast',
        'export default function App() { return (<div>hello</div>) }',
      ].join('\n'),
    }
    const built = buildSandpackFiles(files)
    expect(built['/src/App.tsx']).toBe(files['/src/App.tsx'])
  })

  it('does not double-inject when the file already defines its own __previewSafeAlert', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import React from 'react'",
        "function __previewSafeAlert(message) { console.info('already defined', message) }",
        'export default function App() {',
        "  return (<button onClick={() => __previewSafeAlert('hi')}>Go</button>)",
        '}',
      ].join('\n'),
    })
    const code = built['/src/App.tsx']
    const defCount = (code.match(/function __previewSafeAlert\(/g) || []).length
    expect(defCount).toBe(1)
  })
})
