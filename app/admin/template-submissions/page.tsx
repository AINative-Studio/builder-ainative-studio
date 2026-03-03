'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Eye } from 'lucide-react'
import Link from 'next/link'
import { TemplateReviewModal } from '@/components/admin/template-review-modal'

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

export default function AdminTemplateSubmissionsPage() {
  const { data: session } = useSession()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null)
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false)

  const isAdmin = session?.user?.email?.includes('admin') || false

  useEffect(() => {
    if (isAdmin) {
      fetchSubmissions()
    }
  }, [statusFilter, isAdmin])

  const fetchSubmissions = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/template-submissions?status=${statusFilter}`)
      const data = await response.json()

      if (response.ok) {
        setSubmissions(data.submissions || [])
      }
    } catch (error) {
      console.error('Error fetching submissions:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleReview = (submission: Submission) => {
    setSelectedSubmission(submission)
    setIsReviewModalOpen(true)
  }

  const handleReviewComplete = () => {
    setIsReviewModalOpen(false)
    setSelectedSubmission(null)
    fetchSubmissions() // Refresh the list
  }

  const formatDate = (date: Date | null) => {
    if (!date) return 'N/A'
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>You must be logged in to access this page</CardDescription>
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

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access this page</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/">Go Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Template Submissions</h1>
          <p className="text-muted-foreground">Review and manage user-submitted templates</p>
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : submissions.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Submitted By</TableHead>
                    <TableHead>Template Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Complexity</TableHead>
                    <TableHead>Submitted Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map(({ submission, user }) => (
                    <TableRow key={submission.id}>
                      <TableCell>{user?.email || 'Unknown User'}</TableCell>
                      <TableCell className="font-medium">
                        {submission.template_data.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{submission.template_data.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            submission.template_data.metadata.complexity === 'simple'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                              : submission.template_data.metadata.complexity === 'medium'
                                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100'
                                : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
                          }
                        >
                          {submission.template_data.metadata.complexity}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(submission.submitted_at)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            submission.status === 'approved'
                              ? 'default'
                              : submission.status === 'rejected'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {submission.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReview({ submission, user })}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-20">
                <p className="text-muted-foreground">
                  No {statusFilter} submissions found
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Review Modal */}
      {selectedSubmission && (
        <TemplateReviewModal
          submission={selectedSubmission}
          isOpen={isReviewModalOpen}
          onClose={() => setIsReviewModalOpen(false)}
          onComplete={handleReviewComplete}
        />
      )}
    </div>
  )
}
