'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Search, Filter, Star, Tag, Clock, Zap } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  AgentSkill,
  SkillMetadata,
  SkillBrowserProps,
} from '@/lib/types/agent-skills'

interface SkillCardProps {
  skill: SkillMetadata
  onSelect: (skill: AgentSkill) => void
  isLoading?: boolean
}

function SkillCard({ skill, onSelect, isLoading }: SkillCardProps) {
  const [loading, setLoading] = useState(false)

  const handleSelect = async () => {
    setLoading(true)
    try {
      // Fetch full skill details
      const response = await fetch(`/api/skills/${skill.id}`)
      if (!response.ok) throw new Error('Failed to load skill')

      const data = await response.json()
      onSelect(data.skill)
    } catch (error) {
      console.error('Error loading skill:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">{skill.name}</CardTitle>
            <CardDescription className="text-sm text-muted-foreground mt-1">
              v{skill.version}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Zap className="h-4 w-4" />
            <span>{skill.tokenCost.full} tokens</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-3">
          {skill.description}
        </p>
        <div className="flex flex-wrap gap-1 mt-3">
          {skill.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
          {skill.tags.length > 3 && (
            <Badge variant="outline" className="text-xs">
              +{skill.tags.length - 3} more
            </Badge>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button
          onClick={handleSelect}
          disabled={loading || isLoading}
          className="w-full"
        >
          {loading ? 'Loading...' : 'Load Skill'}
        </Button>
      </CardFooter>
    </Card>
  )
}

export function SkillBrowser({ onSkillSelect, currentContext }: SkillBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<'relevance' | 'name' | 'recent'>('relevance')
  const [skills, setSkills] = useState<SkillMetadata[]>([])
  const [filteredSkills, setFilteredSkills] = useState<SkillMetadata[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'all' | 'built-in' | 'custom'>('all')

  // Fetch skills
  useEffect(() => {
    const fetchSkills = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/skills')
        if (!response.ok) throw new Error('Failed to fetch skills')

        const data = await response.json()
        setSkills(data.skills)

        // Extract unique tags
        const tags = new Set<string>()
        data.skills.forEach((skill: SkillMetadata) => {
          skill.tags.forEach((tag) => tags.add(tag))
        })
        setAvailableTags(Array.from(tags).sort())
      } catch (error) {
        console.error('Error fetching skills:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchSkills()
  }, [])

  // Filter and sort skills
  useEffect(() => {
    let filtered = [...skills]

    // Filter by tab
    if (activeTab === 'built-in') {
      filtered = filtered.filter((s: any) => s.is_built_in)
    } else if (activeTab === 'custom') {
      filtered = filtered.filter((s: any) => !s.is_built_in)
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (skill) =>
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query) ||
          skill.tags.some((tag) => tag.toLowerCase().includes(query))
      )
    }

    // Filter by selected tags
    if (selectedTags.length > 0) {
      filtered = filtered.filter((skill) =>
        selectedTags.some((tag) => skill.tags.includes(tag))
      )
    }

    // Sort
    if (sortBy === 'name') {
      filtered.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sortBy === 'recent') {
      filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    }

    setFilteredSkills(filtered)
  }, [skills, searchQuery, selectedTags, sortBy, activeTab])

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="text-2xl font-bold mb-4">Skill Browser</h2>

        {/* Search and Filter */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="relevance">Relevance</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="recent">Recent</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(value: any) => setActiveTab(value)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all">All Skills</TabsTrigger>
            <TabsTrigger value="built-in">Built-in</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Tags Filter */}
      {availableTags.length > 0 && (
        <div className="px-4 py-2 border-b">
          <div className="flex items-center gap-2 mb-2">
            <Filter className="h-4 w-4" />
            <span className="text-sm font-medium">Filter by tags:</span>
          </div>
          <ScrollArea className="w-full">
            <div className="flex flex-wrap gap-2">
              {availableTags.map((tag) => (
                <Badge
                  key={tag}
                  variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleTag(tag)}
                >
                  <Tag className="h-3 w-3 mr-1" />
                  {tag}
                </Badge>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Skills Grid */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">Loading skills...</p>
              </div>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <div className="text-center">
                <p className="text-lg font-medium mb-2">No skills found</p>
                <p className="text-sm text-muted-foreground">
                  Try adjusting your search or filters
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onSelect={onSkillSelect}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-4 border-t bg-muted/50">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div>
            {filteredSkills.length} {filteredSkills.length === 1 ? 'skill' : 'skills'} found
          </div>
          {currentContext?.tokenBudget && (
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              <span>
                {currentContext.tokenBudget.remaining} / {currentContext.tokenBudget.total} tokens remaining
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
