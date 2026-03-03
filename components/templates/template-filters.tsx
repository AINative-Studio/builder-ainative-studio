'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'
import {
  TEMPLATE_CATEGORIES,
  COMPLEXITY_LEVELS,
  SORT_OPTIONS,
  TEMPLATE_TAGS,
  TemplateFilters,
} from '@/lib/types/template'

interface TemplateFiltersProps {
  filters: TemplateFilters
  onFiltersChange: (filters: TemplateFilters) => void
}

export function TemplateFiltersComponent({ filters, onFiltersChange }: TemplateFiltersProps) {
  const [searchInput, setSearchInput] = useState(filters.search || '')
  const selectedTags = filters.tags || []

  const handleSearchChange = (value: string) => {
    setSearchInput(value)
    // Debounce search
    const timeoutId = setTimeout(() => {
      onFiltersChange({ ...filters, search: value || undefined, page: 1 })
    }, 300)
    return () => clearTimeout(timeoutId)
  }

  const handleCategoryChange = (value: string) => {
    onFiltersChange({ ...filters, category: value === 'all' ? undefined : value, page: 1 })
  }

  const handleComplexityChange = (value: string) => {
    onFiltersChange({ ...filters, complexity: value === 'all' ? undefined : value, page: 1 })
  }

  const handleSortChange = (value: string) => {
    onFiltersChange({ ...filters, sort: value as any, page: 1 })
  }

  const handleTagToggle = (tag: string) => {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag]
    onFiltersChange({ ...filters, tags: newTags.length > 0 ? newTags : undefined, page: 1 })
  }

  const handleClearFilters = () => {
    setSearchInput('')
    onFiltersChange({ sort: 'most-used', page: 1 })
  }

  const hasActiveFilters =
    filters.category || filters.complexity || (filters.tags && filters.tags.length > 0) || filters.search

  return (
    <div className="space-y-4">
      {/* Search and Sort */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <Label htmlFor="search" className="sr-only">
            Search templates
          </Label>
          <Input
            id="search"
            placeholder="Search by name or description..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <div className="w-full md:w-48">
          <Label htmlFor="sort" className="sr-only">
            Sort by
          </Label>
          <Select value={filters.sort || 'most-used'} onValueChange={handleSortChange}>
            <SelectTrigger id="sort">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="w-full md:w-48">
          <Label htmlFor="category" className="sr-only">
            Category
          </Label>
          <Select value={filters.category || 'all'} onValueChange={handleCategoryChange}>
            <SelectTrigger id="category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {TEMPLATE_CATEGORIES.map((category) => (
                <SelectItem key={category.value} value={category.value}>
                  {category.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-full md:w-48">
          <Label htmlFor="complexity" className="sr-only">
            Complexity
          </Label>
          <Select value={filters.complexity || 'all'} onValueChange={handleComplexityChange}>
            <SelectTrigger id="complexity">
              <SelectValue placeholder="Complexity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Complexity</SelectItem>
              {COMPLEXITY_LEVELS.map((level) => (
                <SelectItem key={level.value} value={level.value}>
                  {level.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {hasActiveFilters && (
          <Button variant="outline" onClick={handleClearFilters} className="md:w-auto">
            <X className="w-4 h-4 mr-1" />
            Clear Filters
          </Button>
        )}
      </div>

      {/* Tags */}
      <div>
        <Label className="text-sm font-medium mb-2 block">Tags</Label>
        <div className="flex flex-wrap gap-2">
          {TEMPLATE_TAGS.map((tag) => (
            <Badge
              key={tag}
              variant={selectedTags.includes(tag) ? 'default' : 'outline'}
              className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
              onClick={() => handleTagToggle(tag)}
            >
              {tag}
              {selectedTags.includes(tag) && <X className="w-3 h-3 ml-1" />}
            </Badge>
          ))}
        </div>
      </div>

      {/* Active filters display */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <span className="text-sm text-muted-foreground">Active filters:</span>
          {filters.category && (
            <Badge variant="secondary">
              Category: {TEMPLATE_CATEGORIES.find((c) => c.value === filters.category)?.label}
            </Badge>
          )}
          {filters.complexity && (
            <Badge variant="secondary">
              Complexity: {COMPLEXITY_LEVELS.find((c) => c.value === filters.complexity)?.label}
            </Badge>
          )}
          {filters.search && <Badge variant="secondary">Search: {filters.search}</Badge>}
          {selectedTags.map((tag) => (
            <Badge key={tag} variant="secondary">
              Tag: {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
