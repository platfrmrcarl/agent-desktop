import type { McpServerName } from '../../../../shared/constants'
import { Checkbox } from '../../ui/Checkbox'
import { FieldCard, InheritedText } from './primitives'

export interface McpServersFieldProps {
  mcpServers: McpServerName[]
  mcpDisabledDraft: string[]
  mcpDisabledInherited: string[]
  isMcpOverridden: boolean
  inheritedSource: string
  onToggleMcpOverride: () => void
  onToggleMcpServer: (name: string) => void
}

export function McpServersField({
  mcpServers,
  mcpDisabledDraft,
  mcpDisabledInherited,
  isMcpOverridden,
  inheritedSource,
  onToggleMcpOverride,
  onToggleMcpServer,
}: McpServersFieldProps) {
  if (isMcpOverridden) {
    return (
      <FieldCard label="MCP Servers" active onToggle={onToggleMcpOverride} wide>
        <div
          className="flex flex-col gap-0.5 rounded px-1 py-1 max-h-[120px] overflow-y-auto"
          style={{ backgroundColor: 'var(--color-surface)' }}
          role="group"
          aria-label="MCP server toggles"
        >
          {mcpServers.map((server) => {
            const serverActive = !mcpDisabledDraft.includes(server.name)
            return (
              <button
                key={server.name}
                onClick={() => onToggleMcpServer(server.name)}
                className="flex items-center gap-2 py-0.5 text-xs text-left hover:opacity-80"
                style={{ color: 'var(--color-text)' }}
                role="checkbox"
                aria-checked={serverActive}
              >
                <Checkbox checked={serverActive} />
                <span style={{ opacity: serverActive ? 1 : 0.5 }}>{server.name}</span>
              </button>
            )
          })}
        </div>
      </FieldCard>
    )
  }

  return (
    <FieldCard label="MCP Servers" active={false} onToggle={onToggleMcpOverride}>
      <InheritedText
        value={mcpDisabledInherited.length > 0
          ? `${mcpServers.length - mcpDisabledInherited.length}/${mcpServers.length} enabled`
          : `All ${mcpServers.length} enabled`}
        source={inheritedSource}
      />
    </FieldCard>
  )
}
