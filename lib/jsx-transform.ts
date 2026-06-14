/**
 * Server-side JSX transform using a pre-bundled sucrase (680KB, zero deps).
 * Bundled with esbuild to avoid Railway/Next.js node_modules resolution issues.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sucrase = require('./sucrase-bundle.js')

export function transformJSX(code: string): { code: string } | null {
  try {
    return sucrase.transform(code, {
      transforms: ['jsx'],
      jsxPragma: 'React.createElement',
      jsxFragmentPragma: 'React.Fragment',
      production: true,
    })
  } catch (e) {
    console.warn('[jsx-transform] Sucrase error:', (e as Error)?.message?.substring(0, 80))
    return null
  }
}
