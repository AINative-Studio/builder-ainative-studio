'use client'

import { cn } from '@/lib/utils'

export interface BuildTask {
  id: string
  type: 'create' | 'update' | 'install' | 'configure'
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  description: string
  fileName?: string
  command?: string
}

interface BuildProgressProps {
  tasks: BuildTask[]
  className?: string
}

const getStatusText = (status: BuildTask['status']) => {
  switch (status) {
    case 'completed':
      return 'DONE'
    case 'in_progress':
      return 'BUILDING'
    case 'error':
      return 'ERROR'
    case 'pending':
    default:
      return 'PENDING'
  }
}

export function BuildProgress({ tasks, className }: BuildProgressProps) {
  const completedCount = tasks.filter((t) => t.status === 'completed').length
  const totalCount = tasks.length
  const progressPercent = (completedCount / totalCount) * 100

  return (
    <div
      className={cn(
        'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm',
        className
      )}
    >
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[16px] font-semibold text-black dark:text-white">
          Build Steps
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-gray-500 dark:text-gray-400 font-normal">
            {completedCount} of {totalCount} completed
          </span>
          {/* Thin progress bar */}
          <div className="w-16 h-[2px] bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gray-900 dark:bg-gray-300 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-start justify-between py-1 text-[14px]"
          >
            <div className="flex-1 min-w-0">
              <span className="text-gray-900 dark:text-gray-100">{task.description}</span>
              {task.fileName && (
                <span className="ml-2 text-gray-500 dark:text-gray-400 font-mono text-[13px]">
                  {task.fileName}
                </span>
              )}
            </div>
            <span className="text-[11px] text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium ml-3 flex-shrink-0">
              {getStatusText(task.status)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}