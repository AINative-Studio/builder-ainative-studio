'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface Submission {
  submission: {
    id: string
    user_id: string | null
    template_data: {
      name: string
      category: string
      description: string
      code: string
      tags: string[]
      metadata: {
        placeholders: string[]
        components_used: string[]
        complexity: 'simple' | 'medium' | 'advanced'
      }
    }
    status: string
    admin_notes: string | null
    submitted_at: Date
    reviewed_at: Date | null
    reviewed_by: string | null
  }
  user: {
    id: string
    email: string
  } | null
}

interface TemplateReviewModalProps {
  submission: Submission
  isOpen: boolean
  onClose: () => void
  onComplete: () => void
}

export function TemplateReviewModal({
  submission,
  isOpen,
  onClose,
  onComplete,
}: TemplateReviewModalProps) {
  const [adminNotes, setAdminNotes] = useState('')
  const [loading, setLoading] = useState(false)

  const checkCodeSecurity = () => {
    const issues: string[] = []
    const code = submission.submission.template_data.code

    // Check for external imports
    if (/import\s+.*\s+from\s+['"][^@/.]/.test(code)) {
      issues.push('Contains external imports (only @/ and local imports allowed)')
    }

    // Check for dangerous patterns
    if (/eval\s*\(|Function\s*\(|dangerouslySetInnerHTML/.test(code)) {
      issues.push('Contains potentially dangerous code patterns')
    }

    // Check for network requests
    if (/fetch\s*\(|axios\.|XMLHttpRequest/.test(code)) {
      issues.push('Contains network requests (should use API routes)')
    }

    return issues
  }

  const securityIssues = checkCodeSecurity()

  const handleReview = async (action: 'approve' | 'reject') => {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/template-submissions/${submission.submission.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          admin_notes: adminNotes,
        }),
      })

      if (response.ok) {
        onComplete()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to review submission')
      }
    } catch (error) {
      console.error('Error reviewing submission:', error)
      alert('Failed to review submission')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] p-0">
        <div className="flex flex-col h-full">
          <DialogHeader className="p-6 pb-4 border-b">
            <DialogTitle className="text-2xl">
              Review: {submission.submission.template_data.name}
            </DialogTitle>
            <DialogDescription>
              Submitted by {submission.user?.email || 'Unknown'} on{' '}
              {formatDate(submission.submission.submitted_at)}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden">
            <Tabs defaultValue="details" className="h-full flex flex-col">
              <TabsList className="mx-6 mt-4">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="code">Code</TabsTrigger>
                <TabsTrigger value="security">Security Check</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="flex-1 mt-4 mx-6 mb-6">
                <ScrollArea className="h-full pr-4">
                  <div className="space-y-6">
                    <div>
                      <h3 className="font-semibold mb-2">Template Information</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Name</p>
                          <p className="font-medium">{submission.submission.template_data.name}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Category</p>
                          <Badge variant="outline">
                            {submission.submission.template_data.category}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Complexity</p>
                          <Badge
                            variant="secondary"
                            className={
                              submission.submission.template_data.metadata.complexity === 'simple'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                                : submission.submission.template_data.metadata.complexity ===
                                    'medium'
                                  ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
                            }
                          >
                            {submission.submission.template_data.metadata.complexity}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Status</p>
                          <Badge
                            variant={
                              submission.submission.status === 'approved'
                                ? 'default'
                                : submission.submission.status === 'rejected'
                                  ? 'destructive'
                                  : 'secondary'
                            }
                          >
                            {submission.submission.status}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold mb-2">Description</h3>
                      <p className="text-sm">{submission.submission.template_data.description}</p>
                    </div>

                    <div>
                      <h3 className="font-semibold mb-2">Tags</h3>
                      <div className="flex flex-wrap gap-2">
                        {submission.submission.template_data.tags.map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold mb-2">Components Used</h3>
                      <div className="flex flex-wrap gap-2">
                        {submission.submission.template_data.metadata.components_used.map(
                          (component) => (
                            <Badge key={component} variant="outline">
                              {component}
                            </Badge>
                          )
                        )}
                      </div>
                    </div>

                    {submission.submission.template_data.metadata.placeholders.length > 0 && (
                      <div>
                        <h3 className="font-semibold mb-2">Placeholders</h3>
                        <div className="space-y-1">
                          {submission.submission.template_data.metadata.placeholders.map(
                            (placeholder) => (
                              <code
                                key={placeholder}
                                className="block text-sm bg-muted p-2 rounded"
                              >
                                {placeholder}
                              </code>
                            )
                          )}
                        </div>
                      </div>
                    )}
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
                    {submission.submission.template_data.code}
                  </SyntaxHighlighter>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="security" className="flex-1 mt-4 mx-6 mb-6">
                <ScrollArea className="h-full pr-4">
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold mb-2">Security Check Results</h3>
                      {securityIssues.length === 0 ? (
                        <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                          <span className="text-green-900 dark:text-green-100">
                            No security issues detected
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {securityIssues.map((issue, index) => (
                            <div
                              key={index}
                              className="flex items-start gap-2 p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg"
                            >
                              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
                              <span className="text-red-900 dark:text-red-100">{issue}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <h3 className="font-semibold mb-2">Security Guidelines</h3>
                      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                        <li>Only @/ and local imports are allowed</li>
                        <li>No eval() or Function() constructors</li>
                        <li>No dangerouslySetInnerHTML</li>
                        <li>No direct network requests (use API routes)</li>
                        <li>All user inputs must be sanitized</li>
                      </ul>
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>

          <div className="p-6 border-t bg-muted/30">
            <div className="space-y-4">
              <div>
                <Label htmlFor="admin-notes">Admin Notes (optional)</Label>
                <Textarea
                  id="admin-notes"
                  placeholder="Add notes about this review..."
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex justify-between items-center gap-4">
                <Button variant="outline" onClick={onClose} disabled={loading}>
                  Close
                </Button>
                <div className="flex gap-3">
                  <Button
                    variant="destructive"
                    onClick={() => handleReview('reject')}
                    disabled={loading || submission.submission.status !== 'pending'}
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <XCircle className="w-4 h-4 mr-1" />
                    )}
                    Reject
                  </Button>
                  <Button
                    onClick={() => handleReview('approve')}
                    disabled={
                      loading ||
                      securityIssues.length > 0 ||
                      submission.submission.status !== 'pending'
                    }
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4 mr-1" />
                    )}
                    Approve
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
