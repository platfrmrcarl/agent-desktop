import { useState, useCallback } from 'react'
import { inputStyle } from './shared'

export interface ValidationResult {
  provider: string | null
  providerFound: boolean
  playerFound: boolean
  playerPath: string
  error?: string
}

interface ResponseModeSectionProps {
  provider: string
  responseMode: string
  maxLength: string
  autoWordLimit: string
  validation: ValidationResult | null
  onResponseModeChange: (value: string) => void
  onMaxLengthChange: (value: string) => void
  onAutoWordLimitChange: (value: string) => void
  onValidationChange: (result: ValidationResult | null) => void
}

export function ResponseModeSection({
  provider,
  responseMode,
  maxLength,
  autoWordLimit,
  validation,
  onResponseModeChange,
  onMaxLengthChange,
  onAutoWordLimitChange,
  onValidationChange,
}: ResponseModeSectionProps) {
  const [testing, setTesting] = useState(false)

  const handleTest = useCallback(async () => {
    setTesting(true)
    onValidationChange(null)
    try {
      const result = await window.agent.tts.validate()
      onValidationChange(result)
      if (result.providerFound && (result.playerFound || provider === 'spd-say' || provider === 'say')) {
        try {
          await window.agent.tts.speak('This is a test of the text to speech system.')
        } catch (speakErr) {
          const msg = speakErr instanceof Error ? speakErr.message : 'Speech failed'
          onValidationChange({ ...result, error: (result.error ? result.error + '; ' : '') + msg })
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Validation failed'
      onValidationChange({ provider: null, providerFound: false, playerFound: false, playerPath: '', error: msg })
    } finally {
      setTesting(false)
    }
  }, [provider, onValidationChange])

  return (
    <>
      {/* Max Text Length */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Max Text Length
        </label>
        <input
          type="number"
          value={maxLength}
          onChange={(e) => onMaxLengthChange(e.target.value)}
          min={0}
          max={50000}
          step={100}
          className="w-32 px-3 py-2 rounded text-sm outline-none mobile:text-base"
          style={inputStyle}
          aria-label="Max text length"
        />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Maximum characters to send to the TTS provider (0 = no limit)
        </span>
      </div>

      {/* Test button + results */}
      <div className="flex flex-col gap-2">
        <button
          onClick={handleTest}
          disabled={testing}
          className="self-start px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 bg-tool text-contrast mobile:py-3"
          style={{ opacity: testing ? 0.6 : 1 }}
        >
          {testing ? 'Testing...' : 'Test Voice'}
        </button>

        {validation && (
          <div
            className="flex flex-col gap-1.5 px-3 py-2 rounded text-sm"
            style={{
              backgroundColor: 'var(--color-bg)',
              border: `1px solid ${validation.providerFound && validation.playerFound ? 'var(--color-success)' : 'var(--color-error)'}`,
            }}
          >
            <div className="flex items-center gap-2">
              <span>{validation.providerFound ? '✓' : '✗'}</span>
              <span style={{ color: validation.providerFound ? 'var(--color-success)' : 'var(--color-error)' }}>
                Provider: {validation.provider || '(not configured)'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span>{validation.playerFound ? '✓' : '✗'}</span>
              <span style={{ color: validation.playerFound ? 'var(--color-success)' : 'var(--color-error)' }}>
                Player: {validation.playerPath || '(not found)'}
              </span>
            </div>
            {validation.error && (
              <div className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>
                {validation.error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Divider */}
      <div
        className="border-t pt-4"
        style={{ borderColor: 'var(--color-text-muted)', opacity: 0.2 }}
      />
      <h4
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: 'var(--color-text-muted)' }}
      >
        AI Response TTS
      </h4>

      {/* Response Mode */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Response Mode
        </label>
        <select
          value={responseMode}
          onChange={(e) => onResponseModeChange(e.target.value)}
          className="w-full px-3 py-2 rounded text-sm outline-none mobile:text-base"
          style={inputStyle}
          aria-label="TTS response mode"
        >
          <option value="off">Off</option>
          <option value="full">Full Response</option>
          <option value="summary">Summary</option>
          <option value="auto">Auto (Full or Summary)</option>
        </select>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Automatically speak AI responses. &quot;Auto&quot; reads in full if under the word limit, otherwise summarizes.
        </span>
      </div>

      {/* Auto mode: word limit */}
      {responseMode === 'auto' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Word Limit
          </label>
          <input
            type="number"
            value={autoWordLimit}
            onChange={(e) => onAutoWordLimitChange(e.target.value)}
            min={10}
            max={10000}
            step={10}
            className="w-32 px-3 py-2 rounded text-sm outline-none mobile:text-base"
            style={inputStyle}
            aria-label="Auto mode word limit"
          />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Responses under this word count are read in full; longer ones are summarized.
          </span>
        </div>
      )}
    </>
  )
}
