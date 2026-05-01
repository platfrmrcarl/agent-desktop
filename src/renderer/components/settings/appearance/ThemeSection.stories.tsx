import type { Meta, StoryObj } from '@storybook/react'
import type { ThemeFile } from '../../../../core/types/types'
import { ThemeSection } from './ThemeSection'

const noop = () => {}

const sampleThemes: ThemeFile[] = [
  {
    filename: 'default-dark.css',
    name: 'Default Dark',
    isBuiltin: true,
    css: ':root { --color-bg: #1a1a2e; --color-primary: #e94560; --color-surface: #16213e; --color-text: #eaeaea; --color-text-muted: #a0a0a0; --color-success: #00d26a; }',
  },
  {
    filename: 'default-light.css',
    name: 'Default Light',
    isBuiltin: true,
    css: ':root { --color-bg: #f5f5f5; --color-primary: #007bff; --color-surface: #ffffff; --color-text: #222; --color-text-muted: #888; --color-success: #28a745; }',
  },
  {
    filename: 'my-custom.css',
    name: 'My Custom',
    isBuiltin: false,
    css: ':root { --color-bg: #0d1117; --color-primary: #58a6ff; --color-surface: #161b22; --color-text: #c9d1d9; --color-text-muted: #8b949e; --color-success: #3fb950; }',
  },
]

const meta: Meta<typeof ThemeSection> = {
  title: 'Settings/Appearance/ThemeSection',
  component: ThemeSection,
  args: {
    themes: sampleThemes,
    activeTheme: 'default-dark.css',
    themesDir: null,
    autoThemeDialog: null,
    autoThemeEnabled: false,
    autoThemeDayTheme: 'default-light.css',
    autoThemeNightTheme: 'default-dark.css',
    autoThemeDayTime: '07:00',
    autoThemeNightTime: '21:00',
    deleteConfirm: null,
    onSelectTheme: noop,
    onStartCreate: noop,
    onStartEdit: noop,
    onDelete: noop,
    onSetDeleteConfirm: noop,
    onOpenFolder: noop,
    onToggleAutoTheme: noop,
    onSetAutoThemeDayTheme: noop,
    onSetAutoThemeNightTheme: noop,
    onSetAutoThemeDayTime: noop,
    onSetAutoThemeNightTime: noop,
    onSetAutoThemeDayAndApply: noop,
    onSetAutoThemeNightAndApply: noop,
    onApplyGloballyAndDisableAuto: noop,
    onDismissAutoThemeDialog: noop,
  },
}

export default meta
type Story = StoryObj<typeof ThemeSection>

export const Default: Story = {}

export const WithAutoTheme: Story = {
  args: {
    autoThemeEnabled: true,
  },
}

export const WithThemesDirShown: Story = {
  args: {
    themesDir: '/home/user/.config/agent-desktop/themes',
  },
}

export const WithAutoThemeDialog: Story = {
  args: {
    autoThemeEnabled: true,
    autoThemeDialog: sampleThemes[2],
  },
}

export const WithDeleteConfirm: Story = {
  args: {
    deleteConfirm: 'my-custom.css',
  },
}
