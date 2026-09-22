import { describe, it, expect } from 'vitest'
import { findDuplicateLandmarkElements } from '@/lib/build/completeness-gate'

/**
 * builder#816 — duplicate-landmark detector.
 *
 * Repro (issue #815, `agentive-product`): two real <aside> elements both
 * render simultaneously — the intended desktop sidebar
 * (data-agent-context="sidebar") and a "mobile" drawer
 * (data-agent-context="sidebar-mobile") with NO fixed/absolute positioning
 * and NO hide/off-canvas class at all, so it sits inline and visible on
 * every viewport instead of being a hidden-until-toggled drawer. The parse
 * and completeness gates all pass this cleanly (both elements are valid,
 * fully-resolved JSX) — this detector is the only thing that can see the
 * DUPLICATE, SIMULTANEOUSLY-VISIBLE landmark shape.
 */

describe('findDuplicateLandmarkElements', () => {
  it('AGENTIVE-PRODUCT REPRO: flags two sidebars where the extra one has no hide/off-canvas class', () => {
    const code = `
      export default function App() {
        return (
          <div>
            <aside data-agent-context="sidebar" className="flex flex-col bg-[#131726] text-white transition-all duration-300 sticky top-0 h-screen w-64">
              desktop nav
            </aside>
            <aside data-agent-context="sidebar-mobile" className="translate-x-0">
              mobile nav
            </aside>
            <main data-agent-context="main-content">content</main>
          </div>
        )
      }
    `
    const problems = findDuplicateLandmarkElements(code)
    expect(problems).toHaveLength(1)
    expect(problems[0].role).toBe('sidebar')
    expect(problems[0].contextValues).toEqual(['sidebar', 'sidebar-mobile'])
  })

  it('passes a single sidebar (no duplicate at all)', () => {
    const code = `
      export default function App() {
        return (
          <div>
            <aside data-agent-context="sidebar" className="w-64">nav</aside>
            <main data-agent-context="main-content">content</main>
          </div>
        )
      }
    `
    expect(findDuplicateLandmarkElements(code)).toEqual([])
  })

  it('passes a CORRECTLY-BUILT off-canvas mobile drawer (hidden until toggled via translate)', () => {
    const code = `
      export default function App() {
        return (
          <div>
            <aside data-agent-context="sidebar" className="hidden md:flex md:flex-col md:w-64 md:sticky md:top-0 md:h-screen">
              desktop nav
            </aside>
            <aside data-agent-context="sidebar-mobile" className="fixed inset-y-0 left-0 z-40 w-64 transform -translate-x-full transition-transform md:hidden">
              mobile nav
            </aside>
            <main data-agent-context="main-content">content</main>
          </div>
        )
      }
    `
    expect(findDuplicateLandmarkElements(code)).toEqual([])
  })

  it('passes a drawer hidden via a bare `hidden` utility class', () => {
    const code = `
      export default function App() {
        return (
          <div>
            <aside data-agent-context="sidebar" className="w-64">desktop nav</aside>
            <aside data-agent-context="sidebar-mobile" className="hidden">mobile nav (toggled open via JS)</aside>
          </div>
        )
      }
    `
    expect(findDuplicateLandmarkElements(code)).toEqual([])
  })

  it('passes a drawer hidden via aria-hidden="true"', () => {
    const code = `
      export default function App() {
        return (
          <div>
            <aside data-agent-context="sidebar" className="w-64">desktop nav</aside>
            <aside data-agent-context="sidebar-mobile" aria-hidden="true" className="translate-x-0">mobile nav</aside>
          </div>
        )
      }
    `
    expect(findDuplicateLandmarkElements(code)).toEqual([])
  })

  it('flags a duplicate <header> the same way as a duplicate sidebar', () => {
    const code = `
      export default function App() {
        return (
          <div>
            <header data-agent-context="header" className="flex items-center justify-between p-4">top bar</header>
            <header data-agent-context="header-mobile" className="p-4">mobile top bar</header>
          </div>
        )
      }
    `
    const problems = findDuplicateLandmarkElements(code)
    expect(problems).toHaveLength(1)
    expect(problems[0].role).toBe('header')
  })

  it('does not flag two elements with UNRELATED data-agent-context values', () => {
    const code = `
      export default function App() {
        return (
          <div>
            <section data-agent-context="revenue-chart">chart</section>
            <section data-agent-context="agents-section">agents</section>
          </div>
        )
      }
    `
    expect(findDuplicateLandmarkElements(code)).toEqual([])
  })

  it('does not flag a role appearing only ONCE even if other unrelated landmarks exist', () => {
    const code = `
      export default function App() {
        return (
          <div>
            <aside data-agent-context="sidebar" className="w-64">nav</aside>
            <header data-agent-context="header">top</header>
            <main data-agent-context="main-content">content</main>
            <footer data-agent-context="footer">bottom</footer>
          </div>
        )
      }
    `
    expect(findDuplicateLandmarkElements(code)).toEqual([])
  })

  it('flags THREE simultaneous instances of the same role when only one has a hide class', () => {
    const code = `
      export default function App() {
        return (
          <div>
            <aside data-agent-context="sidebar" className="w-64">a</aside>
            <aside data-agent-context="sidebar-tablet" className="w-48">b (no hide class)</aside>
            <aside data-agent-context="sidebar-mobile" className="hidden">c (hidden)</aside>
          </div>
        )
      }
    `
    // Two of the three instances have no hide indicator — still a real duplicate-visible bug.
    const problems = findDuplicateLandmarkElements(code)
    expect(problems).toHaveLength(1)
    expect(problems[0].role).toBe('sidebar')
    expect(problems[0].contextValues).toHaveLength(3)
  })

  it('resolves a concatenated // --- FILE: --- blob (landmarks split across files)', () => {
    const code = [
      `// --- FILE: src/App.tsx ---`,
      `import Sidebar from './components/Sidebar'`,
      `import MobileSidebar from './components/MobileSidebar'`,
      `export default function App(){ return <div><Sidebar/><MobileSidebar/></div> }`,
      `// --- FILE: src/components/Sidebar.tsx ---`,
      `export default function Sidebar(){ return <aside data-agent-context="sidebar" className="w-64">nav</aside> }`,
      `// --- FILE: src/components/MobileSidebar.tsx ---`,
      `export default function MobileSidebar(){ return <aside data-agent-context="sidebar-mobile" className="translate-x-0">nav</aside> }`,
    ].join('\n')
    const problems = findDuplicateLandmarkElements(code)
    expect(problems).toHaveLength(1)
    expect(problems[0].role).toBe('sidebar')
  })

  it('does not flag elements with no data-agent-context attribute at all', () => {
    const code = `
      export default function App() {
        return (
          <div>
            <aside className="w-64">nav 1</aside>
            <aside className="w-64">nav 2</aside>
          </div>
        )
      }
    `
    expect(findDuplicateLandmarkElements(code)).toEqual([])
  })

  it('handles data-agent-context passed via a JSX expression container', () => {
    const code = `
      export default function App() {
        const role = 'sidebar'
        return (
          <div>
            <aside data-agent-context={'sidebar'} className="w-64">a</aside>
            <aside data-agent-context={'sidebar-mobile'} className="translate-x-0">b</aside>
          </div>
        )
      }
    `
    const problems = findDuplicateLandmarkElements(code)
    expect(problems).toHaveLength(1)
    expect(problems[0].role).toBe('sidebar')
  })

  it('never throws on garbage input (fail-open)', () => {
    expect(findDuplicateLandmarkElements('')).toEqual([])
    expect(findDuplicateLandmarkElements('<<<not real jsx')).toEqual([])
    expect(findDuplicateLandmarkElements(null as unknown as string)).toEqual([])
  })

  it('does not flag a single element even with an unusual but known role value', () => {
    const code = `<nav data-agent-context="nav">main nav</nav>`
    expect(findDuplicateLandmarkElements(code)).toEqual([])
  })

  it('does not false-match main-content against an unrelated "content" landmark', () => {
    const code = `
      export default function App() {
        return (
          <div>
            <section data-agent-context="content">a</section>
            <section data-agent-context="content-preview">b</section>
          </div>
        )
      }
    `
    expect(findDuplicateLandmarkElements(code)).toEqual([])
  })
})
