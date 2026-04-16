import { useEffect, useCallback, useState, useRef } from 'react'
import { useConversationsStore } from '../../stores/conversationsStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { SearchBar } from './SearchBar'
import { SidebarTree } from './FolderTree'
import type { Folder, SortCriterion, SortDirection } from '../../../shared/types'
import { MoveToFolderModal } from '../shared/MoveToFolderModal'

export function Sidebar({ onOpenSettings, onOpenScheduler }: { onOpenSettings?: () => void; onOpenScheduler?: () => void }) {
  const { loadConversations, loadFolders, createConversation, createFolder, selectedIds, clearSelection, deleteSelected, moveSelectedToFolder, folders } =
    useConversationsStore()

  useEffect(() => {
    loadConversations()
    loadFolders()
  }, [loadConversations, loadFolders])

  const handleNewConversation = useCallback(() => {
    createConversation()
  }, [createConversation])

  const handleNewFolder = useCallback(() => {
    createFolder('New Folder')
  }, [createFolder])

  const handleImport = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      await useConversationsStore.getState().importConversation(text)
    }
    input.click()
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center px-3 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-bg)' }}
      >
        <div className="flex flex-1 items-center justify-between mobile:gap-2">
          <SortDropdown />
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              title="Settings (Ctrl+,)"
              className="p-1 mobile:w-11 mobile:h-11 mobile:flex mobile:items-center mobile:justify-center mobile:p-0 rounded transition-colors hover:bg-[var(--color-bg)]"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label="Open settings"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          )}
          {onOpenScheduler && (
            <button
              onClick={onOpenScheduler}
              title="Scheduled Tasks"
              className="p-1 mobile:w-11 mobile:h-11 mobile:flex mobile:items-center mobile:justify-center mobile:p-0 rounded transition-colors hover:bg-[var(--color-bg)]"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label="Open scheduled tasks"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>
          )}
          <button
            onClick={handleImport}
            title="Import conversation"
            className="p-1 mobile:w-11 mobile:h-11 mobile:flex mobile:items-center mobile:justify-center mobile:p-0 rounded transition-colors hover:bg-[var(--color-bg)]"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="Import conversation"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
          </button>
          <button
            onClick={handleNewFolder}
            title="New folder"
            className="p-1 mobile:w-11 mobile:h-11 mobile:flex mobile:items-center mobile:justify-center mobile:p-0 rounded transition-colors hover:bg-[var(--color-bg)]"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="Create new folder"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
              />
            </svg>
          </button>
          <button
            onClick={handleNewConversation}
            title="New conversation (Ctrl+N)"
            className="p-1 mobile:w-11 mobile:h-11 mobile:flex mobile:items-center mobile:justify-center mobile:p-0 rounded transition-colors hover:bg-[var(--color-bg)]"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="Create new conversation"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <SearchBar />

      {/* Unified folder tree + conversations */}
      <SidebarTree />

      {/* Selection action bar */}
      {selectedIds.size > 0 && (
        <SelectionBar
          count={selectedIds.size}
          folders={folders}
          onClear={clearSelection}
          onDelete={deleteSelected}
          onMoveToFolder={moveSelectedToFolder}
        />
      )}
    </div>
  )
}

function SelectionBar({ count, folders, onClear, onDelete, onMoveToFolder }: {
  count: number
  folders: Folder[]
  onClear: () => void
  onDelete: () => Promise<void>
  onMoveToFolder: (folderId: number | null) => Promise<void>
}) {
  const [showFolderModal, setShowFolderModal] = useState(false)

  return (
    <>
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0 text-sm"
        style={{
          borderTop: '1px solid var(--color-bg)',
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text)',
        }}
      >
        <span className="flex-1 truncate" style={{ color: 'var(--color-text-muted)' }}>
          {count} selected
        </span>
        <button
          onClick={() => setShowFolderModal(true)}
          className="p-1.5 rounded transition-colors hover:bg-[var(--color-bg)]"
          style={{ color: 'var(--color-text-muted)' }}
          title="Move to folder"
          aria-label="Move selected to folder"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </button>
        <button
          onClick={() => {
            if (confirm(`Delete ${count} conversations?`)) onDelete()
          }}
          className="p-1.5 rounded transition-colors hover:bg-[var(--color-bg)]"
          style={{ color: 'var(--color-error)' }}
          title="Delete selected"
          aria-label="Delete selected conversations"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
        <button
          onClick={onClear}
          className="p-1.5 rounded transition-colors hover:bg-[var(--color-bg)]"
          style={{ color: 'var(--color-text-muted)' }}
          title="Clear selection (Esc)"
          aria-label="Clear selection"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {showFolderModal && (
        <MoveToFolderModal
          folders={folders}
          onSelect={(folderId) => { setShowFolderModal(false); onMoveToFolder(folderId) }}
          onClose={() => setShowFolderModal(false)}
          title={`Move ${count} to folder`}
        />
      )}
    </>
  )
}

const SORT_CRITERIA: { value: SortCriterion; label: string }[] = [
  { value: 'updated_at', label: 'Last message date' },
  { value: 'message_count', label: 'Message count' },
  { value: 'title', label: 'Alphabetical' },
]

function SortDropdown() {
  const { settings, setSetting } = useSettingsStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const criterion = (settings.sort_criterion as SortCriterion) || 'updated_at'
  const direction = (settings.sort_direction as SortDirection) || 'desc'

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleCriterionChange = (value: SortCriterion) => {
    setSetting('sort_criterion', value)
    setOpen(false)
  }

  const toggleDirection = () => {
    setSetting('sort_direction', direction === 'asc' ? 'desc' : 'asc')
  }

  // Check if non-default sort is active
  const isCustomSort = criterion !== 'updated_at' || direction !== 'desc'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Sort conversations"
        className="p-1 mobile:w-11 mobile:h-11 mobile:flex mobile:items-center mobile:justify-center mobile:p-0 rounded transition-colors hover:bg-[var(--color-bg)]"
        style={{ color: isCustomSort ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
        aria-label="Sort conversations"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 rounded-lg shadow-lg py-1 text-sm min-w-[180px] z-50"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-bg)',
          }}
        >
          {SORT_CRITERIA.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleCriterionChange(opt.value)}
              className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-bg)] flex items-center justify-between"
              style={{
                backgroundColor: 'transparent',
                color: criterion === opt.value ? 'var(--color-primary)' : 'var(--color-text)',
              }}
            >
              <span>{opt.label}</span>
              {criterion === opt.value && <span className="text-xs">✓</span>}
            </button>
          ))}
          <div
            className="mx-2 my-1"
            style={{ borderTop: '1px solid var(--color-bg)' }}
          />
          <button
            onClick={toggleDirection}
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-bg)] flex items-center gap-2"
            style={{ backgroundColor: 'transparent', color: 'var(--color-text)' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              style={{ transform: direction === 'asc' ? 'rotate(180deg)' : 'none' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            <span>{direction === 'asc' ? 'Ascending' : 'Descending'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
