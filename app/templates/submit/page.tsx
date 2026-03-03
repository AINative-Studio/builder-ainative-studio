'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, X } from 'lucide-react'
import Link from 'next/link'
import { TEMPLATE_CATEGORIES, COMPLEXITY_LEVELS } from '@/lib/types/template'
import dynamic from 'next/dynamic'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

const STEPS = [
  { id: 1, name: 'Basic Info' },
  { id: 2, name: 'Code' },
  { id: 3, name: 'Metadata' },
  { id: 4, name: 'Preview & Submit' },
]

export default function SubmitTemplatePage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [currentStep, setCurrentStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [code, setCode] = useState('')
  const [placeholders, setPlaceholders] = useState<string[]>([])
  const [placeholderInput, setPlaceholderInput] = useState('')
  const [componentsUsed, setComponentsUsed] = useState<string[]>([])
  const [componentInput, setComponentInput] = useState('')
  const [complexity, setComplexity] = useState<'simple' | 'medium' | 'advanced'>('simple')
  const [errors, setErrors] = useState<string[]>([])

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>You must be logged in to submit a template</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/login">Sign In</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleAddTag = () => {
    if (tagInput.trim() && tags.length < 10 && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()])
      setTagInput('')
    }
  }

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  const handleAddPlaceholder = () => {
    if (placeholderInput.trim() && !placeholders.includes(placeholderInput.trim())) {
      setPlaceholders([...placeholders, placeholderInput.trim()])
      setPlaceholderInput('')
    }
  }

  const handleAddComponent = () => {
    if (componentInput.trim() && !componentsUsed.includes(componentInput.trim())) {
      setComponentsUsed([...componentsUsed, componentInput.trim()])
      setComponentInput('')
    }
  }

  const validateStep = (step: number): boolean => {
    const newErrors: string[] = []

    switch (step) {
      case 1:
        if (!name.trim()) newErrors.push('Template name is required')
        if (!category) newErrors.push('Category is required')
        if (!description.trim()) newErrors.push('Description is required')
        if (description.length > 500) newErrors.push('Description must be 500 characters or less')
        break
      case 2:
        if (!code.trim()) newErrors.push('Code is required')
        if (/import\s+.*\s+from\s+['"][^@/.]/.test(code)) {
          newErrors.push('Code contains external imports. Only local and @/ imports are allowed.')
        }
        break
      case 3:
        // Auto-detect placeholders and components from code
        const detectedPlaceholders = code.match(/\{\{[^}]+\}\}/g) || []
        if (detectedPlaceholders.length > 0 && placeholders.length === 0) {
          setPlaceholders(detectedPlaceholders.map((p) => p.trim()))
        }
        break
    }

    setErrors(newErrors)
    return newErrors.length === 0
  }

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrevious = () => {
    setCurrentStep(currentStep - 1)
    setErrors([])
  }

  const handleSubmit = async () => {
    if (!validateStep(currentStep)) return

    setLoading(true)
    try {
      const response = await fetch('/api/templates/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          category,
          description,
          code,
          tags,
          metadata: {
            placeholders,
            components_used: componentsUsed,
            complexity,
          },
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setErrors([data.error || 'Failed to submit template'])
        return
      }

      setSubmitted(true)
    } catch (error) {
      setErrors(['Failed to submit template. Please try again.'])
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <CardTitle className="text-center">Template Submitted!</CardTitle>
            <CardDescription className="text-center">
              Your template has been submitted for review. Check back in 1-2 days.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild className="w-full">
              <Link href="/templates">Browse Templates</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/templates/submit">Submit Another</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/templates"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Templates
          </Link>
          <h1 className="text-4xl font-bold mb-2">Submit a Template</h1>
          <p className="text-muted-foreground">
            Share your template with the community and help others build faster
          </p>
        </div>

        {/* Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {STEPS.map((step, index) => (
              <div key={step.id} className="flex items-center flex-1">
                <div className="flex items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      currentStep >= step.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {currentStep > step.id ? <Check className="w-4 h-4" /> : step.id}
                  </div>
                  <span
                    className={`ml-2 text-sm ${
                      currentStep >= step.id ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {step.name}
                  </span>
                </div>
                {index < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-4 ${
                      currentStep > step.id ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <ul className="list-disc list-inside text-sm text-destructive">
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Form Steps */}
        <Card>
          <CardContent className="pt-6">
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Template Name *</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Analytics Dashboard"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Category *</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="category">
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_CATEGORIES.filter((c) => c.value !== 'all').map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">
                    Description * <span className="text-muted-foreground">(max 500 chars)</span>
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="Describe your template..."
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={500}
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {description.length}/500
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tags">
                    Tags <span className="text-muted-foreground">(max 10)</span>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="tags"
                      placeholder="Add a tag..."
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                      disabled={tags.length >= 10}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleAddTag}
                      disabled={tags.length >= 10}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                          <button
                            onClick={() => handleRemoveTag(tag)}
                            className="ml-1 hover:text-destructive"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Template Code *</Label>
                  <p className="text-sm text-muted-foreground">
                    Paste your React component code. Only local (@/) imports are allowed.
                  </p>
                  <div className="border rounded-lg overflow-hidden">
                    <MonacoEditor
                      height="500px"
                      defaultLanguage="typescript"
                      value={code}
                      onChange={(value) => setCode(value || '')}
                      theme="vs-dark"
                      options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="placeholders">Placeholder Variables</Label>
                  <p className="text-sm text-muted-foreground">
                    Add placeholders like <code className="text-xs">{'{{title}}'}</code> that users can customize
                  </p>
                  <div className="flex gap-2">
                    <Input
                      id="placeholders"
                      placeholder="e.g., {{title}}"
                      value={placeholderInput}
                      onChange={(e) => setPlaceholderInput(e.target.value)}
                      onKeyPress={(e) =>
                        e.key === 'Enter' && (e.preventDefault(), handleAddPlaceholder())
                      }
                    />
                    <Button type="button" variant="outline" onClick={handleAddPlaceholder}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  {placeholders.length > 0 && (
                    <div className="space-y-1 mt-2">
                      {placeholders.map((placeholder) => (
                        <div
                          key={placeholder}
                          className="flex items-center justify-between bg-muted p-2 rounded"
                        >
                          <code className="text-sm">{placeholder}</code>
                          <button
                            onClick={() =>
                              setPlaceholders(placeholders.filter((p) => p !== placeholder))
                            }
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="components">Components Used</Label>
                  <p className="text-sm text-muted-foreground">
                    List the shadcn/ui components used in this template
                  </p>
                  <div className="flex gap-2">
                    <Input
                      id="components"
                      placeholder="e.g., Card, Button"
                      value={componentInput}
                      onChange={(e) => setComponentInput(e.target.value)}
                      onKeyPress={(e) =>
                        e.key === 'Enter' && (e.preventDefault(), handleAddComponent())
                      }
                    />
                    <Button type="button" variant="outline" onClick={handleAddComponent}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  {componentsUsed.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {componentsUsed.map((comp) => (
                        <Badge key={comp} variant="outline">
                          {comp}
                          <button
                            onClick={() =>
                              setComponentsUsed(componentsUsed.filter((c) => c !== comp))
                            }
                            className="ml-1 hover:text-destructive"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="complexity">Complexity Level</Label>
                  <Select
                    value={complexity}
                    onValueChange={(value) => setComplexity(value as any)}
                  >
                    <SelectTrigger id="complexity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPLEXITY_LEVELS.map((level) => (
                        <SelectItem key={level.value} value={level.value}>
                          {level.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {currentStep === 4 && (
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-2">Review Your Template</h3>
                  <p className="text-sm text-muted-foreground">
                    Please review all details before submitting
                  </p>
                </div>

                <div className="space-y-4 p-4 bg-muted rounded-lg">
                  <div>
                    <h4 className="font-medium text-sm text-muted-foreground">Name</h4>
                    <p>{name}</p>
                  </div>
                  <div>
                    <h4 className="font-medium text-sm text-muted-foreground">Category</h4>
                    <Badge variant="outline">{category}</Badge>
                  </div>
                  <div>
                    <h4 className="font-medium text-sm text-muted-foreground">Description</h4>
                    <p className="text-sm">{description}</p>
                  </div>
                  {tags.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm text-muted-foreground">Tags</h4>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tags.map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <h4 className="font-medium text-sm text-muted-foreground">Complexity</h4>
                    <Badge
                      variant="secondary"
                      className={
                        complexity === 'simple'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                          : complexity === 'medium'
                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100'
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
                      }
                    >
                      {complexity}
                    </Badge>
                  </div>
                  {placeholders.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm text-muted-foreground">Placeholders</h4>
                      <div className="text-sm space-y-1 mt-1">
                        {placeholders.map((p) => (
                          <code key={p} className="block">
                            {p}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-900 dark:text-blue-100">
                    Your template will be reviewed by our team within 1-2 business days. You'll be
                    notified once it's approved and published.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex justify-between mt-6">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStep === 1 || loading}
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>

          {currentStep < 4 ? (
            <Button onClick={handleNext} disabled={loading}>
              Next
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-1" />
                  Submit Template
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
