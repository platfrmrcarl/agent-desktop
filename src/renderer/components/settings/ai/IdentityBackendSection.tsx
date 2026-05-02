import { SDK_BACKEND_OPTIONS, type PIExtensionInfo } from '../../../../shared/constants'
import { tint } from '../../../utils/colorMix'
import { SettingRow } from '../../shared/SettingRow'

export interface IdentityBackendSectionProps {
  agentName: string
  agentLanguage: string
  agentPersonality: string
  sdkBackend: string
  isClaudeBackend: boolean
  piExtensionsDir: string
  piExtensions: PIExtensionInfo[]
  piDisabledExtensions: string[]
  onAgentNameChange: (value: string) => void
  onAgentLanguageChange: (value: string) => void
  onAgentPersonalityChange: (value: string) => void
  onSdkBackendChange: (value: string) => void
  onPiExtensionsDirChange: (value: string) => void
  onPiDisabledExtensionsChange: (next: string[]) => void
  onBrowseExtensionsDir: () => void
}

/**
 * Agent identity, SDK backend selector, and PI extensions browser.
 * Pure leaf — receives plain data + callbacks; no Zustand.
 */
export function IdentityBackendSection(props: IdentityBackendSectionProps) {
  const {
    agentName,
    agentLanguage,
    agentPersonality,
    sdkBackend,
    isClaudeBackend,
    piExtensionsDir,
    piExtensions,
    piDisabledExtensions,
    onAgentNameChange,
    onAgentLanguageChange,
    onAgentPersonalityChange,
    onSdkBackendChange,
    onPiExtensionsDirChange,
    onPiDisabledExtensionsChange,
    onBrowseExtensionsDir,
  } = props

  return (
    <>
      <SettingRow label="Agent Name" description="Display name shown in chat bubbles.">
        <input
          type="text"
          value={agentName}
          onChange={(e) => onAgentNameChange(e.target.value)}
          placeholder="Claude"
          className="w-48 px-3 py-1.5 rounded text-sm border outline-none mobile:text-base"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Agent name"
        />
      </SettingRow>

      <SettingRow label="Language" description="Response language injected into the system prompt.">
        <input
          type="text"
          value={agentLanguage}
          onChange={(e) => onAgentLanguageChange(e.target.value)}
          placeholder="e.g. Français, English, Español"
          className="w-48 px-3 py-1.5 rounded text-sm border outline-none mobile:text-base"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Agent language"
        />
      </SettingRow>

      <div
        className="flex flex-col gap-2 py-3 border-b"
        style={{ borderColor: tint('--color-text-muted', 10) }}
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Personality
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Personality directive injected into the system prompt.
          </span>
        </div>
        <textarea
          value={agentPersonality}
          onChange={(e) => onAgentPersonalityChange(e.target.value)}
          rows={2}
          placeholder="e.g. concis et technique, chaleureux et pédagogue"
          className="w-full px-3 py-2 rounded text-sm border outline-none resize-y mobile:text-base"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Agent personality"
        />
      </div>

      <SettingRow
        label="Backend"
        description="Claude Agent SDK has more built-in features. PI is extensible via TypeScript extensions."
      >
        <select
          value={sdkBackend}
          onChange={(e) => onSdkBackendChange(e.target.value)}
          className="px-3 py-1.5 rounded text-sm border outline-none mobile:text-base mobile:py-2"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Select SDK backend"
        >
          {SDK_BACKEND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </SettingRow>

      {!isClaudeBackend && (
        <SettingRow
          label="Extensions Directory"
          description="Additional directory for PI extensions (.ts files). Added to default paths."
        >
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={piExtensionsDir}
              onChange={(e) => onPiExtensionsDirChange(e.target.value)}
              placeholder="~/.pi/agent/extensions/"
              className="w-56 px-3 py-1.5 rounded text-sm border outline-none font-mono mobile:text-base"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                borderColor: tint('--color-text-muted', 20),
              }}
              aria-label="PI extensions directory"
            />
            <button
              onClick={onBrowseExtensionsDir}
              className="px-2 py-1.5 rounded text-xs transition-opacity hover:opacity-70 mobile:px-4 mobile:py-3 mobile:text-sm mobile:hidden"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label="Browse for extensions directory"
            >
              Browse
            </button>
          </div>
        </SettingRow>
      )}

      {!isClaudeBackend && piExtensions.length > 0 && (
        <div
          className="py-3 border-b"
          style={{ borderColor: tint('--color-text-muted', 10) }}
        >
          <span className="text-xs font-medium mb-2 block" style={{ color: 'var(--color-text-muted)' }}>
            Discovered Extensions
          </span>
          <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
            {piExtensions.map((ext) => {
              const isDisabled = piDisabledExtensions.includes(ext.path)
              return (
                <label
                  key={ext.path}
                  className="flex items-center gap-2 px-2 py-1 rounded text-sm cursor-pointer hover:opacity-80"
                  style={{ color: 'var(--color-text)' }}
                >
                  <input
                    type="checkbox"
                    checked={!isDisabled}
                    onChange={() => {
                      const next = isDisabled
                        ? piDisabledExtensions.filter((p) => p !== ext.path)
                        : [...piDisabledExtensions, ext.path]
                      onPiDisabledExtensionsChange(next)
                    }}
                    className="rounded"
                  />
                  <span className="flex-shrink-0">{ext.name}</span>
                  <span className="text-xs truncate min-w-0" style={{ color: 'var(--color-text-muted)' }}>
                    {ext.path.split('/').slice(-3).join('/')}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
