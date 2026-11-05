import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('guides/[slug] and compare/[competitor] title suffix not doubled (#1845)', () => {
  it('guide page builds title without appending "| AINative Builder" itself', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../app/guides/[slug]/page.tsx'),
      'utf-8',
    )
    // The root layout's title.template already appends "| AINative Builder"
    // to every page title. The guide page must not append it a second time.
    expect(source).not.toMatch(/const title = `\$\{guide\.title\}.*AINative Builder/)
    expect(source).toMatch(/const title = guide\.title/)
  })

  it('guide not-found fallback title does not hardcode the suffix either', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../app/guides/[slug]/page.tsx'),
      'utf-8',
    )
    expect(source).not.toMatch(/title: 'Guide Not Found \| AINative Builder'/)
  })

  it('compare page builds title without a leading "AINative Builder" prefix', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../app/compare/[competitor]/page.tsx'),
      'utf-8',
    )
    // These used to start with "AINative Builder vs ..." which, combined with
    // the layout's template appending "| AINative Builder", doubled the brand
    // name in the rendered <title>.
    expect(source).not.toMatch(/`AINative Builder vs Polsia/)
    expect(source).not.toMatch(/`AINative Builder vs \$\{data\.displayName\}/)
  })

  it('layout.tsx still owns the single title.template suffix', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../app/layout.tsx'), 'utf-8')
    expect(source).toMatch(/template:\s*'%s \| AINative Builder'/)
  })
})
