'use client'

/**
 * First-run coach strip (#319 GR-10 — "Turn on the computer").
 *
 * Shown ONCE, at the very top of the center panel, to a founder in their
 * first-ever build. Assumes zero prior context: Cody spells out the literal
 * first steps in first person. Dismissed with "Got it" — the flag persists in
 * localStorage (lib/build/first-run.ts) so it never appears again.
 *
 * Visibility resolves in useEffect (not initial state) so SSR and the first
 * client render agree — no hydration mismatch.
 */

import { useEffect, useState } from 'react'
import { shouldShowFirstRun, markFirstRunSeen, browserStorage } from '@/lib/build/first-run'

export function FirstRunGuide() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(shouldShowFirstRun(browserStorage()))
  }, [])

  if (!visible) return null

  const dismiss = () => {
    markFirstRunSeen(browserStorage())
    setVisible(false)
  }

  return (
    <div className="m-firstrun" role="status" aria-label="First build guide">
      <p className="m-firstrun-head m-mono">
        <span className="m-glyph">◇</span> Cody · your first build
      </p>
      <p className="m-firstrun-lede">
        I&apos;m building your app right now — here&apos;s all you do:
      </p>
      <ol className="m-firstrun-steps">
        <li><span className="m-firstrun-num m-mono">1</span> Watch me work — each document I write appears here.</li>
        <li><span className="m-firstrun-num m-mono">2</span> When I pause to ask you a question, pick an answer.</li>
        <li><span className="m-firstrun-num m-mono">3</span> When the preview appears, click it.</li>
      </ol>
      <div className="m-firstrun-foot">
        <span className="m-firstrun-thats m-mono">That&apos;s it.</span>
        <button className="btn-primary m-firstrun-dismiss" onClick={dismiss}>
          Got it
        </button>
      </div>
    </div>
  )
}
