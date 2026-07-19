import { describe, it, expect } from 'vitest'
import { enhancePromptWithMockData } from '@/lib/mock-data-generator'

/**
 * The prompt enhancer force-fed a revenue-dashboard mock-data block ("Total
 * Revenue $45,231…") to EVERY non-matching prompt, and mandated a dashboard
 * header on every app. Claude copied it verbatim, so contact forms / chat /
 * pricing / login all rendered the same generic dashboard (the "wrong app"
 * class found in the 20-prompt sweep).
 */
describe('enhancePromptWithMockData — no forced dashboard (wrong-app fix)', () => {
  const injectsDashboardData = (out: string) =>
    /Total Revenue|45,231|Active Users.*12,543/i.test(out)

  it('does NOT inject dashboard metrics for a contact form', () => {
    expect(injectsDashboardData(enhancePromptWithMockData('Build a contact form with name, email, message fields'))).toBe(false)
  })
  it('does NOT inject dashboard metrics for a pricing page', () => {
    expect(injectsDashboardData(enhancePromptWithMockData('Build a pricing page with three tiers'))).toBe(false)
  })
  it('does NOT inject dashboard metrics for a login form', () => {
    expect(injectsDashboardData(enhancePromptWithMockData('Build a login form with email and password'))).toBe(false)
  })
  it('does NOT inject dashboard metrics for a calendar', () => {
    expect(injectsDashboardData(enhancePromptWithMockData('Build a calendar month view'))).toBe(false)
  })

  it('DOES inject metrics for an explicit dashboard request', () => {
    const out = enhancePromptWithMockData('Build an analytics dashboard with metric cards')
    // dashboard prompts still get the revenue-metric sample data
    expect(injectsDashboardData(out)).toBe(true)
  })
  it('DOES inject metrics for an admin dashboard', () => {
    const out = enhancePromptWithMockData('Build an admin dashboard')
    expect(injectsDashboardData(out)).toBe(true)
  })

  it('injects chat data (not metrics) for a chat interface', () => {
    const out = enhancePromptWithMockData('Build a chat interface with messages and a send button')
    expect(injectsDashboardData(out)).toBe(false)
  })
  it('injects product data (not metrics) for e-commerce', () => {
    const out = enhancePromptWithMockData('Build an e-commerce product grid')
    expect(injectsDashboardData(out)).toBe(false)
  })

  it('no longer MANDATES a dashboard header on every app', () => {
    const out = enhancePromptWithMockData('Build a login form')
    // The old text force-required a header; the new guidance says match the app.
    expect(out).not.toMatch(/MUST include a professional header/)
    expect(out).toMatch(/best fits THIS specific request|do not force a dashboard/i)
  })

  it('softens mock data to optional ("MAY use"), not mandatory', () => {
    const out = enhancePromptWithMockData('Build an analytics dashboard')
    expect(out).not.toMatch(/IMPORTANT: Use this realistic mock data/)
  })

  it('appends no dangling data instruction when there is no mock data', () => {
    const out = enhancePromptWithMockData('Build a login form')
    expect(out).not.toMatch(/sample data you MAY use/i)
  })

  it('always returns the original prompt', () => {
    const p = 'Build a very specific unique widget xyz'
    expect(enhancePromptWithMockData(p)).toContain(p)
  })
})
