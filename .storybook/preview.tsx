import type { Preview } from '@storybook/react'
import React from 'react'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import '../src/renderer/styles/globals.css'
import { createMockAgentBridge } from './mocks/agentBridge'

if (typeof window !== 'undefined' && !(window as Record<string, unknown>).agent) {
  ;(window as Record<string, unknown>).agent = createMockAgentBridge()
}

const preview: Preview = {
  parameters: {
    layout: 'padded',
    backgrounds: {
      default: 'app',
      values: [
        { name: 'app', value: '#1a1a2e' },
        { name: 'surface', value: '#16213e' },
        { name: 'light', value: '#ffffff' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: '1.5rem',
          backgroundColor: 'var(--color-bg)',
          color: 'var(--color-text)',
          minHeight: '100vh',
          colorScheme: 'dark',
        }}
      >
        <Story />
      </div>
    ),
  ],
}

export default preview
