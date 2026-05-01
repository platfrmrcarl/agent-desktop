// vi.mock calls are hoisted — declare them before imports
vi.mock('./FileMentionDropdown', () => ({
  FileMentionDropdown: ({ filter }: { filter: string }) => (
    <div data-testid="mention-dropdown" data-filter={filter} />
  ),
  flattenFileTree: () => [],
}))

vi.mock('./SlashCommandDropdown', () => ({
  SlashCommandDropdown: ({ filter }: { filter: string }) => (
    <div data-testid="slash-dropdown" data-filter={filter} />
  ),
}))

import { render, screen, fireEvent, act } from '@testing-library/react'
import { useSettingsStore } from '../../stores/settingsStore'
import { MessageInput } from './MessageInput'

function makeProps(overrides: Partial<React.ComponentProps<typeof MessageInput>> = {}) {
  return {
    onSend: vi.fn(),
    disabled: false,
    isStreaming: false,
    ...overrides,
  }
}

function setup(props: Partial<React.ComponentProps<typeof MessageInput>> = {}) {
  const merged = makeProps(props)
  const utils = render(<MessageInput {...merged} />)
  const textarea = utils.getByRole('textbox') as HTMLTextAreaElement
  return { ...utils, textarea, onSend: merged.onSend as ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  // Install commands mock (not in global setup.ts)
  ;(window.agent as Record<string, unknown>).commands = {
    list: vi.fn().mockResolvedValue([]),
  }

  useSettingsStore.setState({
    settings: { sendOnEnter: 'true' },
    setSetting: vi.fn().mockResolvedValue(undefined),
    loadSettings: vi.fn().mockResolvedValue(undefined),
  })
})

// ─── basic typing behaviour ───────────────────────────────────────────────────

describe('handleChange — basic content updates', () => {
  it('updates textarea value as user types', () => {
    const { textarea } = setup()
    fireEvent.change(textarea, { target: { value: 'hello' } })
    expect(textarea.value).toBe('hello')
  })

  it('shows no dropdown when text has no / or @ trigger', () => {
    const { queryByTestId, textarea } = setup()
    fireEvent.change(textarea, { target: { value: 'some normal text' } })
    expect(queryByTestId('slash-dropdown')).not.toBeInTheDocument()
    expect(queryByTestId('mention-dropdown')).not.toBeInTheDocument()
  })
})

// ─── slash command detection ──────────────────────────────────────────────────

describe('handleChange — slash command detection', () => {
  it('opens slash dropdown when / typed at start', async () => {
    const { queryByTestId, textarea } = setup()
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '/' } })
    })
    expect(queryByTestId('slash-dropdown')).toBeInTheDocument()
  })

  it('opens slash dropdown when / typed after space', async () => {
    const { queryByTestId, textarea } = setup()
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'text /' } })
    })
    expect(queryByTestId('slash-dropdown')).toBeInTheDocument()
  })

  it('opens slash dropdown when / typed after newline', async () => {
    const { queryByTestId, textarea } = setup()
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'text\n/' } })
    })
    expect(queryByTestId('slash-dropdown')).toBeInTheDocument()
  })

  it('does NOT open slash dropdown when / is mid-word', async () => {
    const { queryByTestId, textarea } = setup()
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'path/to' } })
    })
    expect(queryByTestId('slash-dropdown')).not.toBeInTheDocument()
  })

  it('closes slash dropdown when text no longer starts a slash sequence', async () => {
    const { queryByTestId, textarea } = setup()
    // Open it
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '/' } })
    })
    expect(queryByTestId('slash-dropdown')).toBeInTheDocument()
    // Type a word that doesn't start with /
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hello' } })
    })
    expect(queryByTestId('slash-dropdown')).not.toBeInTheDocument()
  })

  it('passes filter text to slash dropdown', async () => {
    const { getByTestId, textarea } = setup()
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '/comp' } })
    })
    const dropdown = getByTestId('slash-dropdown')
    expect(dropdown.getAttribute('data-filter')).toBe('comp')
  })
})

// ─── @ mention detection ──────────────────────────────────────────────────────

describe('handleChange — @ mention detection', () => {
  it('opens mention dropdown when @ typed at start (with cwd)', async () => {
    const { queryByTestId, textarea } = setup({ cwd: '/tmp/project' })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '@' } })
    })
    expect(queryByTestId('mention-dropdown')).toBeInTheDocument()
  })

  it('opens mention dropdown when @ typed after space', async () => {
    const { queryByTestId, textarea } = setup({ cwd: '/tmp/project' })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'text @' } })
    })
    expect(queryByTestId('mention-dropdown')).toBeInTheDocument()
  })

  it('does NOT open mention dropdown when no cwd provided', async () => {
    const { queryByTestId, textarea } = setup({ cwd: undefined })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '@' } })
    })
    expect(queryByTestId('mention-dropdown')).not.toBeInTheDocument()
  })

  it('does NOT open mention dropdown when @ is mid-word', async () => {
    const { queryByTestId, textarea } = setup({ cwd: '/tmp/project' })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'user@host' } })
    })
    expect(queryByTestId('mention-dropdown')).not.toBeInTheDocument()
  })

  it('passes filter text to mention dropdown', async () => {
    const { getByTestId, textarea } = setup({ cwd: '/tmp/project' })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '@src' } })
    })
    const dropdown = getByTestId('mention-dropdown')
    expect(dropdown.getAttribute('data-filter')).toBe('src')
  })

  it('closes mention dropdown when @ sequence ends', async () => {
    const { queryByTestId, textarea } = setup({ cwd: '/tmp/project' })
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '@' } })
    })
    expect(queryByTestId('mention-dropdown')).toBeInTheDocument()
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hello' } })
    })
    expect(queryByTestId('mention-dropdown')).not.toBeInTheDocument()
  })

  it('@ takes priority: opens mention and closes slash when both could trigger', async () => {
    const { queryByTestId, textarea } = setup({ cwd: '/tmp/project' })
    // First open slash
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '/' } })
    })
    expect(queryByTestId('slash-dropdown')).toBeInTheDocument()
    // Now type @ which should dismiss slash and open mention
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '@' } })
    })
    expect(queryByTestId('mention-dropdown')).toBeInTheDocument()
    expect(queryByTestId('slash-dropdown')).not.toBeInTheDocument()
  })
})
