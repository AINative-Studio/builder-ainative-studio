import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

describe('no internal jargon in user-facing copy (#BLD-08)', () => {
  it('Pricing.tsx feature list and tagline do not say "agent swarm" / "autonomous loop"', () => {
    const content = readFileSync('components/build/screens/Pricing.tsx', 'utf-8')
    expect(content).not.toContain('The nightly autonomous loop + real agent swarm')
    expect(content).not.toContain('Full agent-swarm autonomy.')
  })

  it('Account.tsx billing copy does not say "swarm" in display strings', () => {
    const content = readFileSync('components/build/screens/Account.tsx', 'utf-8')
    expect(content).not.toContain('Custom domain, nightly loop &amp; swarm on paid plans.')
    expect(content).not.toContain("'agent swarm'")
    expect(content).not.toContain('Upgrade to unlock custom domain, nightly loop, and the swarm.')
  })

  it('BuildOverlays.tsx headline/sub-copy do not say "swarm" or the internal "provision everything" phrasing', () => {
    const content = readFileSync('components/build/BuildOverlays.tsx', 'utf-8')
    expect(content).not.toContain("Cody&apos;s swarm is building the MVP")
    expect(content).not.toContain('Provision everything, ask nothing')
  })

  it('AutoModePanel.tsx activity line does not say "swarm"', () => {
    const content = readFileSync('components/build/AutoModePanel.tsx', 'utf-8')
    expect(content).not.toContain('Cody is dispatching the swarm on')
  })

  it('DocumentsPanel.tsx empty-state copy does not say "swarm"', () => {
    const content = readFileSync('components/build/DocumentsPanel.tsx', 'utf-8')
    expect(content).not.toContain('what the swarm did, metrics, and next actions')
  })

  it('OnboardingVideo.tsx fallback copy does not say "swarm"', () => {
    const content = readFileSync('components/build/OnboardingVideo.tsx', 'utf-8')
    expect(content).not.toContain("Cody and the swarm.")
  })

  it('LiveTicker.tsx ticker line does not say "swarm"', () => {
    const content = readFileSync('components/build/LiveTicker.tsx', 'utf-8')
    expect(content).not.toContain('swarm ▸ composing artifacts')
  })
})
