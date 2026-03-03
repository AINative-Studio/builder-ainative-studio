import { logger } from '@/lib/logger'

export interface PlaceholderValues {
  [key: string]: string
}

export interface CustomizationResult {
  customizedCode: string
  placeholdersReplaced: string[]
  placeholdersNotFound: string[]
  success: boolean
}

/**
 * Template Customizer Service
 *
 * Replaces placeholders in template code with user-specific values extracted from prompts.
 * Preserves template structure while customizing content.
 */
export class TemplateCustomizerService {
  /**
   * Extract placeholder values from a user prompt using NLP and pattern matching
   */
  extractPlaceholders(prompt: string, templateCategory: string): PlaceholderValues {
    const normalizedPrompt = prompt.toLowerCase()
    const values: PlaceholderValues = {}

    // Common placeholder extraction patterns
    const patterns: Record<string, RegExp[]> = {
      // Title extraction
      title: [
        /(?:called|named|titled)\s+"([^"]+)"/i,
        /(?:called|named|titled)\s+['']([^'']+)['']?/i,
        /(?:called|named|titled)\s+(\w+(?:\s+\w+){0,4})/i,
        /(?:for|about)\s+(?:a|an|the)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/,
      ],

      // App/Brand name
      app_name: [
        /(?:app|application|platform)\s+(?:called|named)\s+"([^"]+)"/i,
        /(?:app|application|platform)\s+(?:called|named)\s+(\w+)/i,
      ],

      brand_name: [
        /(?:brand|company|business)\s+(?:called|named)\s+"([^"]+)"/i,
        /(?:brand|company|business)\s+(?:called|named)\s+(\w+)/i,
      ],

      store_name: [
        /(?:store|shop)\s+(?:called|named)\s+"([^"]+)"/i,
        /(?:store|shop)\s+(?:called|named)\s+(\w+)/i,
      ],

      // Metrics extraction (for dashboards)
      metrics: [
        /(?:showing|display|track|monitor)\s+([^.]+?)(?:\s+and\s+|\s*,\s*|\s*$)/gi,
      ],

      // CTA text
      cta_text: [
        /button\s+(?:saying|labeled|with)\s+"([^"]+)"/i,
        /button\s+text\s+"([^"]+)"/i,
      ],

      // Features (for landing pages)
      features: [
        /features?\s+(?:like|such as|including)\s+([^.]+)/i,
      ],
    }

    // Extract title/name
    for (const pattern of patterns.title) {
      const match = prompt.match(pattern)
      if (match) {
        values.dashboard_title = match[1].trim()
        values.hero_title = match[1].trim()
        values.blog_title = match[1].trim()
        values.admin_title = match[1].trim()
        values.table_title = match[1].trim()
        break
      }
    }

    // Extract app/brand/store names
    for (const pattern of patterns.app_name) {
      const match = prompt.match(pattern)
      if (match) {
        values.app_name = match[1].trim()
        break
      }
    }

    for (const pattern of patterns.brand_name) {
      const match = prompt.match(pattern)
      if (match) {
        values.brand_name = match[1].trim()
        break
      }
    }

    for (const pattern of patterns.store_name) {
      const match = prompt.match(pattern)
      if (match) {
        values.store_name = match[1].trim()
        break
      }
    }

    // Extract metrics for dashboards
    if (templateCategory === 'dashboard') {
      const metricsMatch = normalizedPrompt.match(
        /(?:showing|display|track|monitor|with)\s+(.+?)(?:\s+metrics?|\s+and|\s*$)/i
      )

      if (metricsMatch) {
        const metricsText = metricsMatch[1]
        const metricsList = metricsText
          .split(/,|\s+and\s+/)
          .map((m) => m.trim())
          .filter((m) => m.length > 0)

        metricsList.forEach((metric, index) => {
          if (index < 4) {
            values[`metric${index + 1}_title`] = this.capitalizeWords(metric)
          }
        })
      }

      // Default metrics if none extracted
      if (!values.metric1_title) values.metric1_title = 'Total Revenue'
      if (!values.metric2_title) values.metric2_title = 'Active Users'
      if (!values.metric3_title) values.metric3_title = 'Total Orders'
      if (!values.metric4_title) values.metric4_title = 'Growth Rate'
    }

    // Extract CTA text
    for (const pattern of patterns.cta_text) {
      const match = prompt.match(pattern)
      if (match) {
        values.cta_primary_text = match[1].trim()
        values.checkout_button_text = match[1].trim()
        values.final_cta_text = match[1].trim()
        break
      }
    }

    // Extract features for landing pages
    if (templateCategory === 'landing') {
      const featuresMatch = prompt.match(patterns.features[0])
      if (featuresMatch) {
        const featuresText = featuresMatch[1]
        const featuresList = featuresText
          .split(/,|\s+and\s+/)
          .map((f) => f.trim())
          .filter((f) => f.length > 0)

        featuresList.forEach((feature, index) => {
          if (index < 4) {
            values[`feature${index + 1}_title`] = this.capitalizeWords(feature)
          }
        })
      }

      // Default features if none extracted
      if (!values.feature1_title) values.feature1_title = 'Fast Performance'
      if (!values.feature2_title) values.feature2_title = 'Secure & Reliable'
      if (!values.feature3_title) values.feature3_title = 'Easy Collaboration'
      if (!values.feature4_title) values.feature4_title = 'Advanced Analytics'
    }

    // Set default values for common placeholders
    if (!values.app_name) values.app_name = 'MyApp'
    if (!values.brand_name) values.brand_name = 'MyBrand'
    if (!values.store_name) values.store_name = 'MyStore'
    if (!values.dashboard_title) values.dashboard_title = 'Dashboard'
    if (!values.hero_title) values.hero_title = 'Welcome to Our Platform'
    if (!values.hero_subtitle) values.hero_subtitle = 'Build amazing things with our powerful tools'
    if (!values.blog_title) values.blog_title = 'Our Blog'
    if (!values.blog_subtitle) values.blog_subtitle = 'Insights, updates, and stories from our team'
    if (!values.cta_primary_text) values.cta_primary_text = 'Get Started'
    if (!values.cta_secondary_text) values.cta_secondary_text = 'Learn More'
    if (!values.checkout_button_text) values.checkout_button_text = 'Proceed to Checkout'
    if (!values.final_cta_text) values.final_cta_text = 'Start Free Trial'
    if (!values.category_title) values.category_title = 'All Products'
    if (!values.table_title) values.table_title = 'Data Management'
    if (!values.admin_title) values.admin_title = 'Admin Panel'
    if (!values.breadcrumb_section) values.breadcrumb_section = 'Admin'
    if (!values.breadcrumb_page) values.breadcrumb_page = 'Dashboard'
    if (!values.entity_name) values.entity_name = 'Item'
    if (!values.entity_name_plural) values.entity_name_plural = 'Items'
    if (!values.sidebar_about_title) values.sidebar_about_title = 'About This Blog'
    if (!values.sidebar_about_text)
      values.sidebar_about_text =
        'Welcome to our blog where we share insights, tutorials, and updates about our products and industry.'

    logger.info('Extracted placeholders from prompt', {
      prompt: prompt.substring(0, 100),
      templateCategory,
      extractedCount: Object.keys(values).length,
      values,
    })

    return values
  }

  /**
   * Capitalize first letter of each word
   */
  private capitalizeWords(text: string): string {
    return text
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  }

  /**
   * Replace placeholders in template code with actual values
   */
  customizeTemplate(
    templateCode: string,
    placeholderValues: PlaceholderValues,
    templatePlaceholders: string[]
  ): CustomizationResult {
    let customizedCode = templateCode
    const placeholdersReplaced: string[] = []
    const placeholdersNotFound: string[] = []

    // Replace each placeholder
    for (const placeholder of templatePlaceholders) {
      const placeholderPattern = new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g')
      const value = placeholderValues[placeholder]

      if (value !== undefined) {
        customizedCode = customizedCode.replace(placeholderPattern, value)
        placeholdersReplaced.push(placeholder)
      } else {
        placeholdersNotFound.push(placeholder)
      }
    }

    // Check for any remaining unreplaced placeholders
    const remainingPlaceholders = customizedCode.match(/\{\{[^}]+\}\}/g)

    const result: CustomizationResult = {
      customizedCode,
      placeholdersReplaced,
      placeholdersNotFound,
      success: !remainingPlaceholders || remainingPlaceholders.length === 0,
    }

    logger.info('Template customization completed', {
      totalPlaceholders: templatePlaceholders.length,
      replaced: placeholdersReplaced.length,
      notFound: placeholdersNotFound.length,
      remainingUnreplaced: remainingPlaceholders?.length || 0,
      success: result.success,
    })

    return result
  }

  /**
   * Full customization pipeline: extract values and replace placeholders
   */
  async customize(
    templateCode: string,
    templatePlaceholders: string[],
    userPrompt: string,
    templateCategory: string
  ): Promise<CustomizationResult> {
    try {
      // Extract placeholder values from prompt
      const placeholderValues = this.extractPlaceholders(userPrompt, templateCategory)

      // Replace placeholders in template
      const result = this.customizeTemplate(
        templateCode,
        placeholderValues,
        templatePlaceholders
      )

      return result
    } catch (error) {
      logger.error('Template customization failed', {
        error,
        templateCategory,
        prompt: userPrompt.substring(0, 100),
      })

      return {
        customizedCode: templateCode,
        placeholdersReplaced: [],
        placeholdersNotFound: templatePlaceholders,
        success: false,
      }
    }
  }

  /**
   * Validate that template code has proper structure after customization
   */
  validateCustomizedCode(code: string): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Check for unreplaced placeholders
    const unreplacedPlaceholders = code.match(/\{\{[^}]+\}\}/g)
    if (unreplacedPlaceholders && unreplacedPlaceholders.length > 0) {
      errors.push(
        `Found ${unreplacedPlaceholders.length} unreplaced placeholders: ${unreplacedPlaceholders.join(', ')}`
      )
    }

    // Check for basic React syntax
    if (!code.includes('export default')) {
      errors.push('Missing default export')
    }

    if (!code.includes('return')) {
      errors.push('Missing return statement')
    }

    // Check for common imports
    if (!code.includes("from '@/components/ui/")) {
      errors.push('Missing UI component imports')
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}

// Singleton instance
let customizerInstance: TemplateCustomizerService | null = null

export function getTemplateCustomizerService(): TemplateCustomizerService {
  if (!customizerInstance) {
    customizerInstance = new TemplateCustomizerService()
  }
  return customizerInstance
}
