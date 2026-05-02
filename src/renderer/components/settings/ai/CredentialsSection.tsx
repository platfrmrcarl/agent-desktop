import { useState } from 'react'
import { tint } from '../../../utils/colorMix'
import { SettingRow } from '../../shared/SettingRow'

export interface CredentialsSectionProps {
  apiKey: string
  baseUrl: string
  onApiKeyChange: (value: string) => void
  onBaseUrlChange: (value: string) => void
}

/**
 * API key (with show/hide toggle) and Base URL editor.
 * Rendered only on the Claude backend — caller decides whether to mount.
 */
export function CredentialsSection(props: CredentialsSectionProps) {
  const { apiKey, baseUrl, onApiKeyChange, onBaseUrlChange } = props
  const [showApiKey, setShowApiKey] = useState(false)

  return (
    <>
      <SettingRow label="API Key" description="Anthropic API key. Bypasses OAuth when set.">
        <div className="flex items-center gap-1">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="sk-ant-..."
            className="w-48 px-3 py-1.5 rounded text-sm border outline-none font-mono mobile:text-base"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderColor: tint('--color-text-muted', 20),
            }}
            aria-label="API key"
          />
          <button
            onClick={() => setShowApiKey((v) => !v)}
            className="px-2 py-1.5 rounded text-xs transition-opacity hover:opacity-70 mobile:px-4 mobile:py-3 mobile:text-sm"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
            title={showApiKey ? 'Hide' : 'Show'}
          >
            {showApiKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </SettingRow>

      {apiKey && (
        <SettingRow label="Base URL" description="Custom API endpoint (OpenRouter, proxy, etc).">
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            placeholder="https://api.anthropic.com"
            className="w-56 px-3 py-1.5 rounded text-sm border outline-none font-mono mobile:text-base"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderColor: tint('--color-text-muted', 20),
            }}
            aria-label="Base URL"
          />
        </SettingRow>
      )}
    </>
  )
}
