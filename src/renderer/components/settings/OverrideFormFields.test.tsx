import { render, screen } from '@testing-library/react'
import { OverrideFormFields } from './OverrideFormFields'

const defaultProps = {
  draft: {} as Record<string, string | undefined>,
  inheritedValues: {} as Record<string, string>,
  inheritedSources: {} as Record<string, string>,
  mcpServers: [{ name: 'test-mcp' }],
  mcpDisabledDraft: [] as string[],
  mcpDisabledInherited: [] as string[],
  isMcpOverridden: false,
  onDraftChange: vi.fn(),
  onToggleOverride: vi.fn(),
  onToggleMcpOverride: vi.fn(),
  onToggleMcpServer: vi.fn(),
  onToggleCwdWhitelistOverride: vi.fn(),
  onCwdWhitelistChange: vi.fn(),
  cwdWhitelistDraft: [],
  cwdWhitelistInherited: [],
  isCwdWhitelistOverridden: false,
}

describe('OverrideFormFields — Claude backend (default)', () => {
  it('renders claudeOnly fields when backend is claude-agent-sdk', () => {
    render(<OverrideFormFields {...defaultProps} inheritedValues={{ ai_sdkBackend: 'claude-agent-sdk' }} />)

    expect(screen.getByText('Budget (USD)')).toBeInTheDocument()
    expect(screen.getByText('Permission Mode')).toBeInTheDocument()
    expect(screen.getByText('Setting Sources')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
  })

  it('renders MCP Servers section when Claude backend', () => {
    render(<OverrideFormFields {...defaultProps} inheritedValues={{ ai_sdkBackend: 'claude-agent-sdk' }} />)

    expect(screen.getByText('MCP Servers')).toBeInTheDocument()
  })

  it('renders CWD Restriction section when Claude backend', () => {
    render(<OverrideFormFields {...defaultProps} inheritedValues={{ ai_sdkBackend: 'claude-agent-sdk' }} />)

    expect(screen.getByText('CWD Restriction')).toBeInTheDocument()
  })

  it('renders CWD Whitelist section when Claude backend', () => {
    render(<OverrideFormFields {...defaultProps} inheritedValues={{ ai_sdkBackend: 'claude-agent-sdk' }} />)

    expect(screen.getByText('CWD Whitelist')).toBeInTheDocument()
  })
})

describe('OverrideFormFields — PI backend (inherited)', () => {
  it('shows previously-Claude-only fields when PI is inherited (modules now handle them)', () => {
    render(<OverrideFormFields {...defaultProps} inheritedValues={{ ai_sdkBackend: 'pi' }} />)

    // Phases 1-4 extension modules implement these on PI backend too.
    expect(screen.getByText('Budget (USD)')).toBeInTheDocument()
    expect(screen.getByText('Permission Mode')).toBeInTheDocument()
    expect(screen.getByText('Setting Sources')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
  })

  it('hides MCP Servers when PI is inherited', () => {
    render(<OverrideFormFields {...defaultProps} inheritedValues={{ ai_sdkBackend: 'pi' }} />)

    expect(screen.queryByText('MCP Servers')).not.toBeInTheDocument()
  })

  it('hides CWD Restriction when PI is inherited', () => {
    render(<OverrideFormFields {...defaultProps} inheritedValues={{ ai_sdkBackend: 'pi' }} />)

    expect(screen.queryByText('CWD Restriction')).not.toBeInTheDocument()
  })

  it('hides CWD Whitelist when PI is inherited', () => {
    render(<OverrideFormFields {...defaultProps} inheritedValues={{ ai_sdkBackend: 'pi' }} />)

    expect(screen.queryByText('CWD Whitelist')).not.toBeInTheDocument()
  })

  it('still shows shared fields (Backend, Model, Max Turns, Thinking Tokens)', () => {
    render(<OverrideFormFields {...defaultProps} inheritedValues={{ ai_sdkBackend: 'pi' }} />)

    expect(screen.getByText('Backend')).toBeInTheDocument()
    // "Model" appears as both section header and field label
    expect(screen.getAllByText('Model').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Max Turns')).toBeInTheDocument()
    expect(screen.getByText('Thinking Tokens')).toBeInTheDocument()
  })
})

describe('OverrideFormFields — PI backend (overridden in draft)', () => {
  it('shows previously-Claude-only fields when PI is set in draft (modules now handle them)', () => {
    render(<OverrideFormFields
      {...defaultProps}
      draft={{ ai_sdkBackend: 'pi' }}
      inheritedValues={{ ai_sdkBackend: 'claude-agent-sdk' }}
    />)

    expect(screen.getByText('Budget (USD)')).toBeInTheDocument()
    expect(screen.getByText('Permission Mode')).toBeInTheDocument()
    // MCP Servers + CWD Restriction are not in the override form's field
    // list at all (scoped to global settings or different surface), so
    // their absence is unrelated to backend selection.
    expect(screen.queryByText('MCP Servers')).not.toBeInTheDocument()
    expect(screen.queryByText('CWD Restriction')).not.toBeInTheDocument()
  })

  it('shows claudeOnly fields when draft overrides PI back to Claude', () => {
    render(<OverrideFormFields
      {...defaultProps}
      draft={{ ai_sdkBackend: 'claude-agent-sdk' }}
      inheritedValues={{ ai_sdkBackend: 'pi' }}
    />)

    expect(screen.getByText('Budget (USD)')).toBeInTheDocument()
    expect(screen.getByText('Permission Mode')).toBeInTheDocument()
    expect(screen.getByText('MCP Servers')).toBeInTheDocument()
    expect(screen.getByText('CWD Restriction')).toBeInTheDocument()
  })
})

describe('OverrideFormFields — PI Extensions section', () => {
  const piExtensions = [
    { name: 'code-review', path: '/home/user/.pi/extensions/code-review.ts' },
    { name: 'test-runner', path: '/tmp/.pi/extensions/test-runner.ts' },
  ]

  it('shows PI Extensions when PI backend + extensions provided', () => {
    render(<OverrideFormFields
      {...defaultProps}
      inheritedValues={{ ai_sdkBackend: 'pi' }}
      piExtensions={piExtensions}
      piExtDisabledDraft={[]}
      piExtDisabledInherited={[]}
      isPiExtOverridden={false}
      onTogglePiExtOverride={vi.fn()}
      onTogglePiExtension={vi.fn()}
    />)

    expect(screen.getByText('PI Extensions')).toBeInTheDocument()
  })

  it('hides PI Extensions when Claude backend', () => {
    render(<OverrideFormFields
      {...defaultProps}
      inheritedValues={{ ai_sdkBackend: 'claude-agent-sdk' }}
      piExtensions={piExtensions}
      piExtDisabledDraft={[]}
      piExtDisabledInherited={[]}
      isPiExtOverridden={false}
      onTogglePiExtOverride={vi.fn()}
      onTogglePiExtension={vi.fn()}
    />)

    expect(screen.queryByText('PI Extensions')).not.toBeInTheDocument()
  })

  it('hides PI Extensions when no extensions discovered', () => {
    render(<OverrideFormFields
      {...defaultProps}
      inheritedValues={{ ai_sdkBackend: 'pi' }}
      piExtensions={[]}
      piExtDisabledDraft={[]}
      piExtDisabledInherited={[]}
      isPiExtOverridden={false}
      onTogglePiExtOverride={vi.fn()}
      onTogglePiExtension={vi.fn()}
    />)

    expect(screen.queryByText('PI Extensions')).not.toBeInTheDocument()
  })

  it('shows extension checkboxes when PI Extensions is overridden', () => {
    render(<OverrideFormFields
      {...defaultProps}
      inheritedValues={{ ai_sdkBackend: 'pi' }}
      piExtensions={piExtensions}
      piExtDisabledDraft={[]}
      piExtDisabledInherited={[]}
      isPiExtOverridden={true}
      onTogglePiExtOverride={vi.fn()}
      onTogglePiExtension={vi.fn()}
    />)

    expect(screen.getByText('code-review')).toBeInTheDocument()
    expect(screen.getByText('test-runner')).toBeInTheDocument()
  })
})
