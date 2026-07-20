import { describe, it, expect } from 'vitest'
import { aikitFiles } from '@/lib/sandpack/aikit-bundle'

/**
 * Regression: AIKit stubs (MetricCard, AIKitSidebar, EmptyState) took an `icon`
 * prop and rendered it as a CHILD ({icon}). Apps commonly pass a component
 * itself (icon={BarChart3}) rather than an element (icon={<BarChart3/>}); a bare
 * component object ({ $$typeof, render }) is not a valid React child, so Sandpack
 * crashed the whole preview with "Objects are not valid as a React child". The
 * stubs must route icon props through a renderIcon() that mounts components as
 * elements.
 */
describe('AIKit icon-prop stubs render components safely', () => {
  const iconStubs = [
    '/src/components/aikit/MetricCard.tsx',
    '/src/components/aikit/AIKitSidebar.tsx',
    '/src/components/aikit/EmptyState.tsx',
  ]

  for (const path of iconStubs) {
    it(`${path} defines renderIcon and uses it`, () => {
      const src = aikitFiles[path]
      expect(src, `${path} exists`).toBeTruthy()
      // has the guard helper
      expect(src).toMatch(/function renderIcon/)
      // the emitted (unescaped) code checks $$typeof correctly
      expect(src).toMatch(/icon\.\$\$typeof/)
      expect(src).toMatch(/React\.createElement\(icon\)/)
    })
  }

  it('MetricCard no longer renders a raw {icon} child', () => {
    const src = aikitFiles['/src/components/aikit/MetricCard.tsx']
    // the icon child must go through renderIcon, not be a bare {icon}
    expect(src).toMatch(/\{renderIcon\(icon\)\}/)
    expect(src).not.toMatch(/text-gray-400">\{icon\}</)
  })

  it('AIKitSidebar routes item.icon through renderIcon', () => {
    const src = aikitFiles['/src/components/aikit/AIKitSidebar.tsx']
    expect(src).toMatch(/\{renderIcon\(item\.icon\)\}/)
    expect(src).not.toMatch(/\{item\.icon\}\{item\.label\}/)
  })

  it('EmptyState routes icon through renderIcon', () => {
    const src = aikitFiles['/src/components/aikit/EmptyState.tsx']
    expect(src).toMatch(/\{renderIcon\(icon\)\}/)
  })
})
