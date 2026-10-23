import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * lib/services/template-customizer.service.ts had zero test coverage. It is
 * pure prompt-parsing/placeholder-substitution logic with only `logger` as a
 * dependency (mocked). Covers placeholder extraction (title/app/brand/store
 * names, dashboard metrics, landing features, CTA text, and the extensive
 * default-value fallbacks), template substitution, the full customize()
 * pipeline including its error path, and output validation.
 */

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

import {
  TemplateCustomizerService,
  getTemplateCustomizerService,
} from '@/lib/services/template-customizer.service'

describe('#1201 lib/services/template-customizer.service', () => {
  let service: TemplateCustomizerService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new TemplateCustomizerService()
  })

  describe('extractPlaceholders', () => {
    it('extracts a quoted title and propagates it to every title placeholder', () => {
      const values = service.extractPlaceholders('Build a dashboard called "Sales Tracker"', 'dashboard')
      expect(values.dashboard_title).toBe('Sales Tracker')
      expect(values.hero_title).toBe('Sales Tracker')
      expect(values.blog_title).toBe('Sales Tracker')
      expect(values.admin_title).toBe('Sales Tracker')
      expect(values.table_title).toBe('Sales Tracker')
    })

    it('extracts an app name when the prompt names the application', () => {
      const values = service.extractPlaceholders('Build an app called TaskFlow for managing tasks', 'landing')
      expect(values.app_name).toBe('TaskFlow')
    })

    it('extracts a brand name when the prompt names the brand/company', () => {
      const values = service.extractPlaceholders('A business named Acme Corp', 'landing')
      expect(values.brand_name).toBe('Acme')
    })

    it('extracts a store name when the prompt names the store/shop', () => {
      const values = service.extractPlaceholders('An online store called Widgets Co', 'ecommerce')
      expect(values.store_name).toBe('Widgets')
    })

    it('extracts dashboard metrics from a "showing X, Y and Z" phrase, capitalized', () => {
      const values = service.extractPlaceholders(
        'Build a dashboard showing revenue, signups and churn rate',
        'dashboard'
      )
      expect(values.metric1_title).toBe('Revenue')
      expect(values.metric2_title).toBe('Signups')
    })

    it('falls back to default dashboard metrics when none are extracted', () => {
      const values = service.extractPlaceholders('Build a simple dashboard', 'dashboard')
      expect(values.metric1_title).toBe('Total Revenue')
      expect(values.metric2_title).toBe('Active Users')
      expect(values.metric3_title).toBe('Total Orders')
      expect(values.metric4_title).toBe('Growth Rate')
    })

    it('caps extracted dashboard metrics at 4 even when more are listed', () => {
      const values = service.extractPlaceholders(
        'dashboard showing a, b, c, d and e',
        'dashboard'
      )
      expect(values.metric4_title).toBeDefined()
      expect(values['metric5_title']).toBeUndefined()
    })

    it('extracts CTA button text and propagates it to all CTA placeholders', () => {
      const values = service.extractPlaceholders('Add a button saying "Join Now"', 'landing')
      expect(values.cta_primary_text).toBe('Join Now')
      expect(values.checkout_button_text).toBe('Join Now')
      expect(values.final_cta_text).toBe('Join Now')
    })

    it('extracts landing-page features and falls back to defaults when none found', () => {
      const withFeatures = service.extractPlaceholders(
        'A landing page with features like speed, security and ease of use',
        'landing'
      )
      expect(withFeatures.feature1_title).toBe('Speed')

      const withoutFeatures = service.extractPlaceholders('A simple landing page', 'landing')
      expect(withoutFeatures.feature1_title).toBe('Fast Performance')
      expect(withoutFeatures.feature2_title).toBe('Secure & Reliable')
    })

    it('fills in every documented default placeholder when the prompt gives no signal at all', () => {
      const values = service.extractPlaceholders('build something', 'admin')
      expect(values.app_name).toBe('MyApp')
      expect(values.brand_name).toBe('MyBrand')
      expect(values.store_name).toBe('MyStore')
      expect(values.dashboard_title).toBe('Dashboard')
      expect(values.hero_title).toBe('Welcome to Our Platform')
      expect(values.hero_subtitle).toContain('Build amazing things')
      expect(values.blog_title).toBe('Our Blog')
      expect(values.blog_subtitle).toContain('Insights, updates')
      expect(values.cta_primary_text).toBe('Get Started')
      expect(values.cta_secondary_text).toBe('Learn More')
      expect(values.checkout_button_text).toBe('Proceed to Checkout')
      expect(values.final_cta_text).toBe('Start Free Trial')
      expect(values.category_title).toBe('All Products')
      expect(values.table_title).toBe('Data Management')
      expect(values.admin_title).toBe('Admin Panel')
      expect(values.breadcrumb_section).toBe('Admin')
      expect(values.breadcrumb_page).toBe('Dashboard')
      expect(values.entity_name).toBe('Item')
      expect(values.entity_name_plural).toBe('Items')
      expect(values.sidebar_about_title).toBe('About This Blog')
      expect(values.sidebar_about_text).toContain('Welcome to our blog')
    })

    it('does not extract dashboard metrics or landing features for an unrelated category', () => {
      const values = service.extractPlaceholders('showing revenue and signups', 'blog')
      // category is 'blog', not 'dashboard', so the metrics branch is skipped
      // entirely — only the generic default fallback values apply.
      expect(values.metric1_title).toBeUndefined()
    })
  })

  describe('customizeTemplate', () => {
    it('replaces every placeholder present in the values map', () => {
      const result = service.customizeTemplate(
        'export default function App() { return <h1>{{title}}</h1> }',
        { title: 'Hello' },
        ['title']
      )
      expect(result.customizedCode).toContain('<h1>Hello</h1>')
      expect(result.placeholdersReplaced).toEqual(['title'])
      expect(result.placeholdersNotFound).toEqual([])
      expect(result.success).toBe(true)
    })

    it('tracks placeholders with no provided value as not-found and leaves them in the code', () => {
      const result = service.customizeTemplate(
        '<h1>{{title}}</h1><p>{{subtitle}}</p>',
        { title: 'Hello' },
        ['title', 'subtitle']
      )
      expect(result.placeholdersReplaced).toEqual(['title'])
      expect(result.placeholdersNotFound).toEqual(['subtitle'])
      expect(result.customizedCode).toContain('{{subtitle}}')
    })

    it('marks success:false when any {{...}} placeholder remains unreplaced in the output', () => {
      const result = service.customizeTemplate('<p>{{unknown_token}}</p>', {}, [])
      expect(result.success).toBe(false)
    })

    it('replaces every occurrence of a repeated placeholder', () => {
      const result = service.customizeTemplate(
        '{{name}} says hi to {{name}}',
        { name: 'Bob' },
        ['name']
      )
      expect(result.customizedCode).toBe('Bob says hi to Bob')
    })
  })

  describe('customize (full pipeline)', () => {
    it('extracts values from the prompt and substitutes them into the template', async () => {
      const result = await service.customize(
        'export default function App() { return <h1>{{dashboard_title}}</h1> }',
        ['dashboard_title'],
        'Build a dashboard called "Sales"',
        'dashboard'
      )
      expect(result.customizedCode).toContain('<h1>Sales</h1>')
      expect(result.success).toBe(true)
    })

    it('catches an internal error and returns a graceful failure result with the original code intact', async () => {
      const brokenService = new TemplateCustomizerService()
      vi.spyOn(brokenService, 'extractPlaceholders').mockImplementation(() => {
        throw new Error('extraction exploded')
      })

      const result = await brokenService.customize('<p>{{x}}</p>', ['x'], 'prompt', 'blog')

      expect(result).toEqual({
        customizedCode: '<p>{{x}}</p>',
        placeholdersReplaced: [],
        placeholdersNotFound: ['x'],
        success: false,
      })
    })
  })

  describe('validateCustomizedCode', () => {
    it('reports valid:true for well-formed code with no issues', () => {
      const code = `
        import { Button } from '@/components/ui/button'
        export default function App() {
          return <Button>Click</Button>
        }
      `
      const result = service.validateCustomizedCode(code)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('flags unreplaced placeholders with a count and the literal tokens', () => {
      const code = `
        export default function App() {
          return <h1>{{title}}</h1>
        }
      `
      const result = service.validateCustomizedCode(code)
      expect(result.errors.some((e) => e.includes('unreplaced placeholders'))).toBe(true)
      expect(result.errors.some((e) => e.includes('{{title}}'))).toBe(true)
    })

    it('flags a missing default export', () => {
      const result = service.validateCustomizedCode('function App() { return <div /> }')
      expect(result.errors).toContain('Missing default export')
    })

    it('flags a missing return statement', () => {
      const result = service.validateCustomizedCode('export default function App() {}')
      expect(result.errors).toContain('Missing return statement')
    })

    it('flags missing UI component imports', () => {
      const code = `export default function App() { return <div>hi</div> }`
      const result = service.validateCustomizedCode(code)
      expect(result.errors).toContain('Missing UI component imports')
    })

    it('accumulates multiple independent errors at once', () => {
      const result = service.validateCustomizedCode('{{x}}')
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(1)
    })
  })

  describe('getTemplateCustomizerService (singleton)', () => {
    it('returns the same instance across calls', () => {
      const a = getTemplateCustomizerService()
      const b = getTemplateCustomizerService()
      expect(a).toBe(b)
    })
  })
})
