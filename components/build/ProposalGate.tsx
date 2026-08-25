'use client'

/**
 * ProposalGate (#68) — the concrete, designed proposal at the pay gate.
 *
 * The #1 conversion lever from customer feedback: the founder pays when they SEE
 * a good design AND what Cody is proposing — "this is what I'm planning, this is
 * what it would cost, and if you click these things here's what it'd look like."
 *
 * Renders, above the pricing tiers on the Pricing (Launch) screen:
 *   1. The REAL, already-generated app preview (iframe → /api/preview/{chatId},
 *      else the durable /build/{slug} subdir). No fabrication.
 *   2. The idea-driven business systems Cody will wire — each with a plain-language
 *      "what it does" + a click-to-preview ("here's what it'd look like if you had
 *      ZeroInvoice"), reusing SystemStatusBadge + the live-vs-planned framing (#67).
 *   3. A clear cost/plan line tying the proposal to the recommended tier.
 *
 * Mid-journey framing (experience-then-pay): the copy assumes the founder has
 * ALREADY started down the path — their app is running — rather than cold-selling.
 *
 * Pure presentation over `lib/build/proposal.ts`; all logic lives there so it's
 * deterministic and unit-covered. This component does NOT start checkout — the
 * Pricing tiers below it own that. It only presents the proposal.
 */

import { useMemo, useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { SystemStatusBadge } from '@/components/build/SystemStatusBadge'
import { planFramingLine } from '@/lib/build/live-vs-planned'
import {
  buildProposal,
  systemPreview,
  proposalStatusCounts,
  type ProposalPlan,
} from '@/lib/build/proposal'

interface ProposalGateProps {
  /** Recommended tier to spotlight in the cost line (name + price). */
  plan: ProposalPlan
}

export function ProposalGate({ plan }: ProposalGateProps) {
  const { state } = useBuild()

  // The proposal is deterministic given the founder's context. Recompute only
  // when the inputs that shape it change.
  const proposal = useMemo(
    () =>
      buildProposal({
        companyName: state.companyName,
        idea: state.idea,
        plan,
      }),
    [state.companyName, state.idea, plan],
  )

  // Which system's preview is expanded (click-to-preview). Default to the first
  // proposed system so the founder immediately SEES one in context, not a blank.
  const [openKey, setOpenKey] = useState<string>(() => proposal.systems[0]?.key ?? '')

  const openSystem = proposal.systems.find((s) => s.key === openKey) ?? proposal.systems[0]
  const preview = openSystem ? systemPreview(openSystem) : null

  const counts = proposalStatusCounts(proposal.systems)

  // The real, already-generated app preview URL. Prefer the generated app iframe
  // (/api/preview/{chatId}); fall back to the durable /build/{slug} subdir so the
  // panel always shows the real running app, never a fabricated mock.
  const appSub = state.appSub || (state.companyName || '').toLowerCase().replace(/\s+/g, '-')
  const appPreviewUrl = state.appChatId
    ? `/api/preview/${state.appChatId}`
    : appSub
      ? `/build/${appSub}`
      : null
  // #78: the {slug}.ainative.studio subdomain does NOT resolve until the company is
  // paid + has claimed it. This is the PRE-PAID proposal surface, so show the durable
  // /build/{slug} PATH form (which resolves for anyone), never the subdomain.
  const appUrlLabel = `builder.ainative.studio/build/${appSub || 'your-app'}`

  return (
    <section className="modernist m-proposal" data-testid="proposal-gate" data-track={state.track}>
      <p className="m-cody-line"><span className="m-glyph">◇</span> Cody · your proposal</p>
      <h2 className="m-h2 m-proposal-headline" data-testid="proposal-headline">{proposal.headline}</h2>
      <p className="m-sub m-proposal-subline">{proposal.subline}</p>

      <div className="m-proposal-grid">
        {/* LEFT — the REAL, already-generated app preview. */}
        <div className="m-proposal-app">
          <div className="m-mono m-proposal-label">Your app — already running</div>
          <div className="m-browser">
            <div className="m-browser-chrome m-mono">
              <span className="m-browser-dots"><i /><i /><i /></span>
              <span className="m-browser-url">{appUrlLabel}</span>
            </div>
            <div className="m-browser-body">
              {appPreviewUrl ? (
                <iframe
                  key={appPreviewUrl}
                  src={appPreviewUrl}
                  className="m-preview-frame"
                  title="Your generated app"
                  data-testid="proposal-app-frame"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                />
              ) : (
                <div className="m-preview-fallback" data-testid="proposal-app-fallback">
                  <p className="m-mono"><span className="m-live-dot" /> Your app preview will appear here.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — the business systems Cody proposes, with click-to-preview. */}
        <div className="m-proposal-systems">
          <div className="m-mono m-proposal-label">What Cody wires next</div>
          {/* Honest live-vs-planned framing (#67) — reused from the Live dashboard. */}
          <p className="m-mono m-system-framing" data-testid="proposal-framing-line">
            {planFramingLine(counts.live, counts.total)}
          </p>

          <div className="m-proposal-syslist m-seams" data-testid="proposal-systems">
            {proposal.systems.map((s) => {
              const isOpen = s.key === openKey
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`m-proposal-sysrow ${isOpen ? 'is-open' : ''}`}
                  data-testid={`proposal-system-${s.key}`}
                  aria-expanded={isOpen}
                  onClick={() => setOpenKey(s.key)}
                >
                  <span className="m-proposal-sysrow-top">
                    <span className="m-system-name">{s.name}</span>
                    <SystemStatusBadge provisioned={s.provisioned} />
                  </span>
                  <span className="m-proposal-sys-does">{s.whatItDoes}</span>
                  <span className="m-mono m-proposal-sys-cta">
                    {isOpen ? 'Previewing ↓' : 'See what it’d look like →'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Click-to-preview panel — "here's what it'd look like if you had X". */}
      {preview && (
        <div className="m-proposal-preview" data-testid="proposal-preview">
          <div className="m-browser">
            <div className="m-browser-chrome m-mono">
              <span className="m-browser-dots"><i /><i /><i /></span>
              <span className="m-browser-url" data-testid="proposal-preview-title">
                {preview.name} · {preview.title}
              </span>
            </div>
            <div className="m-browser-body m-proposal-preview-body">
              <p className="m-proposal-preview-sub">{preview.subtitle}</p>
              <table className="m-proposal-preview-table" data-testid="proposal-preview-table">
                <thead>
                  <tr>{preview.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              <p className="m-mono m-proposal-preview-note">{preview.note}</p>
            </div>
          </div>
        </div>
      )}

      {/* Cost line — ties the proposal to the recommended plan (tiers are below). */}
      <p className="m-proposal-cost m-mono" data-testid="proposal-cost">{proposal.costLine}</p>
    </section>
  )
}
