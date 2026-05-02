/**
 * Minimal Proxy-based mock of `window.agent` (preload IPC bridge).
 *
 * Why a Proxy: the real bridge has 80+ namespaces with hundreds of methods
 * (auth, conversations, messages, mcp, scheduler, settings, ...). Stubbing each
 * by hand would be hundreds of lines and would drift as the bridge evolves.
 * The Proxy auto-resolves any access path to a no-op async function so stories
 * never throw on `window.agent.X.Y(...)` regardless of the real shape.
 *
 * Per-story override: replace the result with a custom `vi.fn()` mock or a
 * spy by setting `window.agent.<namespace>.<method> = ...` inside the story's
 * `play` or `decorators`.
 */

const cleanup = (): void => {}
const noop = (): Promise<undefined> => Promise.resolve(undefined)

function isSubscriptionMethod(prop: string): boolean {
  return prop.startsWith('on')
}

function makeNamespace(): unknown {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop === 'then') return undefined
      if (isSubscriptionMethod(prop)) return () => cleanup
      return noop
    },
  })
}

export function createMockAgentBridge(): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop === 'then') return undefined
      return makeNamespace()
    },
  })
}
