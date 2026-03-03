'use client'

import React, { useState, useEffect } from 'react'
import { Plus, X, Save, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AgentSkill, SkillEditorProps } from '@/lib/types/agent-skills'

export function SkillEditor({ skill, onSave, onCancel }: SkillEditorProps) {
  const [formData, setFormData] = useState<Partial<AgentSkill>>({
    metadata: skill?.metadata || {
      id: '',
      name: '',
      description: '',
      version: '1.0.0',
      author: { id: '', name: '', email: '' },
      tags: [],
      tokenCost: { metadata: 100, full: 2000 },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    content: skill?.content || '',
    references: skill?.references || [],
    examples: skill?.examples || [],
    validationRules: skill?.validationRules || [],
    commands: skill?.commands || [],
  })

  const [newTag, setNewTag] = useState('')
  const [newTriggerPattern, setNewTriggerPattern] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const updateMetadata = (field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      metadata: {
        ...prev.metadata!,
        [field]: value,
      },
    }))
  }

  const addTag = () => {
    if (newTag.trim() && !formData.metadata?.tags.includes(newTag.trim())) {
      updateMetadata('tags', [...(formData.metadata?.tags || []), newTag.trim()])
      setNewTag('')
    }
  }

  const removeTag = (tag: string) => {
    updateMetadata(
      'tags',
      formData.metadata?.tags.filter((t) => t !== tag)
    )
  }

  const addTriggerPattern = () => {
    if (newTriggerPattern.trim()) {
      updateMetadata('triggerPatterns', [
        ...(formData.metadata?.triggerPatterns || []),
        newTriggerPattern.trim(),
      ])
      setNewTriggerPattern('')
    }
  }

  const removeTriggerPattern = (pattern: string) => {
    updateMetadata(
      'triggerPatterns',
      formData.metadata?.triggerPatterns?.filter((p) => p !== pattern)
    )
  }

  const addExample = () => {
    setFormData((prev) => ({
      ...prev,
      examples: [
        ...(prev.examples || []),
        {
          title: 'New Example',
          content: '',
          language: 'typescript',
          description: '',
        },
      ],
    }))
  }

  const updateExample = (index: number, field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      examples: prev.examples?.map((ex, i) =>
        i === index ? { ...ex, [field]: value } : ex
      ),
    }))
  }

  const removeExample = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      examples: prev.examples?.filter((_, i) => i !== index),
    }))
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.metadata?.id?.trim()) {
      newErrors.id = 'ID is required'
    } else if (!/^[a-z0-9-]+$/.test(formData.metadata.id)) {
      newErrors.id = 'ID must be lowercase alphanumeric with hyphens'
    }

    if (!formData.metadata?.name?.trim()) {
      newErrors.name = 'Name is required'
    }

    if (!formData.metadata?.description?.trim()) {
      newErrors.description = 'Description is required'
    }

    if (!formData.metadata?.version?.match(/^\d+\.\d+\.\d+$/)) {
      newErrors.version = 'Version must be in semver format (e.g., 1.0.0)'
    }

    if (!formData.metadata?.tags?.length) {
      newErrors.tags = 'At least one tag is required'
    }

    if (!formData.content?.trim()) {
      newErrors.content = 'Content is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return

    setSaving(true)
    try {
      await onSave(formData as AgentSkill)
    } catch (error) {
      console.error('Error saving skill:', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">
              {skill ? 'Edit Skill' : 'Create Skill'}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Define a modular skill for progressive disclosure
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save Skill'}
            </Button>
          </div>
        </div>
      </div>

      {/* Form */}
      <ScrollArea className="flex-1">
        <div className="p-6 max-w-4xl mx-auto">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="examples">Examples</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            {/* Basic Info Tab */}
            <TabsContent value="basic" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="id">
                  Skill ID <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="id"
                  value={formData.metadata?.id || ''}
                  onChange={(e) => updateMetadata('id', e.target.value)}
                  placeholder="e.g., mandatory-tdd"
                  disabled={!!skill}
                />
                {errors.id && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.id}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.metadata?.name || ''}
                  onChange={(e) => updateMetadata('name', e.target.value)}
                  placeholder="e.g., Mandatory TDD"
                />
                {errors.name && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.name}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="version">
                  Version <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="version"
                  value={formData.metadata?.version || ''}
                  onChange={(e) => updateMetadata('version', e.target.value)}
                  placeholder="1.0.0"
                />
                {errors.version && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.version}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">
                  Description <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="description"
                  value={formData.metadata?.description || ''}
                  onChange={(e) => updateMetadata('description', e.target.value)}
                  placeholder="Short description (~100 words) shown in autocomplete and skill browser"
                  rows={4}
                />
                {errors.description && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.description}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>
                  Tags <span className="text-destructive">*</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                    placeholder="Add a tag"
                  />
                  <Button onClick={addTag} type="button" variant="outline">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.metadata?.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                      <X
                        className="h-3 w-3 ml-1 cursor-pointer"
                        onClick={() => removeTag(tag)}
                      />
                    </Badge>
                  ))}
                </div>
                {errors.tags && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.tags}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tokenCostMetadata">Token Cost (Metadata)</Label>
                  <Input
                    id="tokenCostMetadata"
                    type="number"
                    value={formData.metadata?.tokenCost.metadata || 100}
                    onChange={(e) =>
                      updateMetadata('tokenCost', {
                        ...formData.metadata?.tokenCost,
                        metadata: parseInt(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tokenCostFull">Token Cost (Full)</Label>
                  <Input
                    id="tokenCostFull"
                    type="number"
                    value={formData.metadata?.tokenCost.full || 2000}
                    onChange={(e) =>
                      updateMetadata('tokenCost', {
                        ...formData.metadata?.tokenCost,
                        full: parseInt(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
            </TabsContent>

            {/* Content Tab */}
            <TabsContent value="content" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="content">
                  Skill Content (Markdown) <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="content"
                  value={formData.content || ''}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="# Skill Title&#10;&#10;## Description&#10;&#10;Full skill content in markdown format..."
                  rows={20}
                  className="font-mono text-sm"
                />
                {errors.content && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.content}
                  </p>
                )}
              </div>
            </TabsContent>

            {/* Examples Tab */}
            <TabsContent value="examples" className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Code Examples</Label>
                <Button onClick={addExample} variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Example
                </Button>
              </div>

              {formData.examples?.map((example, index) => (
                <Card key={index}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Example {index + 1}</CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeExample(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>Title</Label>
                      <Input
                        value={example.title}
                        onChange={(e) => updateExample(index, 'title', e.target.value)}
                        placeholder="Example title"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Language</Label>
                      <Select
                        value={example.language}
                        onValueChange={(value) => updateExample(index, 'language', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="typescript">TypeScript</SelectItem>
                          <SelectItem value="javascript">JavaScript</SelectItem>
                          <SelectItem value="python">Python</SelectItem>
                          <SelectItem value="bash">Bash</SelectItem>
                          <SelectItem value="markdown">Markdown</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Code</Label>
                      <Textarea
                        value={example.content}
                        onChange={(e) => updateExample(index, 'content', e.target.value)}
                        placeholder="Example code..."
                        rows={8}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Description (Optional)</Label>
                      <Textarea
                        value={example.description || ''}
                        onChange={(e) => updateExample(index, 'description', e.target.value)}
                        placeholder="Describe what this example demonstrates..."
                        rows={3}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}

              {formData.examples?.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No examples added yet</p>
                  <p className="text-sm">Click "Add Example" to get started</p>
                </div>
              )}
            </TabsContent>

            {/* Advanced Tab */}
            <TabsContent value="advanced" className="space-y-4">
              <div className="space-y-2">
                <Label>Trigger Patterns</Label>
                <div className="flex gap-2">
                  <Input
                    value={newTriggerPattern}
                    onChange={(e) => setNewTriggerPattern(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTriggerPattern())}
                    placeholder="e.g., 'write test', 'create commit'"
                  />
                  <Button onClick={addTriggerPattern} type="button" variant="outline">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.metadata?.triggerPatterns?.map((pattern) => (
                    <Badge key={pattern} variant="outline">
                      {pattern}
                      <X
                        className="h-3 w-3 ml-1 cursor-pointer"
                        onClick={() => removeTriggerPattern(pattern)}
                      />
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Patterns that will automatically load this skill
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Dependencies</Label>
                <Textarea
                  value={formData.metadata?.dependencies?.join('\n') || ''}
                  onChange={(e) =>
                    updateMetadata(
                      'dependencies',
                      e.target.value.split('\n').filter(Boolean)
                    )
                  }
                  placeholder="skill-id-1&#10;skill-id-2"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Other skills this one depends on (one per line)
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Validation Rules</Label>
                <Textarea
                  value={formData.validationRules?.join('\n') || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      validationRules: e.target.value.split('\n').filter(Boolean),
                    })
                  }
                  placeholder="rule-id-1&#10;rule-id-2"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Validation rules this skill enforces (one per line)
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Commands</Label>
                <Textarea
                  value={formData.commands?.join('\n') || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      commands: e.target.value.split('\n').filter(Boolean),
                    })
                  }
                  placeholder="/command-1&#10;/command-2"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Commands this skill provides (one per line)
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  )
}
