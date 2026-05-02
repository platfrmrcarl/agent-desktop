import type { Meta, StoryObj } from '@storybook/react'
import { ShellTool } from './ShellTool'
import type { StreamPart } from '../../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

const meta: Meta<typeof ShellTool> = {
  title: 'Chat/ToolUse/ShellTool',
  component: ShellTool,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof ShellTool>

const bashWithDescription: ToolPart = {
  type: 'tool',
  name: 'Bash',
  id: 'tool_bash_1',
  status: 'done',
  input: { command: 'npm test -- --run', description: 'Run unit tests' },
  output: 'Test Files  83 passed (83)\n      Tests  1161 passed (1161)\n   Duration  11.58s',
}

const bashRunning: ToolPart = {
  type: 'tool',
  name: 'Bash',
  id: 'tool_bash_running',
  status: 'running',
  input: { command: 'npm run build', description: 'Build project' },
}

const bashNoDescription: ToolPart = {
  type: 'tool',
  name: 'Bash',
  id: 'tool_bash_3',
  status: 'done',
  input: { command: 'ls -la src/' },
  output: 'total 48\ndrwxr-xr-x  5 user user 4096 May  1 21:00 .\ndrwxr-xr-x 12 user user 4096 May  1 20:00 ..',
  summary: 'Listed 5 entries',
}

const bashCompact: ToolPart = {
  type: 'tool',
  name: 'Bash',
  id: 'tool_bash_compact',
  status: 'done',
  summary: 'Created directory structure',
}

export const withDescription: Story = { args: { tool: bashWithDescription } }
export const running: Story = { args: { tool: bashRunning } }
export const noDescription: Story = { args: { tool: bashNoDescription } }
export const compact: Story = { args: { tool: bashCompact } }
