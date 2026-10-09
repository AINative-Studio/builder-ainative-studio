// @vitest-environment jsdom
/**
 * Fork — track picker (#222/#65).
 *
 * Bug found during live Company-track QA (2026-10-09): "+ New company" from
 * MyCompanies routes here (GOTO_SCREEN 'fork'), and clicking "Build a
 * Company →" (or "Build an App →") calls pickTrack() → PICK_TRACK, which
 * does NOT clear state.idea. Fork is reached only from a "start fresh"
 * context (MyCompanies "+ New company", the landing page, or "Back" from
 * Intake) — never a resume path — so any idea text left over from a
 * PREVIOUS build earlier in the same browser session (e.g. an app the
 * founder built last week) silently reappears pre-filled in Intake's
 * textarea for the brand-new company. Confirmed live: a session with a
 * prior "Portside" marina app build showed that exact idea text pre-filled
 * after clicking "+ New company" → "Build a Company →".
 *
 * PICK_TRACK itself can't safely clear idea in the reducer — BuildStart's
 * "Surprise me" flow dispatches SET_IDEA with a freshly-generated idea
 * BEFORE calling pickTrack(), relying on PICK_TRACK leaving idea alone.
 * The fix belongs here, at the actual "start fresh" entry point.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const pickTrackMock = vi.fn()
const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({ state: { idea: 'Portside is a mobile app for marina operators...' }, dispatch: dispatchMock, pickTrack: pickTrackMock }),
}))
vi.mock('@/components/build/LiveProof', () => ({ LiveProof: () => null }))
vi.mock('@/components/build/LiveTicker', () => ({ LiveTicker: () => null }))
vi.mock('@/components/build/MenuChip', () => ({ MenuChip: () => null }))
vi.mock('@/components/build/ValueStrip', () => ({ ValueStrip: () => null }))

import { Fork } from '@/components/build/screens/Fork'

let host: HTMLElement
let root: Root
function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}
afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

describe('Fork — stale idea bleed-through on a fresh track pick', () => {
  it('clears any stale idea before picking the Company track from the card button', () => {
    render(React.createElement(Fork))
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Build a Company'))!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_IDEA', idea: '' })
    expect(pickTrackMock).toHaveBeenCalledWith('company')
  })

  it('clears any stale idea before picking the App track from the card button', () => {
    render(React.createElement(Fork))
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Build an App'))!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_IDEA', idea: '' })
    expect(pickTrackMock).toHaveBeenCalledWith('app')
  })

  it('clears stale idea when a card itself is clicked (not just its inner button)', () => {
    render(React.createElement(Fork))
    const card = host.querySelector('[data-track="company"]') as HTMLElement
    act(() => { card.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_IDEA', idea: '' })
    expect(pickTrackMock).toHaveBeenCalledWith('company')
  })
})
