import { useState, useCallback } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { BubbleActions } from './BubbleActions'
import { useMobileMode } from '../../../hooks/useMobileMode'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useTtsStore } from '../../../stores/ttsStore'
import { parseDbTimestamp } from '../../../utils/dbTime'
import type { Message, CreateScheduledTask } from '../../../../shared/types'

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = parseDbTimestamp(dateStr).getTime()
  const diffSec = Math.floor((now - then) / 1000)

  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

export interface UserBubbleProps {
  message: Message
  isLast: boolean
  effectiveTtsResponseMode?: string
  onEdit?: (messageId: number, content: string) => void
  onFork?: (messageId: number) => void
}

export function UserBubble({ message, isLast, effectiveTtsResponseMode, onEdit, onFork }: UserBubbleProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [showActions, setShowActions] = useState(false)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [copiedPos, setCopiedPos] = useState<{ x: number; y: number } | null>(null)
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [selectedText, setSelectedText] = useState('')

  const mobile = useMobileMode()
  const sendOnEnter = useSettingsStore((s) => s.settings.sendOnEnter ?? 'true')
  const ttsProvider = useSettingsStore((s) => s.settings.tts_provider)
  const globalTtsResponseMode = useSettingsStore((s) => s.settings.tts_responseMode)
  const speakingMessageId = useTtsStore((s) => s.speakingMessageId)
  const { playMessage, stopPlayback } = useTtsStore()

  const isSpeakingThis = speakingMessageId === message.id
  const ttsMode = effectiveTtsResponseMode ?? globalTtsResponseMode
  const showTtsButton = !!ttsProvider && ttsProvider !== 'off' && !!ttsMode && ttsMode !== 'off'

  const handleCopy = useCallback(async (e?: React.MouseEvent) => {
    await navigator.clipboard.writeText(message.content)
    const x = e?.clientX ?? 0
    const y = e?.clientY ?? 0
    setCopiedPos({ x, y })
    setTimeout(() => setCopiedPos(null), 1500)
  }, [message.content])

  const handleStartEdit = useCallback(() => {
    setEditContent(message.content)
    setIsEditing(true)
  }, [message.content])

  const handleSaveEdit = useCallback(() => {
    if (editContent.trim() && onEdit) {
      onEdit(message.id, editContent.trim())
    }
    setIsEditing(false)
  }, [editContent, message.id, onEdit])

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditContent(message.content)
  }, [message.content])

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
      return
    }
    if (sendOnEnter === 'false') {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSaveEdit()
      }
    } else {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSaveEdit()
      }
    }
  }, [sendOnEnter, handleSaveEdit, handleCancelEdit])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isEditing) return
    e.preventDefault()
    const sel = window.getSelection()
    setSelectedText(sel && sel.toString().trim() ? sel.toString() : '')
    setContextMenuPos({ x: e.clientX, y: e.clientY })
    setShowContextMenu(true)
  }, [isEditing])

  const handleSaveTask = useCallback(async (data: CreateScheduledTask) => {
    await window.agent.scheduler.create(data)
  }, [])

  const handleRetry = onEdit ? () => onEdit(message.id, message.content) : undefined

  return (
    <div
      className="flex min-w-0 justify-end mb-4 group"
      onMouseEnter={mobile ? undefined : () => setShowActions(true)}
      onMouseLeave={mobile ? undefined : () => setShowActions(false)}
      onClick={mobile ? () => { if (!isEditing) setShowActions(prev => !prev) } : undefined}
    >
      <div
        className={`rounded-lg px-4 py-3 relative max-w-[80%] compact:max-w-[95%] ${
          isEditing ? 'w-full' : ''
        } rounded-br-sm`}
        style={{
          backgroundColor: 'var(--color-deep)',
          color: 'var(--color-text)',
        }}
        onContextMenu={handleContextMenu}
      >
        <div
          className="text-xs font-medium mb-1"
          style={{ color: 'var(--color-primary)' }}
        >
          You
        </div>

        {isEditing ? (
          <div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleEditKeyDown}
              className="w-full rounded p-2 resize-none text-sm mobile:text-base"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-text-muted)',
              }}
              rows={Math.max(3, editContent.split('\n').length + 1)}
              autoFocus
            />
            <div className="flex gap-2 mt-2 mobile:flex-wrap">
              <button
                onClick={handleSaveEdit}
                className="rounded font-medium bg-primary text-contrast px-3 py-1 text-xs mobile:px-4 mobile:py-3 mobile:text-sm"
              >
                Save & Send
              </button>
              <button
                onClick={handleCancelEdit}
                className="rounded px-3 py-1 text-xs mobile:px-4 mobile:py-3 mobile:text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm">
            <MarkdownRenderer content={message.content} />
          </div>
        )}

        <div
          className="text-[0.625rem] mt-2 select-none"
          style={{ color: 'var(--color-text-muted)' }}
          title={parseDbTimestamp(message.created_at).toLocaleString()}
        >
          {formatRelativeTime(message.created_at)}
        </div>

        <BubbleActions
          message={message}
          isUser={true}
          isLast={isLast}
          showActions={showActions}
          isSpeakingThis={isSpeakingThis}
          showTtsButton={showTtsButton}
          isEditing={isEditing}
          onCopy={handleCopy}
          copiedPos={copiedPos}
          onPlayTts={() => playMessage(message.id, message.content, message.conversation_id)}
          onStopTts={stopPlayback}
          onStartEdit={onEdit ? handleStartEdit : undefined}
          onRetry={handleRetry}
          onFork={onFork}
          showTaskForm={showTaskForm}
          onOpenTaskForm={() => setShowTaskForm(true)}
          onCloseTaskForm={() => setShowTaskForm(false)}
          onSaveTask={handleSaveTask}
          showContextMenu={showContextMenu}
          contextMenuPos={contextMenuPos}
          selectedText={selectedText}
          onCloseContextMenu={() => setShowContextMenu(false)}
          onCopySelection={async (text, e) => {
            await navigator.clipboard.writeText(text)
            setCopiedPos({ x: e.clientX, y: e.clientY })
            setTimeout(() => setCopiedPos(null), 1500)
          }}
        />
      </div>
    </div>
  )
}
