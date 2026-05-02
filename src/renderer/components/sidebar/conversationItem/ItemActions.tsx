import { memo } from 'react'
import type { Folder } from '../../../../shared/types'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuDivider,
} from '../../shared/ContextMenu'
import { MoveToFolderModal } from '../../shared/MoveToFolderModal'
import { ColorSwatches, ColorPicker } from '../../shared/ColorPicker'

/** Everything the actions layer needs about the target conversation. */
interface ItemActionsConversationProps {
  id: number
  title: string
  color: string | null
}

interface CommonProps {
  conversation: ItemActionsConversationProps
  folders: Folder[]
  menuPos: { x: number; y: number }
  showMenu: boolean
  showFolderModal: boolean
  showColorPicker: boolean
  colorPickerPos: { x: number; y: number }
  onCloseMenu: () => void
  onOpenColorPicker: (pos: { x: number; y: number }) => void
  onCloseColorPicker: () => void
  onOpenFolderModal: () => void
  onCloseFolderModal: () => void
}

interface SingleProps extends CommonProps {
  bulk: false
  onRename: () => void
  onDelete: () => void
  onExportMarkdown: () => void
  onExportJson: () => void
  onGenerateTitle: () => void
  onColorChange: (color: string | null) => void
  onMoveToFolder: (folderId: number | null) => void
}

interface BulkProps extends CommonProps {
  bulk: true
  selectedCount: number
  onBulkDelete: () => void
  onBulkColor: (color: string | null) => void
  onBulkMoveToFolder: (folderId: number | null) => void
}

type ItemActionsProps = SingleProps | BulkProps

/**
 * Renders the context menu (single or bulk), the Move-to-Folder modal, and
 * the full-color picker for a sidebar conversation item.
 * All callbacks are supplied by ConversationItem — this component has no
 * store access and no local state.
 */
export const ItemActions = memo(function ItemActions(props: ItemActionsProps) {
  const {
    conversation,
    folders,
    menuPos,
    showMenu,
    showFolderModal,
    showColorPicker,
    colorPickerPos,
    onCloseMenu,
    onOpenColorPicker,
    onCloseColorPicker,
    onOpenFolderModal,
    onCloseFolderModal,
  } = props

  return (
    <>
      {showMenu && props.bulk ? (
        <ContextMenu
          position={menuPos}
          onClose={onCloseMenu}
          className="min-w-[160px]"
          aria-label="Bulk conversation actions"
        >
          <ContextMenuItem onClick={() => { onCloseMenu(); onOpenFolderModal() }}>
            Move {props.selectedCount} to folder
          </ContextMenuItem>
          <ColorSwatches
            currentColor={null}
            onColorChange={(c) => { props.onBulkColor(c); onCloseMenu() }}
            onOpenPicker={() => {
              onOpenColorPicker(menuPos)
              onCloseMenu()
            }}
          />
          <ContextMenuDivider />
          <ContextMenuItem
            danger
            onClick={() => { onCloseMenu(); props.onBulkDelete() }}
          >
            Delete {props.selectedCount} conversations
          </ContextMenuItem>
        </ContextMenu>
      ) : showMenu ? (
        <ContextMenu
          position={menuPos}
          onClose={onCloseMenu}
          className="min-w-[160px]"
          aria-label="Conversation actions"
        >
          <ContextMenuItem
            onClick={() => { onCloseMenu(); (props as SingleProps).onRename() }}
            aria-label="Rename conversation"
          >
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={() => { onCloseMenu(); onOpenFolderModal() }}>
            Move to folder
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => (props as SingleProps).onExportMarkdown()}
            aria-label="Export conversation as Markdown"
          >
            Export as Markdown
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => (props as SingleProps).onExportJson()}
            aria-label="Export conversation as JSON"
          >
            Export as JSON
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => (props as SingleProps).onGenerateTitle()}
            aria-label="Generate title with AI"
          >
            Generate Title
          </ContextMenuItem>
          <ContextMenuDivider />
          <ColorSwatches
            currentColor={conversation.color}
            onColorChange={(c) => { (props as SingleProps).onColorChange(c); onCloseMenu() }}
            onOpenPicker={() => {
              onOpenColorPicker(menuPos)
              onCloseMenu()
            }}
          />
          <ContextMenuDivider />
          <ContextMenuItem
            danger
            onClick={() => (props as SingleProps).onDelete()}
            aria-label="Delete conversation"
          >
            Delete
          </ContextMenuItem>
        </ContextMenu>
      ) : null}

      {showFolderModal && (
        <MoveToFolderModal
          folders={folders}
          onSelect={(folderId) => {
            if (props.bulk) {
              props.onBulkMoveToFolder(folderId)
            } else {
              props.onMoveToFolder(folderId)
            }
            onCloseFolderModal()
          }}
          onClose={onCloseFolderModal}
          title={
            props.bulk
              ? `Move ${props.selectedCount} to folder`
              : 'Move to folder'
          }
        />
      )}

      {showColorPicker && (
        <ColorPicker
          currentColor={conversation.color}
          onColorChange={(c) => {
            if (props.bulk) {
              props.onBulkColor(c)
            } else {
              props.onColorChange(c)
            }
          }}
          onClose={onCloseColorPicker}
          position={colorPickerPos}
        />
      )}
    </>
  )
})
