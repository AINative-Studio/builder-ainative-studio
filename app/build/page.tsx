import type { Metadata } from 'next'
import { BuildApp } from '@/components/build/BuildApp'

export const metadata: Metadata = {
  title: 'Build a company with Cody',
  description:
    'AINative Builder — describe an idea, and Cody (your AI co-founder) composes it into a working product or an operating AI-native company from real AINative primitives, then runs it 24/7.',
}

export default function BuildPage() {
  return <BuildApp />
}
