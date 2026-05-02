import type { Meta, StoryObj } from '@storybook/react'
import { EditTools } from './EditTools'
import type { StreamPart } from '../../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

const meta: Meta<typeof EditTools> = {
  title: 'Chat/ToolUse/EditTools',
  component: EditTools,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof EditTools>

const editFileTool: ToolPart = {
  type: 'tool',
  name: 'Edit',
  id: 'tool_edit_1',
  status: 'done',
  input: {
    file_path: '/home/user/projects/myapp/src/components/Button.tsx',
    old_str: 'function Button({ label }) {\n  return <button>{label}</button>\n}',
    new_str: 'function Button({ label, onClick }) {\n  return <button onClick={onClick}>{label}</button>\n}',
  },
  output: 'File updated successfully',
}

const multiEditTool: ToolPart = {
  type: 'tool',
  name: 'MultiEdit',
  id: 'tool_multiedit_1',
  status: 'done',
  input: {
    file_path: '/home/user/projects/myapp/src/utils/helpers.ts',
    edits: [
      { old_str: 'const foo = 1', new_str: 'const foo = 2' },
      { old_str: 'const bar = 2', new_str: 'const bar = 3' },
    ],
  },
  output: '2 edits applied',
}

const writeTool: ToolPart = {
  type: 'tool',
  name: 'Write',
  id: 'tool_write_1',
  status: 'done',
  input: {
    file_path: '/home/user/projects/myapp/src/config.ts',
    content: 'export const API_URL = "https://api.example.com"',
  },
  output: 'File written successfully',
}

const runningEditTool: ToolPart = {
  type: 'tool',
  name: 'Edit',
  id: 'tool_edit_running',
  status: 'running',
  input: {
    file_path: '/home/user/projects/myapp/src/index.ts',
    old_str: 'old content',
    new_str: 'new content',
  },
}

const piEditTool: ToolPart = {
  type: 'tool',
  name: 'edit',
  id: 'tool_pi_edit',
  status: 'done',
  input: {
    path: '/home/user/projects/myapp/src/App.tsx',
    oldText: 'const App = () => <div>Hello</div>',
    newText: 'const App = () => <div>Hello World</div>',
  },
  output: 'ok',
}

export const editFile: Story = { args: { tool: editFileTool } }
export const multiEdit: Story = { args: { tool: multiEditTool } }
export const writeFile: Story = { args: { tool: writeTool } }
export const runningEdit: Story = { args: { tool: runningEditTool } }
export const piSdkEdit: Story = { args: { tool: piEditTool } }
