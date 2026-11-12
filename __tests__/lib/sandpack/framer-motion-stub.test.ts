import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * framer-motion is not declared as a Sandpack dependency (see
 * components/chat/sandpack-preview.tsx's customSetup.dependencies) despite
 * being one of the most common animation libraries an LLM reaches for in a
 * generated landing page or dashboard. Sandpack fails the ENTIRE compile on
 * any unresolvable import, anywhere in the file tree — same mechanism
 * already fixed for next/image, next/navigation, react-icons, etc.
 * (#1151/#1154/#1174/#1150). This stubs framer-motion's exports to inert
 * passthroughs so a generated `<motion.div whileHover={...}>` still renders
 * its children instead of crashing the whole preview.
 */
describe('stubFramerMotionImports', () => {
  it('stubs `motion` and `AnimatePresence` as const declarations, dropping the import', () => {
    const code = "import { motion, AnimatePresence } from 'framer-motion'"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/from ['"]framer-motion['"]/)
    expect(out).toMatch(/const motion = new Proxy/)
    expect(out).toMatch(/const AnimatePresence = /)
  })

  it('drops animation-only props and renders the plain tag + children', () => {
    const code = [
      "import { motion } from 'framer-motion'",
      'export default function App() {',
      '  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="x">hi</motion.div>',
      '}',
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).toContain('const motion = new Proxy')
    expect(out).not.toMatch(/from ['"]framer-motion['"]/)
    // original JSX usage (motion.div with animation props) is left as-is;
    // the Proxy stub is what makes it resolve at runtime.
    expect(out).toContain('<motion.div initial={{ opacity: 0 }}')
  })

  it('handles an aliased import (`motion as m`)', () => {
    const code = "import { motion as m } from 'framer-motion'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/const m = new Proxy/)
  })

  it('leaves code with no framer-motion import untouched', () => {
    const code = "import { useState } from 'react'\nexport default function App(){ return <div/> }"
    expect(fixJsxErrors(code).trim()).toBe(code.trim())
  })

  // #1879: FRAMER_MOTION_STUBS has 8 entries, so a commented-out multi-name
  // import could expand into several output lines — only the first inherits
  // the source line's leading `//`, resurrecting the rest as real code.
  it('does not resurrect a commented-out framer-motion import as real code', () => {
    const code = ["// import { AnimatePresence, useAnimation } from 'framer-motion'", 'const x = 1'].join('\n')
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/^const useAnimation/m)
    expect(out).toContain('const x = 1')
  })
})
