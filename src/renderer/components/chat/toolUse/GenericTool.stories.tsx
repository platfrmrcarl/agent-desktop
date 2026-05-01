import type { Meta, StoryObj } from '@storybook/react'
import { GenericTool } from './GenericTool'
import type { StreamPart } from '../../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

const meta: Meta<typeof GenericTool> = {
  title: 'Chat/ToolUse/GenericTool',
  component: GenericTool,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof GenericTool>

const taskTool: ToolPart = {
  type: 'tool',
  name: 'Task',
  id: 'tool_task_1',
  status: 'done',
  input: { description: 'Analyze the codebase for CRAP hotspots' },
  output: 'Found 12 functions with CRAP score > 500. Top hotspot: ToolUseBlock (1122).',
}

const webFetchTool: ToolPart = {
  type: 'tool',
  name: 'WebFetch',
  id: 'tool_webfetch_1',
  status: 'done',
  input: { url: 'https://api.github.com/repos/myorg/myapp' },
  output: '{"name": "myapp", "stargazers_count": 42, "forks_count": 8}',
}

const todoTool: ToolPart = {
  type: 'tool',
  name: 'TodoWrite',
  id: 'tool_todo_1',
  status: 'done',
  input: {
    todos: [
      { id: '1', content: 'Refactor ToolUseBlock', status: 'completed', priority: 'high' },
      { id: '2', content: 'Add tests for new components', status: 'in_progress', priority: 'medium' },
    ],
  },
  output: 'Todos updated',
  summary: '2 tasks updated',
}

const runningGeneric: ToolPart = {
  type: 'tool',
  name: 'WebSearch',
  id: 'tool_websearch_running',
  status: 'running',
  input: { query: 'React CRAP complexity refactoring patterns' },
}

export const task: Story = { args: { tool: taskTool } }
export const webFetch: Story = { args: { tool: webFetchTool } }
export const todoWrite: Story = { args: { tool: todoTool } }
export const running: Story = { args: { tool: runningGeneric } }
