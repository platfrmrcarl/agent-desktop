import { RadioGroup } from '../../shared/RadioGroup'
import { Toggle } from '../../shared/Toggle'
import type { PreRunAction } from '../../../../shared/types'

export type MaxRunsMode = 'unlimited' | 'once' | 'custom'

export interface AdvancedSectionProps {
  maxRunsMode: MaxRunsMode
  maxRunsValue: number
  catchUp: boolean
  notifyDesktop: boolean
  notifyVoice: boolean
  preRunAction: PreRunAction
  onMaxRunsModeChange: (v: MaxRunsMode) => void
  onMaxRunsValueChange: (v: number) => void
  onCatchUpChange: (v: boolean) => void
  onNotifyDesktopChange: (v: boolean) => void
  onNotifyVoiceChange: (v: boolean) => void
  onPreRunActionChange: (v: PreRunAction) => void
}

const PRE_RUN_OPTIONS = [
  { value: 'none' as const, label: 'Keep context', hint: 'Default — previous history is visible to the AI.' },
  { value: 'clear' as const, label: 'Clear context', hint: 'Resets the conversation history before the prompt. Zero LLM cost.' },
  { value: 'compact' as const, label: 'Compact (summarize, then clear)', hint: 'Summarizes previous history with Haiku, then clears. Falls back to plain clear if the summary fails.' },
]

const MAX_RUNS_OPTIONS = [
  { value: 'unlimited' as const, label: 'Unlimited' },
  { value: 'once' as const, label: 'Run once' },
  { value: 'custom' as const, label: 'Custom' },
]

export function AdvancedSection({
  maxRunsMode,
  maxRunsValue,
  catchUp,
  notifyDesktop,
  notifyVoice,
  preRunAction,
  onMaxRunsModeChange,
  onMaxRunsValueChange,
  onCatchUpChange,
  onNotifyDesktopChange,
  onNotifyVoiceChange,
  onPreRunActionChange,
}: AdvancedSectionProps) {
  return (
    <>
      {/* Execution limit */}
      <fieldset className="border-0 p-0 m-0">
        <legend className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
          Execution limit
        </legend>
        <div className="flex flex-col gap-1.5">
          {MAX_RUNS_OPTIONS.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="maxRunsMode"
                checked={maxRunsMode === value}
                onChange={() => onMaxRunsModeChange(value)}
                className="accent-[var(--color-primary)]"
              />
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</span>
              {value === 'custom' && maxRunsMode === 'custom' && (
                <input
                  type="number"
                  min={2}
                  value={maxRunsValue}
                  onChange={(e) => onMaxRunsValueChange(Math.max(2, Number(e.target.value)))}
                  className="w-20 px-2 py-1 rounded text-sm outline-none ml-1"
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    border: '1px solid var(--color-text-muted)/20',
                  }}
                />
              )}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Pre-run context action */}
      <RadioGroup<PreRunAction>
        legend="Before each run"
        name="preRunAction"
        value={preRunAction}
        onChange={onPreRunActionChange}
        options={PRE_RUN_OPTIONS}
      />

      {/* Toggles */}
      <div className="space-y-2">
        <label className="flex items-center gap-3 cursor-pointer">
          <Toggle enabled={catchUp} onToggle={() => onCatchUpChange(!catchUp)} label="Catch up missed runs" />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Catch up missed runs</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <Toggle enabled={notifyDesktop} onToggle={() => onNotifyDesktopChange(!notifyDesktop)} label="Desktop notification" />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Desktop notification</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <Toggle enabled={notifyVoice} onToggle={() => onNotifyVoiceChange(!notifyVoice)} label="Voice notification (TTS)" />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Voice notification (TTS)</span>
        </label>
      </div>
    </>
  )
}
