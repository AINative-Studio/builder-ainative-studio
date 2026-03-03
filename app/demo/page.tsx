'use client'

import { useState } from 'react'

export default function DemoPage() {
  const [currentPreview, setCurrentPreview] = useState('test-final-001')

  const examples = [
    { id: 'test-final-001', name: '✨ Best Dashboard', desc: 'Clean metric cards' },
    { id: 'improved-0', name: '📈 Crypto Trading', desc: 'Live prices' },
    { id: 'improved-2', name: '💪 Fitness Tracker', desc: 'Workout stats' },
    { id: 'better-pm', name: '📋 Project Mgmt', desc: 'Task cards' },
  ]

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">LLAMA UI Live Previews</h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4">
        {/* Gallery Selector */}
        <div className="flex gap-2 mb-4">
          {examples.map(ex => (
            <button
              key={ex.id}
              onClick={() => setCurrentPreview(ex.id)}
              className={`px-4 py-2 rounded-lg ${
                currentPreview === ex.id
                  ? 'bg-blue-500 text-white'
                  : 'bg-white hover:bg-gray-50'
              }`}
            >
              <div className="font-medium">{ex.name}</div>
              <div className="text-xs opacity-80">{ex.desc}</div>
            </button>
          ))}
        </div>

        {/* Live Preview */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden" style={{ height: '700px' }}>
          <iframe
            key={currentPreview}
            src={`/api/preview/${currentPreview}`}
            className="w-full h-full border-0"
            title={`Preview ${currentPreview}`}
          />
        </div>
      </div>
    </div>
  )
}