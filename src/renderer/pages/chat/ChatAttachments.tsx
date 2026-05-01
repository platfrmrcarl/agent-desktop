import { useCallback } from 'react'
import { FileDropZone } from '../../components/file-attach/FileDropZone'
import { FileUploadButton } from '../../components/file-attach/FileUploadButton'
import { AttachmentPreview } from '../../components/file-attach/AttachmentPreview'
import type { Attachment } from '../../../shared/types'

/**
 * Presentational wrapper for chat attachment UI.
 *
 * State stays in the orchestrator (ChatView) because `attachments` is consumed
 * by handleSend / handleQueue inside ChatLayout — colocating the state with the
 * preview would force prop-drilling callbacks back up. This component renders
 * the drop zone, the upload button, and the preview row; all behaviour is
 * driven by props.
 */

export interface ChatAttachmentsDropZoneProps {
  children: React.ReactNode
  onFilesDropped: (files: Attachment[]) => void
}

export function ChatAttachmentsDropZone({ children, onFilesDropped }: ChatAttachmentsDropZoneProps) {
  return <FileDropZone onFilesDropped={onFilesDropped}>{children}</FileDropZone>
}

export interface ChatAttachmentsPreviewProps {
  attachments: Attachment[]
  onRemove: (index: number) => void
}

export function ChatAttachmentsPreview({ attachments, onRemove }: ChatAttachmentsPreviewProps) {
  if (attachments.length === 0) return null
  return (
    <div className="flex-shrink-0 border-t" style={{ borderColor: 'var(--color-surface)' }}>
      <AttachmentPreview attachments={attachments} onRemove={onRemove} />
    </div>
  )
}

export interface ChatAttachmentsUploadProps {
  onFilesSelected: (files: Attachment[]) => void
}

export function ChatAttachmentsUpload({ onFilesSelected }: ChatAttachmentsUploadProps) {
  return <FileUploadButton onFilesSelected={onFilesSelected} />
}

/**
 * Hook returning paste handler that saves clipboard images via window.agent
 * and pushes them into the attachments list. Centralised here so ChatLayout
 * can wire it into MessageInput's onPaste without re-implementing the logic.
 */
export function useAttachmentPaste(addAttachments: (atts: Attachment[]) => void) {
  return useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const fileItems: DataTransferItem[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file') fileItems.push(item)
    }
    if (fileItems.length === 0) return

    e.preventDefault()

    const collected: Attachment[] = []
    for (const item of fileItems) {
      const blob = item.getAsFile()
      if (!blob) continue
      try {
        const buffer = await blob.arrayBuffer()
        const path = await window.agent.files.savePastedFile(new Uint8Array(buffer), blob.type)
        const ext = blob.type.split('/')[1] || 'png'
        const name = blob.name && blob.name !== 'image.png'
          ? blob.name
          : `pasted-${Date.now()}.${ext}`
        collected.push({ name, path, type: blob.type, size: blob.size })
      } catch (err) {
        console.error('Failed to save pasted file:', err)
      }
    }
    if (collected.length > 0) addAttachments(collected)
  }, [addAttachments])
}
