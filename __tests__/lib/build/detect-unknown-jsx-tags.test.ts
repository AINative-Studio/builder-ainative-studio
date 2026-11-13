import { describe, it, expect } from 'vitest'
import { detectUnknownJsxTags } from '@/lib/build/detect-unknown-jsx-tags'

describe('detectUnknownJsxTags', () => {
  const knownComponents = new Set(['Button', 'Input', 'Card'])

  it('does not flag a shadcn-style generic prop type as an unknown JSX tag', () => {
    const code = `
      function Button({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
        return <button className={className}>{children}</button>
      }
    `
    expect(detectUnknownJsxTags(code, knownComponents)).toEqual([])
  })

  it('does not flag a bare generic with no member access (useRef<HTMLInputElement>)', () => {
    const code = `
      function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
        const ref = useRef<HTMLInputElement>(null)
        return <input ref={ref} {...props} />
      }
    `
    expect(detectUnknownJsxTags(code, knownComponents)).toEqual([])
  })

  it('still flags a genuinely undeclared component used as real JSX', () => {
    const code = `
      function App() {
        return <Ghost />
      }
    `
    expect(detectUnknownJsxTags(code, knownComponents)).toEqual(['Ghost'])
  })

  it('still flags a real undeclared component on the same line as a generic type argument', () => {
    const code = `
      function App(props: React.HTMLAttributes<HTMLDivElement>) {
        return <Ghost {...props} />
      }
    `
    expect(detectUnknownJsxTags(code, knownComponents)).toEqual(['Ghost'])
  })

  it('does not treat a real component used after return/yield as a generic', () => {
    const code = `
      function App() {
        if (loading) return <Ghost />
      }
    `
    expect(detectUnknownJsxTags(code, knownComponents)).toEqual(['Ghost'])
  })
})
