import type { Meta, StoryObj } from '@storybook/react'
import { ItemActions } from './ItemActions'
import type { Folder } from '../../../../shared/types'

const noop = () => {}

const sampleFolders: Folder[] = [
  {
    id: 1,
    name: 'Work',
    parent_id: null,
    position: 0,
    is_default: 0,
    ai_overrides: null,
    default_cwd: null,
    color: '#3b82f6',
    created_at: '2024-01-01T00:00:00',
    updated_at: '2024-01-01T00:00:00',
  },
  {
    id: 2,
    name: 'Personal',
    parent_id: null,
    position: 1,
    is_default: 0,
    ai_overrides: null,
    default_cwd: null,
    color: '#22c55e',
    created_at: '2024-01-01T00:00:00',
    updated_at: '2024-01-01T00:00:00',
  },
]

const sampleConversation = { id: 42, title: 'Refactor the streaming pipeline', color: null }

const meta: Meta<typeof ItemActions> = {
  title: 'Sidebar/ConversationItem/ItemActions',
  component: ItemActions,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof ItemActions>

/** Single-conversation context menu open at a fixed position. */
export const SingleMenu: Story = {
  args: {
    bulk: false,
    conversation: sampleConversation,
    folders: sampleFolders,
    menuPos: { x: 40, y: 60 },
    showMenu: true,
    showFolderModal: false,
    showColorPicker: false,
    colorPickerPos: { x: 0, y: 0 },
    onCloseMenu: noop,
    onOpenColorPicker: noop,
    onCloseColorPicker: noop,
    onOpenFolderModal: noop,
    onCloseFolderModal: noop,
    onRename: noop,
    onDelete: noop,
    onExportMarkdown: noop,
    onExportJson: noop,
    onGenerateTitle: noop,
    onColorChange: noop,
    onMoveToFolder: noop,
  },
}

/** Bulk context menu open (3 conversations selected). */
export const BulkMenu: Story = {
  args: {
    bulk: true,
    conversation: sampleConversation,
    folders: sampleFolders,
    selectedCount: 3,
    menuPos: { x: 40, y: 60 },
    showMenu: true,
    showFolderModal: false,
    showColorPicker: false,
    colorPickerPos: { x: 0, y: 0 },
    onCloseMenu: noop,
    onOpenColorPicker: noop,
    onCloseColorPicker: noop,
    onOpenFolderModal: noop,
    onCloseFolderModal: noop,
    onBulkDelete: noop,
    onBulkColor: noop,
    onBulkMoveToFolder: noop,
  },
}

/** Move-to-folder modal open (single conversation). */
export const FolderModal: Story = {
  args: {
    bulk: false,
    conversation: sampleConversation,
    folders: sampleFolders,
    menuPos: { x: 0, y: 0 },
    showMenu: false,
    showFolderModal: true,
    showColorPicker: false,
    colorPickerPos: { x: 0, y: 0 },
    onCloseMenu: noop,
    onOpenColorPicker: noop,
    onCloseColorPicker: noop,
    onOpenFolderModal: noop,
    onCloseFolderModal: noop,
    onRename: noop,
    onDelete: noop,
    onExportMarkdown: noop,
    onExportJson: noop,
    onGenerateTitle: noop,
    onColorChange: noop,
    onMoveToFolder: noop,
  },
}
