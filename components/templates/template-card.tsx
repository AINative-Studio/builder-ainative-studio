'use client'

import { Template } from '@/lib/types/template'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Eye, TrendingUp } from 'lucide-react'
import Image from 'next/image'

interface TemplateCardProps {
  template: Template
  onPreview: (template: Template) => void
  onUseTemplate: (template: Template) => void
}

export function TemplateCard({ template, onPreview, onUseTemplate }: TemplateCardProps) {
  const truncateDescription = (desc: string, maxLength: number = 100) => {
    if (desc.length <= maxLength) return desc
    return desc.slice(0, maxLength) + '...'
  }

  const formatUsageCount = (count: number) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`
    }
    return count.toString()
  }

  const visibleTags = template.tags.slice(0, 3)
  const remainingTags = template.tags.length - 3

  return (
    <Card
      className="group hover:shadow-lg transition-all duration-300 cursor-pointer h-full flex flex-col"
      onClick={() => onPreview(template)}
    >
      <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900">
        {template.preview_image_url ? (
          <Image
            src={template.preview_image_url}
            alt={template.name}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-6xl opacity-20">{getCategoryIcon(template.category)}</div>
          </div>
        )}

        {/* Usage count badge */}
        <div className="absolute top-2 right-2">
          <Badge variant="secondary" className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm">
            <TrendingUp className="w-3 h-3 mr-1" />
            {formatUsageCount(template.usage_count)} uses
          </Badge>
        </div>
      </div>

      <CardHeader className="flex-1">
        <div className="flex items-start justify-between gap-2 mb-2">
          <CardTitle className="text-lg line-clamp-1">{template.name}</CardTitle>
          <Badge variant="outline" className="shrink-0">
            {template.category}
          </Badge>
        </div>
        <CardDescription className="line-clamp-2">
          {truncateDescription(template.description)}
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="space-y-3">
          {/* Tags */}
          <div className="flex flex-wrap gap-1">
            {visibleTags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {remainingTags > 0 && (
              <Badge variant="secondary" className="text-xs">
                +{remainingTags} more
              </Badge>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={(e) => {
                e.stopPropagation()
                onPreview(template)
              }}
            >
              <Eye className="w-4 h-4 mr-1" />
              Preview
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={(e) => {
                e.stopPropagation()
                onUseTemplate(template)
              }}
            >
              Use Template
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    dashboard: '📊',
    ecommerce: '🛒',
    landing: '🚀',
    admin: '⚙️',
    blog: '📝',
  }
  return icons[category] || '📄'
}
