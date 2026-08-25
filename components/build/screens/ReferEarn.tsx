'use client'

/**
 * Refer & Earn (#59) — the referral/growth view. Modeled on Polsia's account-menu
 * Refer & Earn: a shareable referral link with a one-click COPY, and the three
 * headline stats (Friends Referred / Credits Earned / Credits Pending).
 *
 * The reward is cash credits on a referred user's SUBSCRIBE (uncapped, instant),
 * credited server-side on subscription-verify. This screen only READS the user's
 * own code/link/stats from /api/build/referral (identity resolved server-side).
 *
 * Honest per auth state (#50): a guest has no durable account → no shareable code;
 * we show a "create an account" prompt instead of a fake link. Matches the
 * `.modernist` chrome + the `m-account` layout used by Account/MyCompanies.
 */

import { useEffect, useState } from 'react'
import { useBuild } from '@/contexts/build-context'
import { useSession } from 'next-auth/react'
import { isGuestSession } from '@/lib/build/account-session'
import { REFERRAL_CREDIT_AWARD } from '@/lib/build/referral'

interface Summary {
  code: string
  link: string
  stats: { friendsReferred: number; creditsEarned: number; creditsPending: number }
}

const EMPTY: Summary = {
  code: '',
  link: '',
  stats: { friendsReferred: 0, creditsEarned: 0, creditsPending: 0 },
}

export function ReferEarn() {
  const { dispatch } = useBuild()
  const { data: session } = useSession()
  const isGuest = isGuestSession(session)
  const [summary, setSummary] = useState<Summary>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (isGuest) { setLoading(false); return }
    let alive = true
    setLoading(true)
    fetch('/api/build/referral')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setSummary({ ...EMPTY, ...d, stats: { ...EMPTY.stats, ...d?.stats } }) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [isGuest])

  const copyLink = async () => {
    if (!summary.link) return
    try {
      await navigator.clipboard.writeText(summary.link)
    } catch {
      // Fallback for environments without the async clipboard API.
      const ta = document.createElement('textarea')
      ta.value = summary.link
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* noop */ }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="modernist m-account" data-testid="refer-earn">
      <header className="m-account-head">
        <button className="m-back" onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'account' })}>← Back to account</button>
        <h1 className="m-artifact m-account-h">Refer &amp; Earn</h1>
        <span className="m-chip m-profile-plan">${REFERRAL_CREDIT_AWARD} per referral</span>
      </header>

      <section className="m-account-sec">
        <h2 className="m-mono m-account-sec-h">Give ${REFERRAL_CREDIT_AWARD}, get ${REFERRAL_CREDIT_AWARD}</h2>
        <p className="m-mono m-muted" style={{ padding: '0 0 0.75rem' }}>
          Share your link. When a friend subscribes, you earn ${REFERRAL_CREDIT_AWARD} in
          cash credits — no cap, credited instantly. Refer as many friends as you like.
        </p>

        {isGuest ? (
          <div className="m-sec-rows">
            <div className="m-sec-row" data-testid="refer-guest-prompt">
              <span>Create a free account to get your referral link</span>
              <button
                className="btn-primary"
                data-testid="refer-guest-signup"
                onClick={() => dispatch({ type: 'GOTO_SCREEN', screen: 'signup' })}
              >
                Sign up →
              </button>
            </div>
          </div>
        ) : (
          <div className="m-sec-rows">
            <div className="m-sec-row">
              <span>Your referral link</span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }}>
                <input
                  className="m-mono"
                  data-testid="refer-link"
                  readOnly
                  value={loading ? 'Loading…' : (summary.link || 'Unavailable')}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ maxWidth: '22rem', flex: 1, minWidth: 0, padding: '0.4rem 0.6rem' }}
                />
                <button
                  className="btn-primary"
                  data-testid="refer-copy"
                  disabled={loading || !summary.link}
                  onClick={copyLink}
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="m-sec-row">
              <span>Your code</span>
              <span className="m-mono m-chip" data-testid="refer-code">{summary.code || '—'}</span>
            </div>
          </div>
        )}
      </section>

      {!isGuest && (
        <section className="m-account-sec">
          <h2 className="m-mono m-account-sec-h">Your referrals</h2>
          <div className="m-meters" data-testid="refer-stats">
            <div className="m-meter">
              <div className="m-meter-top">
                <span className="m-mono m-meter-l">Friends Referred</span>
                <span className="m-mono m-meter-v" data-testid="refer-friends">{summary.stats.friendsReferred}</span>
              </div>
            </div>
            <div className="m-meter">
              <div className="m-meter-top">
                <span className="m-mono m-meter-l">Credits Earned</span>
                <span className="m-mono m-meter-v" data-testid="refer-earned">${summary.stats.creditsEarned}</span>
              </div>
            </div>
            <div className="m-meter">
              <div className="m-meter-top">
                <span className="m-mono m-meter-l">Credits Pending</span>
                <span className="m-mono m-meter-v" data-testid="refer-pending">{summary.stats.creditsPending}</span>
              </div>
            </div>
          </div>
          <p className="m-mono m-meter-reset">
            Pending referrals convert to credits the moment your friend subscribes.
          </p>
        </section>
      )}
    </div>
  )
}
