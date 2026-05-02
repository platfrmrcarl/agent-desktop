import { useState, useEffect } from 'react'
import type { ScheduledTask, CreateScheduledTask, IntervalUnit, VariableInfo, PreRunAction } from '../../../shared/types'
import { useConversationsStore } from '../../stores/conversationsStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { tint } from '../../utils/colorMix'
import { PromptSection } from './taskForm/PromptSection'
import { ScheduleSection } from './taskForm/ScheduleSection'
import { AdvancedSection, type MaxRunsMode } from './taskForm/AdvancedSection'

interface Props {
  task?: ScheduledTask | null
  initialPrompt?: string
  initialConversationId?: number
  onSave: (data: CreateScheduledTask) => Promise<void>
  onClose: () => void
}

interface FormState {
  name: string
  prompt: string
  conversationId: number | 'new'
  intervalValue: number
  intervalUnit: IntervalUnit
  scheduleTime: string
  catchUp: boolean
  notifyDesktop: boolean
  maxRunsMode: MaxRunsMode
  maxRunsValue: number
  notifyVoice: boolean
  preRunAction: PreRunAction
}

function resolveMaxRunsMode(maxRuns: number | null | undefined): MaxRunsMode {
  if (maxRuns == null) return 'unlimited'
  if (maxRuns === 1) return 'once'
  return 'custom'
}

function resolveMaxRunsValue(maxRuns: number | null | undefined): number {
  return maxRuns != null && maxRuns > 1 ? maxRuns : 5
}

function autoNameFromPrompt(p: string): string {
  if (!p) return ''
  return p.length > 50 ? p.slice(0, 50).trim() + '...' : p
}

function getInitialFormState(
  task: ScheduledTask | null | undefined,
  initialPrompt: string | undefined,
  initialConversationId: number | undefined,
): FormState {
  const effectivePrompt = initialPrompt ?? (task ? task.prompt : '')
  const maxRuns = task ? task.max_runs : undefined
  return {
    name: (task && task.name) || autoNameFromPrompt(effectivePrompt),
    prompt: effectivePrompt,
    conversationId: initialConversationId ?? (task ? task.conversation_id : 'new'),
    intervalValue: (task && task.interval_value) || 1,
    intervalUnit: (task && task.interval_unit) || 'hours',
    scheduleTime: (task && task.schedule_time) || '',
    catchUp: task ? task.catch_up !== false : true,
    notifyDesktop: task ? task.notify_desktop !== false : true,
    maxRunsMode: resolveMaxRunsMode(maxRuns),
    maxRunsValue: resolveMaxRunsValue(maxRuns),
    notifyVoice: (task && task.notify_voice) || false,
    preRunAction: (task && task.pre_run_action) || 'none',
  }
}

export function TaskFormModal({ task, initialPrompt, initialConversationId, onSave, onClose }: Props) {
  const { conversations, loadConversations } = useConversationsStore()

  const init = getInitialFormState(task, initialPrompt, initialConversationId)
  const [name, setName] = useState(init.name)
  const [prompt, setPrompt] = useState(init.prompt)
  const [conversationId, setConversationId] = useState<number | 'new'>(init.conversationId)
  const [intervalValue, setIntervalValue] = useState(init.intervalValue)
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(init.intervalUnit)
  const [scheduleTime, setScheduleTime] = useState(init.scheduleTime)
  const [catchUp, setCatchUp] = useState(init.catchUp)
  const [notifyDesktop, setNotifyDesktop] = useState(init.notifyDesktop)
  const [maxRunsMode, setMaxRunsMode] = useState<MaxRunsMode>(init.maxRunsMode)
  const [maxRunsValue, setMaxRunsValue] = useState(init.maxRunsValue)
  const [notifyVoice, setNotifyVoice] = useState(init.notifyVoice)
  const [preRunAction, setPreRunAction] = useState<PreRunAction>(init.preRunAction)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [variables, setVariables] = useState<VariableInfo[]>([])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    window.agent.scheduler.listVariables()
      .then((list) => setVariables(list))
      .catch(() => setVariables([]))
  }, [])

  useEscapeKey(onClose)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (!prompt.trim()) { setError('Prompt is required'); return }
    if (intervalValue < 1) { setError('Interval must be at least 1'); return }

    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        prompt: prompt.trim(),
        conversation_id: conversationId === 'new' ? undefined : conversationId,
        interval_value: intervalValue,
        interval_unit: intervalUnit,
        schedule_time: intervalUnit === 'days' && scheduleTime ? scheduleTime : undefined,
        catch_up: catchUp,
        max_runs: maxRunsMode === 'unlimited' ? null : maxRunsMode === 'once' ? 1 : maxRunsValue,
        notify_desktop: notifyDesktop,
        notify_voice: notifyVoice,
        pre_run_action: preRunAction,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg compact:max-w-[calc(100vw-1rem)] rounded-lg shadow-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 compact:px-4 py-4 border-b"
          style={{ borderColor: tint('--color-text-muted', 10) }}
        >
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            {task ? 'Edit Task' : 'New Scheduled Task'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--color-bg)] transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M1.05 1.05a.5.5 0 01.707 0L7 6.293l5.243-5.243a.5.5 0 11.707.707L7.707 7l5.243 5.243a.5.5 0 11-.707.707L7 7.707l-5.243 5.243a.5.5 0 01-.707-.707L6.293 7 1.05 1.757a.5.5 0 010-.707z" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 compact:px-4 py-4 space-y-4 overflow-y-auto max-h-[70vh] compact:max-h-[70dvh]">
          {error && (
            <div className="text-sm p-2 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', color: 'var(--color-error)' }}>
              {error}
            </div>
          )}

          <PromptSection
            name={name}
            prompt={prompt}
            conversationId={conversationId}
            conversations={conversations}
            variables={variables}
            onNameChange={setName}
            onPromptChange={setPrompt}
            onConversationIdChange={setConversationId}
          />

          <ScheduleSection
            intervalValue={intervalValue}
            intervalUnit={intervalUnit}
            scheduleTime={scheduleTime}
            onIntervalValueChange={setIntervalValue}
            onIntervalUnitChange={setIntervalUnit}
            onScheduleTimeChange={setScheduleTime}
          />

          <AdvancedSection
            maxRunsMode={maxRunsMode}
            maxRunsValue={maxRunsValue}
            catchUp={catchUp}
            notifyDesktop={notifyDesktop}
            notifyVoice={notifyVoice}
            preRunAction={preRunAction}
            onMaxRunsModeChange={setMaxRunsMode}
            onMaxRunsValueChange={setMaxRunsValue}
            onCatchUpChange={setCatchUp}
            onNotifyDesktopChange={setNotifyDesktop}
            onNotifyVoiceChange={setNotifyVoice}
            onPreRunActionChange={setPreRunAction}
          />

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded text-sm transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-text-contrast)' }}
            >
              {saving ? 'Saving...' : task ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
