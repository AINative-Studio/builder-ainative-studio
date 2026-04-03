export default function TemplatesLoading() {
  return (
    <div className="container mx-auto p-6">
      <div className="mb-6 h-8 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
          >
            <div className="mb-3 h-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-900" />
          </div>
        ))}
      </div>
    </div>
  )
}
