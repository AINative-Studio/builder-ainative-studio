'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/use-toast'

interface FeedbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chatId: string | null
}

export function FeedbackDialog({
  open,
  onOpenChange,
  chatId,
}: FeedbackDialogProps) {
  const [rating, setRating] = useState(0)
  const [hoveredRating, setHoveredRating] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [wasEdited, setWasEdited] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { toast } = useToast()

  const handleSubmit = async () => {
    if (rating === 0) {
      toast({
        title: 'Rating required',
        description: 'Please provide a rating before submitting.',
        variant: 'destructive',
      })
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/rlhf/submit-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          generationId: chatId,
          rating,
          feedbackText: feedback.trim() || undefined,
          wasEdited,
          iterations: 1,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to submit feedback')
      }

      toast({
        title: 'Thank you!',
        description: 'Your feedback has been submitted successfully.',
      })

      // Reset form
      setRating(0)
      setFeedback('')
      setWasEdited(false)
      onOpenChange(false)
    } catch (error) {
      console.error('Error submitting feedback:', error)
      toast({
        title: 'Error',
        description: 'Failed to submit feedback. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>How was your experience?</DialogTitle>
          <DialogDescription>
            Your feedback helps us improve the AI generation quality.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Star Rating */}
          <div className="space-y-2">
            <Label>Rating</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  className="transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-gray-950 focus:ring-offset-2 rounded dark:focus:ring-gray-300"
                  aria-label={`Rate ${star} out of 5 stars`}
                >
                  <Star
                    className={`h-8 w-8 ${
                      star <= (hoveredRating || rating)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-gray-300 dark:text-gray-700'
                    }`}
                  />
                </button>
              ))}
            </div>
            {rating > 0 && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                You rated: {rating} out of 5 stars
              </p>
            )}
          </div>

          {/* Optional Feedback Text */}
          <div className="space-y-2">
            <Label htmlFor="feedback">
              Additional feedback (optional)
            </Label>
            <Textarea
              id="feedback"
              placeholder="Tell us more about your experience..."
              value={feedback}
              onChange={(e) => {
                const value = e.target.value
                if (value.length <= 500) {
                  setFeedback(value)
                }
              }}
              className="min-h-[100px] resize-none"
              maxLength={500}
            />
            <p className="text-xs text-gray-500 dark:text-gray-500 text-right">
              {feedback.length}/500 characters
            </p>
          </div>

          {/* Was Edited Checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="wasEdited"
              checked={wasEdited}
              onCheckedChange={(checked) =>
                setWasEdited(checked === true)
              }
            />
            <Label
              htmlFor="wasEdited"
              className="text-sm font-normal cursor-pointer"
            >
              I edited the generated code before using it
            </Label>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || rating === 0}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
