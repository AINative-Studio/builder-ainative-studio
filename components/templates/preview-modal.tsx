'use client'

import { Template } from '@/lib/types/template'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronLeft, ChevronRight, Code, Sparkles, TrendingUp } from 'lucide-react'
import Image from 'next/image'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface PreviewModalProps {
  template: Template | null
  isOpen: boolean
  onClose: () => void
  onUseTemplate: (template: Template) => void
  onCustomize: (template: Template) => void
  onNext?: () => void
  onPrevious?: () => void
}

export function PreviewModal({
  template,
  isOpen,
  onClose,
  onUseTemplate,
  onCustomize,
  onNext,
  onPrevious,
}: PreviewModalProps) {
  if (!template) return null

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatUsageCount = (count: number) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`
    }
    return count.toString()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] p-0">
        <div className="flex flex-col h-full">
          <DialogHeader className="p-6 pb-4 border-b">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <DialogTitle className="text-2xl">{template.name}</DialogTitle>
                  <Badge variant="outline">{template.category}</Badge>
                  <Badge
                    variant="secondary"
                    className={
                      template.metadata.complexity === 'simple'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                        : template.metadata.complexity === 'medium'
                          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100'
                          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
                    }
                  >
                    {template.metadata.complexity}
                  </Badge>
                </div>
                <DialogDescription className="text-base">{template.description}</DialogDescription>
              </div>

              {/* Navigation buttons */}
              {(onPrevious || onNext) && (
                <div className="flex gap-2 ml-4">
                  {onPrevious && (
                    <Button variant="outline" size="icon" onClick={onPrevious}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                  )}
                  {onNext && (
                    <Button variant="outline" size="icon" onClick={onNext}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-hidden">
            <Tabs defaultValue="preview" className="h-full flex flex-col">
              <TabsList className="mx-6 mt-4">
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="code">Code</TabsTrigger>
              </TabsList>

              <TabsContent value="preview" className="flex-1 mt-4 mx-6 mb-6">
                <div className="relative aspect-video rounded-lg overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900">
                  {template.preview_image_url ? (
                    <Image
                      src={template.preview_image_url}
                      alt={template.name}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-8xl mb-4 opacity-20">
                          {getCategoryIcon(template.category)}
                        </div>
                        <p className="text-muted-foreground">No preview available</p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="details" className="flex-1 mt-4 mx-6 mb-6">
                <ScrollArea className="h-full">
                  <div className="space-y-6 pr-4">
                    <div>
                      <h3 className="font-semibold mb-2">Tags</h3>
                      <div className="flex flex-wrap gap-2">
                        {template.tags.map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold mb-2">Components Used</h3>
                      <div className="flex flex-wrap gap-2">
                        {template.metadata.components_used.map((component) => (
                          <Badge key={component} variant="outline">
                            {component}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold mb-2">Placeholders</h3>
                      {template.metadata.placeholders.length > 0 ? (
                        <div className="space-y-1">
                          {template.metadata.placeholders.map((placeholder) => (
                            <div key={placeholder} className="text-sm font-mono bg-muted p-2 rounded">
                              {placeholder}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No placeholders</p>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="w-4 h-4" />
                        <span>{formatUsageCount(template.usage_count)} uses</span>
                      </div>
                      <span>•</span>
                      <span>Created {formatDate(template.created_at)}</span>
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="code" className="flex-1 mt-4 mx-6 mb-6">
                <ScrollArea className="h-full rounded-lg border">
                  <SyntaxHighlighter
                    language="tsx"
                    style={vscDarkPlus}
                    customStyle={{
                      margin: 0,
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                    }}
                  >
                    {template.code}
                  </SyntaxHighlighter>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>

          <div className="flex justify-between items-center gap-4 p-6 border-t bg-muted/30">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => onCustomize(template)}>
                <Sparkles className="w-4 h-4 mr-1" />
                Customize
              </Button>
              <Button onClick={() => onUseTemplate(template)}>
                <Code className="w-4 h-4 mr-1" />
                Use This Template
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
