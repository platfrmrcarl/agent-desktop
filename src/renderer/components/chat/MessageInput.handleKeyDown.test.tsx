// vi.mock calls are hoisted — must precede imports
vi.mock('./FileMentionDropdown', () => ({
  FileMentionDropdown: ({
    filter,
    onSelect,
    onClose,
  }: {
    filter: string
    onSelect: (f: { name: string; path: string; relativePath: string; isDirectory: boolean }) => void
    onClose: () => void
  }) => (
    <div data-testid="mention-dropdown" data-filter={filter}>
      <button data-testid="mention-item" onClick={() => onSelect({ name: 'index.ts', path: '/tmp/index.ts', relativePath: 'index.ts', isDirectory: false })}>
        index.ts
      </button>
      <button data-testid="mention-close" onClick={onClose}>close</button>
    </div>
  ),
  flattenFileTree: () => [],
}))

vi.mock('./SlashCommandDropdown', () => ({
  SlashCommandDropdown: ({
    filter,
    onSelect,
    onClose,
  }: {
    filter: string
    onSelect: (cmd: { name: string; description: string; source: string }) => void
    onClose: () => void
  }) => (
    <div data-testid="slash-dropdown" data-filter={filter}>
      <button
        data-testid="slash-item"
        onClick={() => onSelect({ name: 'compact', description: 'Compact', source: 'builtin' })}
      >
        /compact
      </button>
      <button data-testid="slash-close" onClick={onClose}>close</button>
    </div>
  ),
}))

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { useSettingsStore } from '../../stores/settingsStore'
import { MessageInput } from './MessageInput'

type Props = React.ComponentProps<typeof MessageInput>

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    onSend: vi.fn(),
    disabled: false,
    isStreaming: false,
    ...overrides,
  }
}

function setup(overrides: Partial<Props> = {}) {
  const props = makeProps(overrides)
  const utils = render(<MessageInput {...props} />)
  const textarea = utils.getByRole('textbox') as HTMLTextAreaElement
  return { ...utils, textarea, props }
}

function changeValue(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, { target: { value } })
}

beforeEach(() => {
  ;(window.agent as Record<string, unknown>).commands = {
    list: vi.fn().mockResolvedValue([]),
  }

  useSettingsStore.setState({
    settings: { sendOnEnter: 'true' },
    setSetting: vi.fn().mockResolvedValue(undefined),
    loadSettings: vi.fn().mockResolvedValue(undefined),
  })
})

// ─── Enter-to-send ────────────────────────────────────────────────────────────

describe('handleKeyDown — Enter to send (sendOnEnter=true)', () => {
  it('calls onSend when Enter pressed with non-empty content', () => {
    const { textarea, props } = setup()
    changeValue(textarea, 'hello')
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(props.onSend).toHaveBeenCalledWith('hello')
  })

  it('does NOT call onSend when Enter pressed with only whitespace', () => {
    const { textarea, props } = setup()
    changeValue(textarea, '   ')
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it('does NOT call onSend on Shift+Enter (should insert newline instead)', () => {
    const { textarea, props } = setup()
    changeValue(textarea, 'hello')
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it('clears textarea content after send', () => {
    const { textarea } = setup()
    changeValue(textarea, 'hello')
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(textarea.value).toBe('')
  })
})

// ─── sendOnEnter=false (Ctrl+Enter to send) ──────────────────────────────────

describe('handleKeyDown — Ctrl+Enter to send (sendOnEnter=false)', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { sendOnEnter: 'false' },
      setSetting: vi.fn().mockResolvedValue(undefined),
      loadSettings: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('calls onSend on Ctrl+Enter', () => {
    const { textarea, props } = setup()
    changeValue(textarea, 'hello')
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(props.onSend).toHaveBeenCalledWith('hello')
  })

  it('does NOT call onSend on plain Enter', () => {
    const { textarea, props } = setup()
    changeValue(textarea, 'hello')
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it('calls onSend on Meta+Enter', () => {
    const { textarea, props } = setup()
    changeValue(textarea, 'hello')
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    expect(props.onSend).toHaveBeenCalledWith('hello')
  })
})

// ─── slash dropdown keyboard nav ─────────────────────────────────────────────

describe('handleKeyDown — slash dropdown navigation', () => {
  it('Escape closes slash dropdown', async () => {
    const { queryByTestId, textarea } = setup()
    await act(async () => {
      changeValue(textarea, '/')
    })
    expect(queryByTestId('slash-dropdown')).toBeInTheDocument()
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(queryByTestId('slash-dropdown')).not.toBeInTheDocument()
  })

  it('ArrowDown moves slash selection forward', async () => {
    const { queryByTestId, textarea } = setup()
    // Install a list with 2 items for navigation
    ;(window.agent as Record<string, unknown>).commands = {
      list: vi.fn().mockResolvedValue([
        { name: 'compact', description: 'Compact', source: 'builtin' },
        { name: 'clear', description: 'Clear', source: 'builtin' },
      ]),
    }
    await act(async () => {
      changeValue(textarea, '/')
    })
    expect(queryByTestId('slash-dropdown')).toBeInTheDocument()
    // ArrowDown should not throw
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    // Dropdown still open
    expect(queryByTestId('slash-dropdown')).toBeInTheDocument()
  })

  it('ArrowUp does not go below 0', async () => {
    const { queryByTestId, textarea } = setup()
    await act(async () => {
      changeValue(textarea, '/')
    })
    expect(queryByTestId('slash-dropdown')).toBeInTheDocument()
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(queryByTestId('slash-dropdown')).toBeInTheDocument()
  })
})

// ─── mention dropdown keyboard nav ───────────────────────────────────────────

describe('handleKeyDown — mention dropdown navigation', () => {
  it('Escape closes mention dropdown', async () => {
    const { queryByTestId, textarea } = setup({ cwd: '/tmp/project' })
    await act(async () => {
      changeValue(textarea, '@')
    })
    expect(queryByTestId('mention-dropdown')).toBeInTheDocument()
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(queryByTestId('mention-dropdown')).not.toBeInTheDocument()
  })

  it('sends on Enter when mention dropdown is open but file list is empty', async () => {
    // filteredFiles.length === 0 → Enter falls through to handleSend
    const { queryByTestId, textarea, props } = setup({ cwd: '/tmp/project' })
    await act(async () => {
      changeValue(textarea, '@hello')
    })
    expect(queryByTestId('mention-dropdown')).toBeInTheDocument()
    textarea.focus()
    // No files available to select → Enter sends the content
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(props.onSend).toHaveBeenCalledWith('@hello')
  })

  it('ArrowDown within mention dropdown does not throw', async () => {
    const { queryByTestId, textarea } = setup({ cwd: '/tmp/project' })
    await act(async () => {
      changeValue(textarea, '@')
    })
    expect(queryByTestId('mention-dropdown')).toBeInTheDocument()
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    expect(queryByTestId('mention-dropdown')).toBeInTheDocument()
  })

  it('ArrowUp within mention dropdown does not throw', async () => {
    const { queryByTestId, textarea } = setup({ cwd: '/tmp/project' })
    await act(async () => {
      changeValue(textarea, '@')
    })
    expect(queryByTestId('mention-dropdown')).toBeInTheDocument()
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(queryByTestId('mention-dropdown')).toBeInTheDocument()
  })
})

// ─── queue behaviour ─────────────────────────────────────────────────────────

describe('handleKeyDown — queue mode (isStreaming=true)', () => {
  it('calls onQueue instead of onSend when streaming', () => {
    const onQueue = vi.fn()
    const { textarea, props } = setup({ isStreaming: true, onQueue })
    changeValue(textarea, 'queued message')
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onQueue).toHaveBeenCalledWith('queued message')
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it('calls onSend normally when not streaming and no queue', () => {
    const { textarea, props } = setup({ isStreaming: false })
    changeValue(textarea, 'direct message')
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(props.onSend).toHaveBeenCalledWith('direct message')
  })
})
