import type { Meta, StoryObj } from '@storybook/react'
import { FontWindowSection } from './FontWindowSection'

const noop = () => {}

const meta: Meta<typeof FontWindowSection> = {
  title: 'Settings/Appearance/FontWindowSection',
  component: FontWindowSection,
  args: {
    fontSize: '1',
    windowTitle: '',
    showTitlebar: true,
    alwaysVisible: false,
    panelButtonRadius: '10',
    chatLayout: 'tight',
    diffExpanded: false,
    heatmapEnabled: false,
    heatmapMode: 'relative',
    heatmapMin: '0',
    heatmapMax: '50',
    onSetFontSize: noop,
    onSetWindowTitle: noop,
    onToggleTitlebar: noop,
    onToggleAlwaysVisible: noop,
    onSetPanelButtonRadius: noop,
    onSetChatLayout: noop,
    onToggleDiffExpanded: noop,
    onToggleHeatmap: noop,
    onSetHeatmapMode: noop,
    onSetHeatmapMin: noop,
    onSetHeatmapMax: noop,
  },
}

export default meta
type Story = StoryObj<typeof FontWindowSection>

export const Default: Story = {}

export const LargeFontScale: Story = {
  args: {
    fontSize: '1.5',
  },
}

export const HeatmapFixed: Story = {
  args: {
    heatmapEnabled: true,
    heatmapMode: 'fixed',
    heatmapMin: '5',
    heatmapMax: '100',
  },
}

export const HeatmapRelative: Story = {
  args: {
    heatmapEnabled: true,
    heatmapMode: 'relative',
  },
}
