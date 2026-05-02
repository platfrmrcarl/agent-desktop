import { AIOverridesPopover } from '../../components/settings/AIOverridesPopover'
import { ExtensionDialog } from '../../components/extensions/ExtensionDialog'
import { ExtensionToast } from '../../components/extensions/ExtensionToast'
import { ExtensionWidget } from '../../components/extensions/ExtensionWidget'
import { usePiExtensionUIStore } from '../../stores/piExtensionUIStore'
import type { AIOverrides } from '../../../shared/types'
import type { PiUIWidget } from '../../../shared/piUITypes'

/**
 * AI overrides popover — controlled visibility from parent. Parent owns
 * the show/hide flag because the trigger button lives in the chat header
 * (rendered by ChatLayout's surrounding orchestrator). Receives all the
 * already-resolved cascade derivations as props (convOverrides,
 * inheritedValues, inheritedSources, mcpServers).
 */
interface ChatOverridesPopoverProps {
  open: boolean
  convOverrides: AIOverrides
  inheritedValues: Record<string, string>
  inheritedSources: Record<string, string>
  mcpServers: { name: string }[]
  onSave: (overrides: AIOverrides) => void
  onClose: () => void
}

export function ChatOverridesPopover({
  open, convOverrides, inheritedValues, inheritedSources, mcpServers, onSave, onClose,
}: ChatOverridesPopoverProps) {
  if (!open) return null
  return (
    <AIOverridesPopover
      overrides={convOverrides}
      inheritedValues={inheritedValues}
      inheritedSources={inheritedSources}
      title="Conversation AI Settings"
      mcpServers={mcpServers}
      onSave={onSave}
      onClose={onClose}
    />
  )
}

/**
 * Pi extension overlays — dialog + toast + widgets.
 *
 * Reads the piExtensionUIStore directly here (rather than receiving 5+ slices
 * as props) to preserve granular selector locality. The parent only re-renders
 * for chat state, while these overlays only re-render when their specific
 * extension state changes.
 */
export function ChatExtensionOverlays() {
  const activeDialog = usePiExtensionUIStore((s) => s.activeDialog)
  const notifications = usePiExtensionUIStore((s) => s.notifications)
  const dismissDialog = usePiExtensionUIStore((s) => s.dismissDialog)
  const removeNotification = usePiExtensionUIStore((s) => s.removeNotification)

  return (
    <>
      {activeDialog && (
        <ExtensionDialog
          dialog={activeDialog}
          onRespond={(response) => {
            window.agent.pi.respondUI(response.id, response)
            dismissDialog()
          }}
        />
      )}
      {notifications.length > 0 && (
        <ExtensionToast notifications={notifications} onDismiss={removeNotification} />
      )}
    </>
  )
}

/**
 * Inline widgets (above- or below-editor placement). Filtered slice of the
 * store; rendered as flex children inside ChatLayout's main column, so this
 * component just emits the row markup.
 */
interface ChatExtensionWidgetsProps {
  placement: 'aboveEditor' | 'belowEditor'
}

export function ChatExtensionWidgets({ placement }: ChatExtensionWidgetsProps) {
  const widgets = usePiExtensionUIStore((s) => s.widgets)
  const filtered = Object.values(widgets).filter((w: PiUIWidget) => w.placement === placement)
  if (filtered.length === 0) return null
  const padClass = placement === 'aboveEditor' ? 'flex-shrink-0 px-4 pt-1' : 'flex-shrink-0 px-4 pt-1 pb-1'
  return (
    <>
      {filtered.map((w) => (
        <div key={w.key} className={padClass}>
          <ExtensionWidget widget={w} />
        </div>
      ))}
    </>
  )
}
