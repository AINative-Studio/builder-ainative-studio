/**
 * Simplified shadcn/ui component stubs for Sandpack
 */

export const shadcnFiles: Record<string, string> = {
  '/src/components/ui/button.tsx': `
import React from 'react'
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'default' | 'outline' | 'ghost' | 'destructive'; size?: 'default' | 'sm' | 'lg' | 'icon' }
export function Button({ variant = 'default', size = 'default', className = '', children, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50'
  const variants = { default: 'bg-blue-600 text-white hover:bg-blue-700', outline: 'border border-gray-300 bg-white hover:bg-gray-50', ghost: 'hover:bg-gray-100', destructive: 'bg-red-600 text-white hover:bg-red-700' }
  const sizes = { default: 'h-10 px-4 py-2 text-sm', sm: 'h-8 px-3 text-xs', lg: 'h-12 px-6 text-base', icon: 'h-10 w-10' }
  return <button className={\`\${base} \${variants[variant]} \${sizes[size]} \${className}\`} {...props}>{children}</button>
}
`,

  '/src/components/ui/card.tsx': `
import React from 'react'
export function Card({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={\`rounded-xl border border-gray-200 bg-white shadow-sm \${className}\`} {...props}>{children}</div>
}
export function CardHeader({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={\`p-6 pb-0 \${className}\`} {...props}>{children}</div>
}
export function CardContent({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={\`p-6 \${className}\`} {...props}>{children}</div>
}
export function CardTitle({ className = '', children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={\`text-lg font-semibold \${className}\`} {...props}>{children}</h3>
}
export function CardDescription({ className = '', children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={\`text-sm text-gray-500 \${className}\`} {...props}>{children}</p>
}
export function CardFooter({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={\`p-6 pt-0 \${className}\`} {...props}>{children}</div>
}
`,

  '/src/components/ui/badge.tsx': `
import React from 'react'
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> { variant?: 'default' | 'secondary' | 'outline' | 'destructive' }
export function Badge({ variant = 'default', className = '', children, ...props }: BadgeProps) {
  const styles = { default: 'bg-blue-100 text-blue-800', secondary: 'bg-gray-100 text-gray-800', outline: 'border border-gray-300 text-gray-700', destructive: 'bg-red-100 text-red-800' }
  return <span className={\`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium \${styles[variant]} \${className}\`} {...props}>{children}</span>
}
`,

  '/src/components/ui/avatar.tsx': `
import React from 'react'
export function Avatar({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={\`relative inline-flex items-center justify-center w-10 h-10 rounded-full overflow-hidden bg-gray-200 \${className}\`} {...props}>{children}</div>
}
export function AvatarImage({ src, alt, className = '' }: { src: string; alt?: string; className?: string }) {
  return <img src={src} alt={alt || ''} className={\`w-full h-full object-cover \${className}\`} />
}
export function AvatarFallback({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={\`flex items-center justify-center w-full h-full bg-gray-300 text-gray-600 text-sm font-medium \${className}\`} {...props}>{children}</div>
}
`,

  '/src/components/ui/input.tsx': `
import React from 'react'
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className = '', ...props }, ref) => {
  return <input ref={ref} className={\`flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 \${className}\`} {...props} />
})
Input.displayName = 'Input'
`,

  '/src/components/ui/tabs.tsx': `
import React from 'react'
const TabsContext = React.createContext<{ value: string; onChange: (v: string) => void }>({ value: '', onChange: () => {} })
export function Tabs({ defaultValue, children, className = '' }: { defaultValue: string; children: React.ReactNode; className?: string }) {
  const [value, setValue] = React.useState(defaultValue)
  return <TabsContext.Provider value={{ value, onChange: setValue }}><div className={className}>{children}</div></TabsContext.Provider>
}
export function TabsList({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={\`flex gap-1 bg-gray-100 rounded-lg p-1 \${className}\`}>{children}</div>
}
export function TabsTrigger({ value, children, className = '' }: { value: string; children: React.ReactNode; className?: string }) {
  const ctx = React.useContext(TabsContext)
  return <button onClick={() => ctx.onChange(value)} className={\`px-3 py-1.5 rounded-md text-sm font-medium transition-colors \${ctx.value === value ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'} \${className}\`}>{children}</button>
}
export function TabsContent({ value, children, className = '' }: { value: string; children: React.ReactNode; className?: string }) {
  const ctx = React.useContext(TabsContext)
  if (ctx.value !== value) return null
  return <div className={className}>{children}</div>
}
`,

  '/src/components/ui/label.tsx': `
import React from 'react'
export function Label({ className = '', children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={\`text-sm font-medium text-gray-700 \${className}\`} {...props}>{children}</label>
}
`,

  '/src/components/ui/table.tsx': `
import React from 'react'
export function Table({ className = '', children, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <div className="overflow-x-auto rounded-xl border border-gray-200"><table className={\`w-full text-sm \${className}\`} {...props}>{children}</table></div>
}
export function TableHeader({ className = '', children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={\`bg-gray-50 border-b border-gray-200 \${className}\`} {...props}>{children}</thead>
}
export function TableBody({ className = '', children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props}>{children}</tbody>
}
export function TableRow({ className = '', children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={\`border-b border-gray-100 hover:bg-gray-50 \${className}\`} {...props}>{children}</tr>
}
export function TableHead({ className = '', children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={\`text-left px-4 py-3 font-medium text-gray-600 \${className}\`} {...props}>{children}</th>
}
export function TableCell({ className = '', children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={\`px-4 py-3 \${className}\`} {...props}>{children}</td>
}
`,

  '/src/components/ui/separator.tsx': `
import React from 'react'
export function Separator({ className = '', orientation = 'horizontal' }: { className?: string; orientation?: 'horizontal' | 'vertical' }) {
  return orientation === 'vertical' ? <div className={\`w-px bg-gray-200 self-stretch \${className}\`} /> : <div className={\`h-px bg-gray-200 w-full \${className}\`} />
}
`,

  '/src/components/ui/dialog.tsx': `
import React from 'react'
interface DialogProps { open?: boolean; onOpenChange?: (open: boolean) => void; children: React.ReactNode }
export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null
  return <div className="fixed inset-0 z-50">{React.Children.map(children, c => React.isValidElement(c) ? React.cloneElement(c as any, { onClose: () => onOpenChange?.(false) }) : c)}</div>
}
export function DialogOverlay({ className = '' }: { className?: string }) {
  return <div className={\`fixed inset-0 bg-black/50 \${className}\`} />
}
export function DialogContent({ children, className = '', onClose }: { children: React.ReactNode; className?: string; onClose?: () => void }) {
  return (<><DialogOverlay /><div className={\`fixed inset-0 flex items-center justify-center z-50 p-4\`}><div className={\`bg-white rounded-xl shadow-xl max-w-lg w-full p-6 relative \${className}\`}>{onClose && <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">x</button>}{children}</div></div></>)
}
export function DialogHeader({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={\`mb-4 \${className}\`}>{children}</div>
}
export function DialogTitle({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <h2 className={\`text-lg font-semibold \${className}\`}>{children}</h2>
}
export function DialogDescription({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <p className={\`text-sm text-gray-500 mt-1 \${className}\`}>{children}</p>
}
export function DialogFooter({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={\`flex justify-end gap-2 mt-6 \${className}\`}>{children}</div>
}
`,

  '/src/components/ui/select.tsx': `
import React from 'react'
interface SelectProps { value?: string; onValueChange?: (v: string) => void; children: React.ReactNode }
const SelectCtx = React.createContext<{ value: string; onChange: (v: string) => void; open: boolean; setOpen: (o: boolean) => void }>({ value: '', onChange: () => {}, open: false, setOpen: () => {} })
export function Select({ value = '', onValueChange, children }: SelectProps) {
  const [v, setV] = React.useState(value)
  const [open, setOpen] = React.useState(false)
  const onChange = (val: string) => { setV(val); onValueChange?.(val); setOpen(false) }
  return <SelectCtx.Provider value={{ value: v, onChange, open, setOpen }}><div className="relative">{children}</div></SelectCtx.Provider>
}
export function SelectTrigger({ className = '', children }: { className?: string; children: React.ReactNode }) {
  const { setOpen } = React.useContext(SelectCtx)
  return <button onClick={() => setOpen(true)} className={\`flex items-center justify-between h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm \${className}\`}>{children}<span>&#9662;</span></button>
}
export function SelectValue({ placeholder = 'Select...' }: { placeholder?: string }) {
  const { value } = React.useContext(SelectCtx)
  return <span>{value || placeholder}</span>
}
export function SelectContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const { open, setOpen } = React.useContext(SelectCtx)
  if (!open) return null
  return <><div className="fixed inset-0 z-40" onClick={() => setOpen(false)} /><div className={\`absolute z-50 mt-1 w-full bg-white rounded-lg border border-gray-200 shadow-lg py-1 \${className}\`}>{children}</div></>
}
export function SelectItem({ value, children, className = '' }: { value: string; children: React.ReactNode; className?: string }) {
  const { onChange, value: selected } = React.useContext(SelectCtx)
  return <button onClick={() => onChange(value)} className={\`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 \${selected === value ? 'bg-blue-50 text-blue-700' : ''} \${className}\`}>{children}</button>
}
`,

  '/src/components/ui/progress.tsx': `
import React from 'react'
export function Progress({ value = 0, className = '' }: { value?: number; className?: string }) {
  return <div className={\`h-2 bg-gray-200 rounded-full overflow-hidden \${className}\`}><div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: \`\${Math.min(value, 100)}%\` }} /></div>
}
export function CircularProgress({ value = 0, size = 40, className = '' }: { value?: number; size?: number; className?: string }) {
  const r = (size - 4) / 2; const c = 2 * Math.PI * r; const offset = c - (value / 100) * c
  return <svg width={size} height={size} className={className}><circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={4} /><circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#2563eb" strokeWidth={4} strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" transform={\`rotate(-90 \${size/2} \${size/2})\`} /></svg>
}
`,

  '/src/components/ui/checkbox.tsx': `
import React from 'react'
export function Checkbox({ checked, onCheckedChange, className = '' }: { checked?: boolean; onCheckedChange?: (c: boolean) => void; className?: string }) {
  return <button onClick={() => onCheckedChange?.(!checked)} className={\`w-4 h-4 rounded border \${checked ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 bg-white'} flex items-center justify-center \${className}\`}>{checked && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}</button>
}
export function RadioGroup({ value, onValueChange, children, className = '' }: { value?: string; onValueChange?: (v: string) => void; children: React.ReactNode; className?: string }) {
  return <div className={\`space-y-2 \${className}\`}>{React.Children.map(children, c => React.isValidElement(c) ? React.cloneElement(c as any, { selected: value, onSelect: onValueChange }) : c)}</div>
}
export function RadioGroupItem({ value, selected, onSelect, className = '' }: { value: string; selected?: string; onSelect?: (v: string) => void; className?: string }) {
  return <button onClick={() => onSelect?.(value)} className={\`w-4 h-4 rounded-full border-2 \${selected === value ? 'border-blue-600' : 'border-gray-300'} flex items-center justify-center \${className}\`}>{selected === value && <div className="w-2 h-2 rounded-full bg-blue-600" />}</button>
}
`,

  '/src/components/ui/accordion.tsx': `
import React from 'react'
const AccCtx = React.createContext<{ open: string[]; toggle: (v: string) => void }>({ open: [], toggle: () => {} })
export function Accordion({ type = 'single', children, className = '' }: { type?: 'single' | 'multiple'; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = React.useState<string[]>([])
  const toggle = (v: string) => setOpen(prev => type === 'single' ? (prev.includes(v) ? [] : [v]) : (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]))
  return <AccCtx.Provider value={{ open, toggle }}><div className={\`divide-y divide-gray-200 border rounded-xl \${className}\`}>{children}</div></AccCtx.Provider>
}
export function AccordionItem({ value, children, className = '' }: { value: string; children: React.ReactNode; className?: string }) {
  return <div className={className} data-value={value}>{React.Children.map(children, c => React.isValidElement(c) ? React.cloneElement(c as any, { itemValue: value }) : c)}</div>
}
export function AccordionTrigger({ children, className = '', itemValue = '' }: { children: React.ReactNode; className?: string; itemValue?: string }) {
  const { open, toggle } = React.useContext(AccCtx)
  return <button onClick={() => toggle(itemValue)} className={\`flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-left hover:bg-gray-50 \${className}\`}>{children}<span className={\`transition-transform \${open.includes(itemValue) ? 'rotate-180' : ''}\`}>&#9662;</span></button>
}
export function AccordionContent({ children, className = '', itemValue = '' }: { children: React.ReactNode; className?: string; itemValue?: string }) {
  const { open } = React.useContext(AccCtx)
  if (!open.includes(itemValue)) return null
  return <div className={\`px-4 pb-3 text-sm text-gray-600 \${className}\`}>{children}</div>
}
`,

  '/src/components/ui/alert.tsx': `
import React from 'react'
export function Alert({ variant = 'default', className = '', children }: { variant?: 'default' | 'destructive'; className?: string; children: React.ReactNode }) {
  const styles = variant === 'destructive' ? 'border-red-200 bg-red-50 text-red-800' : 'border-gray-200 bg-white'
  return <div className={\`rounded-lg border p-4 \${styles} \${className}\`}>{children}</div>
}
export function AlertTitle({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <h5 className={\`font-medium mb-1 \${className}\`}>{children}</h5>
}
export function AlertDescription({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <p className={\`text-sm opacity-80 \${className}\`}>{children}</p>
}
`,

  '/src/components/ui/toast.tsx': `
import React from 'react'
export function Toast({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={\`fixed bottom-4 right-4 bg-white rounded-lg shadow-lg border border-gray-200 p-4 max-w-sm z-50 \${className}\`}>{children}</div>
}
export function ToastTitle({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={\`font-medium text-sm \${className}\`}>{children}</div>
}
export function ToastDescription({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <p className={\`text-sm text-gray-500 mt-1 \${className}\`}>{children}</p>
}
`,

  '/src/components/ui/popover.tsx': `
import React from 'react'
const PopCtx = React.createContext<{ open: boolean; setOpen: (o: boolean) => void }>({ open: false, setOpen: () => {} })
export function Popover({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  return <PopCtx.Provider value={{ open, setOpen }}><div className="relative inline-block">{children}</div></PopCtx.Provider>
}
export function PopoverTrigger({ children, asChild, className = '' }: { children: React.ReactNode; asChild?: boolean; className?: string }) {
  const { setOpen, open } = React.useContext(PopCtx)
  return <button onClick={() => setOpen(!open)} className={className}>{children}</button>
}
export function PopoverContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const { open, setOpen } = React.useContext(PopCtx)
  if (!open) return null
  return <><div className="fixed inset-0 z-40" onClick={() => setOpen(false)} /><div className={\`absolute z-50 mt-2 bg-white rounded-lg border border-gray-200 shadow-lg p-4 min-w-[200px] \${className}\`}>{children}</div></>
}
`,

  '/src/lib/utils.ts': `
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
`,
}
