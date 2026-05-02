import { useState, useRef, useEffect, useCallback, memo } from 'react'
import type { Conversation, Folder } from '../../../shared/types'
import { useConversationsStore } from '../../stores/conversationsStore'
import { useShallow } from 'zustand/react/shallow'
import { useSchedulerStore } from '../../stores/schedulerStore'
import { useMobileMode } from '../../hooks/useMobileMode'
import { parseDbTimestamp } from '../../utils/dbTime'
import { ItemPreview } from './conversationItem/ItemPreview'
import { ItemActions } from './conversationItem/ItemActions'

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function invertHex(hex: string): string {
  const r = 255 - parseInt(hex.slice(1, 3), 16)
  const g = 255 - parseInt(hex.slice(3, 5), 16)
  const b = 255 - parseInt(hex.slice(5, 7), 16)
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * Returns a dark or light text color that ensures contrast against the given
 * hex background color, using the WCAG relative luminance formula.
 * Used when a card has an explicit background color (effectiveColor) so that
 * the text is always readable regardless of the current theme (dark/light).
 */
function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  // sRGB linearization
  const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
  // Light background → dark text; dark background → light text
  return L > 0.35 ? '#1a1a1a' : '#f0f0f0'
}

// ---------------------------------------------------------------------------
// Store selector
// ---------------------------------------------------------------------------

interface Props {
  conversation: Conversation & { folder_name?: string }
  isActive: boolean
  isSelected: boolean
  visibleOrder: number[]
  depth?: number
  folderColor?: string | null
}

// Stable action selector — useShallow prevents new object reference on every render
const useActions = () => useConversationsStore(useShallow((s) => ({
  setActiveConversation: s.setActiveConversation,
  updateConversation: s.updateConversation,
  deleteConversation: s.deleteConversation,
  moveToFolder: s.moveToFolder,
  exportConversation: s.exportConversation,
  handleSelect: s.handleSelect,
  deleteSelected: s.deleteSelected,
  moveSelectedToFolder: s.moveSelectedToFolder,
  colorSelected: s.colorSelected,
  clearSelection: s.clearSelection,
})))

export const ConversationItem = memo(function ConversationItem({ conversation, isActive, isSelected, visibleOrder, depth = 0, folderColor }: Props) {
  const isMobile = useMobileMode()

  // Granular data selectors — only re-render when these specific values change
  const folders = useConversationsStore((s) => s.folders)
  const selectedIds = useConversationsStore((s) => s.selectedIds)
  const {
    updateConversation, deleteConversation, moveToFolder,
    exportConversation, handleSelect, deleteSelected, moveSelectedToFolder,
    colorSelected,
  } = useActions()

  // O(1) scheduled task lookup via derived Set (Task 2.5)
  const hasScheduledTask = useSchedulerStore((s) => s.taskConversationIds.has(conversation.id))

  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(conversation.title)
  const [showMenu, setShowMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [colorPickerPos, setColorPickerPos] = useState({ x: 0, y: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isRenaming])

  const closeMenu = useCallback(() => {
    setShowMenu(false)
  }, [])

  const openMenuAt = useCallback((x: number, y: number) => {
    setMenuPos({ x, y })
    setShowMenu(true)
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    openMenuAt(e.clientX, e.clientY)
  }, [openMenuAt])

  const handleThreeDotClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    openMenuAt(rect.left, rect.bottom + 4)
  }, [openMenuAt])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return
    const touch = e.touches[0]
    const x = touch.clientX
    const y = touch.clientY
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null
      openMenuAt(x, y)
    }, 500)
  }, [isMobile, openMenuAt])

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== conversation.title) {
      updateConversation(conversation.id, { title: trimmed })
    }
    setIsRenaming(false)
  }, [renameValue, conversation.title, conversation.id, updateConversation])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') handleRenameSubmit()
    if (e.key === 'Escape') {
      setRenameValue(conversation.title)
      setIsRenaming(false)
    }
  }, [handleRenameSubmit, conversation.title])

  const handleDelete = useCallback(() => {
    setShowMenu(false)
    if (confirm(`Delete "${conversation.title}"?`)) {
      deleteConversation(conversation.id)
    }
  }, [conversation.title, conversation.id, deleteConversation])

  const handleExport = useCallback(async (format: 'markdown' | 'json') => {
    setShowMenu(false)
    const data = await exportConversation(conversation.id, format)
    const ext = format === 'markdown' ? 'md' : 'json'
    const blob = new Blob([data], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${conversation.title}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }, [conversation.id, conversation.title, exportConversation])

  const handleMoveToFolder = useCallback((folderId: number | null) => {
    moveToFolder(conversation.id, folderId)
  }, [conversation.id, moveToFolder])

  const handleGenerateTitle = useCallback(async () => {
    setShowMenu(false)
    await window.agent.conversations.generateTitle(conversation.id)
  }, [conversation.id])

  const handleColorChange = useCallback((color: string | null) => {
    updateConversation(conversation.id, { color })
  }, [conversation.id, updateConversation])

  const handleBulkDelete = useCallback(() => {
    if (confirm(`Delete ${selectedIds.size} conversations?`)) {
      deleteSelected()
    }
  }, [selectedIds.size, deleteSelected])

  const handleBulkMoveToFolder = useCallback((folderId: number | null) => {
    moveSelectedToFolder(folderId)
  }, [moveSelectedToFolder])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault()
      handleSelect(conversation.id, e.ctrlKey || e.metaKey, e.shiftKey, visibleOrder)
    } else {
      handleSelect(conversation.id, false, false, visibleOrder)
    }
  }, [conversation.id, handleSelect, visibleOrder])

  const timeAgo = formatTimeAgo(conversation.updated_at)
  const effectiveColor = conversation.color || folderColor || null
  // Only apply contrast-based text color when the conversation has its own color
  // (stronger tint). Inherited folder/heatmap colors use a very light 8% mix,
  // so the theme text color remains readable — forcing contrast on the pure color
  // wrongly picks dark text on a still-dark background.
  const hasOwnColor = !!conversation.color
  const cardTextColor = hasOwnColor && effectiveColor ? getContrastColor(effectiveColor) : undefined
  const cardTextMutedColor = cardTextColor ? cardTextColor + 'aa' : undefined

  const isBulk = isSelected && selectedIds.size > 1

  const actionsProps = isBulk
    ? ({
        bulk: true as const,
        conversation: { id: conversation.id, title: conversation.title, color: conversation.color },
        folders: folders as Folder[],
        selectedCount: selectedIds.size,
        menuPos,
        showMenu,
        showFolderModal,
        showColorPicker,
        colorPickerPos,
        onCloseMenu: closeMenu,
        onOpenColorPicker: (pos: { x: number; y: number }) => {
          setColorPickerPos(pos)
          setShowColorPicker(true)
        },
        onCloseColorPicker: () => setShowColorPicker(false),
        onOpenFolderModal: () => setShowFolderModal(true),
        onCloseFolderModal: () => setShowFolderModal(false),
        onBulkDelete: handleBulkDelete,
        onBulkColor: (c: string | null) => colorSelected(c),
        onBulkMoveToFolder: handleBulkMoveToFolder,
      })
    : ({
        bulk: false as const,
        conversation: { id: conversation.id, title: conversation.title, color: conversation.color },
        folders: folders as Folder[],
        menuPos,
        showMenu,
        showFolderModal,
        showColorPicker,
        colorPickerPos,
        onCloseMenu: closeMenu,
        onOpenColorPicker: (pos: { x: number; y: number }) => {
          setColorPickerPos(pos)
          setShowColorPicker(true)
        },
        onCloseColorPicker: () => setShowColorPicker(false),
        onOpenFolderModal: () => setShowFolderModal(true),
        onCloseFolderModal: () => setShowFolderModal(false),
        onRename: () => setIsRenaming(true),
        onDelete: handleDelete,
        onExportMarkdown: () => handleExport('markdown'),
        onExportJson: () => handleExport('json'),
        onGenerateTitle: handleGenerateTitle,
        onColorChange: handleColorChange,
        onMoveToFolder: handleMoveToFolder,
      })

  return (
    <>
      <div
        {...(!isMobile ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            // If this item is part of a multi-selection, drag all selected IDs
            const ids = isSelected && selectedIds.size > 1
              ? JSON.stringify([...selectedIds])
              : String(conversation.id)
            e.dataTransfer.setData('text/plain', ids)
            e.dataTransfer.effectAllowed = 'move'
            e.currentTarget.classList.add('sidebar-dragging')
          },
          onDragEnd: (e: React.DragEvent) => {
            e.currentTarget.classList.remove('sidebar-dragging')
          },
          onDoubleClick: () => setIsRenaming(true),
        } : {})}
        onClick={handleClick}
        onContextMenu={!isMobile ? handleContextMenu : undefined}
        onTouchStart={handleTouchStart}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        className={`group py-2 cursor-pointer transition-colors rounded mx-1 ${!isActive && !isSelected ? 'hover:bg-[var(--color-bg)]' : ''}`}
        style={{
          paddingLeft: `${depth * 16 + 12}px`,
          paddingRight: '12px',
          backgroundColor: isActive
            ? (effectiveColor ? `color-mix(in srgb, ${effectiveColor} 12%, var(--color-deep))` : 'var(--color-deep)')
            : isSelected ? 'var(--color-bg)'
            : effectiveColor ? `color-mix(in srgb, ${effectiveColor} 8%, transparent)`
            : 'transparent',
          borderLeft: isActive ? '2px solid var(--color-primary)' : isSelected ? '2px solid var(--color-text-muted)' : '2px solid transparent',
          ...(isActive && effectiveColor ? {
            boxShadow: `0 0 8px 1px color-mix(in srgb, ${invertHex(effectiveColor)} 40%, transparent)`,
          } : {}),
        }}
        role="treeitem"
        aria-selected={isActive}
        aria-label={`Conversation: ${conversation.title}`}
      >
        {isRenaming ? (
          <input
            ref={inputRef}
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="w-full text-sm mobile:text-base px-1 py-0.5 rounded outline-none"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-primary)',
            }}
            aria-label="Rename conversation"
          />
        ) : (
          <ItemPreview
            title={conversation.title}
            timeAgo={timeAgo}
            hasScheduledTask={hasScheduledTask}
            textColor={cardTextColor}
            mutedColor={cardTextMutedColor}
            onThreeDotClick={handleThreeDotClick}
          />
        )}
      </div>

      <ItemActions {...actionsProps} />
    </>
  )
})

function formatTimeAgo(dateStr: string): string {
  const then = parseDbTimestamp(dateStr)
  const diffMs = Date.now() - then.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return then.toLocaleDateString()
}
