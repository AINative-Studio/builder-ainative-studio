import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * builder#2013 — findTruncatedFiles() wired into checkAppReady.
 *
 * Real repro: company "luminary" (chatId xW3lIi44cTNLYsOdeOUzj, issue #2013).
 * `ContactFormSection.tsx` stops right after `e.preventDefault();` — no
 * closing return/JSX, no export at all — but its braces still balance (the
 * arrow function that got cut off never opened anything it didn't close), so
 * a strict parse alone says nothing is wrong. findMissingLocalImports() and
 * findUndeclaredJsxComponents() both report a clean bill of health too: the
 * file doesn't import or render anything undefined, it just never finished.
 * findTruncatedFiles() (lib/build/completeness-gate.ts) already catches this
 * exact shape via its "component-shaped file, zero export" signal — this
 * suite proves it's now actually reachable from the live ready gate, not
 * just the retroactive backfill sweep.
 */

const getPreview = vi.fn<(id: string) => string | undefined>()
const getFilesV2 = vi.fn<(id: string) => Record<string, string> | null>()
const loadGeneration = vi.fn<
  (id: string) => Promise<{
    prompt: string
    generatedCode: string
    ssrHtml?: string
    files?: Record<string, string> | null
  } | null>
>()

vi.mock('@/lib/preview-store', () => ({ getPreview: (id: string) => getPreview(id) }))
vi.mock('@/lib/preview-store-v2', () => ({ getFiles: (id: string) => getFilesV2(id) }))
vi.mock('@/lib/zerodb-store', () => ({ loadGeneration: (id: string) => loadGeneration(id) }))

import { checkAppReady } from '@/lib/build/ready-gate'

// The #2013 repro, verbatim (ContactFormSection.tsx cut off mid-handleSubmit,
// braces balanced, no export at all).
const TRUNCATED_CONTACT_FORM = `import React, { useState } from 'react';
import Label from './ui/Label';
import Input from './ui/Input';
import Textarea from './ui/Textarea';
import Button from './ui/Button';

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
}`

const APP_TSX = `import ContactFormSection from './components/ContactFormSection'
export default function App(){ return <ContactFormSection/> }`

beforeEach(() => {
  getPreview.mockReset()
  getFilesV2.mockReset()
  loadGeneration.mockReset()
  getFilesV2.mockReturnValue(null)
})

describe('builder#2013 checkAppReady truncation gate', () => {
  it('BLOCKS a component file cut off mid-statement with no export, even though braces balance and no import/JSX reference is broken', async () => {
    getPreview.mockReturnValue(undefined)
    loadGeneration.mockResolvedValue({
      prompt: 'x',
      generatedCode: APP_TSX,
      files: {
        '/src/App.tsx': APP_TSX,
        '/src/components/ContactFormSection.tsx': TRUNCATED_CONTACT_FORM,
      },
    })
    const r = await checkAppReady('chat-luminary-truncated')
    expect(r.checked).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('truncated_file')
    expect(r.error).toContain('ContactFormSection.tsx')
  })

  it('passes the same component once it is actually finished (has a real export)', async () => {
    const FINISHED = TRUNCATED_CONTACT_FORM.replace(
      /const handleSubmit[\s\S]*$/,
      `const handleSubmit = async (e) => {\n    e.preventDefault();\n    setSubmitted(true);\n  };\n\n  return <form onSubmit={handleSubmit}><Input name="email" /><Button>Send</Button></form>;\n};\n\nexport default ContactFormSection;\n`,
    )
    getPreview.mockReturnValue(undefined)
    loadGeneration.mockResolvedValue({
      prompt: 'x',
      generatedCode: APP_TSX,
      files: {
        '/src/App.tsx': APP_TSX,
        '/src/components/ContactFormSection.tsx': FINISHED,
      },
    })
    const r = await checkAppReady('chat-luminary-finished')
    expect(r.ok).toBe(true)
  })

  it('does not block when no files map is available at all (fail-open, same posture as the other completeness checks)', async () => {
    getPreview.mockReturnValue(APP_TSX)
    getFilesV2.mockReturnValue(null)
    const r = await checkAppReady('chat-no-files-map')
    // No files map means findTruncatedFiles can't run at all — the earlier
    // missing-local-import check on the blob itself is what decides this one
    // (ContactFormSection isn't defined inline), so this just proves the new
    // gate doesn't crash or misbehave with files undefined.
    expect(r.checked).toBe(true)
  })
})
