export const blogLayoutTemplate = {
  name: 'Blog Layout',
  category: 'blog',
  description: 'A modern blog layout with article grid, sidebar, search functionality, category filters, and pagination. Perfect for content websites and news platforms.',
  code: `'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Search,
  Calendar,
  Clock,
  Tag,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  User,
} from 'lucide-react'

interface BlogPost {
  id: number
  title: string
  excerpt: string
  author: string
  category: string
  tags: string[]
  date: string
  readTime: string
  views: number
}

export default function BlogLayout() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const postsPerPage = 6

  // Mock blog posts
  const allPosts: BlogPost[] = [
    {
      id: 1,
      title: 'Getting Started with Modern Web Development',
      excerpt:
        'Learn the fundamentals of modern web development including React, TypeScript, and best practices for building scalable applications.',
      author: 'Sarah Johnson',
      category: 'Tutorial',
      tags: ['React', 'TypeScript', 'Web Dev'],
      date: '2024-01-15',
      readTime: '8 min read',
      views: 1245,
    },
    {
      id: 2,
      title: 'The Future of AI in Software Development',
      excerpt:
        'Exploring how artificial intelligence is transforming the way we write, test, and deploy software in 2024 and beyond.',
      author: 'Michael Chen',
      category: 'Technology',
      tags: ['AI', 'Machine Learning', 'Future'],
      date: '2024-01-14',
      readTime: '12 min read',
      views: 2156,
    },
    {
      id: 3,
      title: 'Design Systems: Building Consistent UIs',
      excerpt:
        'A comprehensive guide to creating and maintaining design systems that scale with your product and team.',
      author: 'Emily Rodriguez',
      category: 'Design',
      tags: ['Design Systems', 'UI/UX', 'Components'],
      date: '2024-01-13',
      readTime: '10 min read',
      views: 987,
    },
    {
      id: 4,
      title: 'Performance Optimization Techniques',
      excerpt:
        'Practical tips and strategies for optimizing web application performance and improving user experience.',
      author: 'David Kim',
      category: 'Tutorial',
      tags: ['Performance', 'Optimization', 'Web Dev'],
      date: '2024-01-12',
      readTime: '15 min read',
      views: 1678,
    },
    {
      id: 5,
      title: 'Introduction to Serverless Architecture',
      excerpt:
        'Understanding serverless computing and how it can simplify your infrastructure while reducing costs.',
      author: 'Lisa Wang',
      category: 'Cloud',
      tags: ['Serverless', 'AWS', 'Architecture'],
      date: '2024-01-11',
      readTime: '7 min read',
      views: 1432,
    },
    {
      id: 6,
      title: 'Accessibility Best Practices for Web Apps',
      excerpt:
        'Ensuring your web applications are accessible to everyone with these essential guidelines and techniques.',
      author: 'James Brown',
      category: 'Tutorial',
      tags: ['Accessibility', 'ARIA', 'Inclusive'],
      date: '2024-01-10',
      readTime: '9 min read',
      views: 876,
    },
    {
      id: 7,
      title: 'State Management in React Applications',
      excerpt:
        'Comparing different state management solutions and choosing the right one for your React project.',
      author: 'Sarah Johnson',
      category: 'Tutorial',
      tags: ['React', 'State Management', 'Redux'],
      date: '2024-01-09',
      readTime: '11 min read',
      views: 1987,
    },
    {
      id: 8,
      title: 'GraphQL vs REST: Which to Choose?',
      excerpt:
        'An in-depth comparison of GraphQL and REST APIs to help you make the right choice for your project.',
      author: 'Michael Chen',
      category: 'Technology',
      tags: ['GraphQL', 'REST', 'APIs'],
      date: '2024-01-08',
      readTime: '13 min read',
      views: 2345,
    },
  ]

  const categories = ['all', 'Tutorial', 'Technology', 'Design', 'Cloud']

  const filteredPosts = allPosts.filter((post) => {
    const matchesSearch =
      post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.excerpt.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
    const matchesCategory = selectedCategory === 'all' || post.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  const totalPages = Math.ceil(filteredPosts.length / postsPerPage)
  const startIndex = (currentPage - 1) * postsPerPage
  const paginatedPosts = filteredPosts.slice(startIndex, startIndex + postsPerPage)

  const popularPosts = [...allPosts].sort((a, b) => b.views - a.views).slice(0, 5)
  const allTags = Array.from(new Set(allPosts.flatMap((post) => post.tags)))

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold">{{blog_title}}</h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              {{blog_subtitle}}
            </p>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Main Content */}
          <main className="flex-1">
            {/* Search Bar */}
            <div className="mb-8">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input
                  type="search"
                  placeholder="Search articles..."
                  className="w-full pl-12 pr-4 py-3 border rounded-lg bg-background text-lg"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setCurrentPage(1)
                  }}
                  aria-label="Search articles"
                />
              </div>
            </div>

            {/* Category Filters */}
            <div className="flex flex-wrap gap-2 mb-8">
              {categories.map((category) => (
                <Button
                  key={category}
                  variant={selectedCategory === category ? 'default' : 'outline'}
                  onClick={() => {
                    setSelectedCategory(category)
                    setCurrentPage(1)
                  }}
                  className="capitalize"
                >
                  {category}
                </Button>
              ))}
            </div>

            {/* Results Count */}
            <div className="mb-6">
              <p className="text-muted-foreground">
                {filteredPosts.length} {filteredPosts.length === 1 ? 'article' : 'articles'} found
              </p>
            </div>

            {/* Blog Posts Grid */}
            {paginatedPosts.length === 0 ? (
              <Card className="p-12">
                <div className="text-center text-muted-foreground">
                  <p className="text-lg">No articles found</p>
                  <p className="mt-2">Try adjusting your search or filters</p>
                </div>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-6 mb-8">
                {paginatedPosts.map((post) => (
                  <Card key={post.id} className="group hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <div className="flex items-center gap-2 mb-3">
                        <Badge>{post.category}</Badge>
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {post.date}
                        </span>
                      </div>
                      <CardTitle className="group-hover:text-primary transition-colors">
                        <a href="#" className="line-clamp-2">
                          {post.title}
                        </a>
                      </CardTitle>
                      <CardDescription className="line-clamp-3">
                        {post.excerpt}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>
                              {post.author
                                .split(' ')
                                .map((n) => n[0])
                                .join('')}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium">{post.author}</span>
                        </div>
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {post.readTime}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {post.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <Button variant="ghost" className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        Read More
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setCurrentPage(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Previous
                </Button>
                <div className="flex items-center gap-2">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <Button
                      key={page}
                      variant={currentPage === page ? 'default' : 'outline'}
                      onClick={() => setCurrentPage(page)}
                      className="w-10"
                    >
                      {page}
                    </Button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  onClick={() => setCurrentPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </main>

          {/* Sidebar */}
          <aside className="lg:w-80 space-y-6">
            {/* About Section */}
            <Card>
              <CardHeader>
                <CardTitle>{{sidebar_about_title}}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {{sidebar_about_text}}
                </p>
              </CardContent>
            </Card>

            {/* Popular Posts */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Popular Posts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-4">
                    {popularPosts.map((post, index) => (
                      <div key={post.id}>
                        {index > 0 && <Separator className="my-4" />}
                        <a href="#" className="block hover:bg-muted/50 p-2 rounded-md transition-colors">
                          <div className="flex gap-3">
                            <div className="text-2xl font-bold text-muted-foreground w-8 shrink-0">
                              {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-sm line-clamp-2 mb-1">
                                {post.title}
                              </h3>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{post.views} views</span>
                                <span>•</span>
                                <span>{post.readTime}</span>
                              </div>
                            </div>
                          </div>
                        </a>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Categories */}
            <Card>
              <CardHeader>
                <CardTitle>Categories</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {categories.slice(1).map((category) => {
                    const count = allPosts.filter((post) => post.category === category).length
                    return (
                      <Button
                        key={category}
                        variant="ghost"
                        className="w-full justify-between"
                        onClick={() => {
                          setSelectedCategory(category)
                          setCurrentPage(1)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                      >
                        <span>{category}</span>
                        <Badge variant="secondary">{count}</Badge>
                      </Button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Tags */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tag className="h-5 w-5" />
                  Popular Tags
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {allTags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                      onClick={() => {
                        setSearchQuery(tag)
                        setCurrentPage(1)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Newsletter */}
            <Card className="bg-primary text-primary-foreground">
              <CardHeader>
                <CardTitle>Subscribe to Newsletter</CardTitle>
                <CardDescription className="text-primary-foreground/80">
                  Get the latest articles delivered to your inbox
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <input
                    type="email"
                    placeholder="Enter your email"
                    className="w-full px-3 py-2 rounded-md bg-background text-foreground"
                    aria-label="Email address"
                  />
                  <Button className="w-full bg-background text-foreground hover:bg-background/90">
                    Subscribe
                  </Button>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t bg-card mt-16">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center text-sm text-muted-foreground">
            © 2024 {{blog_title}}. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}`,
  tags: ['blog', 'content', 'articles', 'news', 'publishing', 'cms'],
  metadata: {
    placeholders: [
      'blog_title',
      'blog_subtitle',
      'sidebar_about_title',
      'sidebar_about_text',
    ],
    components_used: [
      'Card',
      'Button',
      'Badge',
      'Avatar',
      'ScrollArea',
      'Separator',
    ],
    complexity: 'medium' as const,
  },
  preview_image_url: null,
}
