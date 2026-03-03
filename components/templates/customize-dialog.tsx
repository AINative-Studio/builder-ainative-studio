'use client'

import { useState } from 'react'
import { Template } from '@/lib/types/template'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sparkles } from 'lucide-react'

interface CustomizeDialogProps {
  template: Template | null
  isOpen: boolean
  onClose: () => void
  onGenerate: (template: Template, customizations: Record<string, string>) => void
}

export function CustomizeDialog({ template, isOpen, onClose, onGenerate }: CustomizeDialogProps) {
  const [customizations, setCustomizations] = useState<Record<string, string>>({})

  if (!template) return null

  const placeholders = template.metadata.placeholders || []

  const handleCustomizationChange = (placeholder: string, value: string) => {
    setCustomizations((prev) => ({
      ...prev,
      [placeholder]: value,
    }))
  }

  const handleGenerate = () => {
    onGenerate(template, customizations)
    setCustomizations({})
    onClose()
  }

  const getPlaceholderLabel = (placeholder: string) => {
    // Convert {{placeholder}} to readable label
    return placeholder
      .replace(/[{}]/g, '')
      .split(/(?=[A-Z])|_/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const getPlaceholderDefault = (placeholder: string) => {
    // Generate sensible defaults based on placeholder name
    const name = placeholder.toLowerCase()
    if (name.includes('title')) return 'My Dashboard'
    if (name.includes('description')) return 'A beautiful dashboard'
    if (name.includes('metric')) return 'Revenue'
    if (name.includes('value')) return '1,234'
    if (name.includes('color')) return '#3b82f6'
    return placeholder
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Customize Template</DialogTitle>
          <DialogDescription>
            Customize the placeholders in {template.name} before generating your component.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {placeholders.length > 0 ? (
              placeholders.map((placeholder) => (
                <div key={placeholder} className="space-y-2">
                  <Label htmlFor={placeholder}>
                    {getPlaceholderLabel(placeholder)}
                    <span className="ml-2 text-xs font-mono text-muted-foreground">
                      {placeholder}
                    </span>
                  </Label>
                  <Input
                    id={placeholder}
                    placeholder={getPlaceholderDefault(placeholder)}
                    value={customizations[placeholder] || ''}
                    onChange={(e) => handleCustomizationChange(placeholder, e.target.value)}
                  />
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>This template has no customizable placeholders.</p>
                <p className="text-sm mt-2">You can use it directly without customization.</p>
              </div>
            )}

            {/* Preview section (simplified) */}
            {placeholders.length > 0 && (
              <div className="pt-4 border-t">
                <h4 className="font-semibold mb-2">Preview</h4>
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    Your customizations will be applied when you generate the component.
                  </p>
                  <div className="mt-2 space-y-1">
                    {Object.entries(customizations).map(([key, value]) => (
                      value && (
                        <div key={key} className="text-xs">
                          <span className="font-mono text-primary">{key}</span>
                          <span className="mx-2">→</span>
                          <span className="font-semibold">{value}</span>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleGenerate}>
            <Sparkles className="w-4 h-4 mr-1" />
            Generate with Customizations
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
