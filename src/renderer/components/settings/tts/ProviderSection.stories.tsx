import type { Meta, StoryObj } from '@storybook/react'
import { ProviderSection } from './ProviderSection'

const noop = () => {}

const meta: Meta<typeof ProviderSection> = {
  title: 'Settings/TTS/ProviderSection',
  component: ProviderSection,
  args: {
    provider: '',
    piperUrl: '',
    edgettsVoice: '',
    edgettsBinary: '',
    sayVoice: '',
    sayVoices: [],
    playerPath: 'auto',
    players: [],
    isMacOS: false,
    onProviderChange: noop,
    onPiperUrlChange: noop,
    onEdgettsVoiceChange: noop,
    onEdgettsBinaryChange: noop,
    onSayVoiceChange: noop,
    onPlayerPathChange: noop,
  },
}

export default meta
type Story = StoryObj<typeof ProviderSection>

export const Off: Story = {}

export const PiperWithPlayers: Story = {
  args: {
    provider: 'piper',
    piperUrl: 'http://localhost:5000',
    players: [
      { name: 'mpv', path: '/usr/bin/mpv', available: true },
      { name: 'ffplay', path: '/usr/bin/ffplay', available: true },
    ],
    playerPath: '/usr/bin/mpv',
  },
}

export const PiperNoPlayers: Story = {
  args: {
    provider: 'piper',
    piperUrl: '',
    players: [],
    playerPath: 'auto',
  },
}

export const EdgeTTS: Story = {
  args: {
    provider: 'edgetts',
    edgettsVoice: 'en-US-AriaNeural',
    edgettsBinary: 'edge-tts',
    players: [
      { name: 'mpv', path: '/usr/bin/mpv', available: true },
    ],
    playerPath: '/usr/bin/mpv',
  },
}

export const MacOSSay: Story = {
  args: {
    provider: 'say',
    isMacOS: true,
    sayVoices: [
      { name: 'Samantha', locale: 'en_US' },
      { name: 'Alex', locale: 'en_US' },
    ],
    sayVoice: 'Samantha',
  },
}
