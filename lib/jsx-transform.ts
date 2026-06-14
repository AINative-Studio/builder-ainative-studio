/**
 * Server-side JSX → JS transform.
 * Uses sucrase (marked as serverExternalPackages in next.config.ts).
 */
import { transform } from 'sucrase'

export function transformJSX(code: string): { code: string } | null {
  try {
    console.log('[jsx-transform] Running sucrase transform...')
    return transform(code, {
      transforms: ['jsx'],
      jsxPragma: 'React.createElement',
      jsxFragmentPragma: 'React.Fragment',
      production: true,
    })
  } catch (e) {
    console.warn('[jsx-transform] Error:', (e as Error)?.message?.substring(0, 80))
    return null
  }
}
