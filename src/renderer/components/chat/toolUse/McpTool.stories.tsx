import type { Meta, StoryObj } from '@storybook/react'
import { McpTool } from './McpTool'
import type { StreamPart } from '../../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

const meta: Meta<typeof McpTool> = {
  title: 'Chat/ToolUse/McpTool',
  component: McpTool,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof McpTool>

const mcpFilesystem: ToolPart = {
  type: 'tool',
  name: 'mcp__filesystem__read_file',
  id: 'tool_mcp_1',
  status: 'done',
  input: { path: '/home/user/projects/myapp/README.md' },
  output: '# MyApp\n\nA sample application built with React and TypeScript.',
}

const mcpGitHub: ToolPart = {
  type: 'tool',
  name: 'mcp__github__create_issue',
  id: 'tool_mcp_2',
  status: 'done',
  input: {
    owner: 'myorg',
    repo: 'myapp',
    title: 'Fix login button not responding',
    body: 'The login button does not respond on mobile devices.',
  },
  output: '{"number": 42, "html_url": "https://github.com/myorg/myapp/issues/42"}',
}

const mcpRunning: ToolPart = {
  type: 'tool',
  name: 'mcp__slack__send_message',
  id: 'tool_mcp_running',
  status: 'running',
  input: { channel: '#dev', message: 'Deployment complete!' },
}

const mcpCompact: ToolPart = {
  type: 'tool',
  name: 'mcp__postgres__query',
  id: 'tool_mcp_compact',
  status: 'done',
  summary: '3 rows returned',
}

export const filesystemRead: Story = { args: { tool: mcpFilesystem } }
export const githubCreateIssue: Story = { args: { tool: mcpGitHub } }
export const slackRunning: Story = { args: { tool: mcpRunning } }
export const compact: Story = { args: { tool: mcpCompact } }
