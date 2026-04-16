import { useConversationsStore } from '../stores/conversationsStore'

export function useActiveConversationCwd(): string | null {
  return useConversationsStore((s) => {
    const conv = s.conversations.find((c) => c.id === s.activeConversationId)
    return conv?.cwd ?? null
  })
}
