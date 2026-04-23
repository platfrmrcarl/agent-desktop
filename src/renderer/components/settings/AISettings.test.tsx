import { render, screen } from '@testing-library/react'
import { useSettingsStore } from '../../stores/settingsStore'
import { AISettings } from './AISettings'

beforeEach(() => {
  ;(window.agent as Record<string, unknown>).commands = {
    list: vi.fn().mockResolvedValue([]),
  }
  ;(window.agent as Record<string, unknown>).pi = {
    listExtensions: vi.fn().mockResolvedValue([]),
  }

  useSettingsStore.setState({
    settings: {},
    setSetting: vi.fn().mockResolvedValue(undefined),
    loadSettings: vi.fn().mockResolvedValue(undefined),
  })
})

describe('AISettings — Claude backend (default)', () => {
  it('shows Claude-only sections when backend is claude-agent-sdk', () => {
    useSettingsStore.setState({
      settings: { ai_sdkBackend: 'claude-agent-sdk' },
      setSetting: vi.fn().mockResolvedValue(undefined),
      loadSettings: vi.fn().mockResolvedValue(undefined),
    })

    render(<AISettings />)

    expect(screen.getByLabelText('API key')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximum budget in USD')).toBeInTheDocument()
    expect(screen.getByLabelText('Select permission mode')).toBeInTheDocument()
    expect(screen.getByLabelText('Select setting sources')).toBeInTheDocument()
    expect(screen.getByLabelText('Toggle skills')).toBeInTheDocument()
    expect(screen.getByLabelText('Toggle CWD write restriction')).toBeInTheDocument()
    expect(screen.getByLabelText('Share Claude config across backends')).toBeInTheDocument()
  })

  it('shows Claude-only sections when backend is unset (defaults to claude)', () => {
    render(<AISettings />)

    expect(screen.getByLabelText('API key')).toBeInTheDocument()
    expect(screen.getByLabelText('Select permission mode')).toBeInTheDocument()
  })
})

describe('AISettings — PI backend', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ai_sdkBackend: 'pi' },
      setSetting: vi.fn().mockResolvedValue(undefined),
      loadSettings: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('shows PI Extensions Directory when PI is selected', () => {
    render(<AISettings />)
    expect(screen.getByLabelText('PI extensions directory')).toBeInTheDocument()
  })

  it('shows Browse button for extensions directory when PI is selected', () => {
    render(<AISettings />)
    expect(screen.getByLabelText('Browse for extensions directory')).toBeInTheDocument()
  })

  it('hides PI Extensions Directory when Claude is selected', () => {
    useSettingsStore.setState({
      settings: { ai_sdkBackend: 'claude-agent-sdk' },
      setSetting: vi.fn().mockResolvedValue(undefined),
      loadSettings: vi.fn().mockResolvedValue(undefined),
    })
    render(<AISettings />)
    expect(screen.queryByLabelText('PI extensions directory')).not.toBeInTheDocument()
  })

  it('hides API Key when PI is selected', () => {
    render(<AISettings />)
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
  })

  it('hides Base URL when PI is selected', () => {
    render(<AISettings />)
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument()
  })

  it('shows Max Budget when PI is selected (budgetTracker module, Phase 5)', () => {
    render(<AISettings />)
    expect(screen.getByLabelText('Maximum budget in USD')).toBeInTheDocument()
  })

  it('shows Permission Mode when PI is selected (permissionModes module)', () => {
    render(<AISettings />)
    expect(screen.getByLabelText('Select permission mode')).toBeInTheDocument()
  })

  it('shows Setting Sources when PI is selected (skillsBridge module)', () => {
    render(<AISettings />)
    expect(screen.getByLabelText('Select setting sources')).toBeInTheDocument()
  })

  it('shows Skills toggle when PI is selected', () => {
    render(<AISettings />)
    expect(screen.getByLabelText('Toggle skills')).toBeInTheDocument()
  })

  it('shows CWD Restriction when PI is selected (cwdGuard module)', () => {
    render(<AISettings />)
    expect(screen.getByLabelText('Toggle CWD write restriction')).toBeInTheDocument()
  })

  it('still shows Share Claude Config when PI is selected', () => {
    render(<AISettings />)
    expect(screen.getByLabelText('Share Claude config across backends')).toBeInTheDocument()
  })

  it('still shows shared settings (Backend, Model, Max Turns, Thinking Tokens, System Prompt)', () => {
    render(<AISettings />)

    expect(screen.getByLabelText('Select SDK backend')).toBeInTheDocument()
    expect(screen.getByLabelText('Select AI model')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximum agentic turns')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximum thinking tokens')).toBeInTheDocument()
    expect(screen.getByLabelText('Default system prompt')).toBeInTheDocument()
  })
})

describe('AISettings — Compact Model and Title Model sections', () => {
  it('shows Compact Model and Title Model selects', () => {
    render(<AISettings />)

    expect(screen.getByLabelText('Compact model')).toBeInTheDocument()
    expect(screen.getByLabelText('Title model')).toBeInTheDocument()
  })

  it('Compact Model defaults to Auto (empty value)', () => {
    render(<AISettings />)

    const select = screen.getByLabelText('Compact model') as HTMLSelectElement
    expect(select.value).toBe('')
  })

  it('Title Model defaults to Auto (empty value)', () => {
    render(<AISettings />)

    const select = screen.getByLabelText('Title model') as HTMLSelectElement
    expect(select.value).toBe('')
  })

  it('shows custom text input when Compact Model is a non-preset value', () => {
    useSettingsStore.setState({
      settings: { ai_compactModel: 'my-custom-model' },
      setSetting: vi.fn().mockResolvedValue(undefined),
      loadSettings: vi.fn().mockResolvedValue(undefined),
    })

    render(<AISettings />)

    expect(screen.getByLabelText('Custom compact model')).toBeInTheDocument()
  })

  it('shows custom text input when Title Model is a non-preset value', () => {
    useSettingsStore.setState({
      settings: { ai_titleModel: 'my-custom-model' },
      setSetting: vi.fn().mockResolvedValue(undefined),
      loadSettings: vi.fn().mockResolvedValue(undefined),
    })

    render(<AISettings />)

    expect(screen.getByLabelText('Custom title model')).toBeInTheDocument()
  })

  it('does not show custom input when Compact Model is empty (Auto)', () => {
    render(<AISettings />)

    expect(screen.queryByLabelText('Custom compact model')).not.toBeInTheDocument()
  })

  it('does not show custom input when Title Model is empty (Auto)', () => {
    render(<AISettings />)

    expect(screen.queryByLabelText('Custom title model')).not.toBeInTheDocument()
  })
})
