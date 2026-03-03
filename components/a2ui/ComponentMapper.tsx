'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * A2UI Component Type Definitions
 * Based on A2UI protocol for agent-to-UI communication
 */
export interface A2UIComponent {
  type: string
  id: string
  props?: Record<string, any>
  children?: A2UIComponent[] | string
  layout?: {
    width?: string | number
    height?: string | number
    position?: 'relative' | 'absolute' | 'fixed'
    display?: 'block' | 'flex' | 'grid' | 'inline' | 'inline-block'
    flexDirection?: 'row' | 'column'
    gap?: string | number
    padding?: string | number
    margin?: string | number
  }
  style?: Record<string, any>
  events?: {
    onClick?: string
    onChange?: string
    onSubmit?: string
    onLoad?: string
  }
}

/**
 * Maps A2UI component types to actual React components
 */
export const componentRegistry = {
  // Layout Components
  'container': ({ children, layout, style, ...props }: any) => (
    <div
      className="w-full h-full"
      style={{ ...layout, ...style }}
      {...props}
    >
      {children}
    </div>
  ),
  'flex': ({ children, layout, style, ...props }: any) => (
    <div
      className="flex"
      style={{
        flexDirection: layout?.flexDirection || 'row',
        gap: layout?.gap || '1rem',
        ...layout,
        ...style
      }}
      {...props}
    >
      {children}
    </div>
  ),
  'grid': ({ children, layout, style, ...props }: any) => (
    <div
      className="grid"
      style={{
        gap: layout?.gap || '1rem',
        gridTemplateColumns: layout?.columns || 'repeat(auto-fit, minmax(250px, 1fr))',
        ...layout,
        ...style
      }}
      {...props}
    >
      {children}
    </div>
  ),

  // UI Components
  'button': ({ children, variant = 'default', size = 'default', ...props }: any) => (
    <Button variant={variant} size={size} {...props}>
      {children}
    </Button>
  ),
  'input': ({ type = 'text', placeholder, ...props }: any) => (
    <Input type={type} placeholder={placeholder} {...props} />
  ),
  'textarea': ({ placeholder, rows = 4, ...props }: any) => (
    <Textarea placeholder={placeholder} rows={rows} {...props} />
  ),
  'label': ({ children, htmlFor, ...props }: any) => (
    <Label htmlFor={htmlFor} {...props}>
      {children}
    </Label>
  ),
  'select': ({ options = [], placeholder, ...props }: any) => (
    <Select {...props}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option: any) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
  'checkbox': ({ label, ...props }: any) => (
    <div className="flex items-center space-x-2">
      <Checkbox {...props} />
      {label && <Label>{label}</Label>}
    </div>
  ),
  'radio': ({ options = [], ...props }: any) => (
    <RadioGroup {...props}>
      {options.map((option: any) => (
        <div key={option.value} className="flex items-center space-x-2">
          <RadioGroupItem value={option.value} id={option.value} />
          <Label htmlFor={option.value}>{option.label}</Label>
        </div>
      ))}
    </RadioGroup>
  ),

  // Display Components
  'card': ({ children, title, description, ...props }: any) => (
    <Card {...props}>
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </Card>
  ),
  'badge': ({ children, variant = 'default', ...props }: any) => (
    <Badge variant={variant} {...props}>
      {children}
    </Badge>
  ),
  'separator': (props: any) => <Separator {...props} />,
  'progress': ({ value = 0, ...props }: any) => (
    <Progress value={value} {...props} />
  ),

  // Navigation Components
  'tabs': ({ items = [], defaultValue, children, ...props }: any) => (
    <Tabs defaultValue={defaultValue || items[0]?.value} {...props}>
      <TabsList>
        {items.map((item: any) => (
          <TabsTrigger key={item.value} value={item.value}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  ),
  'tab-content': ({ value, children, ...props }: any) => (
    <TabsContent value={value} {...props}>
      {children}
    </TabsContent>
  ),

  // Content Components
  'text': ({ children, variant = 'body', ...props }: any) => {
    const variants = {
      h1: 'text-4xl font-bold',
      h2: 'text-3xl font-semibold',
      h3: 'text-2xl font-semibold',
      h4: 'text-xl font-semibold',
      body: 'text-base',
      small: 'text-sm',
      muted: 'text-sm text-muted-foreground',
    }
    return (
      <p className={variants[variant as keyof typeof variants]} {...props}>
        {children}
      </p>
    )
  },
  'heading': ({ level = 1, children, ...props }: any) => {
    const Tag = `h${level}` as keyof JSX.IntrinsicElements
    const sizes = {
      1: 'text-4xl font-bold',
      2: 'text-3xl font-semibold',
      3: 'text-2xl font-semibold',
      4: 'text-xl font-semibold',
      5: 'text-lg font-semibold',
      6: 'text-base font-semibold',
    }
    return (
      <Tag className={sizes[level as keyof typeof sizes]} {...props}>
        {children}
      </Tag>
    )
  },
  'image': ({ src, alt = '', width, height, ...props }: any) => (
    <img src={src} alt={alt} width={width} height={height} {...props} />
  ),
  'video': ({ src, autoPlay = false, controls = true, loop = false, ...props }: any) => (
    <video
      src={src}
      autoPlay={autoPlay}
      controls={controls}
      loop={loop}
      className="w-full h-auto"
      {...props}
    />
  ),

  // Form Components
  'form': ({ children, onSubmit, ...props }: any) => (
    <form onSubmit={onSubmit} {...props}>
      {children}
    </form>
  ),
  'field': ({ label, children, error, ...props }: any) => (
    <div className="space-y-2" {...props}>
      {label && <Label>{label}</Label>}
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  ),
}

interface ComponentMapperProps {
  component: A2UIComponent
  onAction?: (action: string, context: any) => void
}

/**
 * ComponentMapper
 * Dynamically renders A2UI components from agent specifications
 */
export function ComponentMapper({ component, onAction }: ComponentMapperProps) {
  const ComponentType = componentRegistry[component.type as keyof typeof componentRegistry]

  if (!ComponentType) {
    console.warn(`Unknown A2UI component type: ${component.type}`)
    return (
      <div className="p-4 border border-red-500 bg-red-50 dark:bg-red-950 rounded">
        <p className="text-sm text-red-600 dark:text-red-400">
          Unknown component type: {component.type}
        </p>
      </div>
    )
  }

  // Map event handlers
  const eventHandlers: Record<string, any> = {}
  if (component.events) {
    Object.entries(component.events).forEach(([eventName, actionName]) => {
      eventHandlers[eventName] = (e: any) => {
        e.preventDefault?.()
        onAction?.(actionName as string, {
          componentId: component.id,
          event: eventName,
          value: e.target?.value,
          data: component.props,
        })
      }
    })
  }

  // Render children recursively
  const renderChildren = () => {
    if (typeof component.children === 'string') {
      return component.children
    }
    if (Array.isArray(component.children)) {
      return component.children.map((child, index) => (
        <ComponentMapper
          key={child.id || `child-${index}`}
          component={child}
          onAction={onAction}
        />
      ))
    }
    return null
  }

  return (
    <ComponentType
      {...component.props}
      {...eventHandlers}
      style={component.style}
      layout={component.layout}
    >
      {renderChildren()}
    </ComponentType>
  )
}

/**
 * Utility: Parse A2UI JSON specification
 */
export function parseA2UISpec(json: string): A2UIComponent | null {
  try {
    return JSON.parse(json)
  } catch (error) {
    console.error('Failed to parse A2UI specification:', error)
    return null
  }
}

/**
 * Utility: Validate A2UI component structure
 */
export function validateA2UIComponent(component: any): boolean {
  if (!component || typeof component !== 'object') {
    return false
  }
  if (!component.type || typeof component.type !== 'string') {
    return false
  }
  if (!component.id || typeof component.id !== 'string') {
    return false
  }
  return true
}
