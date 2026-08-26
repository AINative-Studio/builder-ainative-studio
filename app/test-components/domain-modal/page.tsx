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

import { useState, useEffect } from 'react'
import { SessionProvider } from 'next-auth/react'
import { DomainModal } from '@/components/build/DomainModal'
import '@/app/modernist.css'

export default function DomainModalTestPage() {
  const [open, setOpen] = useState(true)
  // Auth toggle (#53/#292): the DomainModal gates anonymous users to sign-in, so
  // the CONNECT/BUY flow tests need a signed-in session. `?authed=1` supplies a
  // fake authenticated session (next-auth's useSession() resolves to
  // 'authenticated' when given a non-null session); without it the harness is
  // anonymous, which lets a test verify the sign-in-routing path.
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [authRequired, setAuthRequired] = useState(false)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setAuthed(q.get('authed') === '1')
  }, [])

  // Wait until we've read the query param so the session state is deterministic
  // before the modal (and its useSession consumers) first render.
  if (authed === null) return null

  const fakeSession = authed
    ? { user: { email: 'founder@example.com' }, expires: '2999-01-01T00:00:00.000Z' }
    : null

  return (
    <SessionProvider session={fakeSession as never}>
      <div className="modernist" style={{ minHeight: '100vh', background: '#f5f4f2' }}>
        <div style={{ padding: 16 }}>
          <button
            onClick={() => setOpen(true)}
            style={{ fontFamily: 'monospace', fontSize: 12, padding: '6px 14px', background: '#151312', color: '#fff', border: 0, cursor: 'pointer' }}
          >
            Open DomainModal
          </button>
          {authRequired && (
            <span data-testid="harness-auth-required" style={{ marginLeft: 12, fontFamily: 'monospace', fontSize: 12 }}>
              auth-required-fired
            </span>
          )}
        </div>

        <DomainModal
          brand="acme"
          slug="acme"
          keywords="tech software"
          open={open}
          onClose={() => setOpen(false)}
          onRequireAuth={() => {
            // Record the anon sign-in routing (so a test can assert it) + close,
            // mirroring Live.tsx which routes to the signup screen.
            setAuthRequired(true)
            setOpen(false)
          }}
        />
      </div>
    </SessionProvider>
  )
}
