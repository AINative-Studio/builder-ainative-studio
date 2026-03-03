export const landingPageTemplate = {
  name: 'Landing Page',
  category: 'landing',
  description: 'A modern landing page with hero section, features grid, testimonials, CTA sections, and footer. Perfect for product launches and marketing campaigns.',
  code: `'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  Check,
  Star,
  Zap,
  Shield,
  Users,
  TrendingUp,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react'

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const features = [
    {
      icon: Zap,
      title: '{{feature1_title}}',
      description: 'Lightning-fast performance with optimized code and best practices.',
    },
    {
      icon: Shield,
      title: '{{feature2_title}}',
      description: 'Enterprise-grade security with end-to-end encryption and compliance.',
    },
    {
      icon: Users,
      title: '{{feature3_title}}',
      description: 'Seamless collaboration tools for teams of all sizes.',
    },
    {
      icon: TrendingUp,
      title: '{{feature4_title}}',
      description: 'Advanced analytics and insights to drive growth.',
    },
  ]

  const testimonials = [
    {
      name: 'Sarah Johnson',
      role: 'CEO, TechCorp',
      content:
        'This product has completely transformed how our team works. The efficiency gains are incredible!',
      rating: 5,
    },
    {
      name: 'Michael Chen',
      role: 'Product Manager, StartupXYZ',
      content:
        'The best investment we made this year. Our productivity has increased by 40%.',
      rating: 5,
    },
    {
      name: 'Emily Rodriguez',
      role: 'CTO, InnovateLabs',
      content:
        'Outstanding support and a product that actually delivers on its promises. Highly recommend!',
      rating: 5,
    },
  ]

  const pricingPlans = [
    {
      name: 'Starter',
      price: '$29',
      description: 'Perfect for individuals and small teams',
      features: [
        'Up to 5 team members',
        '10GB storage',
        'Basic analytics',
        'Email support',
      ],
      popular: false,
    },
    {
      name: 'Professional',
      price: '$99',
      description: 'For growing teams and businesses',
      features: [
        'Up to 20 team members',
        '100GB storage',
        'Advanced analytics',
        'Priority support',
        'Custom integrations',
      ],
      popular: true,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      description: 'For large organizations',
      features: [
        'Unlimited team members',
        'Unlimited storage',
        'Advanced security',
        'Dedicated support',
        'Custom development',
        'SLA guarantee',
      ],
      popular: false,
    },
  ]

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm">
        <nav className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">{{brand_name}}</h1>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-6">
              <a href="#features" className="hover:text-primary transition-colors">
                Features
              </a>
              <a href="#testimonials" className="hover:text-primary transition-colors">
                Testimonials
              </a>
              <a href="#pricing" className="hover:text-primary transition-colors">
                Pricing
              </a>
              <Button variant="outline">Sign In</Button>
              <Button>Get Started</Button>
            </div>

            {/* Mobile Menu Button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-4 pb-4 space-y-4">
              <a
                href="#features"
                className="block hover:text-primary transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Features
              </a>
              <a
                href="#testimonials"
                className="block hover:text-primary transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Testimonials
              </a>
              <a
                href="#pricing"
                className="block hover:text-primary transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Pricing
              </a>
              <div className="flex flex-col gap-2">
                <Button variant="outline" className="w-full">
                  Sign In
                </Button>
                <Button className="w-full">Get Started</Button>
              </div>
            </div>
          )}
        </nav>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 md:py-32">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <Badge className="mx-auto" variant="secondary">
            New: Now with AI-powered features
          </Badge>
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight">
            {{hero_title}}
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            {{hero_subtitle}}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg">
              {{cta_primary_text}}
              <ChevronRight className="ml-2 h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline" className="text-lg">
              {{cta_secondary_text}}
            </Button>
          </div>
          <div className="flex items-center justify-center gap-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              <span>No credit card required</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              <span>14-day free trial</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="container mx-auto px-4 py-20 bg-muted/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Everything you need to succeed
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Powerful features designed to help you work smarter, not harder.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="border-2">
                <CardHeader>
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle>{feature.title}</CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-muted-foreground mb-8">Trusted by leading companies worldwide</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 items-center opacity-50">
            <div className="text-2xl font-bold">ACME Corp</div>
            <div className="text-2xl font-bold">TechStart</div>
            <div className="text-2xl font-bold">InnovateLabs</div>
            <div className="text-2xl font-bold">GlobalTech</div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="container mx-auto px-4 py-20 bg-muted/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Loved by teams everywhere
            </h2>
            <p className="text-xl text-muted-foreground">
              See what our customers have to say
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <Card key={index}>
                <CardContent className="pt-6">
                  <div className="flex mb-4">
                    {Array.from({ length: testimonial.rating }).map((_, i) => (
                      <Star
                        key={i}
                        className="h-5 w-5 fill-yellow-400 text-yellow-400"
                      />
                    ))}
                  </div>
                  <p className="mb-6 text-muted-foreground">"{testimonial.content}"</p>
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback>
                        {testimonial.name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold">{testimonial.name}</p>
                      <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="container mx-auto px-4 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Simple, transparent pricing
            </h2>
            <p className="text-xl text-muted-foreground">
              Choose the plan that's right for you
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {pricingPlans.map((plan, index) => (
              <Card
                key={index}
                className={plan.popular ? 'border-primary border-2 relative' : ''}
              >
                {plan.popular && (
                  <Badge className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    Most Popular
                  </Badge>
                )}
                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                  <div className="mt-4">
                    <span className="text-4xl font-bold">{plan.price}</span>
                    {plan.price !== 'Custom' && <span className="text-muted-foreground">/month</span>}
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3 mb-6">
                    {plan.features.map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-600 shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={plan.popular ? 'default' : 'outline'}
                  >
                    Get Started
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 bg-muted/50">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <h2 className="text-3xl md:text-5xl font-bold">
            Ready to get started?
          </h2>
          <p className="text-xl text-muted-foreground">
            Join thousands of teams already using our platform
          </p>
          <Button size="lg" className="text-lg">
            {{final_cta_text}}
            <ChevronRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-card">
        <div className="container mx-auto px-4 py-12">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <h3 className="font-bold text-lg mb-4">{{brand_name}}</h3>
              <p className="text-sm text-muted-foreground">
                Building the future of work, one team at a time.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-primary">Features</a></li>
                <li><a href="#" className="hover:text-primary">Pricing</a></li>
                <li><a href="#" className="hover:text-primary">Security</a></li>
                <li><a href="#" className="hover:text-primary">Roadmap</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-primary">About</a></li>
                <li><a href="#" className="hover:text-primary">Blog</a></li>
                <li><a href="#" className="hover:text-primary">Careers</a></li>
                <li><a href="#" className="hover:text-primary">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-primary">Privacy</a></li>
                <li><a href="#" className="hover:text-primary">Terms</a></li>
                <li><a href="#" className="hover:text-primary">Cookies</a></li>
                <li><a href="#" className="hover:text-primary">Licenses</a></li>
              </ul>
            </div>
          </div>
          <Separator className="my-8" />
          <div className="text-center text-sm text-muted-foreground">
            © 2024 {{brand_name}}. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}`,
  tags: ['landing', 'marketing', 'hero', 'cta', 'pricing', 'testimonials'],
  metadata: {
    placeholders: [
      'brand_name',
      'hero_title',
      'hero_subtitle',
      'cta_primary_text',
      'cta_secondary_text',
      'feature1_title',
      'feature2_title',
      'feature3_title',
      'feature4_title',
      'final_cta_text',
    ],
    components_used: [
      'Card',
      'Button',
      'Badge',
      'Avatar',
      'Separator',
    ],
    complexity: 'medium' as const,
  },
  preview_image_url: null,
}
