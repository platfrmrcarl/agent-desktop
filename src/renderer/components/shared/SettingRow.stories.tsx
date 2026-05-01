import type { Meta, StoryObj } from '@storybook/react'
import { SettingRow } from './SettingRow'

const meta: Meta<typeof SettingRow> = {
  title: 'Shared/SettingRow',
  component: SettingRow,
  args: {
    label: 'Maximum turns',
    description: 'Hard cap on agent turns per request before forcing a stop.',
  },
}

export default meta
type Story = StoryObj<typeof SettingRow>

export const WithTextInput: Story = {
  args: {
    children: (
      <input
        type="number"
        defaultValue={100}
        className="w-24 px-2 py-1 text-sm rounded border"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderColor: 'var(--color-text-muted)',
          color: 'var(--color-text)',
        }}
      />
    ),
  },
}

export const WithToggle: Story = {
  args: {
    label: 'Enable streaming',
    description: 'Stream tokens as they arrive instead of waiting for the full response.',
    children: (
      <input
        type="checkbox"
        defaultChecked
        role="switch"
        style={{ width: '2rem', height: '1.25rem' }}
      />
    ),
  },
}

export const WithSelect: Story = {
  args: {
    label: 'Theme',
    description: 'Color theme used by the desktop app and the embedded web view.',
    children: (
      <select
        defaultValue="dark"
        className="px-2 py-1 text-sm rounded border"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderColor: 'var(--color-text-muted)',
          color: 'var(--color-text)',
        }}
      >
        <option value="dark">Dark (default)</option>
        <option value="light">Light</option>
        <option value="auto">Auto</option>
      </select>
    ),
  },
}

export const LongDescription: Story = {
  args: {
    label: 'CWD whitelist',
    description:
      'Comma-separated list of additional directories the agent is allowed to read or write. The conversation working directory is always allowed; knowledge-base paths are merged in automatically.',
    children: (
      <button
        className="px-3 py-1 text-sm rounded border"
        style={{
          backgroundColor: 'var(--color-primary)',
          borderColor: 'var(--color-primary)',
          color: 'var(--color-text-contrast)',
        }}
      >
        Edit list
      </button>
    ),
  },
}
