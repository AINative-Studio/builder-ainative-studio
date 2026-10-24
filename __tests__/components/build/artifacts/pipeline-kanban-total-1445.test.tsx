// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Pipeline } from '@/components/build/artifacts/Pipeline'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1445 — kanban column totals used `parseInt(d.v)` directly on a value
 * string like '$18k'. parseInt stops at the leading '$' (a non-digit), so
 * every deal contributed NaN to the running sum and `(s + NaN) || 0`
 * silently coerced every column's total to $0k regardless of its real
 * deals. Fixed by stripping non-digit characters before parsing. These
 * assertions check the REAL fixed sums, not just "not $0k".
 */

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
})

describe('Pipeline — kanban column totals (#1445)', () => {
  it('sums each column\'s real deal values instead of showing $0k', () => {
    render(React.createElement(Pipeline))

    const headers = Array.from(host.querySelectorAll('.m-kan-head')).map((el) => el.textContent)
    expect(headers[0]).toContain('$18k') // Qualified: Northwind Ops $18k
    expect(headers[1]).toContain('$36k') // In conversation: Acme Retail $24k + Bolt Logistics $12k
    expect(headers[2]).toContain('$32k') // Proposal: Vertex Health $32k
    expect(headers[3]).toContain('$0k')  // Closed won: Pike Manufacturing is genuinely $0k
  })
})
