'use client'

import { useParams } from 'next/navigation'

export default function PreviewPage() {
  const params = useParams()
  const id = params.id as string

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-4">
          <h1 className="text-2xl font-bold mb-2">Preview: {id}</h1>
          <p className="text-gray-600">Generated component preview</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg overflow-hidden" style={{ height: '80vh' }}>
          <iframe
            src={`/api/preview/${id}`}
            className="w-full h-full border-0"
            title={`Preview ${id}`}
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </div>
    </div>
  )
}