import type { Meta, StoryObj } from '@storybook/react'
import { CredentialsSection } from './CredentialsSection'

const noop = () => {}

const meta: Meta<typeof CredentialsSection> = {
  title: 'Settings/AI/CredentialsSection',
  component: CredentialsSection,
  args: {
    apiKey: '',
    baseUrl: '',
    onApiKeyChange: noop,
    onBaseUrlChange: noop,
  },
}

export default meta
type Story = StoryObj<typeof CredentialsSection>

export const Empty: Story = {}

export const WithApiKeyShowsBaseUrl: Story = {
  args: {
    apiKey: 'sk-ant-1234567890abcdef',
    baseUrl: 'https://api.anthropic.com',
  },
}

export const CustomEndpoint: Story = {
  args: {
    apiKey: 'sk-or-1234567890abcdef',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
}
