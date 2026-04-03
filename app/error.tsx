'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 dark:bg-black">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 text-6xl text-gray-300 dark:text-gray-600">!</div>
        <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
          Something went wrong
        </h2>
        <p className="mb-6 text-gray-500 dark:text-gray-400">
          An unexpected error occurred. Please try again or return to the home
          page.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-[#5867EF] px-4 py-2 text-sm font-medium text-white hover:bg-[#4756DE]"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  )
}
