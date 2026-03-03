"use client"

/**
 * Variable Prompt Dialog Component
 *
 * Prompts user for command variables before execution
 *
 * Features:
 * - Multi-step form for complex commands
 * - Real-time validation
 * - Support for various input types
 * - Default values and placeholders
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import { AgentCommand, CommandVariable } from '@/lib/types/agent-commands'
import { getCommandService } from '@/lib/services/agent-command.service'

interface VariablePromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  command: AgentCommand
  onSubmit: (values: Record<string, any>) => void
  onCancel: () => void
  initialValues?: Record<string, any>
}

export function VariablePromptDialog({
  open,
  onOpenChange,
  command,
  onSubmit,
  onCancel,
  initialValues = {},
}: VariablePromptDialogProps) {
  const [values, setValues] = useState<Record<string, any>>(initialValues)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const commandService = getCommandService()

  // Initialize with default values
  useEffect(() => {
    const defaults: Record<string, any> = {}
    command.variables.forEach((variable) => {
      if (variable.defaultValue !== undefined) {
        defaults[variable.name] = variable.defaultValue
      }
    })
    setValues((prev) => ({ ...defaults, ...prev }))
  }, [command])

  const handleValueChange = (name: string, value: any) => {
    setValues((prev) => ({ ...prev, [name]: value }))
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev }
        delete newErrors[name]
        return newErrors
      })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    // Validate
    const validation = commandService.validateVariables(command.variables, values)

    if (!validation.valid) {
      setErrors(validation.errors)
      setIsSubmitting(false)
      return
    }

    // Submit
    onSubmit(values)
    setIsSubmitting(false)
  }

  const handleCancel = () => {
    setValues(initialValues)
    setErrors({})
    onCancel()
  }

  const renderInput = (variable: CommandVariable) => {
    const value = values[variable.name] ?? ''
    const error = errors[variable.name]

    switch (variable.type) {
      case 'text':
      case 'url':
        return (
          <div key={variable.name} className="space-y-2">
            <Label htmlFor={variable.name}>
              {variable.label}
              {variable.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            {variable.description && (
              <p className="text-sm text-muted-foreground">{variable.description}</p>
            )}
            <Input
              id={variable.name}
              type={variable.type === 'url' ? 'url' : 'text'}
              value={value}
              onChange={(e) => handleValueChange(variable.name, e.target.value)}
              placeholder={variable.placeholder}
              className={error ? 'border-destructive' : ''}
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
        )

      case 'number':
        return (
          <div key={variable.name} className="space-y-2">
            <Label htmlFor={variable.name}>
              {variable.label}
              {variable.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            {variable.description && (
              <p className="text-sm text-muted-foreground">{variable.description}</p>
            )}
            <Input
              id={variable.name}
              type="number"
              value={value}
              onChange={(e) => handleValueChange(variable.name, parseFloat(e.target.value))}
              placeholder={variable.placeholder}
              className={error ? 'border-destructive' : ''}
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
        )

      case 'boolean':
        return (
          <div key={variable.name} className="flex items-center space-x-2">
            <Checkbox
              id={variable.name}
              checked={value === true}
              onCheckedChange={(checked) => handleValueChange(variable.name, checked)}
            />
            <Label htmlFor={variable.name} className="text-sm font-normal">
              {variable.label}
              {variable.description && (
                <span className="text-muted-foreground ml-2">- {variable.description}</span>
              )}
            </Label>
          </div>
        )

      case 'select':
        return (
          <div key={variable.name} className="space-y-2">
            <Label htmlFor={variable.name}>
              {variable.label}
              {variable.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            {variable.description && (
              <p className="text-sm text-muted-foreground">{variable.description}</p>
            )}
            <Select
              value={value}
              onValueChange={(newValue) => handleValueChange(variable.name, newValue)}
            >
              <SelectTrigger className={error ? 'border-destructive' : ''}>
                <SelectValue placeholder={variable.placeholder || 'Select an option'} />
              </SelectTrigger>
              <SelectContent>
                {variable.options?.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex flex-col">
                      <span>{option.label}</span>
                      {option.description && (
                        <span className="text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
        )

      case 'multiselect':
        return (
          <div key={variable.name} className="space-y-2">
            <Label htmlFor={variable.name}>
              {variable.label}
              {variable.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            {variable.description && (
              <p className="text-sm text-muted-foreground">{variable.description}</p>
            )}
            <div className="space-y-2">
              {variable.options?.map((option) => (
                <div key={option.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`${variable.name}-${option.value}`}
                    checked={Array.isArray(value) && value.includes(option.value)}
                    onCheckedChange={(checked) => {
                      const currentValues = Array.isArray(value) ? value : []
                      const newValues = checked
                        ? [...currentValues, option.value]
                        : currentValues.filter((v) => v !== option.value)
                      handleValueChange(variable.name, newValues)
                    }}
                  />
                  <Label
                    htmlFor={`${variable.name}-${option.value}`}
                    className="text-sm font-normal"
                  >
                    {option.label}
                    {option.description && (
                      <span className="text-muted-foreground ml-2">- {option.description}</span>
                    )}
                  </Label>
                </div>
              ))}
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
        )

      case 'file':
        return (
          <div key={variable.name} className="space-y-2">
            <Label htmlFor={variable.name}>
              {variable.label}
              {variable.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            {variable.description && (
              <p className="text-sm text-muted-foreground">{variable.description}</p>
            )}
            <Input
              id={variable.name}
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) {
                  handleValueChange(variable.name, file.name)
                }
              }}
              className={error ? 'border-destructive' : ''}
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
        )

      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure: {command.metadata.name}</DialogTitle>
          <DialogDescription>{command.metadata.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Pre-conditions warning */}
          {command.preConditions.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This command has {command.preConditions.length} pre-condition
                {command.preConditions.length > 1 ? 's' : ''} that will be checked before execution.
              </AlertDescription>
            </Alert>
          )}

          {/* Required skills */}
          {command.requiredSkills.length > 0 && (
            <div className="space-y-2">
              <Label>Required Skills</Label>
              <div className="flex flex-wrap gap-2">
                {command.requiredSkills.map((skillId) => (
                  <Badge key={skillId} variant="secondary">
                    {skillId}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Variables */}
          <div className="space-y-4">
            {command.variables.map((variable) => renderInput(variable))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Executing...' : 'Execute Command'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
