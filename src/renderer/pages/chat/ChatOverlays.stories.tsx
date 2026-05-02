import type { Meta, StoryObj } from '@storybook/react'
import { ChatExtensionWidgets } from './ChatOverlays'
import { usePiExtensionUIStore } from '../../stores/piExtensionUIStore'
import type { PiUIWidget } from '../../../shared/piUITypes'
import { useEffect } from 'react'

const widgetAbove: PiUIWidget = {
  key: 'demo:above',
  placement: 'aboveEditor',
  content: ['model: claude-3-5-sonnet', 'token-budget: 80% used'],
}
const widgetBelow: PiUIWidget = {
  key: 'demo:below',
  placement: 'belowEditor',
  content: ['indexing 142 files...', 'last hook: PreToolUse@Bash → allow'],
}

function PrimedWidgetsHost({ placement }: { placement: 'aboveEditor' | 'belowEditor' }) {
  // Prime the Pi extension store with two demo widgets — one in each placement
  // — so we can exercise the placement filter from the public component.
  useEffect(() => {
    const store = usePiExtensionUIStore.getState() as {
      widgets: Record<string, PiUIWidget>
    }
    store.widgets[widgetAbove.key] = widgetAbove
    store.widgets[widgetBelow.key] = widgetBelow
    // Force a notify by replacing the widgets map.
    usePiExtensionUIStore.setState({ widgets: { ...store.widgets } })
  }, [])
  return <ChatExtensionWidgets placement={placement} />
}

const meta: Meta<typeof PrimedWidgetsHost> = {
  title: 'Pages/Chat/Overlays',
  component: PrimedWidgetsHost,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof PrimedWidgetsHost>

/**
 * Widgets pinned above the editor — typical "context summary" use case.
 * Renders one of the two seeded widgets (aboveEditor) and skips the other.
 */
export const WidgetsAboveEditor: Story = {
  args: { placement: 'aboveEditor' },
}

/**
 * Widgets pinned below the editor — typical "background activity" feed.
 * Renders the belowEditor widget and skips the aboveEditor one.
 */
export const WidgetsBelowEditor: Story = {
  args: { placement: 'belowEditor' },
}

/**
 * Empty state: the store is reset before render so the placement filter
 * yields zero widgets and the component returns null.
 */
export const NoWidgets: Story = {
  render: () => {
    // Reset store so no widgets are present.
    usePiExtensionUIStore.setState({ widgets: {} })
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
        No extension widgets registered — both placements render nothing.
      </div>
    )
  },
}
