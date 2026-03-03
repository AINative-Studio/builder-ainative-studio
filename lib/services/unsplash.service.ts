import { createApi } from 'unsplash-js'

// Unsplash client (only initialize if API key is available)
const unsplash = process.env.UNSPLASH_ACCESS_KEY &&
  process.env.UNSPLASH_ACCESS_KEY !== 'YOUR_UNSPLASH_ACCESS_KEY_HERE'
  ? createApi({ accessKey: process.env.UNSPLASH_ACCESS_KEY })
  : null

export interface UnsplashImage {
  url: string
  photographer: string
  photographerUrl: string
  downloadUrl: string
}

/**
 * Extract keywords from user prompt to find relevant Unsplash images
 */
function extractImageKeywords(prompt: string): string[] {
  const lower = prompt.toLowerCase()

  // Map common UI types to Unsplash search terms
  const keywordMap: Record<string, string[]> = {
    // Landing pages & marketing
    landing: ['business', 'technology', 'startup', 'office'],
    hero: ['business', 'success', 'technology', 'innovation'],
    marketing: ['business', 'team', 'office', 'meeting'],

    // E-commerce
    ecommerce: ['shopping', 'product', 'retail', 'store'],
    shop: ['shopping', 'product', 'retail'],
    product: ['product photography', 'minimal product'],

    // Dashboard & analytics
    dashboard: ['data', 'analytics', 'charts', 'workspace'],
    analytics: ['data', 'charts', 'statistics', 'graphs'],
    admin: ['office', 'workspace', 'computer', 'desk'],

    // Food & restaurant
    restaurant: ['food', 'dining', 'restaurant', 'cuisine'],
    food: ['food photography', 'cuisine', 'meal'],
    menu: ['food', 'restaurant', 'dining'],

    // Travel & booking
    travel: ['travel', 'destination', 'adventure', 'landscape'],
    hotel: ['hotel', 'luxury', 'hospitality', 'room'],
    booking: ['travel', 'vacation', 'destination'],

    // Fitness & health
    fitness: ['fitness', 'gym', 'exercise', 'health'],
    health: ['health', 'wellness', 'medical', 'care'],
    gym: ['fitness', 'gym', 'workout', 'exercise'],

    // Real estate
    property: ['architecture', 'house', 'interior', 'home'],
    realestate: ['architecture', 'house', 'property', 'home'],

    // Finance
    finance: ['finance', 'business', 'banking', 'money'],
    banking: ['banking', 'finance', 'business', 'professional'],

    // Education
    education: ['education', 'learning', 'student', 'books'],
    course: ['education', 'learning', 'study', 'classroom'],

    // Social & community
    social: ['people', 'community', 'friends', 'group'],
    community: ['community', 'people', 'group', 'together'],

    // Portfolio & creative
    portfolio: ['creative', 'art', 'design', 'minimal'],
    creative: ['creative', 'art', 'design', 'artistic'],

    // Default/generic
    app: ['technology', 'modern', 'digital', 'innovation'],
    website: ['technology', 'modern', 'web', 'digital'],
  }

  // Find matching keywords
  for (const [key, values] of Object.entries(keywordMap)) {
    if (lower.includes(key)) {
      return values
    }
  }

  // Fallback to generic business/tech images
  return ['technology', 'modern', 'business', 'abstract']
}

/**
 * Fetch relevant images from Unsplash based on user prompt
 */
export async function fetchContextualImages(
  prompt: string,
  count: number = 3
): Promise<UnsplashImage[]> {
  // If no Unsplash API key, return empty array (will fallback to gradients)
  if (!unsplash) {
    console.log('Unsplash API key not configured - using fallback images')
    return []
  }

  try {
    const keywords = extractImageKeywords(prompt)
    const searchTerm = keywords[0] // Use primary keyword

    console.log(`Fetching Unsplash images for: "${searchTerm}" (from prompt: "${prompt}")`)

    const result = await unsplash.search.getPhotos({
      query: searchTerm,
      page: 1,
      perPage: count,
      orientation: 'landscape', // Better for hero sections
    })

    if (result.type === 'error') {
      console.error('Unsplash API error:', result.errors)
      return []
    }

    const images: UnsplashImage[] = result.response.results.map(photo => ({
      url: photo.urls.regular,
      photographer: photo.user.name,
      photographerUrl: photo.user.links.html,
      downloadUrl: photo.links.download_location,
    }))

    // Trigger download tracking (required by Unsplash API guidelines)
    images.forEach(img => {
      if (unsplash && img.downloadUrl) {
        unsplash.photos.trackDownload({ downloadLocation: img.downloadUrl })
          .catch(err => console.error('Failed to track download:', err))
      }
    })

    return images
  } catch (error) {
    console.error('Error fetching Unsplash images:', error)
    return []
  }
}

/**
 * Format images for Claude prompt injection
 */
export function formatImagesForPrompt(images: UnsplashImage[]): string {
  if (images.length === 0) {
    return ''
  }

  const imageList = images
    .map((img, i) => `  ${i + 1}. ${img.url}\n     Photographer: ${img.photographer}\n     Attribution URL: ${img.photographerUrl}`)
    .join('\n\n')

  return `
## AVAILABLE HERO IMAGES

Use these professional Unsplash images instead of gradients for hero sections and backgrounds:

${imageList}

**CRITICAL ATTRIBUTION REQUIREMENTS (UNSPLASH API GUIDELINES):**

✅ **CORRECT Image Usage:**
\`\`\`jsx
{/* Hero section with proper attribution */}
<div className="relative h-[600px]">
  <img
    src="${images[0].url}"
    alt="Photo by ${images[0].photographer}"
    loading="lazy"
    className="absolute inset-0 w-full h-full object-cover"
  />
  <div className="relative z-10">
    {/* Your content */}
  </div>
  <a
    href="${images[0].photographerUrl}?utm_source=ainative&utm_medium=referral"
    target="_blank"
    rel="noopener noreferrer"
    className="absolute bottom-4 right-4 text-xs text-white/80 hover:text-white"
  >
    Photo by ${images[0].photographer} on Unsplash
  </a>
</div>
\`\`\`

**OR as background image:**
\`\`\`jsx
<div
  className="relative h-[600px] bg-cover bg-center"
  style={{ backgroundImage: 'url(${images[0].url})' }}
>
  {/* Your content */}
  <a
    href="${images[0].photographerUrl}?utm_source=ainative&utm_medium=referral"
    className="absolute bottom-4 right-4 text-xs text-white/80"
  >
    Photo by ${images[0].photographer} on Unsplash
  </a>
</div>
\`\`\`

**MANDATORY RULES:**
1. ALWAYS use the exact image URLs provided above
2. ALWAYS include photographer attribution link
3. ALWAYS add loading="lazy" for performance
4. ALWAYS include proper alt text: "Photo by {photographer}"
5. NEVER use placeholder URLs like source.unsplash.com
6. ALWAYS position attribution link in bottom-right corner (absolute bottom-4 right-4)
`
}

/**
 * Fallback image URLs for when Unsplash is not configured
 * Using Unsplash Source API (doesn't require API key)
 */
export function getFallbackImages(theme: string = 'technology'): UnsplashImage[] {
  const themes = ['technology', 'business', 'abstract', 'nature', 'architecture']
  const selectedTheme = themes.includes(theme.toLowerCase()) ? theme : 'technology'

  return [
    {
      url: `https://source.unsplash.com/1920x1080/?${selectedTheme},1`,
      photographer: 'Unsplash',
      photographerUrl: 'https://unsplash.com',
      downloadUrl: '',
    },
    {
      url: `https://source.unsplash.com/1920x1080/?${selectedTheme},2`,
      photographer: 'Unsplash',
      photographerUrl: 'https://unsplash.com',
      downloadUrl: '',
    },
    {
      url: `https://source.unsplash.com/1920x1080/?${selectedTheme},3`,
      photographer: 'Unsplash',
      photographerUrl: 'https://unsplash.com',
      downloadUrl: '',
    },
  ]
}
