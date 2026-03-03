import { db } from './connection'
import { few_shot_examples } from './schema'

/**
 * Seed few-shot examples for enhanced prompt engineering (US-028)
 *
 * These examples demonstrate best practices for different UI categories
 * and are used for dynamic example selection based on user prompts.
 */
export async function seedFewShotExamples() {
  const examples = [
    // DASHBOARD CATEGORY
    {
      category: 'dashboard',
      prompt: 'Create an analytics dashboard showing key metrics',
      good_output: `function AnalyticsDashboard() {
  const [dateRange, setDateRange] = useState('7d')

  const metrics = [
    { label: 'Total Revenue', value: '$45,231', change: '+20.1%', trend: 'up' },
    { label: 'Active Users', value: '2,350', change: '+15.3%', trend: 'up' },
    { label: 'Conversion Rate', value: '3.24%', change: '-2.4%', trend: 'down' },
    { label: 'Avg Session', value: '4m 32s', change: '+8.7%', trend: 'up' }
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
        <Button variant="outline" onClick={() => setDateRange(dateRange === '7d' ? '30d' : '7d')}>
          {dateRange === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardHeader>
              <CardDescription>{metric.label}</CardDescription>
              <CardTitle className="text-2xl">{metric.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={metric.trend === 'up' ? 'default' : 'destructive'}>
                {metric.change}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}`,
      explanation: 'This example demonstrates: 1) Interactive state management with useState, 2) Grid layout for metric cards, 3) Proper Card structure with Header/Content, 4) Dynamic badge variants based on data, 5) Real functionality with clickable date range toggle',
      tags: ['dashboard', 'analytics', 'metrics', 'cards', 'interactive', 'state']
    },

    // DASHBOARD - Data Table
    {
      category: 'dashboard',
      prompt: 'Build a user management table with search and actions',
      good_output: `function UserManagement() {
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState([
    { id: 1, name: 'John Doe', email: 'john@example.com', role: 'Admin', status: 'Active' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com', role: 'User', status: 'Active' },
    { id: 3, name: 'Bob Johnson', email: 'bob@example.com', role: 'User', status: 'Inactive' }
  ])

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(search.toLowerCase()) ||
    user.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">User Management</h1>
        <Input
          type="search"
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <Card>
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
            {filteredUsers.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell><Badge>{user.role}</Badge></TableCell>
                <TableCell>
                  <Badge variant={user.status === 'Active' ? 'default' : 'secondary'}>
                    {user.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button variant="outline" size="sm">Edit</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}`,
      explanation: 'This example shows: 1) Working search functionality with filter, 2) Proper table structure with all required components, 3) Dynamic filtering based on user input, 4) Status indicators with badges, 5) Action buttons in table cells',
      tags: ['dashboard', 'table', 'search', 'filter', 'crud', 'interactive']
    },

    // FORM CATEGORY
    {
      category: 'form',
      prompt: 'Create a contact form with validation',
      good_output: `function ContactForm() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: ''
  })
  const [errors, setErrors] = useState({})
  const [submitted, setSubmitted] = useState(false)

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  const validateForm = () => {
    const newErrors = {}
    if (!formData.name.trim()) newErrors.name = 'Name is required'
    if (!formData.email.includes('@')) newErrors.email = 'Valid email is required'
    if (!formData.message.trim()) newErrors.message = 'Message is required'
    return newErrors
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const newErrors = validateForm()
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }
    setSubmitted(true)
    console.log('Form submitted:', formData)
  }

  if (submitted) {
    return (
      <Card className="max-w-md mx-auto p-6">
        <CardContent className="text-center">
          <h2 className="text-2xl font-bold text-green-600 mb-2">Thank You!</h2>
          <p>Your message has been sent successfully.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Contact Us</CardTitle>
        <CardDescription>Fill out the form below to get in touch</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className={errors.name ? 'border-red-500' : ''}
            />
            {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
          </div>

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              className={errors.email ? 'border-red-500' : ''}
            />
            {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
          </div>

          <div>
            <Label htmlFor="message">Message</Label>
            <Input
              id="message"
              type="text"
              value={formData.message}
              onChange={(e) => handleChange('message', e.target.value)}
              className={errors.message ? 'border-red-500' : ''}
            />
            {errors.message && <p className="text-red-500 text-sm mt-1">{errors.message}</p>}
          </div>

          <Button type="submit" className="w-full">Send Message</Button>
        </form>
      </CardContent>
    </Card>
  )
}`,
      explanation: 'This example demonstrates: 1) Complete form state management, 2) Field validation with error messages, 3) Success state after submission, 4) Proper Label/Input pairing for accessibility, 5) Real submit handler with preventDefault, 6) Dynamic error styling',
      tags: ['form', 'validation', 'state', 'submit', 'errors', 'accessibility']
    },

    // FORM - Multi-step
    {
      category: 'form',
      prompt: 'Create a multi-step registration form',
      good_output: `function RegistrationForm() {
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: ''
  })

  const handleNext = () => setStep(prev => Math.min(prev + 1, 3))
  const handleBack = () => setStep(prev => Math.max(prev - 1, 1))

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Registration - Step {step} of 3</CardTitle>
        <CardDescription>
          {step === 1 && 'Create your account'}
          {step === 2 && 'Personal information'}
          {step === 3 && 'Review and confirm'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 1 && (
          <>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => handleChange('password', e.target.value)}
              />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                type="text"
                value={formData.firstName}
                onChange={(e) => handleChange('firstName', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                type="text"
                value={formData.lastName}
                onChange={(e) => handleChange('lastName', e.target.value)}
              />
            </div>
          </>
        )}

        {step === 3 && (
          <div className="space-y-2">
            <h3 className="font-semibold">Review Your Information</h3>
            <p><strong>Email:</strong> {formData.email}</p>
            <p><strong>Name:</strong> {formData.firstName} {formData.lastName}</p>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={step === 1}
        >
          Back
        </Button>
        <Button onClick={handleNext}>
          {step === 3 ? 'Complete' : 'Next'}
        </Button>
      </CardFooter>
    </Card>
  )
}`,
      explanation: 'This example shows: 1) Multi-step form navigation, 2) Conditional rendering based on step, 3) State persistence across steps, 4) Navigation with Next/Back buttons, 5) Review step showing collected data, 6) Proper CardFooter usage for actions',
      tags: ['form', 'multi-step', 'wizard', 'navigation', 'state', 'conditional']
    },

    // ECOMMERCE CATEGORY
    {
      category: 'ecommerce',
      prompt: 'Build a product catalog with add to cart functionality',
      good_output: `function ProductCatalog() {
  const [cart, setCart] = useState([])
  const [filter, setFilter] = useState('all')

  const products = [
    { id: 1, name: 'Wireless Headphones', price: 99.99, category: 'electronics', image: '🎧' },
    { id: 2, name: 'Smart Watch', price: 299.99, category: 'electronics', image: '⌚' },
    { id: 3, name: 'Running Shoes', price: 89.99, category: 'clothing', image: '👟' },
    { id: 4, name: 'Backpack', price: 49.99, category: 'accessories', image: '🎒' }
  ]

  const filteredProducts = filter === 'all'
    ? products
    : products.filter(p => p.category === filter)

  const addToCart = (product) => {
    setCart(prev => [...prev, product])
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Our Products</h1>
        <Badge>{cart.length} items in cart</Badge>
      </div>

      <div className="flex gap-2">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          All
        </Button>
        <Button
          variant={filter === 'electronics' ? 'default' : 'outline'}
          onClick={() => setFilter('electronics')}
        >
          Electronics
        </Button>
        <Button
          variant={filter === 'clothing' ? 'default' : 'outline'}
          onClick={() => setFilter('clothing')}
        >
          Clothing
        </Button>
        <Button
          variant={filter === 'accessories' ? 'default' : 'outline'}
          onClick={() => setFilter('accessories')}
        >
          Accessories
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredProducts.map((product) => (
          <Card key={product.id}>
            <CardHeader>
              <div className="text-6xl text-center mb-4">{product.image}</div>
              <CardTitle className="text-lg">{product.name}</CardTitle>
              <CardDescription>{product.category}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${product.price}</p>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                onClick={() => addToCart(product)}
              >
                Add to Cart
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}`,
      explanation: 'This example demonstrates: 1) Product filtering with category buttons, 2) Shopping cart state management, 3) Add to cart functionality, 4) Dynamic button variants for active filter, 5) Grid layout for product cards, 6) Cart count badge indicator',
      tags: ['ecommerce', 'products', 'cart', 'filter', 'grid', 'interactive']
    },

    // ECOMMERCE - Checkout
    {
      category: 'ecommerce',
      prompt: 'Create a shopping cart checkout page',
      good_output: `function CheckoutPage() {
  const [cartItems, setCartItems] = useState([
    { id: 1, name: 'Wireless Headphones', price: 99.99, quantity: 1 },
    { id: 2, name: 'Smart Watch', price: 299.99, quantity: 2 }
  ])

  const updateQuantity = (id, newQuantity) => {
    if (newQuantity < 1) return
    setCartItems(prev => prev.map(item =>
      item.id === id ? { ...item, quantity: newQuantity } : item
    ))
  }

  const removeItem = (id) => {
    setCartItems(prev => prev.filter(item => item.id !== id))
  }

  const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0)
  const tax = subtotal * 0.1
  const total = subtotal + tax

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Shopping Cart</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {cartItems.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <h3 className="font-semibold">{item.name}</h3>
                  <p className="text-gray-600">${item.price.toFixed(2)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                  >
                    -
                  </Button>
                  <span className="w-8 text-center">{item.quantity}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                  >
                    +
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => removeItem(item.id)}
                  >
                    Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Order Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tax (10%)</span>
              <span>${tax.toFixed(2)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full">Proceed to Checkout</Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}`,
      explanation: 'This example shows: 1) Cart item quantity management, 2) Real-time total calculations, 3) Remove item functionality, 4) Grid layout with sidebar summary, 5) Proper number formatting, 6) Use of Separator for visual hierarchy',
      tags: ['ecommerce', 'cart', 'checkout', 'calculations', 'crud', 'layout']
    },

    // LANDING PAGE CATEGORY
    {
      category: 'landing',
      prompt: 'Create a SaaS product landing page with hero section',
      good_output: `function LandingPage() {
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)

  const handleSubscribe = (e) => {
    e.preventDefault()
    if (email.includes('@')) {
      setSubscribed(true)
    }
  }

  const features = [
    { icon: '⚡', title: 'Lightning Fast', description: 'Optimized for speed and performance' },
    { icon: '🔒', title: 'Secure', description: 'Enterprise-grade security built-in' },
    { icon: '📊', title: 'Analytics', description: 'Powerful insights and reporting' },
    { icon: '🎨', title: 'Customizable', description: 'Tailored to your needs' }
  ]

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-blue-600 to-purple-700 text-white p-12 text-center">
        <h1 className="text-5xl font-bold mb-4">Transform Your Workflow</h1>
        <p className="text-xl mb-8 max-w-2xl mx-auto">
          The all-in-one platform for modern teams to collaborate, analyze, and grow
        </p>

        {subscribed ? (
          <Card className="max-w-md mx-auto bg-white text-gray-900">
            <CardContent className="p-6">
              <p className="text-lg font-semibold">🎉 Thanks for subscribing!</p>
              <p className="text-sm text-gray-600">Check your email for next steps</p>
            </CardContent>
          </Card>
        ) : (
          <form onSubmit={handleSubscribe} className="max-w-md mx-auto flex gap-2">
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-white text-gray-900"
            />
            <Button type="submit" variant="secondary">Get Started</Button>
          </form>
        )}
      </div>

      {/* Features Section */}
      <div className="p-12">
        <h2 className="text-3xl font-bold text-center mb-8">Why Choose Us</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {features.map((feature, index) => (
            <Card key={index}>
              <CardHeader>
                <div className="text-4xl mb-2">{feature.icon}</div>
                <CardTitle className="text-xl">{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}`,
      explanation: 'This example demonstrates: 1) Hero section with gradient background, 2) Email capture form with validation, 3) Success state after subscription, 4) Feature grid with icons, 5) Responsive layout, 6) Centered content with max-width constraints',
      tags: ['landing', 'hero', 'cta', 'features', 'email', 'gradient']
    },

    // LANDING - Pricing
    {
      category: 'landing',
      prompt: 'Build a pricing page with multiple tiers',
      good_output: `function PricingPage() {
  const [billingPeriod, setBillingPeriod] = useState('monthly')

  const plans = [
    {
      name: 'Starter',
      price: billingPeriod === 'monthly' ? 9 : 90,
      features: ['5 Projects', '10 GB Storage', 'Email Support']
    },
    {
      name: 'Professional',
      price: billingPeriod === 'monthly' ? 29 : 290,
      features: ['Unlimited Projects', '100 GB Storage', 'Priority Support', 'Advanced Analytics'],
      popular: true
    },
    {
      name: 'Enterprise',
      price: billingPeriod === 'monthly' ? 99 : 990,
      features: ['Unlimited Everything', 'Dedicated Support', 'Custom Integrations', 'SLA']
    }
  ]

  return (
    <div className="p-12 max-w-6xl mx-auto">
      <h1 className="text-4xl font-bold text-center mb-4">Choose Your Plan</h1>
      <p className="text-center text-gray-600 mb-8">Start free, upgrade when you need</p>

      <div className="flex justify-center gap-2 mb-12">
        <Button
          variant={billingPeriod === 'monthly' ? 'default' : 'outline'}
          onClick={() => setBillingPeriod('monthly')}
        >
          Monthly
        </Button>
        <Button
          variant={billingPeriod === 'yearly' ? 'default' : 'outline'}
          onClick={() => setBillingPeriod('yearly')}
        >
          Yearly (Save 17%)
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <Card
            key={plan.name}
            className={plan.popular ? 'border-blue-500 border-2' : ''}
          >
            <CardHeader>
              {plan.popular && (
                <Badge className="w-fit mb-2">Most Popular</Badge>
              )}
              <CardTitle className="text-2xl">{plan.name}</CardTitle>
              <div className="text-4xl font-bold my-4">
                ${plan.price}
                <span className="text-lg text-gray-600 font-normal">
                  /{billingPeriod === 'monthly' ? 'mo' : 'yr'}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span>✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                variant={plan.popular ? 'default' : 'outline'}
              >
                Get Started
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}`,
      explanation: 'This example shows: 1) Billing period toggle with price updates, 2) Popular plan highlighting, 3) Feature lists with checkmarks, 4) Dynamic pricing based on billing period, 5) Visual emphasis on recommended tier, 6) Responsive grid layout',
      tags: ['landing', 'pricing', 'plans', 'toggle', 'billing', 'features']
    },

    // BLOG CATEGORY
    {
      category: 'blog',
      prompt: 'Create a blog post listing page with categories',
      good_output: `function BlogListing() {
  const [selectedCategory, setSelectedCategory] = useState('all')

  const posts = [
    { id: 1, title: 'Getting Started with React', category: 'tutorial', author: 'John Doe', date: '2024-01-15' },
    { id: 2, title: 'Web Performance Tips', category: 'performance', author: 'Jane Smith', date: '2024-01-20' },
    { id: 3, title: 'Design System Best Practices', category: 'design', author: 'Bob Johnson', date: '2024-01-25' },
    { id: 4, title: 'Advanced React Patterns', category: 'tutorial', author: 'John Doe', date: '2024-02-01' }
  ]

  const filteredPosts = selectedCategory === 'all'
    ? posts
    : posts.filter(post => post.category === selectedCategory)

  const categories = ['all', 'tutorial', 'performance', 'design']

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold mb-8">Blog</h1>

      <div className="flex gap-2 mb-6">
        {categories.map((category) => (
          <Button
            key={category}
            variant={selectedCategory === category ? 'default' : 'outline'}
            onClick={() => setSelectedCategory(category)}
          >
            {category.charAt(0).toUpperCase() + category.slice(1)}
          </Button>
        ))}
      </div>

      <div className="space-y-4">
        {filteredPosts.map((post) => (
          <Card key={post.id} className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <div className="flex justify-between items-start mb-2">
                <Badge>{post.category}</Badge>
                <span className="text-sm text-gray-600">{post.date}</span>
              </div>
              <CardTitle className="text-2xl">{post.title}</CardTitle>
              <CardDescription>By {post.author}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  )
}`,
      explanation: 'This example demonstrates: 1) Category filtering with active state, 2) Dynamic post filtering, 3) Post metadata display (author, date, category), 4) Hover effects for interactivity, 5) Clean list layout with spacing',
      tags: ['blog', 'list', 'filter', 'categories', 'posts', 'metadata']
    },

    // ADMIN PANEL
    {
      category: 'admin',
      prompt: 'Build an admin settings page with multiple sections',
      good_output: `function AdminSettings() {
  const [settings, setSettings] = useState({
    siteName: 'My App',
    maintenanceMode: false,
    allowSignups: true,
    maxUsers: 1000
  })
  const [saved, setSaved] = useState(false)

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const handleSave = () => {
    console.log('Saving settings:', settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Settings</h1>
        {saved && <Badge variant="default">Saved successfully!</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>Manage your application configuration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="siteName">Site Name</Label>
            <Input
              id="siteName"
              value={settings.siteName}
              onChange={(e) => handleChange('siteName', e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="maxUsers">Maximum Users</Label>
            <Input
              id="maxUsers"
              type="number"
              value={settings.maxUsers}
              onChange={(e) => handleChange('maxUsers', parseInt(e.target.value))}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label>Maintenance Mode</Label>
              <p className="text-sm text-gray-600">Temporarily disable site access</p>
            </div>
            <Button
              variant={settings.maintenanceMode ? 'destructive' : 'outline'}
              onClick={() => handleChange('maintenanceMode', !settings.maintenanceMode)}
            >
              {settings.maintenanceMode ? 'Enabled' : 'Disabled'}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Allow New Signups</Label>
              <p className="text-sm text-gray-600">Let new users register accounts</p>
            </div>
            <Button
              variant={settings.allowSignups ? 'default' : 'outline'}
              onClick={() => handleChange('allowSignups', !settings.allowSignups)}
            >
              {settings.allowSignups ? 'Enabled' : 'Disabled'}
            </Button>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleSave} className="w-full">
            Save Changes
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}`,
      explanation: 'This example shows: 1) Settings state management, 2) Toggle buttons for boolean settings, 3) Save confirmation with temporary badge, 4) Mixed input types (text, number, toggles), 5) Proper use of Separator for sections, 6) Clear save action',
      tags: ['admin', 'settings', 'toggles', 'form', 'configuration', 'state']
    }
  ]

  console.log('Seeding few-shot examples...')

  for (const example of examples) {
    await db.insert(few_shot_examples).values(example)
  }

  console.log(`Successfully seeded ${examples.length} few-shot examples`)
}

// Run if executed directly
if (require.main === module) {
  seedFewShotExamples()
    .then(() => {
      console.log('Seed completed')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Seed failed:', error)
      process.exit(1)
    })
}
