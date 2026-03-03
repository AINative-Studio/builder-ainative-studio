'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Template, TemplateFilters } from '@/lib/types/template'
import { TemplateCard } from '@/components/templates/template-card'
import { TemplateFiltersComponent } from '@/components/templates/template-filters'
import { PreviewModal } from '@/components/templates/preview-modal'
import { CustomizeDialog } from '@/components/templates/customize-dialog'
import { Button } from '@/components/ui/button'
import { Plus, Loader2 } from 'lucide-react'
import Link from 'next/link'

export default function TemplatesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 12,
    total: 0,
    totalPages: 0,
  })
  const [filters, setFilters] = useState<TemplateFilters>({
    sort: 'most-used',
    page: 1,
    limit: 12,
  })

  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false)

  useEffect(() => {
    fetchTemplates()
  }, [filters])

  const fetchTemplates = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.category) params.append('category', filters.category)
      if (filters.tags && filters.tags.length > 0) params.append('tags', filters.tags.join(','))
      if (filters.search) params.append('search', filters.search)
      if (filters.complexity) params.append('complexity', filters.complexity)
      if (filters.sort) params.append('sort', filters.sort)
      params.append('page', (filters.page || 1).toString())
      params.append('limit', (filters.limit || 12).toString())

      const response = await fetch(`/api/templates?${params.toString()}`)
      const data = await response.json()

      setTemplates(data.templates || [])
      setPagination(data.pagination || { page: 1, limit: 12, total: 0, totalPages: 0 })
    } catch (error) {
      console.error('Error fetching templates:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePreview = (template: Template) => {
    setSelectedTemplate(template)
    setIsPreviewOpen(true)
  }

  const handleUseTemplate = (template: Template) => {
    // Navigate to home with pre-filled prompt
    const prompt = `Create a ${template.category} using the ${template.name} template`
    router.push(`/?prompt=${encodeURIComponent(prompt)}`)
  }

  const handleCustomize = (template: Template) => {
    setSelectedTemplate(template)
    setIsPreviewOpen(false)
    setIsCustomizeOpen(true)
  }

  const handleGenerate = (template: Template, customizations: Record<string, string>) => {
    // Build customized prompt
    let prompt = `Create a ${template.category} based on the ${template.name} template`

    const customEntries = Object.entries(customizations).filter(([_, value]) => value)
    if (customEntries.length > 0) {
      prompt += ' with the following customizations:\n'
      customEntries.forEach(([key, value]) => {
        prompt += `- ${key}: ${value}\n`
      })
    }

    router.push(`/?prompt=${encodeURIComponent(prompt)}`)
  }

  const handleNextTemplate = () => {
    if (!selectedTemplate) return
    const currentIndex = templates.findIndex((t) => t.id === selectedTemplate.id)
    if (currentIndex < templates.length - 1) {
      setSelectedTemplate(templates[currentIndex + 1])
    }
  }

  const handlePreviousTemplate = () => {
    if (!selectedTemplate) return
    const currentIndex = templates.findIndex((t) => t.id === selectedTemplate.id)
    if (currentIndex > 0) {
      setSelectedTemplate(templates[currentIndex - 1])
    }
  }

  const handlePageChange = (newPage: number) => {
    setFilters({ ...filters, page: newPage })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">Template Gallery</h1>
            <p className="text-muted-foreground">
              Browse and use pre-built templates to jumpstart your projects
            </p>
          </div>
          <Button asChild>
            <Link href="/templates/submit">
              <Plus className="w-4 h-4 mr-1" />
              Submit Template
            </Link>
          </Button>
        </div>

        {/* Filters */}
        <div className="mb-8">
          <TemplateFiltersComponent filters={filters} onFiltersChange={setFilters} />
        </div>

        {/* Templates Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : templates.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onPreview={handlePreview}
                  onUseTemplate={handleUseTemplate}
                />
              ))}
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex justify-center items-center gap-2">
                <Button
                  variant="outline"
                  disabled={pagination.page === 1}
                  onClick={() => handlePageChange(pagination.page - 1)}
                >
                  Previous
                </Button>
                <div className="flex items-center gap-2">
                  {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map((page) => (
                    <Button
                      key={page}
                      variant={page === pagination.page ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handlePageChange(page)}
                    >
                      {page}
                    </Button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  disabled={pagination.page === pagination.totalPages}
                  onClick={() => handlePageChange(pagination.page + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20">
            <p className="text-xl text-muted-foreground mb-4">No templates found</p>
            <p className="text-sm text-muted-foreground">
              Try adjusting your filters or{' '}
              <Link href="/templates/submit" className="text-primary hover:underline">
                submit your own template
              </Link>
            </p>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      <PreviewModal
        template={selectedTemplate}
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        onUseTemplate={handleUseTemplate}
        onCustomize={handleCustomize}
        onNext={
          selectedTemplate &&
          templates.findIndex((t) => t.id === selectedTemplate.id) < templates.length - 1
            ? handleNextTemplate
            : undefined
        }
        onPrevious={
          selectedTemplate && templates.findIndex((t) => t.id === selectedTemplate.id) > 0
            ? handlePreviousTemplate
            : undefined
        }
      />

      {/* Customize Dialog */}
      <CustomizeDialog
        template={selectedTemplate}
        isOpen={isCustomizeOpen}
        onClose={() => setIsCustomizeOpen(false)}
        onGenerate={handleGenerate}
      />
    </div>
  )
}
