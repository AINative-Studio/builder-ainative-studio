export const ecommerceProductTemplate = {
  name: 'E-commerce Product Page',
  category: 'ecommerce',
  description: 'A complete e-commerce product page with product grid, filters, add to cart functionality, and cart sidebar. Ideal for online stores and marketplace applications.',
  code: `'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  ShoppingCart,
  Star,
  Heart,
  Search,
  X,
  Plus,
  Minus,
  Filter,
  ChevronDown,
} from 'lucide-react'

interface Product {
  id: number
  name: string
  price: number
  originalPrice?: number
  rating: number
  reviews: number
  category: string
  inStock: boolean
  image: string
}

interface CartItem extends Product {
  quantity: number
}

export default function EcommercePage() {
  const [cartOpen, setCartOpen] = useState(false)
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [filters, setFilters] = useState({
    categories: [] as string[],
    priceRange: 'all',
    inStockOnly: false,
  })

  // Mock products
  const products: Product[] = [
    {
      id: 1,
      name: 'Premium Wireless Headphones',
      price: 299.99,
      originalPrice: 399.99,
      rating: 4.5,
      reviews: 128,
      category: 'Electronics',
      inStock: true,
      image: '🎧',
    },
    {
      id: 2,
      name: 'Smart Watch Pro',
      price: 249.99,
      rating: 4.8,
      reviews: 256,
      category: 'Electronics',
      inStock: true,
      image: '⌚',
    },
    {
      id: 3,
      name: 'Ergonomic Office Chair',
      price: 449.99,
      rating: 4.6,
      reviews: 89,
      category: 'Furniture',
      inStock: true,
      image: '🪑',
    },
    {
      id: 4,
      name: 'Mechanical Keyboard',
      price: 129.99,
      rating: 4.7,
      reviews: 342,
      category: 'Electronics',
      inStock: false,
      image: '⌨️',
    },
    {
      id: 5,
      name: 'Standing Desk',
      price: 599.99,
      originalPrice: 799.99,
      rating: 4.9,
      reviews: 167,
      category: 'Furniture',
      inStock: true,
      image: '🖥️',
    },
    {
      id: 6,
      name: 'Noise Cancelling Earbuds',
      price: 179.99,
      rating: 4.4,
      reviews: 523,
      category: 'Electronics',
      inStock: true,
      image: '🎵',
    },
    {
      id: 7,
      name: 'Monitor Arm Mount',
      price: 89.99,
      rating: 4.3,
      reviews: 94,
      category: 'Accessories',
      inStock: true,
      image: '🖥️',
    },
    {
      id: 8,
      name: 'Laptop Stand',
      price: 59.99,
      rating: 4.5,
      reviews: 218,
      category: 'Accessories',
      inStock: true,
      image: '💻',
    },
  ]

  const addToCart = (product: Product) => {
    const existingItem = cartItems.find((item) => item.id === product.id)
    if (existingItem) {
      setCartItems(
        cartItems.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      )
    } else {
      setCartItems([...cartItems, { ...product, quantity: 1 }])
    }
    setCartOpen(true)
  }

  const updateQuantity = (id: number, delta: number) => {
    setCartItems(
      cartItems
        .map((item) =>
          item.id === id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item
        )
        .filter((item) => item.quantity > 0)
    )
  }

  const removeFromCart = (id: number) => {
    setCartItems(cartItems.filter((item) => item.id !== id))
  }

  const cartTotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const cartItemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0)

  const filteredProducts = products.filter((product) => {
    if (filters.categories.length > 0 && !filters.categories.includes(product.category)) {
      return false
    }
    if (filters.inStockOnly && !product.inStock) {
      return false
    }
    if (filters.priceRange === 'under100' && product.price >= 100) {
      return false
    }
    if (filters.priceRange === '100to300' && (product.price < 100 || product.price > 300)) {
      return false
    }
    if (filters.priceRange === 'over300' && product.price <= 300) {
      return false
    }
    return true
  })

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">{{store_name}}</h1>
            <div className="flex items-center gap-4">
              <div className="relative hidden md:block">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="search"
                  placeholder="Search products..."
                  className="w-64 pl-10 pr-4 py-2 border rounded-md bg-background"
                  aria-label="Search products"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="relative"
                onClick={() => setCartOpen(!cartOpen)}
                aria-label="Shopping cart"
              >
                <ShoppingCart className="h-5 w-5" />
                {cartItemCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground rounded-full w-5 h-5 text-xs flex items-center justify-center">
                    {cartItemCount}
                  </span>
                )}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="flex gap-8">
          {/* Filters Sidebar */}
          <aside className="hidden lg:block w-64 shrink-0">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Filter className="h-5 w-5" />
                  Filters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Category Filter */}
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Category</Label>
                  {['Electronics', 'Furniture', 'Accessories'].map((category) => (
                    <div key={category} className="flex items-center space-x-2">
                      <Checkbox
                        id={category}
                        checked={filters.categories.includes(category)}
                        onCheckedChange={(checked) => {
                          setFilters({
                            ...filters,
                            categories: checked
                              ? [...filters.categories, category]
                              : filters.categories.filter((c) => c !== category),
                          })
                        }}
                      />
                      <Label htmlFor={category} className="font-normal cursor-pointer">
                        {category}
                      </Label>
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Price Range Filter */}
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Price Range</Label>
                  <Select
                    value={filters.priceRange}
                    onValueChange={(value) => setFilters({ ...filters, priceRange: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Prices</SelectItem>
                      <SelectItem value="under100">Under $100</SelectItem>
                      <SelectItem value="100to300">$100 - $300</SelectItem>
                      <SelectItem value="over300">Over $300</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                {/* Stock Filter */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="inStock"
                    checked={filters.inStockOnly}
                    onCheckedChange={(checked) =>
                      setFilters({ ...filters, inStockOnly: checked as boolean })
                    }
                  />
                  <Label htmlFor="inStock" className="font-normal cursor-pointer">
                    In Stock Only
                  </Label>
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    setFilters({ categories: [], priceRange: 'all', inStockOnly: false })
                  }
                >
                  Clear Filters
                </Button>
              </CardContent>
            </Card>
          </aside>

          {/* Product Grid */}
          <main className="flex-1">
            <div className="mb-6">
              <h2 className="text-2xl font-bold">{{category_title}}</h2>
              <p className="text-muted-foreground">
                {filteredProducts.length} products found
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProducts.map((product) => (
                <Card key={product.id} className="group overflow-hidden">
                  <CardContent className="p-0">
                    <div className="relative aspect-square bg-muted flex items-center justify-center text-6xl">
                      {product.image}
                      {product.originalPrice && (
                        <Badge className="absolute top-2 right-2" variant="destructive">
                          Sale
                        </Badge>
                      )}
                      <Button
                        variant="secondary"
                        size="icon"
                        className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Add to wishlist"
                      >
                        <Heart className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="p-4 space-y-3">
                      <div>
                        <h3 className="font-semibold line-clamp-1">{product.name}</h3>
                        <p className="text-sm text-muted-foreground">{product.category}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={\`h-4 w-4 \${
                                i < Math.floor(product.rating)
                                  ? 'fill-yellow-400 text-yellow-400'
                                  : 'text-muted-foreground'
                              }\`}
                            />
                          ))}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          ({product.reviews})
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xl font-bold">\${product.price}</span>
                          {product.originalPrice && (
                            <span className="ml-2 text-sm text-muted-foreground line-through">
                              \${product.originalPrice}
                            </span>
                          )}
                        </div>
                      </div>
                      {product.inStock ? (
                        <Button
                          className="w-full"
                          onClick={() => addToCart(product)}
                        >
                          <ShoppingCart className="h-4 w-4 mr-2" />
                          Add to Cart
                        </Button>
                      ) : (
                        <Button className="w-full" disabled>
                          Out of Stock
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </main>
        </div>
      </div>

      {/* Cart Sidebar */}
      {cartOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setCartOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed right-0 top-0 h-full w-full md:w-96 bg-card border-l z-50 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">Shopping Cart ({cartItemCount})</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCartOpen(false)}
                aria-label="Close cart"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <ScrollArea className="flex-1 p-4">
              {cartItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShoppingCart className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Your cart is empty</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {cartItems.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="p-4">
                        <div className="flex gap-4">
                          <div className="w-16 h-16 bg-muted rounded flex items-center justify-center text-2xl shrink-0">
                            {item.image}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-sm line-clamp-1">{item.name}</h3>
                            <p className="text-sm text-muted-foreground">\${item.price}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => updateQuantity(item.id, -1)}
                                aria-label="Decrease quantity"
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-8 text-center text-sm">{item.quantity}</span>
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => updateQuantity(item.id, 1)}
                                aria-label="Increase quantity"
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeFromCart(item.id)}
                                className="ml-auto text-destructive"
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>

            {cartItems.length > 0 && (
              <div className="border-t p-4 space-y-4">
                <div className="flex justify-between text-lg font-semibold">
                  <span>Total:</span>
                  <span>\${cartTotal.toFixed(2)}</span>
                </div>
                <Button className="w-full" size="lg">
                  {{checkout_button_text}}
                </Button>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  )
}`,
  tags: ['ecommerce', 'shop', 'products', 'cart', 'store', 'marketplace'],
  metadata: {
    placeholders: ['store_name', 'category_title', 'checkout_button_text'],
    components_used: [
      'Card',
      'Button',
      'Badge',
      'Checkbox',
      'Label',
      'Select',
      'ScrollArea',
      'Separator',
    ],
    complexity: 'advanced' as const,
  },
  preview_image_url: null,
}
