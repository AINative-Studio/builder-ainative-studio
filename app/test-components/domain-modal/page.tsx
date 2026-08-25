'use client'

/**
 * DomainModal test harness — /test-components/domain-modal
 *
 * Mounts the DomainModal in isolation so Playwright E2E tests (#48) can
 * verify scroll containment, Show-more pagination, and mobile behaviour
 * without navigating through the full /build Live flow.
 *
 * The modal opens automatically on load and the /api/build/domains route is
 * intercepted at the Playwright level to control API responses.
 */

import { useState } from 'react'
import { DomainModal } from '@/components/build/DomainModal'
import '@/app/modernist.css'

export default function DomainModalTestPage() {
  const [open, setOpen] = useState(true)

  return (
    <div className="modernist" style={{ minHeight: '100vh', background: '#f5f4f2' }}>
      {/* Controls outside the modal for manual testing */}
      <div style={{ padding: 16 }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            padding: '6px 14px',
            background: '#151312',
            color: '#fff',
            border: 0,
            cursor: 'pointer',
          }}
        >
          Open DomainModal
        </button>
      </div>

      <DomainModal
        brand="acme"
        slug="acme"
        keywords="tech software"
        open={open}
        onClose={() => setOpen(false)}
        onRequireAuth={() => {
          // In the test harness, auth-required just closes the modal
          setOpen(false)
        }}
      />
    </div>
  )
}
