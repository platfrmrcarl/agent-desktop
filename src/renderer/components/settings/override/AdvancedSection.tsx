import type { McpServerName, PIExtensionInfo } from '../../../../shared/constants'
import type { CwdWhitelistEntry } from '../../../../shared/types'
import { SectionHeader } from './primitives'
import { McpServersField } from './McpServersField'
import { CwdRestrictionField } from './CwdRestrictionField'
import { CwdWhitelistField } from './CwdWhitelistField'
import { PiExtensionsField } from './PiExtensionsField'

export interface AdvancedSectionProps {
  isClaudeBackend: boolean
  draft: Record<string, string | undefined>
  inheritedValues: Record<string, string>
  inheritedSources?: Record<string, string>
  onDraftChange: (key: string, value: string) => void
  onToggleOverride: (key: string) => void

  // MCP
  mcpServers: McpServerName[]
  mcpDisabledDraft: string[]
  mcpDisabledInherited: string[]
  isMcpOverridden: boolean
  onToggleMcpOverride: () => void
  onToggleMcpServer: (name: string) => void

  // CWD whitelist
  cwdWhitelistDraft?: CwdWhitelistEntry[]
  cwdWhitelistInherited?: CwdWhitelistEntry[]
  isCwdWhitelistOverridden?: boolean
  onToggleCwdWhitelistOverride?: () => void
  onCwdWhitelistChange?: (entries: CwdWhitelistEntry[]) => void

  // PI extensions
  piExtensions?: PIExtensionInfo[]
  piExtDisabledDraft?: string[]
  piExtDisabledInherited?: string[]
  isPiExtOverridden?: boolean
  onTogglePiExtOverride?: () => void
  onTogglePiExtension?: (path: string) => void
}

export function AdvancedSection(props: AdvancedSectionProps) {
  const {
    isClaudeBackend,
    draft,
    inheritedValues,
    inheritedSources,
    onDraftChange,
    onToggleOverride,
    mcpServers,
    mcpDisabledDraft,
    mcpDisabledInherited,
    isMcpOverridden,
    onToggleMcpOverride,
    onToggleMcpServer,
    cwdWhitelistDraft,
    cwdWhitelistInherited,
    isCwdWhitelistOverridden,
    onToggleCwdWhitelistOverride,
    onCwdWhitelistChange,
    piExtensions,
    piExtDisabledDraft,
    piExtDisabledInherited,
    isPiExtOverridden,
    onTogglePiExtOverride,
    onTogglePiExtension,
  } = props

  const showMcp = isClaudeBackend && mcpServers.length > 0
  const showCwdRestriction = isClaudeBackend
  const showCwdWhitelist = isClaudeBackend && !!onToggleCwdWhitelistOverride && !!onCwdWhitelistChange
  const showPiExt = !isClaudeBackend && !!onTogglePiExtOverride && !!onTogglePiExtension && !!piExtensions && piExtensions.length > 0

  return (
    <div className="flex flex-col gap-1.5">
      <SectionHeader label="Advanced" />
      <div className="grid grid-cols-3 gap-2">
        {showMcp && (
          <McpServersField
            mcpServers={mcpServers}
            mcpDisabledDraft={mcpDisabledDraft}
            mcpDisabledInherited={mcpDisabledInherited}
            isMcpOverridden={isMcpOverridden}
            inheritedSource={inheritedSources?.['ai_mcpDisabled'] || 'Global'}
            onToggleMcpOverride={onToggleMcpOverride}
            onToggleMcpServer={onToggleMcpServer}
          />
        )}
        {showCwdRestriction && (
          <CwdRestrictionField
            draftValue={draft['hooks_cwdRestriction']}
            inheritedValue={inheritedValues['hooks_cwdRestriction'] ?? 'true'}
            inheritedSource={inheritedSources?.['hooks_cwdRestriction'] || 'Global'}
            onToggle={() => onToggleOverride('hooks_cwdRestriction')}
            onChange={(value) => onDraftChange('hooks_cwdRestriction', value)}
          />
        )}
        {showCwdWhitelist && (
          <CwdWhitelistField
            isCwdWhitelistOverridden={isCwdWhitelistOverridden ?? false}
            cwdWhitelistDraft={cwdWhitelistDraft ?? []}
            cwdWhitelistInherited={cwdWhitelistInherited ?? []}
            inheritedSource={inheritedSources?.['hooks_cwdWhitelist'] || 'Global'}
            onToggleCwdWhitelistOverride={onToggleCwdWhitelistOverride!}
            onCwdWhitelistChange={onCwdWhitelistChange!}
          />
        )}
        {showPiExt && (
          <PiExtensionsField
            piExtensions={piExtensions!}
            piExtDisabledDraft={piExtDisabledDraft || []}
            piExtDisabledInherited={piExtDisabledInherited || []}
            isPiExtOverridden={isPiExtOverridden ?? false}
            inheritedSource={inheritedSources?.['pi_disabledExtensions'] || 'Global'}
            onTogglePiExtOverride={onTogglePiExtOverride!}
            onTogglePiExtension={onTogglePiExtension!}
          />
        )}
      </div>
    </div>
  )
}
