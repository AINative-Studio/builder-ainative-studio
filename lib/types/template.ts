export interface Template {
  id: string
  name: string
  category: string
  description: string
  code: string
  preview_image_url: string | null
  tags: string[]
  metadata: {
    placeholders: string[]
    components_used: string[]
    complexity: 'simple' | 'medium' | 'advanced'
  }
  is_active: boolean
  usage_count: number
  created_at: Date
  updated_at: Date
}

export interface TemplateFilters {
  category?: string
  tags?: string[]
  search?: string
  complexity?: string
  sort?: 'most-used' | 'newest' | 'a-z'
  page?: number
  limit?: number
}

export interface TemplatePagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export const TEMPLATE_CATEGORIES = [
  { value: 'all', label: 'All Templates' },
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'landing', label: 'Landing Page' },
  { value: 'admin', label: 'Admin Panel' },
  { value: 'blog', label: 'Blog' },
]

export const TEMPLATE_TAGS = [
  'Analytics',
  'CRUD',
  'Marketing',
  'Charts',
  'Forms',
  'Tables',
  'Cards',
  'Navigation',
  'Authentication',
  'Dashboard',
  'Responsive',
  'Dark Mode',
]

export const COMPLEXITY_LEVELS = [
  { value: 'simple', label: 'Simple' },
  { value: 'medium', label: 'Medium' },
  { value: 'advanced', label: 'Advanced' },
]

export const SORT_OPTIONS = [
  { value: 'most-used', label: 'Most Used' },
  { value: 'newest', label: 'Newest' },
  { value: 'a-z', label: 'A-Z' },
]
