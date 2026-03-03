import { db } from './index'
import { templates } from './schema'

const seedTemplates = [
  {
    name: 'Analytics Dashboard',
    category: 'dashboard',
    description: 'A comprehensive analytics dashboard with charts, metrics, and data visualization components.',
    code: `'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, Users, DollarSign, Activity } from 'lucide-react'

export default function AnalyticsDashboard() {
  const metrics = [
    { title: '{{metric1Title}}', value: '{{metric1Value}}', icon: TrendingUp, change: '+12.5%' },
    { title: '{{metric2Title}}', value: '{{metric2Value}}', icon: Users, change: '+8.2%' },
    { title: '{{metric3Title}}', value: '{{metric3Value}}', icon: DollarSign, change: '+15.3%' },
    { title: '{{metric4Title}}', value: '{{metric4Value}}', icon: Activity, change: '+6.7%' },
  ]

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-3xl font-bold">{{title}}</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
              <metric.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <p className="text-xs text-green-600">{metric.change} from last month</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}`,
    preview_image_url: null,
    tags: ['Analytics', 'Dashboard', 'Charts', 'Metrics', 'Cards'],
    metadata: {
      placeholders: ['{{title}}', '{{metric1Title}}', '{{metric1Value}}', '{{metric2Title}}', '{{metric2Value}}', '{{metric3Title}}', '{{metric3Value}}', '{{metric4Title}}', '{{metric4Value}}'],
      components_used: ['Card', 'CardContent', 'CardHeader', 'CardTitle'],
      complexity: 'simple' as const,
    },
    is_active: true,
    usage_count: 245,
  },
  {
    name: 'Product Card Grid',
    category: 'ecommerce',
    description: 'A responsive product grid with cards, images, prices, and add-to-cart buttons.',
    code: `'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ShoppingCart } from 'lucide-react'

export default function ProductGrid() {
  const products = [
    { id: 1, name: 'Product 1', price: '$99.99', image: 'https://placehold.co/400x400' },
    { id: 2, name: 'Product 2', price: '$149.99', image: 'https://placehold.co/400x400' },
    { id: 3, name: 'Product 3', price: '$79.99', image: 'https://placehold.co/400x400' },
  ]

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">{{storeName}}</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map((product) => (
          <Card key={product.id}>
            <CardHeader>
              <img src={product.image} alt={product.name} className="w-full h-48 object-cover rounded-t-lg" />
            </CardHeader>
            <CardContent>
              <CardTitle>{product.name}</CardTitle>
              <CardDescription className="text-2xl font-bold mt-2">{product.price}</CardDescription>
              <Button className="w-full mt-4">
                <ShoppingCart className="w-4 h-4 mr-2" />
                Add to Cart
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}`,
    preview_image_url: null,
    tags: ['E-commerce', 'Products', 'Cards', 'Grid', 'Shopping'],
    metadata: {
      placeholders: ['{{storeName}}'],
      components_used: ['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle', 'Button'],
      complexity: 'simple' as const,
    },
    is_active: true,
    usage_count: 189,
  },
  {
    name: 'Hero Landing Section',
    category: 'landing',
    description: 'A modern hero section with headline, description, CTA buttons, and an image.',
    code: `'use client'

import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'

export default function HeroSection() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-16">
        <div className="flex flex-col lg:flex-row items-center gap-12">
          <div className="flex-1 space-y-6">
            <h1 className="text-5xl lg:text-6xl font-bold leading-tight">
              {{headline}}
            </h1>
            <p className="text-xl text-muted-foreground">
              {{description}}
            </p>
            <div className="flex gap-4">
              <Button size="lg">
                {{ctaText}}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline">
                Learn More
              </Button>
            </div>
          </div>
          <div className="flex-1">
            <img
              src="https://placehold.co/600x400"
              alt="Hero"
              className="rounded-lg shadow-2xl"
            />
          </div>
        </div>
      </div>
    </div>
  )
}`,
    preview_image_url: null,
    tags: ['Landing', 'Hero', 'Marketing', 'CTA', 'Responsive'],
    metadata: {
      placeholders: ['{{headline}}', '{{description}}', '{{ctaText}}'],
      components_used: ['Button'],
      complexity: 'simple' as const,
    },
    is_active: true,
    usage_count: 312,
  },
  {
    name: 'Data Table with Pagination',
    category: 'admin',
    description: 'A data table with sorting, filtering, and pagination for admin panels.',
    code: `'use client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useState } from 'react'

export default function DataTable() {
  const [searchTerm, setSearchTerm] = useState('')

  const data = [
    { id: 1, name: 'John Doe', email: 'john@example.com', role: 'Admin', status: 'Active' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com', role: 'User', status: 'Active' },
    { id: 3, name: 'Bob Johnson', email: 'bob@example.com', role: 'User', status: 'Inactive' },
  ]

  return (
    <div className="p-8 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">{{tableTitle}}</h1>
        <Input
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell>{row.email}</TableCell>
              <TableCell>{row.role}</TableCell>
              <TableCell>{row.status}</TableCell>
              <TableCell>
                <Button variant="outline" size="sm">Edit</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}`,
    preview_image_url: null,
    tags: ['Admin', 'Table', 'CRUD', 'Pagination', 'Data'],
    metadata: {
      placeholders: ['{{tableTitle}}'],
      components_used: ['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow', 'Button', 'Input'],
      complexity: 'medium' as const,
    },
    is_active: true,
    usage_count: 156,
  },
  {
    name: 'Blog Post Card List',
    category: 'blog',
    description: 'A list of blog post cards with images, titles, excerpts, and read more links.',
    code: `'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar, User } from 'lucide-react'

export default function BlogPostList() {
  const posts = [
    {
      id: 1,
      title: '{{post1Title}}',
      excerpt: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
      author: 'John Doe',
      date: 'Mar 15, 2025',
      image: 'https://placehold.co/800x400',
    },
    {
      id: 2,
      title: '{{post2Title}}',
      excerpt: 'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      author: 'Jane Smith',
      date: 'Mar 12, 2025',
      image: 'https://placehold.co/800x400',
    },
  ]

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold">{{blogTitle}}</h1>
      <div className="space-y-6">
        {posts.map((post) => (
          <Card key={post.id} className="overflow-hidden">
            <div className="md:flex">
              <div className="md:w-1/3">
                <img src={post.image} alt={post.title} className="w-full h-full object-cover" />
              </div>
              <div className="md:w-2/3">
                <CardHeader>
                  <CardTitle className="text-2xl">{post.title}</CardTitle>
                  <CardDescription className="flex items-center gap-4 mt-2">
                    <span className="flex items-center gap-1">
                      <User className="w-4 h-4" />
                      {post.author}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      {post.date}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">{post.excerpt}</p>
                  <Button>Read More</Button>
                </CardContent>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}`,
    preview_image_url: null,
    tags: ['Blog', 'Content', 'Cards', 'Posts', 'Responsive'],
    metadata: {
      placeholders: ['{{blogTitle}}', '{{post1Title}}', '{{post2Title}}'],
      components_used: ['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle', 'Button'],
      complexity: 'simple' as const,
    },
    is_active: true,
    usage_count: 134,
  },
  {
    name: 'Login Form',
    category: 'admin',
    description: 'A clean login form with email, password, and remember me checkbox.',
    code: `'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

export default function LoginForm() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">{{formTitle}}</CardTitle>
          <CardDescription>{{formDescription}}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="Enter your email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" placeholder="Enter your password" />
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="remember" />
            <Label htmlFor="remember" className="text-sm font-normal">Remember me</Label>
          </div>
          <Button className="w-full">Sign In</Button>
        </CardContent>
      </Card>
    </div>
  )
}`,
    preview_image_url: null,
    tags: ['Forms', 'Authentication', 'Login', 'Admin'],
    metadata: {
      placeholders: ['{{formTitle}}', '{{formDescription}}'],
      components_used: ['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle', 'Input', 'Button', 'Label', 'Checkbox'],
      complexity: 'simple' as const,
    },
    is_active: true,
    usage_count: 278,
  },
]

export async function seedTemplatesData() {
  try {
    console.log('Seeding templates...')

    for (const template of seedTemplates) {
      await db.insert(templates).values(template).onConflictDoNothing()
    }

    console.log('Templates seeded successfully!')
  } catch (error) {
    console.error('Error seeding templates:', error)
    throw error
  }
}

// Run if called directly
if (require.main === module) {
  seedTemplatesData()
    .then(() => {
      console.log('Seed completed')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Seed failed:', error)
      process.exit(1)
    })
}
