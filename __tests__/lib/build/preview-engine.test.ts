import { describe, it, expect } from 'vitest'
import {
  shouldUseSandpack,
  countSourceFiles,
  hasCrossFileImports,
} from '@/lib/build/preview-engine'

describe('preview-engine routing (#291)', () => {
  describe('countSourceFiles', () => {
    it('counts real source files only', () => {
      expect(countSourceFiles({ '/App.tsx': 'x', '/Foo.tsx': 'y' })).toBe(2)
    })
    it('ignores non-source + empty files', () => {
      expect(countSourceFiles({
        '/App.tsx': 'x',
        '/robots.txt': 'User-agent: *',
        '/data.json': '{}',
        '/Empty.tsx': '   ',
      })).toBe(1)
    })
    it('handles null/empty', () => {
      expect(countSourceFiles(null)).toBe(0)
      expect(countSourceFiles({})).toBe(0)
    })
  })

  describe('hasCrossFileImports', () => {
    it('detects relative imports', () => {
      expect(hasCrossFileImports({ '/App.tsx': "import Foo from './Foo'" })).toBe(true)
    })
    it('detects @/ alias imports', () => {
      expect(hasCrossFileImports({ '/App.tsx': "import { Foo } from '@/components/Foo'" })).toBe(true)
    })
    it('ignores npm imports (react, lucide)', () => {
      expect(hasCrossFileImports({ '/App.tsx': "import React from 'react'\nimport { X } from 'lucide-react'" })).toBe(false)
    })
  })

  describe('shouldUseSandpack', () => {
    it('single-file app → Babel (false)', () => {
      const single = { '/App.tsx': "import React from 'react'\nexport default function App(){return <div>hi</div>}" }
      expect(shouldUseSandpack(single)).toBe(false)
    })

    it('multiple real source files → Sandpack (true)', () => {
      const multi = {
        '/App.tsx': "import Header from './Header'\nexport default function App(){return <Header/>}",
        '/Header.tsx': 'export default function Header(){return <h1>hi</h1>}',
      }
      expect(shouldUseSandpack(multi)).toBe(true)
    })

    it('single file BUT with cross-file imports → Sandpack (true)', () => {
      // The model referenced another local module even if only one file is present.
      const one = { '/App.tsx': "import { util } from './lib/util'\nexport default function App(){return <div/>}" }
      expect(shouldUseSandpack(one)).toBe(true)
    })

    it('single file with only npm imports → Babel (false)', () => {
      const one = { '/App.tsx': "import React from 'react'\nimport { Star } from 'lucide-react'\nexport default function App(){return <Star/>}" }
      expect(shouldUseSandpack(one)).toBe(false)
    })

    it('empty / null → Babel (false)', () => {
      expect(shouldUseSandpack(null)).toBe(false)
      expect(shouldUseSandpack({})).toBe(false)
      expect(shouldUseSandpack({ '/robots.txt': 'x' })).toBe(false)
    })

    it('multi-file with data files present still counts source files correctly', () => {
      const mixed = {
        '/App.tsx': 'export default function App(){return <div/>}',
        '/components/Card.tsx': 'export default function Card(){return <div/>}',
        '/data.json': '{"x":1}',
        '/sitemap.xml': '<xml/>',
      }
      expect(shouldUseSandpack(mixed)).toBe(true)
    })
  })
})
