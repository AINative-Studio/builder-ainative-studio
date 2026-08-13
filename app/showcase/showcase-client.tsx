'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { SEED_SHOWCASE, SHOWCASE_CATEGORIES, type ShowcaseEntry } from '@/lib/showcase-data'

// Build a self-contained HTML page that renders React code using CDN scripts
function buildPreviewHtml(code: string): string {
  let cleanCode = code

  // Handle multi-file output — extract only the main App file
  if (cleanCode.includes('// --- FILE:')) {
    const files = cleanCode.split(/\/\/\s*---\s*FILE:\s*/i)
    let mainFile = files.find(f => /^src\/App\.tsx|^App\.tsx/i.test(f.trim()))
    if (!mainFile) mainFile = files.find(f => /\.tsx|\.jsx/i.test(f.split('\n')[0]))
    if (!mainFile && files.length > 1) mainFile = files[1]
    if (mainFile) cleanCode = mainFile.replace(/^.*?---\s*\n?/, '').trim()
  }

  // Extract from markdown fences if present
  const fenceMatch = cleanCode.match(/```(?:jsx?|tsx?)\s*\n([\s\S]*?)```/)
  if (fenceMatch) cleanCode = fenceMatch[1]

  // Detect component name BEFORE stripping exports
  const exportMatch = cleanCode.match(/export\s+default\s+function\s+([A-Z]\w+)/)
  const exportConstMatch = cleanCode.match(/export\s+default\s+([A-Z]\w+)/)
  const funcDeclMatch = cleanCode.match(/^function\s+([A-Z]\w+)/m)
  const constDeclMatch = cleanCode.match(/^const\s+([A-Z]\w+)\s*=/m)
  const componentName = exportMatch?.[1] || funcDeclMatch?.[1] || exportConstMatch?.[1] || constDeclMatch?.[1] || 'App'

  // Strip imports and exports
  cleanCode = cleanCode
    .replace(/^import\s+.*$/gm, '')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s+/gm, '')
    // Strip TypeScript types
    .replace(/:\s*React\.FC<.*?>/g, '')
    .replace(/:\s*React\.FC/g, '')
    .replace(/interface\s+\w+\s*\{[^}]*\}/g, '')
    .trim()

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>body{font-family:Inter,system-ui,sans-serif;margin:0;overflow:hidden}*{box-sizing:border-box}</style>
</head><body>
<div id="root"></div>
<script type="text/babel">
const { useState, useEffect, useCallback, useMemo, useRef, Fragment } = React;

// Stub UI components
const Button = ({children, className='', ...p}) => <button className={"px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium "+className} {...p}>{children}</button>;
const Card = ({children, className='', ...p}) => <div className={"bg-white rounded-xl border border-gray-200 shadow-sm "+className} {...p}>{children}</div>;
const CardHeader = ({children, className='', ...p}) => <div className={"p-6 pb-2 "+className} {...p}>{children}</div>;
const CardTitle = ({children, className='', ...p}) => <h3 className={"text-lg font-semibold "+className} {...p}>{children}</h3>;
const CardDescription = ({children, className='', ...p}) => <p className={"text-sm text-gray-500 "+className} {...p}>{children}</p>;
const CardContent = ({children, className='', ...p}) => <div className={"p-6 pt-2 "+className} {...p}>{children}</div>;
const CardFooter = ({children, className='', ...p}) => <div className={"p-6 pt-0 "+className} {...p}>{children}</div>;
const Badge = ({children, className='', ...p}) => <span className={"inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700 "+className} {...p}>{children}</span>;
const Input = ({className='', ...p}) => <input className={"w-full px-3 py-2 border border-gray-200 rounded-lg text-sm "+className} {...p}/>;
const Label = ({children, ...p}) => <label className="text-sm font-medium" {...p}>{children}</label>;
const Separator = ({className=''}) => <hr className={"border-gray-200 "+className}/>;
const Progress = ({value=0, className=''}) => <div className={"h-2 bg-gray-200 rounded-full overflow-hidden "+className}><div className="h-full bg-blue-600 rounded-full" style={{width:value+'%'}}/></div>;
const Tabs = ({children, ...p}) => <div {...p}>{children}</div>;
const TabsList = ({children, className='', ...p}) => <div className={"flex gap-1 bg-gray-100 p-1 rounded-lg "+className} {...p}>{children}</div>;
const TabsTrigger = ({children, className='', ...p}) => <button className={"px-3 py-1.5 text-sm rounded-md "+className} {...p}>{children}</button>;
const TabsContent = ({children, ...p}) => <div {...p}>{children}</div>;
const Avatar = ({children, className='', ...p}) => <div className={"w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden "+className} {...p}>{children}</div>;
const AvatarFallback = ({children, className='', ...p}) => <span className={"text-sm font-medium text-gray-600 "+className} {...p}>{children}</span>;
const AvatarImage = ({...p}) => <img className="w-full h-full object-cover" {...p}/>;
const Table = ({children, className='', ...p}) => <table className={"w-full text-sm "+className} {...p}>{children}</table>;
const TableHeader = ({children, ...p}) => <thead {...p}>{children}</thead>;
const TableBody = ({children, ...p}) => <tbody {...p}>{children}</tbody>;
const TableRow = ({children, className='', ...p}) => <tr className={"border-b border-gray-100 "+className} {...p}>{children}</tr>;
const TableHead = ({children, className='', ...p}) => <th className={"text-left p-3 text-gray-500 font-medium "+className} {...p}>{children}</th>;
const TableCell = ({children, className='', ...p}) => <td className={"p-3 "+className} {...p}>{children}</td>;
const Select = ({children, ...p}) => <div {...p}>{children}</div>;
const SelectTrigger = ({children, className='', ...p}) => <button className={"px-3 py-2 border rounded-lg text-sm text-left w-full "+className} {...p}>{children}</button>;
const SelectValue = ({placeholder=''}) => <span className="text-gray-500">{placeholder}</span>;
const SelectContent = ({children}) => null;
const SelectItem = ({children}) => null;
const Dialog = ({children}) => <>{children}</>;
const DialogContent = ({children}) => null;
const DialogHeader = ({children}) => <div>{children}</div>;
const DialogTitle = ({children}) => <h2>{children}</h2>;
const Checkbox = ({...p}) => <input type="checkbox" className="w-4 h-4" {...p}/>;
const Accordion = ({children, ...p}) => <div {...p}>{children}</div>;
const AccordionItem = ({children, ...p}) => <div {...p}>{children}</div>;
const AccordionTrigger = ({children, ...p}) => <button className="w-full text-left py-3 font-medium" {...p}>{children}</button>;
const AccordionContent = ({children, ...p}) => <div className="pb-3" {...p}>{children}</div>;

// Stub AIKit components
const MetricCard = ({title='', value='', change='', changeType='positive', icon, sparklineData}) => <Card><CardContent className="p-4"><div className="flex justify-between items-start"><div><p className="text-xs text-gray-500">{title}</p><p className="text-2xl font-bold mt-1">{value}</p>{change && <p className={"text-xs mt-1 "+(changeType==='positive'?'text-green-600':'text-red-600')}>{change}</p>}</div>{icon && <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">{icon}</div>}</div></CardContent></Card>;
const AIKitPriceCard = ({name='', price='', period='', features=[], popular, cta='Get Started'}) => <Card className={popular?'border-blue-600 ring-2 ring-blue-600':''}><CardContent className="p-6"><h3 className="font-bold text-lg">{name}</h3><p className="text-3xl font-bold mt-2">{price}<span className="text-sm text-gray-500 font-normal">{period}</span></p><ul className="mt-4 space-y-2">{features.map((f,i) => <li key={i} className="text-sm text-gray-600">✓ {f}</li>)}</ul><Button className="w-full mt-6">{cta}</Button></CardContent></Card>;
const AIKitRating = ({value=0, max=5, showValue, reviews}) => <div className="flex items-center gap-1"><span className="text-yellow-500">{'★'.repeat(Math.floor(value))}</span>{showValue && <span className="text-sm font-medium">{value}</span>}{reviews && <span className="text-xs text-gray-400">({reviews})</span>}</div>;
const AIKitSidebar = ({items=[], title='', activeItem, collapsed}) => <div className={"bg-gray-900 text-white p-4 "+(collapsed?'w-16':'w-56')}><h2 className="font-bold mb-4 text-sm">{title}</h2>{items.map((item,i) => <div key={i} className={"px-3 py-2 rounded-lg text-sm mb-1 cursor-pointer "+(activeItem===item.id?'bg-white/10':'hover:bg-white/5')}>{item.label}</div>)}</div>;
const AIKitHeader = ({title='', navItems=[], user}) => <div className="bg-white border-b px-6 py-3 flex items-center justify-between"><span className="font-bold">{title}</span><div className="flex gap-4 text-sm">{navItems.map((n,i) => <span key={i} className={n.active?'text-blue-600':'text-gray-500'}>{n.label}</span>)}</div></div>;
const AIKitTable = ({columns=[], data=[]}) => <Table><TableHeader><TableRow>{columns.map((c,i) => <TableHead key={i}>{c.label}</TableHead>)}</TableRow></TableHeader><TableBody>{data.slice(0,5).map((row,i) => <TableRow key={i}>{columns.map((c,j) => <TableCell key={j}>{c.render ? c.render(row[c.key],row) : row[c.key]}</TableCell>)}</TableRow>)}</TableBody></Table>;
const AIKitAvatar = ({name='', status, size='md'}) => <Avatar><AvatarFallback>{name.split(' ').map(w=>w[0]).join('').slice(0,2)}</AvatarFallback></Avatar>;
const AIKitBanner = ({children, variant='info', dismissible}) => <div className={"p-3 rounded-lg text-sm "+(variant==='error'?'bg-red-50 text-red-700':variant==='success'?'bg-green-50 text-green-700':'bg-blue-50 text-blue-700')}>{children}</div>;
const AIKitPagination = ({currentPage=1, totalPages=1}) => <div className="flex gap-1 justify-center">{Array.from({length:Math.min(totalPages,5)},(_,i)=><button key={i} className={"w-8 h-8 rounded text-sm "+(i+1===currentPage?'bg-blue-600 text-white':'bg-gray-100')}>{i+1}</button>)}</div>;
const AIKitBreadcrumb = ({items=[]}) => <div className="flex gap-2 text-sm text-gray-500">{items.map((item,i) => <span key={i}>{i>0 && ' / '}{item.label}</span>)}</div>;
const AIKitStepper = ({steps=[], currentStep=0}) => <div className="flex gap-2">{steps.map((s,i) => <div key={i} className={"flex items-center gap-1 text-sm "+(i<=currentStep?'text-blue-600':'text-gray-400')}><span className={"w-6 h-6 rounded-full flex items-center justify-center text-xs "+(i<=currentStep?'bg-blue-600 text-white':'bg-gray-200')}>{i+1}</span>{s}</div>)}</div>;
const AIKitTimeline = ({items=[]}) => <div className="space-y-3">{items.map((item,i) => <div key={i} className="flex gap-3"><div className="w-2 h-2 rounded-full bg-blue-600 mt-2"/><div><p className="text-sm font-medium">{item.title}</p><p className="text-xs text-gray-500">{item.time}</p></div></div>)}</div>;
const AIKitProductCard = ({name='', price=0, rating=0, badge, onAddToCart}) => <Card><CardContent className="p-4"><div className="aspect-square bg-gray-100 rounded-lg mb-3"/><h3 className="font-medium text-sm">{name}</h3><div className="flex justify-between items-center mt-2"><span className="font-bold">USD {price}</span><AIKitRating value={rating}/></div></CardContent></Card>;
const Skeleton = ({className=''}) => <div className={"animate-pulse bg-gray-200 rounded "+className}/>;
const SkeletonCard = () => <Card><CardContent className="p-4 space-y-3"><Skeleton className="h-4 w-1/3"/><Skeleton className="h-8 w-2/3"/><Skeleton className="h-4 w-full"/></CardContent></Card>;
const EmptyState = ({title='', description='', icon, actionLabel}) => <div className="text-center py-12"><p className="font-medium text-gray-900">{title}</p><p className="text-sm text-gray-500 mt-1">{description}</p></div>;
const ChatBubble = ({children, role='user', name=''}) => <div className={"p-3 rounded-lg mb-2 max-w-[80%] text-sm "+(role==='user'?'bg-blue-600 text-white ml-auto':'bg-gray-100')}>{name && <p className="font-medium text-xs mb-1">{name}</p>}{children}</div>;
const StreamingIndicator = () => <div className="flex gap-1 p-2"><span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"/><span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:'0.1s'}}/><span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:'0.2s'}}/></div>;
const CodeDisplay = ({code='', language=''}) => <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-auto"><code>{code}</code></pre>;
const TokenUsageBar = ({used=0, limit=100, label=''}) => <div><div className="flex justify-between text-xs mb-1"><span>{label}</span><span>{used}/{limit}</span></div><Progress value={(used/limit)*100}/></div>;
const ConnectionStatus = ({status='connected'}) => <span className={"inline-flex items-center gap-1 text-xs "+(status==='connected'?'text-green-600':'text-red-600')}><span className={"w-2 h-2 rounded-full "+(status==='connected'?'bg-green-500':'bg-red-500')}/>{status}</span>;
const AgentCard = ({name='', role='', status='active', tasks=0}) => <Card><CardContent className="p-4"><div className="flex items-center gap-3"><Avatar><AvatarFallback>{name[0]}</AvatarFallback></Avatar><div><p className="font-medium text-sm">{name}</p><p className="text-xs text-gray-500">{role}</p></div></div><div className="mt-3 flex justify-between text-xs"><span>{tasks} tasks</span><ConnectionStatus status={status}/></div></CardContent></Card>;
const SwarmView = ({agents=[], title=''}) => <div><h3 className="font-bold mb-3">{title}</h3><div className="grid grid-cols-3 gap-3">{agents.map((a,i) => <AgentCard key={i} {...a}/>)}</div></div>;
const SafetyBadge = ({score, level='safe', label=''}) => <Badge className={level==='safe'?'bg-green-50 text-green-700':'bg-yellow-50 text-yellow-700'}>{label || (score ? score+'%' : level)}</Badge>;
const GuardrailPanel = ({rules=[]}) => <div className="space-y-2">{rules.map((r,i) => <div key={i} className="flex items-center gap-2 text-sm"><span className={r.status==='passed'?'text-green-600':'text-red-600'}>{r.status==='passed'?'✓':'✗'}</span>{r.name}</div>)}</div>;
const AgentTimeline = ({events=[]}) => <AIKitTimeline items={events.map(e => ({title: e.message || e.agent, time: e.duration || ''}))} />;
const VideoPlayer = ({title=''}) => <div className="aspect-video bg-gray-900 rounded-lg flex items-center justify-center text-white">{title}</div>;
const MediaGallery = ({items=[], columns=3}) => <div className={"grid gap-2"} style={{gridTemplateColumns:'repeat('+columns+',1fr)'}}>{items.map((item,i) => <div key={i} className="aspect-square bg-gray-100 rounded-lg"/>)}</div>;
const StreamingText = ({text=''}) => <span>{text}</span>;

// Stub Lucide icons as simple SVG placeholders
const iconSvg = (d) => ({className='w-5 h-5',...p}) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...p}><path strokeLinecap="round" strokeLinejoin="round" d={d}/></svg>;
const Search = iconSvg("M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z");
const Menu = iconSvg("M4 6h16M4 12h16M4 18h16");
const X = iconSvg("M6 18L18 6M6 6l12 12");
const ChevronDown = iconSvg("M19 9l-7 7-7-7");
const ChevronRight = iconSvg("M9 5l7 7-7 7");
const ChevronLeft = iconSvg("M15 19l-7-7 7-7");
const Home = iconSvg("M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4");
const Settings = iconSvg("M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z");
const Users = iconSvg("M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z");
const Bell = iconSvg("M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9");
const Mail = iconSvg("M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z");
const Star = iconSvg("M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z");
const Plus = iconSvg("M12 4v16m8-8H4");
const Edit = iconSvg("M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z");
const Trash2 = iconSvg("M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16");
const ArrowRight = iconSvg("M13 7l5 5m0 0l-5 5m5-5H6");
const ArrowLeft = iconSvg("M11 17l-5-5m0 0l5-5m-5 5h12");
const TrendingUp = iconSvg("M13 7h8m0 0v8m0-8l-8 8-4-4-6 6");
const TrendingDown = iconSvg("M13 17h8m0 0V9m0 8l-8-8-4 4-6-6");
const Activity = iconSvg("M22 12h-4l-3 9L9 3l-3 9H2");
const DollarSign = iconSvg("M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6");
const Zap = iconSvg("M13 2L3 14h9l-1 10 10-12h-9l1-10z");
const Shield = iconSvg("M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z");
const Globe = iconSvg("M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9");
const Lock = iconSvg("M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z");
const Sparkles = iconSvg("M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z");
const Rocket = iconSvg("M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.58-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z");
const Brain = iconSvg("M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z");
const Bot = iconSvg("M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z");
const BarChart3 = iconSvg("M18 20V10M12 20V4M6 20v-6");
const LineChart = iconSvg("M3 3v18h18");
const PieChart = iconSvg("M21.21 15.89A10 10 0 118 2.83M22 12A10 10 0 0012 2v10z");
const Target = iconSvg("M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0M12 12m-7 0a7 7 0 1014 0 7 7 0 10-14 0M12 12m-11 0a11 11 0 1022 0 11 11 0 10-22 0");
const Eye = iconSvg("M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z");
const Check = iconSvg("M5 13l4 4L19 7");
const AlertCircle = iconSvg("M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z");
const Info = iconSvg("M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z");
const Download = iconSvg("M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4");
const Upload = iconSvg("M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12");
const Filter = iconSvg("M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z");
const Calendar = iconSvg("M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z");
const Clock = iconSvg("M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z");
const MapPin = iconSvg("M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z");
const Phone = iconSvg("M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z");
const ExternalLink = iconSvg("M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14");
const Share2 = iconSvg("M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z");
const Copy = iconSvg("M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z");
const Save = iconSvg("M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4");
const RefreshCw = iconSvg("M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15");
const MoreHorizontal = iconSvg("M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z");
const Layers = iconSvg("M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5");
const Grid = iconSvg("M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z");
const List = iconSvg("M4 6h16M4 10h16M4 14h16M4 18h16");
const Inbox = iconSvg("M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4");
const Package = iconSvg("M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4");
const Truck = iconSvg("M16 3h5v12h-5M1 14h14V3H1v11zm15 3a3 3 0 11-6 0m6 0H10m-5 0a3 3 0 11-6 0m6 0H1");
const CreditCard = iconSvg("M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z");
const Briefcase = iconSvg("M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z");
const BookOpen = iconSvg("M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253");
const LogOut = iconSvg("M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1");
const UserPlus = iconSvg("M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z");
const FolderOpen = iconSvg("M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z");
const File = iconSvg("M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z");
const Box = iconSvg("M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4");
const Award = iconSvg("M12 15l-2 5-1-1-1 1 2-5m4 0l2 5 1-1 1 1-2-5M8.21 13.89L7 23l5-3 5 3-1.21-9.12M21 9a9 9 0 11-18 0 9 9 0 0118 0z");
const Building2 = iconSvg("M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4");
const Laptop = iconSvg("M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z");
const Smartphone = iconSvg("M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z");
const Code = iconSvg("M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4");
const Terminal = iconSvg("M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z");
const GitBranch = iconSvg("M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zm12-6a9 9 0 00-9-9");
const Send = iconSvg("M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z");
const MessageSquare = iconSvg("M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z");
const Bookmark = iconSvg("M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z");
const Tag = iconSvg("M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z");
const Heart = iconSvg("M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z");
const ShoppingCart = iconSvg("M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z");
const Minus = iconSvg("M20 12H4");
const ArrowUp = iconSvg("M5 10l7-7m0 0l7 7m-7-7v18");
const ArrowDown = iconSvg("M19 14l-7 7m0 0l-7-7m7 7V3");
const Sun = iconSvg("M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z");
const Moon = iconSvg("M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z");
const Layout = iconSvg("M4 4h6v6H4zM14 4h6v6h-6zM4 14h16v6H4z");
const MoreVertical = iconSvg("M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z");
const Users2 = Users;
const CircleDot = iconSvg("M12 12m-1 0a1 1 0 102 0 1 1 0 10-2 0M12 12m-9 0a9 9 0 1018 0 9 9 0 10-18 0");

// Recharts stubs (render nothing gracefully)
const ResponsiveContainer = ({children, width, height}) => <div style={{width: width||'100%', height: height||200}}>{children}</div>;
const ReLineChart = ({children}) => <div className="w-full h-full bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg flex items-end p-4"><div className="flex gap-1 items-end w-full">{[40,65,45,80,55,90,70].map((h,i) => <div key={i} className="flex-1 bg-blue-400 rounded-t" style={{height:h+'%'}}/>)}</div></div>;
const Line = () => null;
const ReBarChart = ReLineChart;
const Bar = () => null;
const RePieChart = ({children}) => <div className="w-full h-full flex items-center justify-center"><div className="w-32 h-32 rounded-full border-8 border-blue-500 border-t-green-500 border-r-yellow-500"/></div>;
const Pie = () => null;
const Cell = () => null;
const AreaChart = ReLineChart;
const Area = () => null;
const XAxis = () => null;
const YAxis = () => null;
const CartesianGrid = () => null;
const RechartsTooltip = () => null;
const Tooltip = () => null;
const Legend = () => null;
const RadialBarChart = RePieChart;
const RadialBar = () => null;

// Utility
const cn = (...args) => args.filter(Boolean).join(' ');

try {
  // Compile JSX with Babel, then execute with all globals available
  var _src = ${JSON.stringify(cleanCode)};
  var _compiled = Babel.transform(_src, {presets:[['react',{runtime:'classic'}],['typescript',{isTSX:true, allExtensions:true, onlyRemoveTypeImports:true}]], parserOpts:{errorRecovery:true}}).code;
  // Execute in a function scope with all component globals
  var _fn = new Function(
    'React','useState','useEffect','useCallback','useMemo','useRef','Fragment',
    'Button','Card','CardHeader','CardTitle','CardDescription','CardContent','CardFooter',
    'Input','Label','Badge','Avatar','AvatarImage','AvatarFallback',
    'Table','TableHeader','TableBody','TableRow','TableHead','TableCell','Separator',
    'Tabs','TabsList','TabsTrigger','TabsContent','Progress','Checkbox',
    'Dialog','DialogContent','DialogHeader','DialogTitle',
    'Select','SelectTrigger','SelectValue','SelectContent','SelectItem',
    'Accordion','AccordionItem','AccordionTrigger','AccordionContent',
    'Alert','AlertTitle','AlertDescription',
    'MetricCard','AIKitPriceCard','AIKitRating','AgentCard','SwarmView','SafetyBadge',
    'GuardrailPanel','ChatBubble','StreamingIndicator','CodeDisplay','TokenUsageBar',
    'ConnectionStatus','AIKitHeader','AIKitSidebar','AIKitTable','AIKitTimeline',
    'AIKitBanner','AIKitAvatar','Skeleton','SkeletonCard','EmptyState',
    'AIKitProductCard','AIKitPagination','AIKitBreadcrumb','AIKitStepper',
    'VideoPlayer','StreamingText','MediaGallery','AgentTimeline',
    'ResponsiveContainer','ReLineChart','Line','ReBarChart','Bar',
    'RePieChart','Pie','Cell','AreaChart','Area','XAxis','YAxis',
    'CartesianGrid','RechartsTooltip','Tooltip','Legend','cn',
    _compiled + ';\\nreturn typeof ${componentName} !== "undefined" ? ${componentName} : null;'
  );
  var _comp = _fn(
    React, useState, useEffect, useCallback, useMemo, useRef, Fragment,
    Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
    Input, Label, Badge, Avatar, AvatarImage, AvatarFallback,
    Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Separator,
    Tabs, TabsList, TabsTrigger, TabsContent, Progress, Checkbox,
    Dialog, DialogContent, DialogHeader, DialogTitle,
    Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
    Accordion, AccordionItem, AccordionTrigger, AccordionContent,
    Alert, AlertTitle, AlertDescription,
    MetricCard, AIKitPriceCard, AIKitRating, AgentCard, SwarmView, SafetyBadge,
    GuardrailPanel, ChatBubble, StreamingIndicator, CodeDisplay, TokenUsageBar,
    ConnectionStatus, AIKitHeader, AIKitSidebar, AIKitTable, AIKitTimeline,
    AIKitBanner, AIKitAvatar, Skeleton, SkeletonCard, EmptyState,
    AIKitProductCard, AIKitPagination, AIKitBreadcrumb, AIKitStepper,
    VideoPlayer, StreamingText, MediaGallery, AgentTimeline,
    ResponsiveContainer, ReLineChart, Line, ReBarChart, Bar,
    RePieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis,
    CartesianGrid, RechartsTooltip, Tooltip, Legend, cn
  );
  if (_comp) {
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(_comp));
  }
} catch(e) {
  document.getElementById('root').innerHTML = '<div style="padding:20px;text-align:center;color:#6b7280;font-size:12px">Preview</div>';
}
</script>
</body></html>`
}

// Auto-detect category from prompt keywords
function detectCategory(prompt: string): string {
  const p = prompt.toLowerCase()
  if (p.includes('dashboard') || p.includes('analytics') || p.includes('monitor') || p.includes('metrics') || p.includes('metriccard')) return 'dashboard'
  if (p.includes('landing') || p.includes('hero section') || p.includes('pricing') || p.includes('testimonial')) return 'landing'
  if (p.includes('ecommerce') || p.includes('e-commerce') || p.includes('product') || p.includes('shopping') || p.includes('cart') || p.includes('store')) return 'ecommerce'
  if (p.includes('chat') || p.includes('message') || p.includes('social') || p.includes('chatbubble')) return 'social'
  if (p.includes('kanban') || p.includes('task') || p.includes('calendar') || p.includes('note') || p.includes('file manager') || p.includes('todo') || p.includes('project')) return 'productivity'
  if (p.includes('saas') || p.includes('team') || p.includes('crm') || p.includes('invoice') || p.includes('subscription') || p.includes('onboarding')) return 'saas'
  if (p.includes('music') || p.includes('recipe') || p.includes('weather') || p.includes('blog') || p.includes('portfolio') || p.includes('fitness') || p.includes('restaurant') || p.includes('menu')) return 'creative'
  return 'creative'
}

// Clean up auto-generated titles
function cleanTitle(title: string): string {
  let t = title
    // Convert kebab-case slugs to words
    .replace(/-/g, ' ')
    // Remove "Build a/an" prefix
    .replace(/^Build\s+(a|an)\s+/i, '')
    // Remove everything after "with", "using", "for" (prompt details)
    .replace(/\s+with\s+.*/i, '')
    .replace(/\s+using\s+.*/i, '')
    .replace(/\s+for\s+"[^"]*"/, '')
    // Take first part before comma
    .split(',')[0]
    .trim()
  // Title case
  t = t.split(' ')
    .slice(0, 5)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
  return t || 'Generated App'
}

// Generate a real description from the prompt
function cleanDescription(prompt: string, title: string): string {
  if (!prompt || prompt === title) {
    return `A production-ready React application generated with AI`
  }
  // Remove "Build a/an" prefix and clean up
  let desc = prompt
    .replace(/^Build\s+(a|an)\s+/i, 'A ')
    .replace(/AIKitSidebar|AIKitHeader|AIKitTable|AIKitPriceCard|MetricCard|AIKitRating|AIKitAvatar|AIKitBreadcrumb|AIKitPagination|AIKitStepper|AIKitTimeline|AIKitBanner|AIKitProductCard|AgentCard|SwarmView|SafetyBadge|GuardrailPanel|ChatBubble|StreamingIndicator|CodeDisplay|TokenUsageBar|ConnectionStatus|AgentTimeline|Recharts|sparklineData/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  // Cap at 120 chars
  if (desc.length > 120) {
    desc = desc.slice(0, 117) + '...'
  }
  return desc
}

function CommunityCard({ entry, isSeed = false }: { entry: ShowcaseEntry; isSeed?: boolean }) {
  const cat = detectCategory(entry.prompt || entry.title || '')
  const category = SHOWCASE_CATEGORIES.find(c => c.id === cat)
  const title = cleanTitle(entry.title || '')
  // Curated seed demos link to their reliable static-preview wrapper page
  // (/showcase/{slug} -> /showcase-previews/{slug}.html, build-time, can't fail).
  // Dynamic community apps link to the runtime preview by chatId.
  const previewUrl = isSeed
    ? `/showcase/${entry.slug}`
    : (entry.chatId ? `/api/preview/${entry.chatId}` : '')

  return (
    <a
      href={previewUrl || '/'}
      target={isSeed ? undefined : '_blank'}
      rel={isSeed ? undefined : 'noopener noreferrer'}
      className="group block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700 transition-all duration-200"
    >
      {/* Thumbnail — stylish gradient with app icon, loads instantly */}
      <div className="aspect-video relative overflow-hidden" style={{
        background: cat === 'dashboard' ? 'linear-gradient(135deg, #1e293b 0%, #334155 100%)' :
          cat === 'landing' ? 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' :
          cat === 'ecommerce' ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)' :
          cat === 'social' ? 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)' :
          cat === 'productivity' ? 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)' :
          cat === 'saas' ? 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)' :
          'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)'
      }}>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-4">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-2 backdrop-blur-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {cat === 'dashboard' ? <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18" /> :
               cat === 'landing' ? <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /> :
               cat === 'ecommerce' ? <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" /> :
               cat === 'social' ? <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /> :
               <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />}
            </svg>
          </div>
          <span className="text-sm font-semibold text-center leading-tight">{title}</span>
          <span className="text-[10px] text-white/60 mt-1">{category?.label || cat}</span>
        </div>
        <div className="absolute inset-0 bg-transparent group-hover:bg-white/10 transition-colors" />
      </div>

      {/* Card info */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-full">
            {category?.label || cat}
          </span>
        </div>
        <h3 className="font-semibold text-sm text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors line-clamp-1">
          {title}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
          {cleanDescription(entry.prompt || '', title)}
        </p>
      </div>
    </a>
  )
}

export function ShowcaseGalleryClient() {
  // Seed-first architecture: the curated SEED_SHOWCASE demos are ALWAYS rendered
  // (they're static, build-time, and each links to its reliable
  // /showcase/{slug} -> /showcase-previews/{slug}.html page). Dynamic community
  // apps are fetched as an ENHANCEMENT and appended below — so a slow/empty/
  // failed /api/showcase read can never blank the gallery. This is the fix for
  // the recurring "showcase not working" (blank gallery) regressions.
  const seedSlugs = useMemo(() => new Set(SEED_SHOWCASE.map(e => e.slug)), [])
  const [dynamicEntries, setDynamicEntries] = useState<ShowcaseEntry[]>([])
  const [filter, setFilter] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Enhancement only — never blocks or blanks the curated grid.
    fetch('/api/showcase?offset=0&limit=500')
      .then(r => (r.ok ? r.json() : { entries: [] }))
      .then(data => {
        if (cancelled) return
        const dynamic = (data.entries || []).filter((e: ShowcaseEntry & { hasCode?: boolean }) => {
          // The server now applies the code quality gate and strips
          // generatedCode from the list payload (#58), exposing `hasCode`
          // instead. Fall back to the legacy generatedCode check for any
          // response that still carries it (backwards compatible).
          const qualifies = e.hasCode ?? Boolean(e.generatedCode && e.generatedCode.length >= 2000)
          if (!e.chatId || !qualifies) return false
          if (seedSlugs.has(e.slug)) return false // don't duplicate curated seeds
          return true
        })
        setDynamicEntries(dynamic)
      })
      .catch(() => {
        // Swallow: the curated seed grid still renders. Never blank.
      })
    return () => { cancelled = true }
  }, [seedSlugs])

  // Freshly-generated community apps first (newest builds are the whole point of
  // the showcase), then the curated seed demos. Seeds still ALWAYS render, so a
  // slow/empty/failed /api/showcase read can never blank the grid. Dynamic
  // entries are deduped against seeds in the fetch above, so no overlap here.
  const all: Array<ShowcaseEntry & { __seed?: boolean }> = [
    ...dynamicEntries,
    ...SEED_SHOWCASE.map(e => ({ ...e, __seed: true })),
  ]

  const filtered = filter
    ? all.filter(e => detectCategory(e.prompt || e.title || '') === filter)
    : all

  const cats = [...new Set(all.map(e => detectCategory(e.prompt || e.title || '')))]

  return (
    <div>
      {/* Category filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setFilter(null)}
          className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
            !filter
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-300'
          }`}
        >
          All ({all.length})
        </button>
        {cats.map(cat => {
          const label = SHOWCASE_CATEGORIES.find(c => c.id === cat)?.label || cat
          const count = all.filter(e => detectCategory(e.prompt || e.title || '') === cat).length
          return (
            <button
              key={cat}
              onClick={() => setFilter(filter === cat ? null : cat)}
              className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                filter === cat
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-300'
              }`}
            >
              {label} ({count})
            </button>
          )
        })}
      </div>

      {/* Grid of cards — curated seeds link to static previews, community apps to runtime preview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {filtered.map(entry => (
          <CommunityCard
            key={entry.__seed ? `seed-${entry.slug}` : (entry.chatId || entry.slug)}
            entry={entry}
            isSeed={entry.__seed}
          />
        ))}
      </div>
    </div>
  )
}
