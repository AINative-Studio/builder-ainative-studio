'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

export type FileStatus = 'pending' | 'in_progress' | 'completed' | 'error'

export interface FileNode {
  id: string
  path: string
  name: string
  type: 'file' | 'folder'
  status: FileStatus
  action?: 'create' | 'update' | 'delete'
}

export interface FileGroup {
  id: string
  title: string
  files: FileNode[]
}

interface FileTreeProps {
  groups: FileGroup[]
  className?: string
}

const getStatusText = (status: FileStatus, action?: 'create' | 'update' | 'delete') => {
  if (status === 'completed') {
    if (action === 'create') return 'created'
    if (action === 'update') return 'modified'
    if (action === 'delete') return 'deleted'
  }
  if (status === 'in_progress') return 'building...'
  return ''
}

const FileItem = ({ file }: { file: FileNode }) => {
  const statusText = getStatusText(file.status, file.action)

  return (
    <div className="flex items-baseline justify-between py-1 text-[14px] ml-6">
      <span className={cn(
        'font-mono',
        file.status === 'completed' ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'
      )}>
        {file.name}
      </span>
      {statusText && (
        <span className="text-[11px] text-gray-400 dark:text-gray-500 lowercase ml-2">
          ({statusText})
        </span>
      )}
    </div>
  )
}

const CollapsibleGroup = ({ group }: { group: FileGroup }) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const completedCount = group.files.filter((f) => f.status === 'completed').length
  const totalCount = group.files.length

  return (
    <div className="mb-4">
      {/* Sub-section header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full text-left mb-1"
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-gray-900 dark:text-gray-100">{group.title}</span>
          <span className="text-[12px] text-gray-500 dark:text-gray-400">
            {completedCount}/{totalCount}
          </span>
        </div>
      </button>

      {/* File list */}
      {isExpanded && (
        <div>
          {group.files.map((file) => (
            <FileItem key={file.id} file={file} />
          ))}
        </div>
      )}
    </div>
  )
}

export function FileTree({ groups, className = '' }: FileTreeProps) {
  if (groups.length === 0) {
    return null
  }

  const totalFiles = groups.reduce((sum, group) => sum + group.files.length, 0)
  const completedFiles = groups.reduce(
    (sum, group) => sum + group.files.filter((f) => f.status === 'completed').length,
    0
  )
  const overallProgress = (completedFiles / totalFiles) * 100

  return (
    <div className={cn('rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm', className)}>
      {/* Main section header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[16px] font-semibold text-black dark:text-white">Files</h3>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-gray-500 dark:text-gray-400 font-normal">
            {completedFiles} of {totalFiles} completed
          </span>
          {/* Main progress bar */}
          <div className="w-16 h-[2px] bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gray-900 dark:bg-gray-300 transition-all duration-300"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Collapsible sub-sections */}
      <div>
        {groups.map((group) => (
          <CollapsibleGroup key={group.id} group={group} />
        ))}
      </div>
    </div>
  )
}