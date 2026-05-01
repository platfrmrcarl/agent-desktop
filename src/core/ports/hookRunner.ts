interface HookSystemMessage {
  content: string
  hookEvent: string
}

export interface HookRunner {
  /**
   * Run UserPromptSubmit hooks for the given user message.
   * Returns system messages to inject into the conversation.
   */
  runUserPromptSubmitHooks(
    userContent: string,
    cwd: string,
    permissionMode: string,
  ): Promise<HookSystemMessage[]>
}

/** No-op hook runner for headless/test contexts. */
export const noopHookRunner: HookRunner = {
  async runUserPromptSubmitHooks() { return [] },
}
