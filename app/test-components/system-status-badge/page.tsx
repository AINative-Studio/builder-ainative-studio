'use client'

/**
 * SystemStatusBadge test harness — /test-components/system-status-badge (#1056)
 *
 * Mounts SystemStatusBadge in isolation across every real state so Playwright
 * can verify the Business Systems grid's #1067/#1044 Live/Planned badges stay
 * unregressed AND the new #1056 "Connected, not wired" state renders with its
 * own distinct modifier (.st.is-needs) rather than looking like Live or Planned.
 */

import { SystemStatusBadge } from '@/components/build/SystemStatusBadge'
import '@/app/modernist.css'

export default function SystemStatusBadgeTestPage() {
  return (
    <div className="modernist" style={{ minHeight: '100vh', background: '#f5f4f2', padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 420 }}>
        <div data-testid="case-live-url">
          <span style={{ fontFamily: 'monospace', fontSize: 11, marginRight: 10 }}>url set:</span>
          <SystemStatusBadge url="https://acme.ainative.studio" provisioned={false} />
        </div>
        <div data-testid="case-live-provisioned">
          <span style={{ fontFamily: 'monospace', fontSize: 11, marginRight: 10 }}>provisioned, wired omitted (#1044 unregressed):</span>
          <SystemStatusBadge provisioned={true} />
        </div>
        <div data-testid="case-live-wired-true">
          <span style={{ fontFamily: 'monospace', fontSize: 11, marginRight: 10 }}>provisioned + wired:true (flashpoint/habanero-hub shape):</span>
          <SystemStatusBadge provisioned={true} wired={true} />
        </div>
        <div data-testid="case-unwired">
          <span style={{ fontFamily: 'monospace', fontSize: 11, marginRight: 10 }}>provisioned + wired:false (real mendr shape):</span>
          <SystemStatusBadge provisioned={true} wired={false} />
        </div>
        <div data-testid="case-planned">
          <span style={{ fontFamily: 'monospace', fontSize: 11, marginRight: 10 }}>not provisioned:</span>
          <SystemStatusBadge provisioned={false} />
        </div>
        <div data-testid="case-planned-wired-false">
          <span style={{ fontFamily: 'monospace', fontSize: 11, marginRight: 10 }}>not provisioned, wired:false (nothing to be unwired from):</span>
          <SystemStatusBadge provisioned={false} wired={false} />
        </div>
      </div>
    </div>
  )
}
