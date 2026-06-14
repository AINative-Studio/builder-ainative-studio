/**
 * Server-side JSX transform using a pre-bundled sucrase (680KB, zero deps).
 * Uses path.join + require to prevent webpack from resolving at build time.
 */
import path from 'path'

let _sucrase: any = null

function getSucrase() {
  if (_sucrase) return _sucrase
  try {
    // Use path.join to prevent webpack from resolving the require at build time
    const bundlePath = path.join(process.cwd(), 'lib', 'sucrase-bundle.js')
    _sucrase = require(bundlePath)
    console.log('[jsx-transform] Sucrase loaded from:', bundlePath)
  } catch (e) {
    console.error('[jsx-transform] Failed to load sucrase:', (e as Error)?.message?.substring(0, 100))
  }
  return _sucrase
}

export function transformJSX(code: string): { code: string } | null {
  const sucrase = getSucrase()
  if (!sucrase) return null
  try {
    return sucrase.transform(code, {
      transforms: ['jsx'],
      jsxPragma: 'React.createElement',
      jsxFragmentPragma: 'React.Fragment',
      production: true,
    })
  } catch (e) {
    console.warn('[jsx-transform] Transform error:', (e as Error)?.message?.substring(0, 80))
    return null
  }
}
