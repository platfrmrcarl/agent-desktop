import { SearchableModelPicker } from '../../shared/SearchableModelPicker'
import type { ModelPickerOption } from '../../shared/SearchableModelPicker'
import { inputStyle, DEFAULT_SUMMARY_PROMPT } from './shared'

const CUSTOM_OPTION: ModelPickerOption = { value: '__custom__', label: 'Custom...' }

interface SummaryPromptSectionProps {
  responseMode: string
  summaryModel: string
  summaryPrompt: string
  fetchedModels: ModelPickerOption[]
  onSummaryModelChange: (value: string) => void
  onSummaryPromptChange: (value: string) => void
}

export function SummaryPromptSection({
  responseMode,
  summaryModel,
  summaryPrompt,
  fetchedModels,
  onSummaryModelChange,
  onSummaryPromptChange,
}: SummaryPromptSectionProps) {
  const showSummary = responseMode === 'summary' || responseMode === 'auto'
  if (!showSummary) return null

  const isPresetModel = !summaryModel || fetchedModels.some((o) => o.value === summaryModel)
  const isCustomModel = summaryModel !== '' && !isPresetModel

  const pickerValue = isCustomModel ? '__custom__' : (summaryModel || fetchedModels[0]?.value || '')

  return (
    <>
      {/* Summary Model */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Summary Model
        </label>
        <SearchableModelPicker
          value={pickerValue}
          options={fetchedModels}
          extraOptions={[CUSTOM_OPTION]}
          onChange={(val) => onSummaryModelChange(val === '__custom__' ? '' : val)}
          buttonLabel="Summary Model"
          ariaLabel="TTS summary model"
          align="left"
          className="w-full"
        />
        {isCustomModel && (
          <input
            type="text"
            value={summaryModel}
            onChange={(e) => onSummaryModelChange(e.target.value)}
            placeholder="model-name"
            className="w-full px-3 py-2 rounded text-sm outline-none mobile:text-base"
            style={inputStyle}
            aria-label="Custom summary model"
          />
        )}
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Model used to generate TTS summaries. Use &quot;Custom...&quot; for third-party API models.
        </span>
      </div>

      {/* Summary prompt */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Summary Prompt
        </label>
        <textarea
          value={summaryPrompt}
          onChange={(e) => onSummaryPromptChange(e.target.value)}
          placeholder={DEFAULT_SUMMARY_PROMPT}
          rows={4}
          className="w-full px-3 py-2 rounded text-sm outline-none resize-y mobile:text-base"
          style={inputStyle}
          aria-label="Summary prompt"
        />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Prompt used to summarize responses for speech. Use <code>{'{response}'}</code> as a placeholder for the AI response text.
        </span>
      </div>
    </>
  )
}
