import type { Meta, StoryObj } from '@storybook/react'
import { ResponseModeSection } from './ResponseModeSection'

const noop = () => {}

const meta: Meta<typeof ResponseModeSection> = {
  title: 'Settings/TTS/ResponseModeSection',
  component: ResponseModeSection,
  args: {
    provider: 'piper',
    responseMode: 'off',
    maxLength: '2000',
    autoWordLimit: '200',
    validation: null,
    onResponseModeChange: noop,
    onMaxLengthChange: noop,
    onAutoWordLimitChange: noop,
    onValidationChange: noop,
  },
}

export default meta
type Story = StoryObj<typeof ResponseModeSection>

export const Default: Story = {}

export const AutoMode: Story = {
  args: {
    responseMode: 'auto',
    autoWordLimit: '150',
  },
}

export const ValidationSuccess: Story = {
  args: {
    validation: {
      provider: 'piper',
      providerFound: true,
      playerFound: true,
      playerPath: '/usr/bin/mpv',
    },
  },
}

export const ValidationError: Story = {
  args: {
    validation: {
      provider: null,
      providerFound: false,
      playerFound: false,
      playerPath: '',
      error: 'Piper server not reachable at http://localhost:5000',
    },
  },
}
