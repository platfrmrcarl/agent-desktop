/** Canonical MCP tool name: `mcp__<server>__<tool>` */
export function mcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`
}

/** Wildcard pattern for all tools of an MCP server: `mcp__<server>__*` */
export function mcpServerWildcard(serverName: string): string {
  return `mcp__${serverName}__*`
}
