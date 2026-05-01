import type { Meta, StoryObj } from '@storybook/react'
import { MessageBubble } from '../MessageBubble'
import type { Message } from '../../../../shared/types'

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    conversation_id: 1,
    role: 'user',
    content: 'Hello, can you help me with a React question?',
    attachments: '[]',
    tool_calls: null,
    created_at: new Date(Date.now() - 60000).toISOString(),
    updated_at: new Date(Date.now() - 60000).toISOString(),
    ...overrides,
  }
}

const meta: Meta<typeof MessageBubble> = {
  title: 'Chat/MessageBubble',
  component: MessageBubble,
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj<typeof MessageBubble>

// ─── User stories ────────────────────────────────────────────

export const userMessage: Story = {
  args: {
    message: makeMessage({
      role: 'user',
      content: 'Hello, can you help me refactor this function to use async/await?',
    }),
    isLast: true,
  },
}

export const userMessageWithEdit: Story = {
  args: {
    message: makeMessage({
      role: 'user',
      content: 'Please fix this bug in my code.',
    }),
    isLast: true,
    onEdit: (id, content) => console.log('edit', id, content),
    onFork: (id) => console.log('fork', id),
  },
}

// ─── Assistant stories ───────────────────────────────────────

export const assistantPlain: Story = {
  args: {
    message: makeMessage({
      id: 2,
      role: 'assistant',
      content: `Sure! Here's how to refactor that function:

\`\`\`typescript
async function fetchData(url: string): Promise<Data> {
  const response = await fetch(url)
  return response.json()
}
\`\`\`

This is cleaner than using raw Promises with \`.then()\`.`,
    }),
    isLast: true,
  },
}

export const assistantWithToolCalls: Story = {
  args: {
    message: makeMessage({
      id: 3,
      role: 'assistant',
      content: "I've analyzed your codebase and made the changes.",
      tool_calls: JSON.stringify([
        {
          id: 'tc1',
          name: 'Read',
          input: JSON.stringify({ file_path: '/src/utils.ts' }),
          output: 'export function add(a: number, b: number) { return a + b }',
          status: 'done',
        },
        {
          id: 'tc2',
          name: 'Edit',
          input: JSON.stringify({ file_path: '/src/utils.ts', old_string: 'a + b', new_string: 'a + b + 0' }),
          output: 'File updated',
          status: 'done',
        },
        {
          id: 'tc3',
          name: 'Bash',
          input: JSON.stringify({ command: 'npm test' }),
          output: 'All tests passed',
          status: 'done',
        },
      ]),
    }),
    isLast: true,
    onRegenerate: () => console.log('regenerate'),
    onFork: (id) => console.log('fork', id),
  },
}

export const assistantWithHookMessages: Story = {
  args: {
    message: makeMessage({
      id: 4,
      role: 'assistant',
      content: `<hook-system-message>Lint hook: 0 warnings, 0 errors — all checks passed</hook-system-message>
<hook-system-message>Security scan: No vulnerabilities detected in changed files</hook-system-message>
Here is the completed implementation. I've added proper error handling and TypeScript types throughout.`,
    }),
    isLast: true,
    onRegenerate: () => console.log('regenerate'),
  },
}

export const assistantWithCustomAgentName: Story = {
  args: {
    message: makeMessage({
      id: 5,
      role: 'assistant',
      content: 'Hello! I am Jarvis, your AI assistant.',
    }),
    isLast: false,
    effectiveAgentName: 'Jarvis',
  },
}

export const assistantNotLast: Story = {
  args: {
    message: makeMessage({
      id: 6,
      role: 'assistant',
      content: 'This is an earlier message in the conversation.',
    }),
    isLast: false,
  },
}
