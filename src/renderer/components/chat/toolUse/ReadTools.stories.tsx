import type { Meta, StoryObj } from '@storybook/react'
import { ReadTools } from './ReadTools'
import type { StreamPart } from '../../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

const meta: Meta<typeof ReadTools> = {
  title: 'Chat/ToolUse/ReadTools',
  component: ReadTools,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof ReadTools>

const readTool: ToolPart = {
  type: 'tool',
  name: 'Read',
  id: 'tool_read_1',
  status: 'done',
  input: { file_path: '/home/user/projects/myapp/src/components/Button.tsx' },
  output: 'import React from "react"\n\nexport function Button({ label }) {\n  return <button>{label}</button>\n}',
}

const globTool: ToolPart = {
  type: 'tool',
  name: 'Glob',
  id: 'tool_glob_1',
  status: 'done',
  input: { pattern: '**/*.test.ts' },
  output: 'src/utils/helpers.test.ts\nsrc/components/Button.test.tsx\nsrc/pages/Home.test.tsx',
  summary: 'Found 3 files',
}

const grepTool: ToolPart = {
  type: 'tool',
  name: 'Grep',
  id: 'tool_grep_1',
  status: 'done',
  input: { pattern: 'useSettingsStore', path: 'src/' },
  output: 'src/components/Settings.tsx:12:  const settings = useSettingsStore((s) => s.settings)\nsrc/components/Toolbar.tsx:8:  const theme = useSettingsStore((s) => s.theme)',
}

const lspTool: ToolPart = {
  type: 'tool',
  name: 'LSP',
  id: 'tool_lsp_1',
  status: 'done',
  input: { file_path: '/home/user/projects/myapp/src/types.ts', line: 42, character: 10 },
  output: 'type ButtonProps = { label: string; onClick?: () => void }',
}

const runningReadTool: ToolPart = {
  type: 'tool',
  name: 'Read',
  id: 'tool_read_running',
  status: 'running',
  input: { file_path: '/home/user/projects/myapp/package.json' },
}

export const readFile: Story = { args: { tool: readTool } }
export const globPattern: Story = { args: { tool: globTool } }
export const grepSearch: Story = { args: { tool: grepTool } }
export const lspHover: Story = { args: { tool: lspTool } }
export const runningRead: Story = { args: { tool: runningReadTool } }
