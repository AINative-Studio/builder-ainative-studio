"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress, CircularProgress, IndeterminateProgress } from "@/components/ui/progress"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { ScrollArea } from "@/components/ui/scroll-area"

// Component documentation data
const componentDocs = [
  {
    id: "button",
    name: "Button",
    category: "Basic",
    description: "A versatile button component with multiple variants and sizes.",
    props: [
      { name: "variant", type: "'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'", default: "'default'", description: "Visual style variant" },
      { name: "size", type: "'default' | 'sm' | 'lg' | 'icon'", default: "'default'", description: "Button size" },
      { name: "disabled", type: "boolean", default: "false", description: "Disables the button" },
    ],
    example: `<Button variant="default">Click me</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost" size="sm">Small Ghost</Button>`,
    accessibility: [
      "Keyboard accessible (Tab, Enter, Space)",
      "Focus visible indicator",
      "Proper disabled state handling",
      "ARIA attributes for screen readers"
    ],
    dos: [
      "Use clear, action-oriented labels",
      "Choose appropriate variant for context",
      "Provide visual feedback on interaction"
    ],
    donts: [
      "Don't use too many variants on one page",
      "Don't make buttons too small for touch targets",
      "Avoid vague labels like 'Click here'"
    ]
  },
  {
    id: "card",
    name: "Card",
    category: "Basic",
    description: "A container component for grouping related content with header, content, and footer sections.",
    props: [
      { name: "className", type: "string", default: "''", description: "Additional CSS classes" },
    ],
    subComponents: ["CardHeader", "CardTitle", "CardDescription", "CardContent", "CardFooter"],
    example: `<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Card description</CardDescription>
  </CardHeader>
  <CardContent>Content goes here</CardContent>
  <CardFooter>Footer actions</CardFooter>
</Card>`,
    accessibility: [
      "Semantic HTML structure",
      "Proper heading hierarchy",
      "Screen reader friendly"
    ],
    dos: [
      "Use CardHeader for titles and descriptions",
      "Keep card content focused and related",
      "Use CardFooter for actions"
    ],
    donts: [
      "Don't nest cards too deeply",
      "Avoid overloading cards with too much content",
      "Don't use cards for everything"
    ]
  },
  {
    id: "input",
    name: "Input",
    category: "Basic",
    description: "A text input field component with various types and states.",
    props: [
      { name: "type", type: "string", default: "'text'", description: "Input type (text, email, password, etc.)" },
      { name: "placeholder", type: "string", default: "''", description: "Placeholder text" },
      { name: "disabled", type: "boolean", default: "false", description: "Disables the input" },
      { name: "value", type: "string", default: "''", description: "Controlled value" },
    ],
    example: `<Label htmlFor="email">Email</Label>
<Input id="email" type="email" placeholder="Enter email" />`,
    accessibility: [
      "Always pair with Label component",
      "Use htmlFor to associate label with input",
      "Provide clear placeholder text",
      "Support keyboard navigation"
    ],
    dos: [
      "Use appropriate input types",
      "Provide clear labels",
      "Show validation errors clearly"
    ],
    donts: [
      "Don't use placeholder as only label",
      "Avoid unclear validation messages",
      "Don't disable copy/paste unnecessarily"
    ]
  },
  {
    id: "dialog",
    name: "Dialog",
    category: "Advanced",
    description: "A modal dialog component with overlay, header, and footer sections. Supports keyboard navigation and focus trapping.",
    props: [
      { name: "open", type: "boolean", default: "false", description: "Controls dialog visibility" },
      { name: "onOpenChange", type: "(open: boolean) => void", default: "undefined", description: "Callback when dialog state changes" },
    ],
    subComponents: ["DialogTrigger", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription", "DialogFooter"],
    example: `<Dialog>
  <DialogTrigger asChild>
    <Button>Open Dialog</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Dialog Title</DialogTitle>
      <DialogDescription>Dialog description</DialogDescription>
    </DialogHeader>
    <div>Content goes here</div>
    <DialogFooter>
      <Button>Save</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>`,
    accessibility: [
      "Focus trap (Tab stays within dialog)",
      "Escape key to close",
      "ARIA role='dialog'",
      "ARIA labelledby and describedby",
      "Focus returns to trigger on close"
    ],
    dos: [
      "Use for important user decisions",
      "Keep content concise",
      "Provide clear actions"
    ],
    donts: [
      "Don't nest dialogs",
      "Avoid using for non-critical information",
      "Don't make dialogs too large"
    ]
  },
  {
    id: "select",
    name: "Select",
    category: "Advanced",
    description: "A dropdown select component with keyboard navigation and searchable variants.",
    props: [
      { name: "value", type: "string", default: "''", description: "Selected value" },
      { name: "onValueChange", type: "(value: string) => void", default: "undefined", description: "Callback when value changes" },
      { name: "defaultValue", type: "string", default: "''", description: "Default selected value" },
    ],
    subComponents: ["SelectTrigger", "SelectValue", "SelectContent", "SelectItem"],
    example: `<Select onValueChange={(value) => console.log(value)}>
  <SelectTrigger>
    <SelectValue placeholder="Select option" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="option1">Option 1</SelectItem>
    <SelectItem value="option2">Option 2</SelectItem>
    <SelectItem value="option3">Option 3</SelectItem>
  </SelectContent>
</Select>`,
    accessibility: [
      "ARIA role='combobox'",
      "Keyboard navigation (Arrow keys, Enter, Escape)",
      "Type-ahead search",
      "Proper ARIA states"
    ],
    dos: [
      "Use for 5+ options",
      "Provide clear placeholder",
      "Group related options"
    ],
    donts: [
      "Don't use for 2-3 options (use RadioGroup)",
      "Avoid extremely long option lists",
      "Don't hide important information in options"
    ]
  },
  {
    id: "tabs",
    name: "Tabs",
    category: "Advanced",
    description: "A tabbed interface component for organizing content into separate views.",
    props: [
      { name: "defaultValue", type: "string", default: "''", description: "Default active tab" },
      { name: "value", type: "string", default: "undefined", description: "Controlled active tab" },
      { name: "onValueChange", type: "(value: string) => void", default: "undefined", description: "Callback when tab changes" },
    ],
    subComponents: ["TabsList", "TabsTrigger", "TabsContent"],
    example: `<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
    <TabsTrigger value="tab3">Tab 3</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Tab 1 content</TabsContent>
  <TabsContent value="tab2">Tab 2 content</TabsContent>
  <TabsContent value="tab3">Tab 3 content</TabsContent>
</Tabs>`,
    accessibility: [
      "ARIA role='tablist'",
      "Keyboard navigation (Arrow keys, Home, End)",
      "Proper ARIA selected states",
      "Focus management"
    ],
    dos: [
      "Use for related content",
      "Keep tab labels short",
      "Limit to 3-7 tabs"
    ],
    donts: [
      "Don't use for sequential steps (use Stepper)",
      "Avoid vertical tabs on mobile",
      "Don't hide critical actions in tabs"
    ]
  },
  {
    id: "progress",
    name: "Progress",
    category: "Advanced",
    description: "Progress indicators for showing task completion. Includes linear, circular, and indeterminate variants.",
    props: [
      { name: "value", type: "number", default: "0", description: "Progress value (0-100)" },
      { name: "className", type: "string", default: "''", description: "Additional CSS classes" },
    ],
    variants: ["Progress (linear)", "CircularProgress", "IndeterminateProgress"],
    example: `<Progress value={60} />
<CircularProgress value={75} size={80} showValue />
<IndeterminateProgress />`,
    accessibility: [
      "ARIA role='progressbar'",
      "ARIA valuenow, valuemin, valuemax",
      "Visual and semantic progress indication"
    ],
    dos: [
      "Use for long-running tasks",
      "Show percentage when accurate",
      "Use indeterminate for unknown duration"
    ],
    donts: [
      "Don't fake progress",
      "Avoid for instant operations",
      "Don't use without context"
    ]
  },
  {
    id: "checkbox",
    name: "Checkbox",
    category: "Forms",
    description: "A checkbox input component with checked, unchecked, and indeterminate states.",
    props: [
      { name: "checked", type: "boolean | 'indeterminate'", default: "false", description: "Checked state" },
      { name: "onCheckedChange", type: "(checked: boolean) => void", default: "undefined", description: "Callback when state changes" },
      { name: "disabled", type: "boolean", default: "false", description: "Disables the checkbox" },
    ],
    example: `<div className="flex items-center space-x-2">
  <Checkbox id="terms" />
  <Label htmlFor="terms">Accept terms</Label>
</div>`,
    accessibility: [
      "ARIA checked state",
      "Keyboard accessible (Space to toggle)",
      "Proper label association",
      "Support for indeterminate state"
    ],
    dos: [
      "Always pair with a label",
      "Use for independent options",
      "Support indeterminate for parent checkboxes"
    ],
    donts: [
      "Don't use for single yes/no choices (use Switch)",
      "Avoid without clear labels",
      "Don't use for mutually exclusive options (use RadioGroup)"
    ]
  },
  {
    id: "radiogroup",
    name: "RadioGroup",
    category: "Forms",
    description: "A radio button group for mutually exclusive selections.",
    props: [
      { name: "value", type: "string", default: "''", description: "Selected value" },
      { name: "onValueChange", type: "(value: string) => void", default: "undefined", description: "Callback when value changes" },
      { name: "disabled", type: "boolean", default: "false", description: "Disables all radio buttons" },
    ],
    subComponents: ["RadioGroupItem"],
    example: `<RadioGroup defaultValue="option1">
  <div className="flex items-center space-x-2">
    <RadioGroupItem value="option1" id="r1" />
    <Label htmlFor="r1">Option 1</Label>
  </div>
  <div className="flex items-center space-x-2">
    <RadioGroupItem value="option2" id="r2" />
    <Label htmlFor="r2">Option 2</Label>
  </div>
</RadioGroup>`,
    accessibility: [
      "ARIA role='radiogroup'",
      "Keyboard navigation (Arrow keys)",
      "Only one radio can be selected",
      "Proper label association"
    ],
    dos: [
      "Use for 2-5 mutually exclusive options",
      "Provide default selection",
      "Use clear labels"
    ],
    donts: [
      "Don't use for many options (use Select)",
      "Avoid without default selection",
      "Don't use for independent choices (use Checkbox)"
    ]
  },
  {
    id: "accordion",
    name: "Accordion",
    category: "Advanced",
    description: "An expandable/collapsible content component with smooth animations.",
    props: [
      { name: "type", type: "'single' | 'multiple'", default: "'single'", description: "Single or multiple items open" },
      { name: "collapsible", type: "boolean", default: "false", description: "Allow closing all items" },
      { name: "defaultValue", type: "string | string[]", default: "undefined", description: "Default open items" },
    ],
    subComponents: ["AccordionItem", "AccordionTrigger", "AccordionContent"],
    example: `<Accordion type="single" collapsible>
  <AccordionItem value="item-1">
    <AccordionTrigger>Item 1</AccordionTrigger>
    <AccordionContent>Item 1 content</AccordionContent>
  </AccordionItem>
  <AccordionItem value="item-2">
    <AccordionTrigger>Item 2</AccordionTrigger>
    <AccordionContent>Item 2 content</AccordionContent>
  </AccordionItem>
</Accordion>`,
    accessibility: [
      "ARIA expanded state",
      "Keyboard navigation (Arrow keys, Home, End)",
      "Focus management",
      "Animated height transitions"
    ],
    dos: [
      "Use for FAQ sections",
      "Group related expandable content",
      "Keep headers concise"
    ],
    donts: [
      "Don't hide critical information",
      "Avoid nesting accordions",
      "Don't use for navigation"
    ]
  },
  {
    id: "badge",
    name: "Badge",
    category: "Basic",
    description: "A small component for displaying status, labels, or counts.",
    props: [
      { name: "variant", type: "'default' | 'secondary' | 'destructive' | 'outline'", default: "'default'", description: "Visual variant" },
    ],
    example: `<Badge>Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="destructive">Destructive</Badge>`,
    accessibility: [
      "Use semantic HTML",
      "Provide sufficient color contrast",
      "Don't rely solely on color"
    ],
    dos: [
      "Use for status indicators",
      "Keep text very short",
      "Use appropriate variants"
    ],
    donts: [
      "Don't use for buttons",
      "Avoid long text",
      "Don't overuse on a page"
    ]
  },
  {
    id: "avatar",
    name: "Avatar",
    category: "Basic",
    description: "A component for displaying user profile images with fallback support.",
    props: [
      { name: "className", type: "string", default: "''", description: "Additional CSS classes" },
    ],
    subComponents: ["AvatarImage", "AvatarFallback"],
    example: `<Avatar>
  <AvatarImage src="/user.jpg" alt="User" />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>`,
    accessibility: [
      "Provide alt text for images",
      "Use fallback for failed loads",
      "Ensure sufficient size for readability"
    ],
    dos: [
      "Use appropriate sizes",
      "Provide meaningful fallbacks",
      "Use rounded shape for people"
    ],
    donts: [
      "Don't use for decorative images",
      "Avoid tiny sizes",
      "Don't skip alt text"
    ]
  },
  {
    id: "table",
    name: "Table",
    category: "Basic",
    description: "A table component for displaying structured tabular data.",
    props: [
      { name: "className", type: "string", default: "''", description: "Additional CSS classes" },
    ],
    subComponents: ["TableHeader", "TableBody", "TableRow", "TableHead", "TableCell"],
    example: `<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Status</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>John</TableCell>
      <TableCell>Active</TableCell>
    </TableRow>
  </TableBody>
</Table>`,
    accessibility: [
      "Use semantic table elements",
      "Provide table headers",
      "Support keyboard navigation",
      "Consider responsive design"
    ],
    dos: [
      "Use for tabular data",
      "Provide sortable columns",
      "Make responsive on mobile"
    ],
    donts: [
      "Don't use for layout",
      "Avoid very wide tables",
      "Don't overload with data"
    ]
  },
  {
    id: "separator",
    name: "Separator",
    category: "Basic",
    description: "A visual divider for separating content sections.",
    props: [
      { name: "orientation", type: "'horizontal' | 'vertical'", default: "'horizontal'", description: "Separator direction" },
    ],
    example: `<Separator />
<Separator orientation="vertical" />`,
    accessibility: [
      "Uses semantic separator role",
      "Provides visual separation",
      "Supports both orientations"
    ],
    dos: [
      "Use to separate content sections",
      "Use sparingly for clarity",
      "Consider spacing"
    ],
    donts: [
      "Don't overuse",
      "Avoid as only visual indicator",
      "Don't use for decoration only"
    ]
  }
]

export default function ComponentDocsPage() {
  const [searchQuery, setSearchQuery] = React.useState("")
  const [selectedCategory, setSelectedCategory] = React.useState("all")
  const [selectedComponent, setSelectedComponent] = React.useState<string | null>(null)

  const categories = ["all", ...Array.from(new Set(componentDocs.map(doc => doc.category)))]

  const filteredDocs = componentDocs.filter(doc => {
    const matchesSearch = doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         doc.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === "all" || doc.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  const selectedDoc = selectedComponent
    ? componentDocs.find(doc => doc.id === selectedComponent)
    : null

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <div className="w-64 border-r bg-white p-4 overflow-y-auto">
        <h1 className="text-2xl font-bold mb-4">Components</h1>

        <Input
          placeholder="Search components..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="mb-4"
        />

        <div className="mb-4">
          <Label className="mb-2 block text-sm font-medium">Category</Label>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map(cat => (
                <SelectItem key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator className="my-4" />

        <div className="space-y-1">
          {filteredDocs.map(doc => (
            <button
              key={doc.id}
              onClick={() => setSelectedComponent(doc.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                selectedComponent === doc.id
                  ? 'bg-slate-100 font-medium'
                  : 'hover:bg-slate-50'
              }`}
            >
              {doc.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {selectedDoc ? (
          <div className="max-w-4xl mx-auto p-8">
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-4xl font-bold">{selectedDoc.name}</h1>
                <Badge variant="secondary">{selectedDoc.category}</Badge>
              </div>
              <p className="text-lg text-slate-600">{selectedDoc.description}</p>
            </div>

            <Tabs defaultValue="props">
              <TabsList>
                <TabsTrigger value="props">Props</TabsTrigger>
                <TabsTrigger value="examples">Examples</TabsTrigger>
                <TabsTrigger value="accessibility">Accessibility</TabsTrigger>
                <TabsTrigger value="guidelines">Guidelines</TabsTrigger>
              </TabsList>

              <TabsContent value="props" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Component Props</CardTitle>
                    <CardDescription>Available properties for {selectedDoc.name}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {selectedDoc.props && selectedDoc.props.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Default</TableHead>
                            <TableHead>Description</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedDoc.props.map((prop, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="font-mono font-medium">{prop.name}</TableCell>
                              <TableCell className="font-mono text-sm">{prop.type}</TableCell>
                              <TableCell className="font-mono text-sm">{prop.default}</TableCell>
                              <TableCell>{prop.description}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-slate-500">No props documentation available.</p>
                    )}

                    {selectedDoc.subComponents && selectedDoc.subComponents.length > 0 && (
                      <div className="mt-6">
                        <h3 className="font-semibold mb-2">Sub-components</h3>
                        <div className="flex flex-wrap gap-2">
                          {selectedDoc.subComponents.map((sub, idx) => (
                            <Badge key={idx} variant="outline">{sub}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedDoc.variants && selectedDoc.variants.length > 0 && (
                      <div className="mt-6">
                        <h3 className="font-semibold mb-2">Variants</h3>
                        <div className="flex flex-wrap gap-2">
                          {selectedDoc.variants.map((variant, idx) => (
                            <Badge key={idx} variant="outline">{variant}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="examples" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Usage Example</CardTitle>
                    <CardDescription>Code example for {selectedDoc.name}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="bg-slate-900 text-slate-50 p-4 rounded-lg overflow-x-auto">
                      <code>{selectedDoc.example}</code>
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="accessibility" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Accessibility Features</CardTitle>
                    <CardDescription>WCAG 2.1 compliance for {selectedDoc.name}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {selectedDoc.accessibility && selectedDoc.accessibility.length > 0 ? (
                      <ul className="space-y-2">
                        {selectedDoc.accessibility.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <Badge variant="secondary" className="mt-0.5">✓</Badge>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-slate-500">No accessibility documentation available.</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="guidelines" className="mt-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-green-700">Do's</CardTitle>
                      <CardDescription>Best practices</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {selectedDoc.dos && selectedDoc.dos.length > 0 ? (
                        <ul className="space-y-2">
                          {selectedDoc.dos.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="text-green-600 font-bold">✓</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-slate-500">No guidelines available.</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-red-700">Don'ts</CardTitle>
                      <CardDescription>Common mistakes to avoid</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {selectedDoc.donts && selectedDoc.donts.length > 0 ? (
                        <ul className="space-y-2">
                          {selectedDoc.donts.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="text-red-600 font-bold">✗</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-slate-500">No guidelines available.</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-2">Select a component</h2>
              <p className="text-slate-600">Choose a component from the sidebar to view its documentation</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
