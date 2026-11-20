import { describe, it, expect } from 'vitest'
import { findShadcnComponentsImportedFromLucide } from '@/lib/build/completeness-gate'

/**
 * #2185 repro: a generated App.tsx imports shadcn UI primitives
 * (Button/Card/Dialog/...) from 'lucide-react' instead of the local
 * './components/ui/*' bundle. 'lucide-react' is a real, allowlisted icon
 * package with no such exports — the binding resolves to `undefined` and
 * React throws "Element type is invalid" the moment it renders.
 */

describe('findShadcnComponentsImportedFromLucide', () => {
  it('returns [] for undefined/empty files map', () => {
    expect(findShadcnComponentsImportedFromLucide(undefined)).toEqual([])
    expect(findShadcnComponentsImportedFromLucide({})).toEqual([])
  })

  it('flags the real repro (#2185): CardHeader/DialogOverlay/... imported from lucide-react', () => {
    const files = {
      '/src/App.tsx': `import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Badge, Dialog, DialogOverlay, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, IconButton } from 'lucide-react'\nexport default function App(){ return <Dialog open={true}><DialogContent><CardHeader/></DialogContent></Dialog> }`,
    }
    const hits = findShadcnComponentsImportedFromLucide(files)
    expect(hits).toContain('CardHeader')
    expect(hits).toContain('DialogOverlay')
    expect(hits).toContain('DialogContent')
    // Bare, icon-ambiguous names are intentionally never flagged (see below).
    expect(hits).not.toContain('Button')
    expect(hits).not.toContain('Card')
    expect(hits).not.toContain('Badge')
  })

  it('does not flag genuine icon imports from lucide-react', () => {
    const files = {
      '/src/App.tsx': `import { Check, ArrowRight, Mail, MapPin, Phone } from 'lucide-react'\nexport default function App(){ return <Check/> }`,
    }
    expect(findShadcnComponentsImportedFromLucide(files)).toEqual([])
  })

  it('does not flag Badge/Table even though shadcn-bundle.ts also exports them — both are real lucide icons too', () => {
    const files = {
      '/src/App.tsx': `import { Badge, Table } from 'lucide-react'\nexport default function App(){ return <Badge/> }`,
    }
    expect(findShadcnComponentsImportedFromLucide(files)).toEqual([])
  })

  it('does not flag the correct local import path', () => {
    const files = {
      '/src/App.tsx': `import { Button } from './components/ui/button'\nimport { CardHeader } from './components/ui/card'\nexport default function App(){ return <Button/> }`,
    }
    expect(findShadcnComponentsImportedFromLucide(files)).toEqual([])
  })

  it('ignores a type-only import', () => {
    const files = {
      '/src/App.tsx': `import type { CardHeader } from 'lucide-react'\nexport default function App(){ return null }`,
    }
    expect(findShadcnComponentsImportedFromLucide(files)).toEqual([])
  })

  it('does not flag a commented-out import', () => {
    const files = {
      '/src/App.tsx': `// import { CardHeader, DialogOverlay } from 'lucide-react'\nexport default function App(){ return null }`,
    }
    expect(findShadcnComponentsImportedFromLucide(files)).toEqual([])
  })

  it('handles a renamed import (`CardHeader as Foo`) — flags the real external name, not the local alias', () => {
    const files = {
      '/src/App.tsx': `import { CardHeader as Foo } from 'lucide-react'\nexport default function App(){ return <Foo/> }`,
    }
    expect(findShadcnComponentsImportedFromLucide(files)).toEqual(['CardHeader'])
  })

  it('handles a mixed default + named import from lucide-react', () => {
    const files = {
      '/src/App.tsx': `import Icon, { DialogOverlay } from 'lucide-react'\nexport default function App(){ return <DialogOverlay/> }`,
    }
    expect(findShadcnComponentsImportedFromLucide(files)).toEqual(['DialogOverlay'])
  })

  it('never throws on malformed input', () => {
    expect(() => findShadcnComponentsImportedFromLucide({ '/src/App.tsx': null as unknown as string })).not.toThrow()
  })
})
