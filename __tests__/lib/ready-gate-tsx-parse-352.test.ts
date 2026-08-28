import { describe, it, expect } from 'vitest'
import { parse as babelParse } from '@babel/parser'
import { flattenMultiFile } from '@/lib/build/flatten-multifile'

/**
 * #352 — the flattened-parse gate (lib/build/ready-gate.ts) MUST parse with the
 * same plugin set as the preview renderer (which uses the TypeScript preset).
 * A jsx-only parser false-rejects valid .tsx apps on TS syntax (the aerosol
 * "Missing semicolon (154:30)" bug) — reporting a "truncation" that isn't one.
 *
 * These lock the parser config: valid TSX with type annotations must PASS, and
 * a genuinely truncated/unbalanced generation must still FAIL.
 */

// The exact call the gate makes.
function gateParse(code: string): { ok: boolean; msg?: string } {
  try {
    babelParse(flattenMultiFile(code), {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message.split('\n')[0] : String(e) }
  }
}

const VALID_TSX = `import { useState } from 'react'

interface Piece {
  id: number
  artist: string
  neighborhood: string
}

export default function App() {
  const [pieces] = useState<Piece[]>([
    { id: 1, artist: 'Ren', neighborhood: 'Seabright' },
    { id: 2, artist: 'Mira', neighborhood: 'Westside' },
  ])
  const [fav, setFav] = useState<Record<number, boolean>>({})
  const toggle = (id: number): void => setFav((f) => ({ ...f, [id]: !f[id] }))
  return (
    <div className="p-8">
      {pieces.map((p) => (
        <button key={p.id} onClick={() => toggle(p.id)}>
          {p.artist} — {p.neighborhood} {fav[p.id] ? '★' : '☆'}
        </button>
      ))}
    </div>
  )
}
`

const TRUNCATED = `export default function App() {
  return (
    <div className="grid">
      <h1>Gallery</h1>
      {items.map((i) => (
        <div key={i.id}>
));}}
`

describe('ready-gate flattened-parse plugin set (#352)', () => {
  it('PASSES a valid TSX app with type annotations (jsx-only would false-reject)', () => {
    expect(gateParse(VALID_TSX).ok).toBe(true)
  })

  it('STILL FAILS a genuinely truncated/unbalanced generation', () => {
    expect(gateParse(TRUNCATED).ok).toBe(false)
  })

  it("regression: TS type args like useState<Piece[]> don't read as a truncation", () => {
    const r = gateParse(VALID_TSX)
    expect(r.ok).toBe(true)
    expect(r.msg).toBeUndefined()
  })
})
