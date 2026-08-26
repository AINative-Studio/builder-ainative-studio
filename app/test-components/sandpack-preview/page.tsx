'use client'

/**
 * Sandpack preview test harness — /test-components/sandpack-preview (#291)
 *
 * Mounts the SandpackPreview with a fixed multi-file app so Playwright can verify
 * that Sandpack actually bundles + renders a real multi-file React app (cross-file
 * imports resolved), independent of live codegen. The rendered app lives inside
 * Sandpack's own sandboxed iframe.
 */
import { SandpackPreview } from '@/components/chat/sandpack-preview'
import '@/app/modernist.css'

// A genuinely multi-file app: App.tsx imports a local Header + Card component.
const MULTI_FILE = {
  '/App.tsx': `import React from 'react'
import Header from './Header'
import Card from './Card'

export default function App() {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <Header title="Sandpack Multi-File" />
      <Card label="Rendered via real bundler" />
    </div>
  )
}`,
  '/Header.tsx': `import React from 'react'
export default function Header({ title }: { title: string }) {
  return <h1 data-testid="mf-header" style={{ color: '#0B7285' }}>{title}</h1>
}`,
  '/Card.tsx': `import React from 'react'
export default function Card({ label }: { label: string }) {
  return <div data-testid="mf-card" style={{ marginTop: 12, padding: 16, border: '1px solid #ddd', borderRadius: 8 }}>{label}</div>
}`,
}

export default function SandpackHarness() {
  return (
    <div className="modernist" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }} data-testid="sandpack-harness-ready">
        Sandpack multi-file harness
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <SandpackPreview files={MULTI_FILE} />
      </div>
    </div>
  )
}
