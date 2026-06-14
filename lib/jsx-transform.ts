/**
 * Server-side JSX transform using a pre-bundled sucrase.
 * Bundle is in public/ (always deployed) and loaded via absolute path.
 */
import path from 'path'
import fs from 'fs'

let _sucrase: any = null
let _loadAttempted = false

function getSucrase() {
  if (_sucrase || _loadAttempted) return _sucrase
  _loadAttempted = true

  // Try multiple paths where the bundle might be
  const paths = [
    path.join(process.cwd(), 'public', 'sucrase-bundle.js'),
    path.join(process.cwd(), 'lib', 'sucrase-bundle.js'),
    path.join(__dirname, 'sucrase-bundle.js'),
    path.join(__dirname, '..', 'public', 'sucrase-bundle.js'),
  ]

  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        _sucrase = require(p)
        console.log('[jsx-transform] Sucrase loaded from:', p)
        return _sucrase
      }
    } catch (e) {
      console.warn('[jsx-transform] Failed at', p, ':', (e as Error)?.message?.substring(0, 50))
    }
  }

  console.error('[jsx-transform] Sucrase bundle not found at any path:', paths.join(', '))
  return null
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
