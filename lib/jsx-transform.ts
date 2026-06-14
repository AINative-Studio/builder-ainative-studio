/**
 * Server-side JSX transform using sucrase.
 * This wrapper exists because Next.js webpack has trouble importing
 * sucrase directly in API routes. This module is marked as external.
 */

export function transformJSX(code: string): { code: string } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { transform } = require('sucrase')
    return transform(code, {
      transforms: ['jsx'],
      jsxPragma: 'React.createElement',
      jsxFragmentPragma: 'React.Fragment',
      production: true,
    })
  } catch (e) {
    console.error('[jsx-transform] Failed:', (e as Error)?.message?.substring(0, 100))
    return null
  }
}
