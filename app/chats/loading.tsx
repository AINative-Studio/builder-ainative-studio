export default function ChatsLoading() {
  return (
    <div className="flex h-screen">
      <div className="w-72 border-r border-gray-200 p-4 dark:border-gray-800">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="mb-3 space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-900" />
          </div>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-[#5867EF]" />
      </div>
    </div>
  )
}
