'use client'

/**
 * Evidence Page
 *
 * Central place to browse collected proof (test runs, builds, coverage,
 * deployments) via a gallery or chronological timeline. Backs issue #19's
 * "visual gallery" acceptance criterion.
 */

import { useState } from 'react'
import { PublicNav } from '@/components/shared/public-nav'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EvidenceGallery } from '@/components/evidence/evidence-gallery'
import { EvidenceTimeline } from '@/components/evidence/evidence-timeline'
import type { Evidence } from '@/lib/types/evidence'
import { LayoutGrid, ListOrdered, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react'

interface VerifyResult {
  passed: boolean
  missingEvidence: string[]
  failedEvidence: string[]
  coverage?: { passed: boolean; coverage: number | null; threshold: number; message: string }
  message: string
}

export default function EvidencePage() {
  const [selected, setSelected] = useState<Evidence | null>(null)
  const [verifyUserId, setVerifyUserId] = useState('')
  const [verifyBranch, setVerifyBranch] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  // #1213 — real consumer for the previously-orphaned POST /api/evidence/
  // verify. Clicking an evidence row below pre-fills its owner so "verify
  // commit readiness" starts from a real, known user_id rather than an
  // invented one.
  const selectEvidence = (ev: Evidence) => {
    setSelected(ev)
    setVerifyUserId(ev.user_id)
    setVerifyBranch(ev.git_branch || '')
    setVerifyResult(null)
    setVerifyError(null)
  }

  const runVerify = async () => {
    if (!verifyUserId.trim()) return
    setVerifying(true)
    setVerifyError(null)
    setVerifyResult(null)
    try {
      const res = await fetch('/api/evidence/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: verifyUserId.trim(),
          gitBranch: verifyBranch.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setVerifyError(data.message || data.error || 'Verification failed')
        return
      }
      setVerifyResult(data)
    } catch {
      setVerifyError('Verification request failed')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="modernist" style={{ minHeight: '100vh' }}>
      <PublicNav />
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" style={{ color: 'var(--color-accent)' }} />
            <h1 className="m-h1" style={{ fontSize: 30, margin: 0 }}>Evidence</h1>
          </div>
          <p style={{ marginTop: 4, color: 'var(--text-muted)' }}>
            Automated proof for every claim — test runs, builds, coverage and
            deployments. Verify before you trust.
          </p>
        </div>

        {/* Verify Commit Readiness (#1213) — real consumer for the previously
            orphaned POST /api/evidence/verify. Click an evidence row below to
            pre-fill its owner, or type a user id directly. */}
        <div className="mb-6 rounded-lg border bg-background p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
            <span className="text-sm font-semibold">Verify commit readiness</span>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1" style={{ minWidth: 220 }}>
              <label className="mb-1 block text-xs" style={{ color: 'var(--text-muted)' }}>
                User ID
              </label>
              <Input
                value={verifyUserId}
                onChange={(e) => setVerifyUserId(e.target.value)}
                placeholder="Click an evidence row, or paste a user id"
                data-testid="evidence-verify-userid"
              />
            </div>
            <div style={{ minWidth: 160 }}>
              <label className="mb-1 block text-xs" style={{ color: 'var(--text-muted)' }}>
                Branch (optional)
              </label>
              <Input
                value={verifyBranch}
                onChange={(e) => setVerifyBranch(e.target.value)}
                placeholder="main"
                data-testid="evidence-verify-branch"
              />
            </div>
            <Button
              onClick={runVerify}
              disabled={verifying || !verifyUserId.trim()}
              data-testid="evidence-verify-submit"
            >
              {verifying ? 'Verifying…' : 'Verify'}
            </Button>
          </div>

          {verifyError && (
            <p className="mt-3 text-sm text-red-600" data-testid="evidence-verify-error">
              {verifyError}
            </p>
          )}

          {verifyResult && (
            <div className="mt-3 flex items-start gap-2" data-testid="evidence-verify-result">
              {verifyResult.passed ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 text-red-500" />
              )}
              <div>
                <Badge variant={verifyResult.passed ? 'default' : 'destructive'}>
                  {verifyResult.passed ? 'Ready to commit' : 'Not ready'}
                </Badge>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {verifyResult.message}
                </p>
                {verifyResult.missingEvidence.length > 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    Missing: {verifyResult.missingEvidence.join(', ')}
                  </p>
                )}
                {verifyResult.failedEvidence.length > 0 && (
                  <p className="mt-1 text-xs text-red-600">
                    Failed: {verifyResult.failedEvidence.join(', ')}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <Tabs defaultValue="gallery" className="w-full">
          <TabsList>
            <TabsTrigger value="gallery" className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4" />
              Gallery
            </TabsTrigger>
            <TabsTrigger value="timeline" className="flex items-center gap-2">
              <ListOrdered className="h-4 w-4" />
              Timeline
            </TabsTrigger>
          </TabsList>

          <TabsContent value="gallery" className="mt-4">
            <div className="rounded-lg border bg-background">
              <EvidenceGallery onEvidenceSelect={selectEvidence} />
            </div>
          </TabsContent>

          <TabsContent value="timeline" className="mt-4">
            <div className="rounded-lg border bg-background p-2">
              <EvidenceTimeline />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
