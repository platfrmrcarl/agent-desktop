import type { VariableInfo } from '../../../../shared/types'

interface Conversation {
  id: number
  title: string
}

export interface PromptSectionProps {
  name: string
  prompt: string
  conversationId: number | 'new'
  conversations: Conversation[]
  variables: VariableInfo[]
  onNameChange: (v: string) => void
  onPromptChange: (v: string) => void
  onConversationIdChange: (v: number | 'new') => void
}

const inputStyle = {
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-text-muted)/20',
}

export function PromptSection({
  name,
  prompt,
  conversationId,
  conversations,
  variables,
  onNameChange,
  onPromptChange,
  onConversationIdChange,
}: PromptSectionProps) {
  return (
    <>
      {/* Name */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
          Name
        </label>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. News summary"
          className="w-full px-3 py-2 rounded text-sm outline-none"
          style={inputStyle}
          autoFocus
        />
      </div>

      {/* Prompt */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
          Prompt
        </label>
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="The message sent to the conversation each time..."
          rows={4}
          className="w-full px-3 py-2 rounded text-sm outline-none resize-y"
          style={inputStyle}
        />
        {variables.length > 0 && (
          <details className="mt-2 group">
            <summary
              className="cursor-pointer select-none text-xs flex items-center gap-1.5 py-1"
              style={{ color: 'var(--color-text-muted)', listStyle: 'none' }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                className="transition-transform group-open:rotate-90"
                fill="currentColor"
              >
                <path d="M3 1l4 4-4 4V1z" />
              </svg>
              <span>
                Available variables ({variables.length}) — use <code className="font-mono">{'{name}'}</code> or{' '}
                <code className="font-mono">{'{name:arg}'}</code>
              </span>
            </summary>
            <div
              className="mt-2 rounded p-2 max-h-56 overflow-y-auto space-y-1.5 text-xs"
              style={{
                backgroundColor: 'var(--color-bg)',
                border: '1px solid color-mix(in srgb, var(--color-text-muted) 15%, transparent)',
              }}
            >
              {variables.map((v) => (
                <div key={v.name} className="flex items-start gap-2">
                  <code
                    className="font-mono px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
                      color: 'var(--color-text)',
                    }}
                  >
                    {'{'}{v.name}{v.argsHint ? `:${v.argsHint}` : ''}{'}'}
                  </code>
                  {v.source === 'custom' && (
                    <span
                      className="text-[0.625rem] uppercase px-1 py-0.5 rounded shrink-0"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--color-accent, var(--color-primary)) 20%, transparent)',
                        color: 'var(--color-text)',
                      }}
                    >
                      custom
                    </span>
                  )}
                  <span style={{ color: 'var(--color-text-muted)' }}>{v.description}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Conversation */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
          Conversation
        </label>
        <select
          value={conversationId}
          onChange={(e) =>
            onConversationIdChange(e.target.value === 'new' ? 'new' : Number(e.target.value))
          }
          className="w-full px-3 py-2 rounded text-sm outline-none"
          style={inputStyle}
        >
          <option value="new">+ Create new conversation</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}
