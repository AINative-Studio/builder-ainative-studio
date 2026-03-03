"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress, CircularProgress, IndeterminateProgress } from "@/components/ui/progress"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { ScrollArea } from "@/components/ui/scroll-area"

export default function StorybookPage() {
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [progressValue, setProgressValue] = React.useState(60)
  const [checkboxChecked, setCheckboxChecked] = React.useState(false)
  const [radioValue, setRadioValue] = React.useState("option1")
  const [selectValue, setSelectValue] = React.useState("option1")
  const [viewport, setViewport] = React.useState<"mobile" | "tablet" | "desktop">("desktop")

  React.useEffect(() => {
    const timer = setInterval(() => {
      setProgressValue((prev) => {
        const next = prev + 10
        return next > 100 ? 0 : next
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const viewportSizes = {
    mobile: "375px",
    tablet: "768px",
    desktop: "100%"
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b bg-white sticky top-0 z-50">
        <div className="container mx-auto p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Component Storybook</h1>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Viewport:</Label>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={viewport === "mobile" ? "default" : "outline"}
                  onClick={() => setViewport("mobile")}
                >
                  Mobile
                </Button>
                <Button
                  size="sm"
                  variant={viewport === "tablet" ? "default" : "outline"}
                  onClick={() => setViewport("tablet")}
                >
                  Tablet
                </Button>
                <Button
                  size="sm"
                  variant={viewport === "desktop" ? "default" : "outline"}
                  onClick={() => setViewport("desktop")}
                >
                  Desktop
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto p-8">
        <div
          className="mx-auto bg-white shadow-lg border"
          style={{
            width: viewportSizes[viewport],
            transition: "width 0.3s ease"
          }}
        >
          <ScrollArea className="h-[calc(100vh-200px)]">
            <div className="p-8 space-y-12">
              {/* Button Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Button</h2>
                <div className="flex flex-wrap gap-3">
                  <Button variant="default">Default</Button>
                  <Button variant="destructive">Destructive</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="link">Link</Button>
                </div>
                <div className="flex flex-wrap gap-3 mt-3">
                  <Button size="sm">Small</Button>
                  <Button size="default">Default</Button>
                  <Button size="lg">Large</Button>
                  <Button size="icon">🔍</Button>
                </div>
                <div className="flex flex-wrap gap-3 mt-3">
                  <Button disabled>Disabled</Button>
                </div>
              </section>

              <Separator />

              {/* Card Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Card</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>Card Title</CardTitle>
                      <CardDescription>Card description goes here</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p>This is the card content area. You can put any content here.</p>
                    </CardContent>
                    <CardFooter>
                      <Button>Action</Button>
                    </CardFooter>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Another Card</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p>Minimal card with just header and content.</p>
                    </CardContent>
                  </Card>
                </div>
              </section>

              <Separator />

              {/* Input Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Input & Label</h2>
                <div className="space-y-4 max-w-md">
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" placeholder="Enter your email" />
                  </div>
                  <div>
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" placeholder="Enter password" />
                  </div>
                  <div>
                    <Label htmlFor="disabled">Disabled Input</Label>
                    <Input id="disabled" disabled placeholder="Disabled input" />
                  </div>
                </div>
              </section>

              <Separator />

              {/* Badge Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Badge</h2>
                <div className="flex flex-wrap gap-2">
                  <Badge>Default</Badge>
                  <Badge variant="secondary">Secondary</Badge>
                  <Badge variant="destructive">Destructive</Badge>
                  <Badge variant="outline">Outline</Badge>
                </div>
              </section>

              <Separator />

              {/* Avatar Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Avatar</h2>
                <div className="flex gap-4 items-center">
                  <Avatar>
                    <AvatarImage src="https://github.com/shadcn.png" alt="User" />
                    <AvatarFallback>SC</AvatarFallback>
                  </Avatar>
                  <Avatar>
                    <AvatarImage src="/nonexistent.jpg" alt="User" />
                    <AvatarFallback>JD</AvatarFallback>
                  </Avatar>
                  <Avatar>
                    <AvatarFallback>AB</AvatarFallback>
                  </Avatar>
                </div>
              </section>

              <Separator />

              {/* Table Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Table</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>John Doe</TableCell>
                      <TableCell><Badge>Active</Badge></TableCell>
                      <TableCell>Admin</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Jane Smith</TableCell>
                      <TableCell><Badge variant="secondary">Inactive</Badge></TableCell>
                      <TableCell>User</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Bob Johnson</TableCell>
                      <TableCell><Badge>Active</Badge></TableCell>
                      <TableCell>Editor</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </section>

              <Separator />

              {/* Dialog Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Dialog</h2>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>Open Dialog</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Dialog Title</DialogTitle>
                      <DialogDescription>
                        This is a dialog description. Dialogs are great for important user decisions.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <Label htmlFor="name">Name</Label>
                      <Input id="name" placeholder="Enter your name" />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={() => setDialogOpen(false)}>Save</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </section>

              <Separator />

              {/* Select Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Select</h2>
                <div className="max-w-md">
                  <Label>Choose an option</Label>
                  <Select value={selectValue} onValueChange={setSelectValue}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="option1">Option 1</SelectItem>
                      <SelectItem value="option2">Option 2</SelectItem>
                      <SelectItem value="option3">Option 3</SelectItem>
                      <SelectItem value="option4">Option 4</SelectItem>
                      <SelectItem value="option5">Option 5</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-slate-500 mt-2">Selected: {selectValue}</p>
                </div>
              </section>

              <Separator />

              {/* Tabs Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Tabs</h2>
                <Tabs defaultValue="tab1">
                  <TabsList>
                    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
                    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
                    <TabsTrigger value="tab3">Tab 3</TabsTrigger>
                  </TabsList>
                  <TabsContent value="tab1">
                    <Card>
                      <CardHeader>
                        <CardTitle>Tab 1 Content</CardTitle>
                      </CardHeader>
                      <CardContent>
                        This is the content for tab 1.
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="tab2">
                    <Card>
                      <CardHeader>
                        <CardTitle>Tab 2 Content</CardTitle>
                      </CardHeader>
                      <CardContent>
                        This is the content for tab 2.
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="tab3">
                    <Card>
                      <CardHeader>
                        <CardTitle>Tab 3 Content</CardTitle>
                      </CardHeader>
                      <CardContent>
                        This is the content for tab 3.
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </section>

              <Separator />

              {/* Progress Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Progress</h2>
                <div className="space-y-6">
                  <div>
                    <Label>Linear Progress: {progressValue}%</Label>
                    <Progress value={progressValue} className="mt-2" />
                  </div>
                  <div className="flex gap-4 items-center">
                    <div>
                      <Label className="mb-2 block">Circular Progress</Label>
                      <CircularProgress value={progressValue} size={80} showValue />
                    </div>
                    <div>
                      <Label className="mb-2 block">Indeterminate</Label>
                      <IndeterminateProgress size={80} />
                    </div>
                  </div>
                </div>
              </section>

              <Separator />

              {/* Checkbox Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Checkbox</h2>
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="terms"
                      checked={checkboxChecked}
                      onCheckedChange={(checked) => setCheckboxChecked(checked as boolean)}
                    />
                    <Label htmlFor="terms">Accept terms and conditions</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="marketing" />
                    <Label htmlFor="marketing">Receive marketing emails</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="disabled" disabled />
                    <Label htmlFor="disabled">Disabled checkbox</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="indeterminate" checked="indeterminate" />
                    <Label htmlFor="indeterminate">Indeterminate state</Label>
                  </div>
                </div>
              </section>

              <Separator />

              {/* RadioGroup Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">RadioGroup</h2>
                <RadioGroup value={radioValue} onValueChange={setRadioValue}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="option1" id="r1" />
                    <Label htmlFor="r1">Option 1</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="option2" id="r2" />
                    <Label htmlFor="r2">Option 2</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="option3" id="r3" />
                    <Label htmlFor="r3">Option 3</Label>
                  </div>
                </RadioGroup>
                <p className="text-sm text-slate-500 mt-2">Selected: {radioValue}</p>
              </section>

              <Separator />

              {/* Accordion Section */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Accordion</h2>
                <Accordion type="single" collapsible>
                  <AccordionItem value="item-1">
                    <AccordionTrigger>What is LLAMA UI?</AccordionTrigger>
                    <AccordionContent>
                      LLAMA UI is an AI-native web builder that lets you generate beautiful UIs using natural language.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="item-2">
                    <AccordionTrigger>How many components are available?</AccordionTrigger>
                    <AccordionContent>
                      We have 18+ production-ready components including Button, Card, Dialog, Tabs, and more.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="item-3">
                    <AccordionTrigger>Is it accessible?</AccordionTrigger>
                    <AccordionContent>
                      Yes! All components are built with WCAG 2.1 AA compliance in mind, featuring proper ARIA attributes and keyboard navigation.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="item-4">
                    <AccordionTrigger>Can I customize the components?</AccordionTrigger>
                    <AccordionContent>
                      Absolutely! All components use Tailwind CSS classes and can be customized using className props.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="item-5">
                    <AccordionTrigger>What technologies are used?</AccordionTrigger>
                    <AccordionContent>
                      Built with React 19, Next.js 15, Radix UI primitives, and Tailwind CSS for styling.
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </section>

              <Separator />

              {/* Accessibility Testing Panel */}
              <section>
                <h2 className="text-2xl font-bold mb-4">Accessibility Testing</h2>
                <Card>
                  <CardHeader>
                    <CardTitle>Keyboard Navigation</CardTitle>
                    <CardDescription>Test keyboard accessibility</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm">
                      <p><kbd className="px-2 py-1 bg-slate-100 rounded border">Tab</kbd> - Navigate between elements</p>
                      <p><kbd className="px-2 py-1 bg-slate-100 rounded border">Enter</kbd> / <kbd className="px-2 py-1 bg-slate-100 rounded border">Space</kbd> - Activate buttons/checkboxes</p>
                      <p><kbd className="px-2 py-1 bg-slate-100 rounded border">Arrow Keys</kbd> - Navigate tabs, radio groups, accordions</p>
                      <p><kbd className="px-2 py-1 bg-slate-100 rounded border">Esc</kbd> - Close dialogs and popovers</p>
                      <p><kbd className="px-2 py-1 bg-slate-100 rounded border">Home</kbd> / <kbd className="px-2 py-1 bg-slate-100 rounded border">End</kbd> - Navigate to first/last item</p>
                    </div>
                  </CardContent>
                </Card>
              </section>
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}
