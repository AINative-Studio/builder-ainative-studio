// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

import { TextCodyCard } from '@/components/build/TextCodyCard'

let host: HTMLElement
let root: Root
function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

describe('TextCodyCard', () => {
  it('displays the real shared number, formatted for readability', () => {
    render(React.createElement(TextCodyCard))
    expect(host.textContent).toMatch(/\(937\)\s*764-2838/)
  })

  it('carries the same SMS consent disclosure language as ZeroVoiceConnect', () => {
    render(React.createElement(TextCodyCard))
    expect(host.textContent).toMatch(/agree to receive SMS replies from Cody/i)
    expect(host.querySelector('a[href*="sms-terms"]')).toBeTruthy()
  })

  it('renders no action button — nothing to provision, the number already exists', () => {
    render(React.createElement(TextCodyCard))
    expect(host.querySelectorAll('button').length).toBe(0)
  })
})
