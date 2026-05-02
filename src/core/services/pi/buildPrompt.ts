// PI-SDK prompt construction: slash command detection + history injection.
//
// Slash commands are passed directly to session.prompt() so the PI SDK can route
// them to extension handlers. All other prompts get the full message history
// (via buildPromptWithHistory) and an optional system_context prefix.

import { buildPromptWithHistory } from '../streaming'

interface MessageParam {
  role: 'user' | 'assistant'
  content: string
}

export function buildPrompt(
  messages: MessageParam[],
  systemPrompt: string | undefined,
): string {
  const lastContent = messages[messages.length - 1]?.content?.trim() || ''
  const isSlashCommand = /^\/[\w-]+/.test(lastContent)

  if (isSlashCommand) {
    // Pass command directly so PI SDK can route to extension handler
    return lastContent
  }

  const historyPrompt = buildPromptWithHistory(messages)
  return systemPrompt
    ? `<system_context>\n${systemPrompt}\n</system_context>\n\n${historyPrompt}`
    : historyPrompt
}
