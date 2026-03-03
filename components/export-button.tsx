'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Download, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

interface ExportButtonProps {
  generationId: string
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm' | 'lg'
  className?: string
}

export function ExportButton({
  generationId,
  variant = 'outline',
  size = 'default',
  className
}: ExportButtonProps) {
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  const handleExport = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/export/${generationId}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Failed to export project')
      }

      const blob = await response.blob()

      // Trigger download
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `generated-project-${generationId}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      toast({
        title: 'Export successful',
        description: 'Your project has been downloaded as a ZIP file.'
      })
    } catch (error) {
      console.error('Export error:', error)
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Failed to export project',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      onClick={handleExport}
      disabled={loading}
      variant={variant}
      size={size}
      className={className}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <Download className="w-4 h-4 mr-2" />
      )}
      {loading ? 'Exporting...' : 'Export'}
    </Button>
  )
}
