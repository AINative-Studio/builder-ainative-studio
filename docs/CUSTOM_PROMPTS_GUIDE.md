# Custom Prompts Usage Guide

> Master the art of writing effective prompts for AINative Component Builder to generate production-ready React components

## Table of Contents

1. [Introduction to Custom Prompts](#introduction)
2. [Prompt Structure Best Practices](#prompt-structure)
3. [Component Categories](#component-categories)
4. [Effective Prompt Examples](#effective-examples)
5. [Common Patterns and Templates](#common-patterns)
6. [Advanced Techniques](#advanced-techniques)
7. [Troubleshooting Guide](#troubleshooting)
8. [Before/After Examples](#before-after-examples)

---

## Introduction to Custom Prompts {#introduction}

AINative Component Builder uses a sophisticated multi-agent AI system powered by Claude Sonnet 4 to transform your natural language prompts into production-ready React components. Understanding how to write effective prompts will help you get better results faster.

### How It Works

The system uses a hierarchical multi-agent architecture:

```
User Prompt → Orchestrator (Cody) → Design Subagent → Code Subagent → Validation Subagent → Component
```

1. **Design Subagent**: Analyzes your requirements and creates a design specification
2. **Code Subagent**: Generates React code using Tailwind CSS and shadcn/ui components
3. **Validation Subagent**: Tests and validates the output for quality

### What Makes a Good Prompt?

A good prompt is:
- **Specific**: Clearly describes what you want
- **Contextual**: Provides relevant details about the use case
- **Actionable**: Focuses on concrete features and functionality
- **Realistic**: Requests components that can be built with available tools

---

## Prompt Structure Best Practices {#prompt-structure}

### The SPEC Formula

Use the **SPEC** formula for structured prompts:

- **S**pecifics: What component type (dashboard, form, landing page, etc.)
- **P**urpose: What problem it solves or what it's used for
- **E**lements: What specific UI elements or features to include
- **C**onstraints: Any special requirements (responsive, accessibility, data handling)

### Example Using SPEC

```
Bad: "Create a dashboard"

Good: "Create an analytics dashboard (S) for a SaaS product (P) with
metric cards showing revenue, users, and conversion rate, plus a data
table of recent signups (E). Make it responsive and include working
filters (C)."
```

### Key Components to Include

1. **Component Type**: Dashboard, form, landing page, etc.
2. **Main Features**: Lists, cards, tables, charts, forms
3. **Interactions**: Buttons, filters, search, toggles
4. **Data Structure**: What kind of data to display
5. **Layout**: Grid, flexbox, single column, sidebar

---

## Component Categories {#component-categories}

The system recognizes these main categories and optimizes for each:

### 1. Dashboards
**Keywords**: dashboard, analytics, metrics, admin panel, overview, statistics, KPI, monitoring

**What Works Well**:
- Metric cards with statistics
- Data tables with sorting/filtering
- Charts and graphs (using mock data)
- Status indicators and badges
- Recent activity feeds

### 2. E-commerce
**Keywords**: product, shop, store, cart, checkout, catalog, marketplace

**What Works Well**:
- Product listings with filters
- Shopping cart functionality
- Product detail pages
- Checkout flows
- Price displays and variants

### 3. Landing Pages
**Keywords**: landing page, hero, marketing, CTA, pricing, testimonials, features

**What Works Well**:
- Hero sections with CTAs
- Feature grids
- Pricing tables
- Testimonial sections
- Newsletter signup forms

### 4. Forms
**Keywords**: form, input, validation, submit, registration, contact

**What Works Well**:
- Multi-step wizards
- Form validation
- Success/error states
- File uploads (UI only)
- Dynamic field addition

### 5. Admin Panels
**Keywords**: admin, CRUD, manage, table, edit, settings

**What Works Well**:
- Data tables with actions
- Settings panels
- User management
- Content management
- Configuration interfaces

### 6. Blogs & Content
**Keywords**: blog, article, post, news, content, publishing

**What Works Well**:
- Article listings
- Category filters
- Search functionality
- Post cards
- Author information

---

## Effective Prompt Examples {#effective-examples}

### Landing Page Prompts

#### Example 1: SaaS Product Landing
```
Create a modern landing page for a project management SaaS tool. Include:
- Hero section with headline "Transform Your Team's Workflow" and email signup
- Features grid showcasing 4 key features (collaboration, analytics, automation, security)
- Pricing section with 3 tiers (Starter $29, Pro $99, Enterprise custom)
- Testimonials from 3 customers with ratings
- Final CTA section
Make it responsive and use a professional color scheme.
```

**Why This Works**:
- Clear component type (landing page)
- Specific sections listed
- Exact content provided (headlines, pricing)
- Layout guidance (grid, sections)
- Design constraint (responsive, professional)

#### Example 2: Product Launch Page
```
Build a product launch landing page with:
- Animated hero with product screenshot placeholder
- "What's New" badge highlighting latest features
- Feature showcase with icons (speed, security, scalability, support)
- Email waitlist signup form with validation
- Social proof section showing company logos
- Sticky navigation with "Sign Up" button
```

### Dashboard Prompts

#### Example 1: Analytics Dashboard
```
Create an analytics dashboard for an e-commerce platform showing:
- 4 metric cards (Total Revenue with +20% change, Active Users, Conversion Rate, Average Order Value)
- Line chart showing revenue trend (mock data)
- Top products table with columns: Product Name, Sales, Revenue, Status
- Date range selector (Last 7 days, 30 days, 90 days)
- Export button
Include working filters and interactive elements.
```

**Why This Works**:
- Specific metrics named
- Data structure defined
- Interactive elements listed
- Table structure clear
- Real functionality requested

#### Example 2: Team Dashboard
```
Build a team management dashboard with:
- Overview cards showing team stats (Total Members: 24, Active Projects: 8, Tasks Completed: 156)
- Team members table with avatar, name, role, status, and action buttons
- Search functionality to filter members
- "Add Member" button with modal (UI only)
- Activity feed showing recent team actions
Make the table sortable and include working search.
```

### Form Prompts

#### Example 1: Multi-Step Registration
```
Create a 3-step registration form:

Step 1 - Account Info:
- Email and password fields with validation
- Password strength indicator

Step 2 - Personal Details:
- First name, last name, phone number
- Country dropdown

Step 3 - Preferences:
- Newsletter checkbox
- Account type selection (Personal/Business)
- Review summary

Include Next/Back navigation, progress indicator, and form validation.
```

**Why This Works**:
- Clear step breakdown
- Specific fields listed
- Validation requirements
- Navigation elements defined
- Progress tracking included

#### Example 2: Contact Form with Validation
```
Build a contact form with:
- Name, email, subject, and message fields
- Phone number field (optional)
- File attachment button (UI only)
- Real-time validation showing errors
- Success message after submission
- Character counter for message field (max 500 chars)
Include proper error states and accessibility labels.
```

### E-commerce Prompts

#### Example 1: Product Catalog
```
Create a product catalog page with:
- Grid of 8 product cards (image placeholder, name, price, rating)
- Category filters (Electronics, Clothing, Home, Sports)
- Sort dropdown (Price: Low to High, Newest, Rating)
- Search bar
- "Add to Cart" button on each product
- Cart counter badge in header
Make filters and search fully functional.
```

#### Example 2: Shopping Cart Checkout
```
Build a shopping cart page showing:
- List of cart items with image, name, price, quantity selector
- Remove item button for each product
- Quantity +/- buttons that update totals
- Subtotal, tax (10%), and total calculations
- Promo code input field
- "Proceed to Checkout" button
- Empty cart state message
Include working quantity updates and real-time total calculations.
```

### Gallery Prompts

#### Example 1: Image Gallery
```
Create a responsive image gallery with:
- Grid layout (3 columns on desktop, 2 on tablet, 1 on mobile)
- 12 placeholder images with captions
- Category filter tabs (All, Nature, Architecture, People)
- Lightbox modal on image click (UI only)
- Loading state skeleton
- "Load More" button
Make filtering and responsive layout work properly.
```

#### Example 2: Portfolio Gallery
```
Build a portfolio gallery featuring:
- Masonry layout with project cards
- Hover effect showing project title and description
- Filter buttons by category (Web, Mobile, Design, Branding)
- Each card shows: project image, title, client name, year
- Detail modal on click showing full project info
- Smooth transitions and animations
```

### Navigation Prompts

#### Example 1: App Navigation
```
Create a responsive app navigation with:
- Logo on the left
- Main menu items (Dashboard, Projects, Team, Settings)
- User menu dropdown with avatar (Profile, Preferences, Logout)
- Notification bell icon with badge count
- Mobile hamburger menu
- Active state highlighting
- Search bar that expands on click
Make the mobile menu and dropdowns functional.
```

#### Example 2: Sidebar Navigation
```
Build a sidebar navigation for an admin panel:
- Collapsible sidebar with icons and labels
- Grouped menu items (Overview, Management, Settings, Help)
- Active route highlighting
- Expand/collapse toggle button
- User profile section at bottom
- Responsive: slides out on mobile
- Badge indicators for notifications
Include working collapse/expand functionality.
```

---

## Common Patterns and Templates {#common-patterns}

### Pattern 1: List with Actions

Use this pattern for: User lists, product catalogs, content management

```
Create a [item type] list with:
- Data table showing [columns: field1, field2, field3]
- Search bar filtering by [field]
- Action buttons (Edit, Delete, View) for each row
- "Add New" button
- Pagination (10 items per page)
- Empty state message
Make search and filtering functional.
```

### Pattern 2: Form with Validation

Use this pattern for: Contact forms, signup forms, settings

```
Build a [purpose] form with:
- Fields: [field1 (required), field2 (optional), field3]
- Validation rules: [specific rules]
- Error messages displayed inline
- Success state after submission
- Submit and Cancel buttons
- Loading state during submission
Include working validation and error handling.
```

### Pattern 3: Dashboard Overview

Use this pattern for: Admin dashboards, analytics, KPI displays

```
Create a [type] dashboard with:
- Metric cards: [metric1, metric2, metric3, metric4]
- Chart showing [data type] over time
- Recent [items] table with [columns]
- Filter by [date range/category]
- Export/Download button
Make filters and interactions work.
```

### Pattern 4: Card Grid Layout

Use this pattern for: Features, team members, services, testimonials

```
Build a [purpose] section with:
- Grid of [number] cards
- Each card shows: [icon/image, title, description]
- Hover effects
- CTA button on each card
- Responsive layout (4 cols → 2 cols → 1 col)
- Optional filtering by [category]
```

### Pattern 5: Multi-Step Flow

Use this pattern for: Onboarding, checkout, wizards

```
Create a [number]-step [purpose] flow:

Step 1: [purpose]
- [Fields/elements]

Step 2: [purpose]
- [Fields/elements]

Step 3: [purpose]
- [Review/confirmation elements]

Include progress indicator, Next/Back buttons, and validation.
```

---

## Advanced Techniques {#advanced-techniques}

### 1. State Management Requests

Be explicit about interactivity:

```
Good: "Include a working search that filters the table in real-time as the user types"
Better: "Add a search input that uses useState to filter the table rows based on name and email fields"
```

### 2. Layout Specifics

Describe responsive behavior:

```
Good: "Make it responsive"
Better: "Use a 4-column grid on desktop, 2 columns on tablet, and 1 column on mobile. Stack the sidebar below content on mobile."
```

### 3. Data Structure

Provide example data structure:

```
Good: "Show a list of users"
Better: "Show a table of users with sample data like:
{ id: 1, name: 'John Doe', email: 'john@example.com', role: 'Admin', status: 'Active' }"
```

### 4. Interaction Details

Specify behavior precisely:

```
Good: "Add a modal"
Better: "Add a modal that opens when clicking 'Add User', includes a close X button, and has a backdrop that closes the modal on click"
```

### 5. Combining Categories

Mix categories for complex UIs:

```
"Create a SaaS dashboard landing page that combines:
- Landing page hero section (top)
- Dashboard metrics preview (middle)
- Pricing cards (bottom)
Include navigation that links to each section."
```

### 6. Real-Time Calculations

Request computed values:

```
"Build a pricing calculator with:
- Base price input
- Quantity slider
- Discount percentage selector
- Real-time total calculation showing: subtotal, discount amount, and final price
- Update all values immediately when any input changes"
```

---

## Troubleshooting Guide {#troubleshooting}

### Problem: Component is too simple

**Symptom**: Generated component lacks features or depth

**Solution**:
- Add more specific details to your prompt
- Request specific UI elements and interactions
- Mention the number of items/features you want
- Ask for working functionality, not just UI

**Example Fix**:
```
Before: "Create a user dashboard"
After: "Create a user dashboard with profile card, activity feed showing 5 recent actions,
stats cards for followers/posts/likes, and an editable bio section with save button"
```

### Problem: Missing interactivity

**Symptom**: Buttons and inputs don't do anything

**Solution**:
- Explicitly request "working" or "functional" elements
- Describe what should happen on interactions
- Ask for useState hooks and event handlers

**Example Fix**:
```
Before: "Add a filter dropdown"
After: "Add a functional filter dropdown that updates the displayed products when changed,
using useState to track the selected category"
```

### Problem: Layout doesn't match expectations

**Symptom**: Component layout is different than intended

**Solution**:
- Be specific about grid columns and layout structure
- Mention spacing and alignment preferences
- Describe responsive breakpoints explicitly

**Example Fix**:
```
Before: "Show products in a grid"
After: "Display products in a responsive grid: 4 columns on desktop (lg), 2 columns on
tablet (md), 1 column on mobile. Use gap-4 spacing between cards."
```

### Problem: Missing validation or error states

**Symptom**: Forms submit without validation

**Solution**:
- Request specific validation rules
- Ask for error message display
- Mention required vs optional fields

**Example Fix**:
```
Before: "Create a signup form"
After: "Create a signup form with validation: email must contain @, password min 8 chars,
name is required. Show error messages in red below each field. Disable submit until valid."
```

### Problem: Not enough data shown

**Symptom**: Only 1-2 items in lists/tables

**Solution**:
- Specify the number of items you want
- Request realistic sample data
- Mention variety in the data

**Example Fix**:
```
Before: "Show a user table"
After: "Show a user table with 8-10 sample users, varying their roles (Admin, User, Guest)
and statuses (Active, Inactive, Pending)"
```

### Problem: Component doesn't match brand/style

**Symptom**: Colors or styling feel off

**Solution**:
- Specify color preferences or upload design tokens
- Mention style keywords (modern, minimal, bold, professional)
- Reference specific design systems if applicable

**Example Fix**:
```
Before: "Create a landing page"
After: "Create a landing page with a modern, minimal design. Use blue as primary color
(#3B82F6), clean white backgrounds, and subtle shadows. Professional SaaS aesthetic."
```

### Problem: Too complex, slow to generate

**Symptom**: Generation takes too long or times out

**Solution**:
- Break complex requests into smaller components
- Start with core features, then iterate
- Request one section at a time for large pages

**Example Fix**:
```
Before: "Create a complete admin panel with dashboard, user management, settings,
reports, analytics, and billing"

After (Split):
1. "Create an admin dashboard with metric cards and activity feed"
2. Then: "Add a user management table to the admin dashboard"
3. Then: "Add a settings panel to the admin dashboard"
```

---

## Before/After Examples {#before-after-examples}

### Example 1: Dashboard Improvement

#### Before (Vague)
```
"Make a dashboard"
```

**Result**: Basic page with 2-3 metric cards, no interactivity

#### After (Specific)
```
"Create an analytics dashboard for a SaaS platform with:
- 4 metric cards showing: Monthly Revenue ($45,231, +20%), Active Users (2,350, +15%),
  Churn Rate (3.2%, -5%), Trial Conversions (245, +32%)
- Recent customers table with columns: Name, Email, Plan, Status, Join Date
- Date range filter (7 days, 30 days, 90 days) that updates the metrics
- Export to CSV button
- Search bar for the customers table
Make the filters and search fully functional."
```

**Result**: Comprehensive dashboard with working interactions and detailed data

---

### Example 2: Form Enhancement

#### Before (Incomplete)
```
"Create a contact form"
```

**Result**: Basic form with name, email, message - no validation

#### After (Complete)
```
"Build a contact form with:
- Fields: Name (required), Email (required, must contain @), Phone (optional),
  Subject dropdown (General, Support, Sales), Message (required, max 500 chars)
- Show character counter for message field
- Display validation errors in red below each field
- Disable submit button until form is valid
- Show success message 'Thank you! We'll respond within 24 hours' after submission
- Include a 'Clear Form' button
Add proper accessibility labels and keyboard navigation."
```

**Result**: Professional form with full validation, user feedback, and accessibility

---

### Example 3: E-commerce Refinement

#### Before (Generic)
```
"Show products"
```

**Result**: Simple grid of 3-4 product cards

#### After (Detailed)
```
"Create a product catalog page with:
- Grid of 12 products (3 in Electronics, 4 in Clothing, 5 in Home)
- Each product card shows: image placeholder, name, price, rating (1-5 stars), 'In Stock' badge
- Category filter buttons: All, Electronics, Clothing, Home (working filter)
- Sort dropdown: Price Low-High, Price High-Low, Newest, Rating
- Search bar that filters by product name in real-time
- Shopping cart icon in header with count badge
- 'Add to Cart' button on each product that updates cart count
- Price range filter: Under $50, $50-$100, Over $100

Sample products:
- Wireless Headphones ($99.99, Electronics, 4.5 stars)
- Smart Watch ($299.99, Electronics, 5 stars)
- Running Shoes ($89.99, Clothing, 4 stars)

Make all filters, search, and cart functionality work together."
```

**Result**: Full-featured e-commerce catalog with working filters and cart

---

### Example 4: Landing Page Transformation

#### Before (Basic)
```
"Create a landing page for a SaaS product"
```

**Result**: Hero section with generic text, maybe 2-3 features

#### After (Professional)
```
"Build a professional SaaS landing page for 'TaskFlow' - a project management tool:

HERO SECTION:
- Headline: 'Transform Your Team's Workflow'
- Subheadline: 'The all-in-one platform for modern teams to collaborate, plan, and deliver'
- Email capture form with 'Start Free Trial' button
- Trust badges: 'No credit card required' and '14-day free trial'
- Hero image placeholder on the right

FEATURES SECTION:
Grid of 4 features with icons:
1. Real-time Collaboration - Work together seamlessly
2. Advanced Analytics - Data-driven insights
3. Smart Automation - Save 10+ hours per week
4. Enterprise Security - Bank-level encryption

SOCIAL PROOF:
- Logos of 5 companies (placeholders)
- Text: 'Trusted by 10,000+ teams worldwide'

PRICING SECTION:
3 tiers displayed as cards:
- Starter: $29/mo (5 projects, 10 team members)
- Professional: $99/mo (Unlimited projects, 50 team members) - Badge: 'Most Popular'
- Enterprise: Custom (Unlimited everything, dedicated support)

TESTIMONIALS:
3 customer testimonial cards with:
- 5-star ratings
- Quote
- Customer name, role, company

FINAL CTA:
- Headline: 'Ready to transform your workflow?'
- Large 'Start Free Trial' button
- Subtext: 'Join 10,000+ teams already using TaskFlow'

FOOTER:
- Product links (Features, Pricing, Security)
- Company links (About, Blog, Careers)
- Legal links (Privacy, Terms)

Make it responsive, use professional blue/purple gradient for hero, and include smooth
scroll navigation to sections."
```

**Result**: Complete, professional landing page ready for production use

---

## Quick Reference Checklist

When writing your prompt, include:

- [ ] Component type (dashboard, form, landing page, etc.)
- [ ] Specific features and sections
- [ ] Number of items to display
- [ ] Interactive elements (search, filters, buttons)
- [ ] Data structure or sample data
- [ ] Layout specifications (grid, columns)
- [ ] Responsive behavior
- [ ] Validation rules (for forms)
- [ ] State management needs
- [ ] Style preferences

## Additional Resources

- **Template Library**: Browse pre-built templates at `/templates`
- **Component Documentation**: See available shadcn/ui components
- **Design Tokens**: Upload custom design systems for brand consistency
- **Example Selector**: System automatically includes relevant examples based on your prompt

---

## Tips for Success

1. **Start Specific**: The more details you provide, the better the result
2. **Request Working Features**: Always ask for "functional" or "working" interactions
3. **Provide Sample Data**: Give example data structures for lists and tables
4. **Think Responsive**: Mention mobile/tablet/desktop layouts
5. **Iterate**: Start with core features, then ask for additions
6. **Use Numbers**: "Show 8 products" not "show some products"
7. **Name Real Features**: "Revenue metric card" not just "metrics"
8. **Specify States**: Request loading, error, empty, and success states
9. **Include Context**: Mention the use case or industry
10. **Test Interactivity**: After generation, verify filters, searches, and buttons work

---

## Need Help?

If you're stuck:
1. Check the **few-shot examples** in the database for inspiration
2. Browse the **template library** for similar components
3. Use the **SPEC formula** to structure your prompt
4. Start with a template and customize it
5. Break complex requests into smaller prompts

---

**Happy Building!** Start with specific, detailed prompts and watch the AI create production-ready components tailored to your needs.
