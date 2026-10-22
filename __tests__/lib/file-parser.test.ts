import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createFileTreeFromFiles,
  parseGeneratedFiles,
  simulateFileProgress,
  createFileTree,
} from '@/lib/file-parser'
import type { FileGroup, FileNode } from '@/components/chat/file-tree'

describe('createFileTreeFromFiles', () => {
  it('returns [] for empty input', () => {
    expect(createFileTreeFromFiles({})).toEqual([])
  })

  it('classifies every category and emits groups in the fixed order: config, components, styles, pages, ainative, other', () => {
    const files: Record<string, string> = {
      'package.json': '{}',
      'src/components/Button.tsx': 'export const Button = () => null',
      'src/styles/globals.css': 'body {}',
      'src/app/page.tsx': 'export default function Page() {}',
      'public/robots.txt': 'User-agent: *',
      'README.md': '# readme',
    }

    const result = createFileTreeFromFiles(files)
    expect(result.map((g) => g.id)).toEqual(['config', 'components', 'styles', 'pages', 'ainative', 'other'])
  })

  it('uses the exact expected group titles', () => {
    const files: Record<string, string> = {
      'package.json': '{}',
      'src/components/Button.tsx': 'x',
      'src/styles/globals.css': 'x',
      'src/app/page.tsx': 'x',
      'public/robots.txt': 'x',
      'README.md': 'x',
    }
    const result = createFileTreeFromFiles(files)
    const titleById = Object.fromEntries(result.map((g) => [g.id, g.title]))
    expect(titleById).toEqual({
      config: 'Configuration',
      components: 'Components',
      styles: 'Styles',
      pages: 'Pages',
      ainative: 'AINative Agent Files',
      other: 'Other',
    })
  })

  it('omits groups with no matching files', () => {
    const files: Record<string, string> = {
      'src/components/Button.tsx': 'x',
      'src/components/Card.tsx': 'x',
    }
    const result = createFileTreeFromFiles(files)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('components')
    expect(result[0].files).toHaveLength(2)
  })

  it('classifies a path containing /app/layout.tsx outside src/ as an agent/ainative file', () => {
    // The isAgentFile check is a substring match on '/app/layout.tsx' (leading slash
    // required) combined with NOT containing 'src/' — a bare 'app/layout.tsx' with no
    // leading slash does not match; a leading-slash or nested path does.
    const result = createFileTreeFromFiles({ '/app/layout.tsx': 'x' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('ainative')
  })

  it('classifies src/app/layout.tsx (excluded from agent rule by src/) as a page file instead', () => {
    const result = createFileTreeFromFiles({ 'src/app/layout.tsx': 'x' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('pages')
  })

  it('sets name = last path segment, type = "file", status = "completed"', () => {
    const result = createFileTreeFromFiles({ 'src/components/Button.tsx': 'x' })
    const node = result[0].files[0]
    expect(node.name).toBe('Button.tsx')
    expect(node.type).toBe('file')
    expect(node.status).toBe('completed')
    expect(typeof node.id).toBe('string')
    expect(node.id.length).toBeGreaterThan(0)
  })

  it('defaults action to "create", except "update" for config and style files', () => {
    const result = createFileTreeFromFiles({
      'package.json': 'x',
      'src/styles/globals.css': 'x',
      'src/components/Button.tsx': 'x',
      'src/app/page.tsx': 'x',
    })

    const byId = Object.fromEntries(result.map((g) => [g.id, g.files[0]]))
    expect(byId.config.action).toBe('update')
    expect(byId.styles.action).toBe('update')
    expect(byId.components.action).toBe('create')
    expect(byId.pages.action).toBe('create')
  })
})

describe('parseGeneratedFiles (deprecated)', () => {
  it('returns [] when none of the trigger substrings are present', () => {
    expect(parseGeneratedFiles('just some plain text')).toEqual([])
  })

  it('"function Dashboard" triggers a components group with Dashboard.tsx, titled "📦 Components"', () => {
    const result = parseGeneratedFiles('function Dashboard() { return null }')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('components')
    expect(result[0].title).toBe('📦 Components')
    expect(result[0].files[0]).toMatchObject({ path: 'src/components/Dashboard.tsx', name: 'Dashboard.tsx' })
  })

  it('"export default function" also triggers the components group', () => {
    const result = parseGeneratedFiles('export default function App() {}')
    expect(result.some((g) => g.id === 'components')).toBe(true)
  })

  it('"className=" triggers a styles group with globals.css', () => {
    const result = parseGeneratedFiles('<div className="foo">')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('styles')
    expect(result[0].title).toBe('🎨 Styles')
    expect(result[0].files[0]).toMatchObject({ path: 'src/styles/globals.css', name: 'globals.css' })
  })

  it('"tailwind" also triggers the styles group', () => {
    const result = parseGeneratedFiles('uses tailwind utility classes')
    expect(result.some((g) => g.id === 'styles')).toBe(true)
  })

  it('"React" or "useState" triggers a config group with package.json', () => {
    const result = parseGeneratedFiles('import { useState } from "react"; useState(0)')
    expect(result.some((g) => g.id === 'config')).toBe(true)
    const configGroup = result.find((g) => g.id === 'config')!
    expect(configGroup.files[0]).toMatchObject({ path: 'package.json', name: 'package.json' })
  })

  it('content matching all three triggers returns groups in push order: components, styles, config', () => {
    const content = `
      export default function Dashboard() {
        const [x] = useState(0)
        return <div className="foo">hi</div>
      }
    `
    const result = parseGeneratedFiles(content)
    expect(result.map((g) => g.id)).toEqual(['components', 'styles', 'config'])
  })
})

describe('simulateFileProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeGroups(): FileGroup[] {
    const makeFile = (id: string, path: string): FileNode => ({
      id,
      path,
      name: path,
      type: 'file',
      status: 'pending',
      action: 'create',
    })

    return [
      { id: 'g1', title: 'Group 1', files: [makeFile('f1', 'f1.tsx'), makeFile('f2', 'f2.tsx')] },
      { id: 'g2', title: 'Group 2', files: [makeFile('f3', 'f3.tsx')] },
    ]
  }

  it('marks the current file in_progress and earlier files completed on each tick, matched by id across groups', () => {
    const groups = makeGroups()
    const onUpdate = vi.fn()

    simulateFileProgress(groups, onUpdate)

    vi.advanceTimersByTime(800)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    let allFiles = onUpdate.mock.calls[0][0].flatMap((g: FileGroup) => g.files)
    expect(allFiles.find((f: FileNode) => f.id === 'f1').status).toBe('in_progress')
    expect(allFiles.find((f: FileNode) => f.id === 'f2').status).toBe('pending')
    expect(allFiles.find((f: FileNode) => f.id === 'f3').status).toBe('pending')

    vi.advanceTimersByTime(800)
    expect(onUpdate).toHaveBeenCalledTimes(2)
    allFiles = onUpdate.mock.calls[1][0].flatMap((g: FileGroup) => g.files)
    expect(allFiles.find((f: FileNode) => f.id === 'f1').status).toBe('completed')
    expect(allFiles.find((f: FileNode) => f.id === 'f2').status).toBe('in_progress')
    expect(allFiles.find((f: FileNode) => f.id === 'f3').status).toBe('pending')

    vi.advanceTimersByTime(800)
    expect(onUpdate).toHaveBeenCalledTimes(3)
    allFiles = onUpdate.mock.calls[2][0].flatMap((g: FileGroup) => g.files)
    expect(allFiles.find((f: FileNode) => f.id === 'f1').status).toBe('completed')
    expect(allFiles.find((f: FileNode) => f.id === 'f2').status).toBe('completed')
    expect(allFiles.find((f: FileNode) => f.id === 'f3').status).toBe('in_progress')
  })

  it('clears the interval once all files are processed; no further onUpdate calls', () => {
    const groups = makeGroups()
    const onUpdate = vi.fn()

    simulateFileProgress(groups, onUpdate)

    // 3 files total -> 3 ticks process them, 4th tick sees currentIndex >= length and clears
    vi.advanceTimersByTime(800 * 4)
    const countAfterCompletion = onUpdate.mock.calls.length
    expect(countAfterCompletion).toBe(3)

    vi.advanceTimersByTime(800 * 3)
    expect(onUpdate.mock.calls.length).toBe(countAfterCompletion)
  })

  it('the returned cleanup function stops further onUpdate calls', () => {
    const groups = makeGroups()
    const onUpdate = vi.fn()

    const cleanup = simulateFileProgress(groups, onUpdate)

    vi.advanceTimersByTime(800)
    expect(onUpdate).toHaveBeenCalledTimes(1)

    cleanup()

    vi.advanceTimersByTime(800 * 5)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('createFileTree', () => {
  it('always includes config, styles, and pages groups regardless of prompt content', () => {
    const result = createFileTree('some totally unrelated prompt text')
    const ids = result.map((g) => g.id)
    expect(ids).toContain('config')
    expect(ids).toContain('styles')
    expect(ids).toContain('pages')

    const config = result.find((g) => g.id === 'config')!
    expect(config.title).toBe('⚙️ Configuration')
    expect(config.files.map((f) => f.path)).toEqual(['package.json', 'tsconfig.json'])
    expect(config.files.every((f) => f.status === 'pending' && f.action === 'update')).toBe(true)

    const styles = result.find((g) => g.id === 'styles')!
    expect(styles.title).toBe('🎨 Styles')
    expect(styles.files.map((f) => f.path)).toEqual(['src/styles/globals.css', 'tailwind.config.js'])

    const pages = result.find((g) => g.id === 'pages')!
    expect(pages.title).toBe('📄 Pages')
    expect(pages.files.map((f) => f.path)).toEqual(['src/app/page.tsx'])
  })

  it('dashboard/analytics/metrics prompt produces Dashboard, MetricCard, Chart components', () => {
    const result = createFileTree('build me an analytics dashboard with metrics')
    const components = result.find((g) => g.id === 'components')!
    expect(components.title).toBe('📦 Components')
    expect(components.files.map((f) => f.name)).toEqual(['Dashboard.tsx', 'MetricCard.tsx', 'Chart.tsx'])
  })

  it('ecommerce/shop/cart/product prompt produces ProductList, ProductCard, ShoppingCart components', () => {
    const result = createFileTree('build me a shop with a cart for products')
    const components = result.find((g) => g.id === 'components')!
    expect(components.files.map((f) => f.name)).toEqual(['ProductList.tsx', 'ProductCard.tsx', 'ShoppingCart.tsx'])
  })

  it('form/contact/input/submit prompt produces ContactForm, FormField components', () => {
    const result = createFileTree('I need a contact form with a submit button')
    const components = result.find((g) => g.id === 'components')!
    expect(components.files.map((f) => f.name)).toEqual(['ContactForm.tsx', 'FormField.tsx'])
  })

  it('falls through to the default App/Layout components when no pattern matches', () => {
    const result = createFileTree('build me a simple landing homepage')
    const components = result.find((g) => g.id === 'components')!
    expect(components.files.map((f) => f.name)).toEqual(['App.tsx', 'Layout.tsx'])
  })

  it('a prompt matching both dashboard and ecommerce patterns takes the dashboard branch (first if wins)', () => {
    const result = createFileTree('ecommerce dashboard for my shop analytics')
    const components = result.find((g) => g.id === 'components')!
    expect(components.files.map((f) => f.name)).toEqual(['Dashboard.tsx', 'MetricCard.tsx', 'Chart.tsx'])
  })
})
