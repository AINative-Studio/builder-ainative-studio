// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ dispatch: dispatchMock }) }))

import { Start } from '@/components/build/screens/Start'

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

describe('Start — "Grow my company" reaches kickoff (#BLD-10)', () => {
  it('picking "Grow my company" then Continue dispatches GOTO_SCREEN build AND SET_GROWTH_INTENT true', async () => {
    render(React.createElement(Start))
    const growBtn = host.querySelector('[data-testid="start-grow"]') as HTMLButtonElement
    const continueBtn = host.querySelector('[data-testid="start-continue"]') as HTMLButtonElement
    await act(async () => { growBtn.click() })
    await act(async () => { continueBtn.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_GROWTH_INTENT', value: true })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'build' })
  })

  it('picking "Create a new company" then Continue dispatches SET_GROWTH_INTENT false', async () => {
    render(React.createElement(Start))
    const continueBtn = host.querySelector('[data-testid="start-continue"]') as HTMLButtonElement
    await act(async () => { continueBtn.click() })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_GROWTH_INTENT', value: false })
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'GOTO_SCREEN', screen: 'build' })
  })
})
