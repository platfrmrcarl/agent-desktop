import { useEffect, useState, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAuthStore } from '../../stores/authStore'
import { DEFAULT_MODEL, SETTING_SOURCES_OPTIONS, SKILLS_TOGGLE_OPTIONS, SDK_BACKEND_OPTIONS, CONFIG_SHARING_OPTIONS, parseCustomModels, parseCustomModelContextLengths, shortenModelName, type PIExtensionInfo } from '../../../shared/constants'
import { useModelsStore } from '../../stores/modelsStore'
import { SearchableModelPicker } from '../shared/SearchableModelPicker'
import { SystemPromptEditorModal } from './SystemPromptEditorModal'
import { CwdWhitelistEditor } from './CwdWhitelistEditor'
import type { CwdWhitelistEntry } from '../../../shared/types'
import { tint } from '../../utils/colorMix'
import { SettingRow } from '../shared/SettingRow'

export function AISettings() {
  const { settings, loadSettings, setSetting } = useSettingsStore()
  const { checkAuth } = useAuthStore()

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const sdkBackend = settings['ai_sdkBackend'] ?? 'claude-agent-sdk'
  const isClaudeBackend = sdkBackend !== 'pi'
  const apiKey = settings['ai_apiKey'] ?? ''
  const baseUrl = settings['ai_baseUrl'] ?? ''
  const customModel = settings['ai_customModel'] ?? ''
  const [showApiKey, setShowApiKey] = useState(false)

  const handleApiKeyChange = useCallback((value: string) => {
    setSetting('ai_apiKey', value)
    // Re-check auth status after a brief delay (API key auth is instant)
    setTimeout(() => checkAuth(), 300)
  }, [setSetting, checkAuth])

  const model = settings['ai_model'] ?? DEFAULT_MODEL
  const isCustomModel = !!customModel
  const customModels = parseCustomModels(settings['ai_customModels'])
  const customModelContextLengths = parseCustomModelContextLengths(settings['ai_customModelContextLengths'])

  const setCustomModelContextLength = useCallback((modelId: string, lengthInK: number | null) => {
    const next = { ...customModelContextLengths }
    if (lengthInK == null || lengthInK <= 0) {
      delete next[modelId]
    } else {
      next[modelId] = Math.round(lengthInK * 1000)
    }
    setSetting('ai_customModelContextLengths', JSON.stringify(next))
  }, [customModelContextLengths, setSetting])
  const fetchedModels = useModelsStore((s) => s.models)
  const fetchModels = useModelsStore((s) => s.fetch)
  useEffect(() => { fetchModels(sdkBackend) }, [fetchModels, sdkBackend])
  const presetValues = new Set(fetchedModels.map(o => o.value))
  const maxTurns = settings['ai_maxTurns'] ?? '1'
  const maxThinkingTokens = settings['ai_maxThinkingTokens'] ?? '0'
  const maxBudgetUsd = settings['ai_maxBudgetUsd'] ?? '0'
  const permissionMode = settings['ai_permissionMode'] ?? 'bypassPermissions'
  const requirePlanApproval = settings['ai_requirePlanApproval'] ?? 'true'
  const skills = settings['ai_skills'] ?? 'off'
  const [skillsOverhead, setSkillsOverhead] = useState<Record<'off' | 'user' | 'project' | 'local', { tokens: number; count: number }> | null>(null)

  useEffect(() => {
    if (!isClaudeBackend) return
    window.agent.context.getSkillsOverhead()
      .then((r) => setSkillsOverhead(r as never))
      .catch(() => setSkillsOverhead(null))
  }, [isClaudeBackend])
  const sharedHooks = settings['settings_sharedAcrossBackends'] ?? 'true'
  const cwdRestriction = settings['hooks_cwdRestriction'] ?? 'true'
  const cwdWhitelistRaw = settings['hooks_cwdWhitelist'] ?? '[]'
  const cwdWhitelist: CwdWhitelistEntry[] = (() => {
    try { return JSON.parse(cwdWhitelistRaw) } catch { return [] }
  })()
  const defaultSystemPrompt = settings['ai_defaultSystemPrompt'] ?? ''
  const compactModel = settings['ai_compactModel'] ?? ''
  const titleModel = settings['ai_titleModel'] ?? ''
  const isCompactModelCustom = compactModel !== '' && !fetchedModels.some(o => o.value === compactModel)
  const isTitleModelCustom = titleModel !== '' && !fetchedModels.some(o => o.value === titleModel)
  const agentName = settings['agent_name'] ?? ''
  const agentPersonality = settings['agent_personality'] ?? ''
  const agentLanguage = settings['agent_language'] ?? ''
  const skillsEnabled = settings['ai_skillsEnabled'] ?? 'true'
  const skillsIncludePlugins = settings['ai_skillsIncludePlugins'] ?? 'false'
  const disabledSkills: string[] = (() => {
    try { const arr = JSON.parse(settings['ai_disabledSkills'] || '[]'); return Array.isArray(arr) ? arr : [] } catch { return [] }
  })()
  const [discoveredSkills, setDiscoveredSkills] = useState<import('../../../shared/types').SlashCommand[]>([])
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [showPromptEditor, setShowPromptEditor] = useState(false)

  const saveCustomModel = useCallback((value: string) => {
    const trimmed = value.trim()
    if (!trimmed || presetValues.has(trimmed) || customModels.includes(trimmed)) return
    setSetting('ai_customModels', JSON.stringify([...customModels, trimmed]))
  }, [customModels, presetValues, setSetting])

  const removeCustomModel = useCallback((value: string) => {
    const next = customModels.filter(m => m !== value)
    setSetting('ai_customModels', JSON.stringify(next))
    if (model === value) {
      setSetting('ai_model', DEFAULT_MODEL)
      setSetting('ai_customModel', '')
    }
  }, [customModels, model, setSetting])

  // PI Extensions state
  const piExtensionsDir = settings['pi_extensionsDir'] ?? ''
  const piDisabledExtensions: string[] = (() => {
    try { const arr = JSON.parse(settings['pi_disabledExtensions'] || '[]'); return Array.isArray(arr) ? arr : [] } catch { return [] }
  })()
  const [piExtensions, setPiExtensions] = useState<PIExtensionInfo[]>([])

  useEffect(() => {
    if (skills === 'off') {
      setDiscoveredSkills([])
      return
    }
    window.agent.commands.list(undefined, skills).then((cmds: import('../../../shared/types').SlashCommand[]) => {
      setDiscoveredSkills(cmds.filter(c => c.source === 'skill'))
    }).catch(() => setDiscoveredSkills([]))
  }, [skills])

  useEffect(() => {
    if (isClaudeBackend) {
      setPiExtensions([])
      return
    }
    window.agent.pi.listExtensions()
      .then(setPiExtensions)
      .catch(() => setPiExtensions([]))
  }, [isClaudeBackend, piExtensionsDir])

  return (
    <div className="flex flex-col gap-1">
      {/* ─── Agent Identity ─────────────────────────────── */}
      <SettingRow label="Agent Name" description="Display name shown in chat bubbles.">
        <input
          type="text"
          value={agentName}
          onChange={(e) => setSetting('agent_name', e.target.value)}
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
          onChange={(e) => setSetting('agent_language', e.target.value)}
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
          onChange={(e) => setSetting('agent_personality', e.target.value)}
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

      {/* Backend */}
      <SettingRow label="Backend" description="Claude Agent SDK has more built-in features. PI is extensible via TypeScript extensions.">
        <select
          value={sdkBackend}
          onChange={(e) => setSetting('ai_sdkBackend', e.target.value)}
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

      {/* PI Extensions Directory (PI only) */}
      {!isClaudeBackend && (
        <SettingRow label="Extensions Directory" description="Additional directory for PI extensions (.ts files). Added to default paths.">
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={piExtensionsDir}
              onChange={(e) => setSetting('pi_extensionsDir', e.target.value)}
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
              onClick={async () => {
                const selected = await window.agent.system.selectFolder()
                if (selected) setSetting('pi_extensionsDir', selected)
              }}
              className="px-2 py-1.5 rounded text-xs transition-opacity hover:opacity-70 mobile:px-4 mobile:py-3 mobile:text-sm mobile:hidden"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label="Browse for extensions directory"
            >
              Browse
            </button>
          </div>
        </SettingRow>
      )}

      {/* Discovered PI Extensions (PI only) */}
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
                      const newDisabled = isDisabled
                        ? piDisabledExtensions.filter(p => p !== ext.path)
                        : [...piDisabledExtensions, ext.path]
                      setSetting('pi_disabledExtensions', JSON.stringify(newDisabled))
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

      {/* API Key (Claude only) */}
      {isClaudeBackend && (
        <SettingRow label="API Key" description="Anthropic API key. Bypasses OAuth when set.">
          <div className="flex items-center gap-1">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
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
      )}

      {/* Base URL (only when API key is set, Claude only) */}
      {isClaudeBackend && apiKey && (
        <SettingRow label="Base URL" description="Custom API endpoint (OpenRouter, proxy, etc).">
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setSetting('ai_baseUrl', e.target.value)}
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

      {/* Model */}
      <SettingRow label="Model" description="Claude model used for responses.">
        <div className="flex flex-col items-end gap-1">
          <SearchableModelPicker
            value={(isCustomModel || model === 'custom') ? 'custom' : model}
            options={fetchedModels}
            extraOptions={[
              ...customModels.map((m) => ({ value: m, label: shortenModelName(m) })),
              { value: 'custom', label: 'Other' },
            ]}
            onChange={(next) => {
              if (next === 'custom') {
                setSetting('ai_model', 'custom')
              } else {
                setSetting('ai_model', next)
                setSetting('ai_customModel', '')
              }
            }}
            buttonLabel="Model"
            ariaLabel="Select AI model"
          />
          {(isCustomModel || model === 'custom') && (
            <input
              type="text"
              value={customModel}
              onChange={(e) => setSetting('ai_customModel', e.target.value)}
              onBlur={() => saveCustomModel(customModel)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveCustomModel(customModel) }}
              placeholder="model-id (saved on Enter/blur)"
              className="w-48 px-3 py-1.5 rounded text-xs border outline-none font-mono mobile:text-base"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                borderColor: tint('--color-text-muted', 20),
              }}
              aria-label="Custom model ID"
            />
          )}
          {customModels.length > 0 && (
            <div className="flex flex-col gap-1 mt-1">
              {customModels.map((m) => {
                const persistedK = customModelContextLengths[m] ? customModelContextLengths[m] / 1000 : ''
                return (
                  <div
                    key={m}
                    className="flex items-center gap-2 px-2 py-1 rounded text-xs"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--color-text-muted) 10%, transparent)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    <span className="font-mono flex-1 truncate" title={m}>{shortenModelName(m)}</span>
                    <label className="flex items-center gap-1 text-[0.625rem] whitespace-nowrap">
                      ctx
                      <input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="auto"
                        defaultValue={persistedK}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          setCustomModelContextLength(m, v === '' ? null : Number(v))
                        }}
                        className="w-14 px-1 py-0.5 rounded border text-right"
                        style={{
                          backgroundColor: 'var(--color-bg)',
                          color: 'var(--color-text)',
                          borderColor: 'color-mix(in srgb, var(--color-text-muted) 30%, transparent)',
                        }}
                        aria-label={`Context window size for ${m} (thousands of tokens)`}
                        title="Context window size in thousands of tokens. Leave blank to auto-detect."
                      />
                      k
                    </label>
                    <button
                      onClick={() => removeCustomModel(m)}
                      className="hover:opacity-70 leading-none text-sm"
                      aria-label={`Remove custom model ${m}`}
                      title="Remove"
                    >
                      &times;
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </SettingRow>

      {/* Context token counter mode */}
      <SettingRow label="Context counter" description="How <code>/context</code> estimates token usage. PI backend is always local.">
        <select
          value={settings['ai_contextTokenCounter'] ?? 'local'}
          onChange={(e) => setSetting('ai_contextTokenCounter', e.target.value)}
          disabled={!isClaudeBackend}
          className="px-3 py-1.5 rounded text-sm border outline-none disabled:opacity-50 mobile:text-base mobile:py-2"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Select context token counter mode"
          title={isClaudeBackend ? undefined : 'Only available on Claude Agent SDK backend'}
        >
          <option value="local">Local (gpt-tokenizer, fast)</option>
          <option value="anthropic">Anthropic API (exact, slower)</option>
        </select>
      </SettingRow>

      {/* Max Turns */}
      <SettingRow label="Max Turns" description="Maximum agentic turns per request. 0 = unlimited.">
        <input
          type="number"
          min={0}
          value={maxTurns}
          onChange={(e) => {
            const v = Math.max(0, Number(e.target.value) || 0)
            setSetting('ai_maxTurns', String(v))
          }}
          className="w-20 px-3 py-1.5 rounded text-sm border outline-none text-right mobile:text-base"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Maximum agentic turns"
        />
      </SettingRow>

      {/* Max Thinking Tokens */}
      <SettingRow label="Max Thinking Tokens" description="Extended thinking budget. 0 = disabled (0-100000).">
        <input
          type="number"
          min={0}
          max={100000}
          step={1000}
          value={maxThinkingTokens}
          onChange={(e) => {
            const v = Math.max(0, Math.min(100000, Number(e.target.value) || 0))
            setSetting('ai_maxThinkingTokens', String(v))
          }}
          className="w-24 px-3 py-1.5 rounded text-sm border outline-none text-right mobile:text-base"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Maximum thinking tokens"
        />
      </SettingRow>

      {/* Max Budget USD — both backends (PI via budgetTracker module, Phase 5) */}
      {(
        <SettingRow label="Max Budget (USD)" description="Cost limit per request. 0 = unlimited (0-10).">
          <input
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={maxBudgetUsd}
            onChange={(e) => {
              const v = Math.max(0, Math.min(10, Number(e.target.value) || 0))
              setSetting('ai_maxBudgetUsd', String(v))
            }}
            className="w-24 px-3 py-1.5 rounded text-sm border outline-none text-right mobile:text-base"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderColor: tint('--color-text-muted', 20),
            }}
            aria-label="Maximum budget in USD"
          />
        </SettingRow>
      )}

      {/* Permission Mode — both backends (PI via permissionModes module) */}
      {(
        <SettingRow label="Permission Mode" description="Controls how the SDK handles tool permission prompts.">
          <select
            value={permissionMode}
            onChange={(e) => setSetting('ai_permissionMode', e.target.value)}
            className="px-3 py-1.5 rounded text-sm border outline-none mobile:text-base mobile:py-2"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderColor: tint('--color-text-muted', 20),
            }}
            aria-label="Select permission mode"
          >
            <option value="bypassPermissions">Bypass Permissions</option>
            <option value="acceptEdits">Accept Edits</option>
            <option value="default">Default</option>
            <option value="dontAsk">Don't Ask</option>
            <option value="plan">Plan Only</option>
          </select>
        </SettingRow>
      )}

      {/* Require Plan Approval — both backends */}
      {(
        <div
        className="flex items-center justify-between py-3 border-b"
        style={{ borderColor: tint('--color-text-muted', 10) }}
      >
          <div className="flex flex-col gap-0.5 pr-4">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)', opacity: permissionMode === 'bypassPermissions' ? 1 : 0.5 }}>
              Ask before leaving Plan mode
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: permissionMode === 'bypassPermissions' ? 1 : 0.5 }}>
              Show an approval popup when the agent calls ExitPlanMode, even in Bypass Permissions.
            </span>
          </div>
          <button
            onClick={() => setSetting('ai_requirePlanApproval', requirePlanApproval === 'true' ? 'false' : 'true')}
            disabled={permissionMode !== 'bypassPermissions'}
            className="relative w-10 h-5 rounded-full transition-colors"
            style={{
              backgroundColor: requirePlanApproval === 'true' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              opacity: permissionMode !== 'bypassPermissions' ? 0.3 : (requirePlanApproval === 'true' ? 1 : 0.4),
            }}
            role="switch"
            aria-checked={requirePlanApproval === 'true'}
            aria-label="Require approval for plan exit"
          >
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
              style={{ left: requirePlanApproval === 'true' ? '1.25rem' : '0.125rem' }}
            />
          </button>
        </div>
      )}

      {/* Setting Sources — both backends (PI via skillsBridge module, Phase 4) */}
      {(
        <div
        className="flex flex-col gap-2 py-3 border-b"
        style={{ borderColor: tint('--color-text-muted', 10) }}
      >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                Setting Sources
              </span>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Load Claude Code configuration from filesystem (settings.json, CLAUDE.md, skills, commands, hooks). Larger scopes load more skill frontmatters into the system prompt.
              </span>
            </div>
            <select
              value={skills}
              onChange={(e) => setSetting('ai_skills', e.target.value)}
              className="px-3 py-1.5 rounded text-sm border outline-none whitespace-nowrap mobile:text-base mobile:py-2"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                borderColor: tint('--color-text-muted', 20),
              }}
              aria-label="Select setting sources"
            >
              {SETTING_SOURCES_OPTIONS.map((opt) => {
                const o = skillsOverhead?.[opt.value as 'off' | 'user' | 'project' | 'local']
                const suffix = o && o.tokens > 0
                  ? ` — +${o.tokens >= 1000 ? `${Math.round(o.tokens / 1000)}k` : o.tokens} tokens (${o.count} skills)`
                  : skillsOverhead
                    ? ' — 0 tokens'
                    : ''
                return (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}{suffix}
                  </option>
                )
              })}
            </select>
          </div>
          <div
            className="text-[11px] leading-relaxed px-3 py-2 rounded"
            style={{
              color: 'var(--color-text-muted)',
              backgroundColor: 'color-mix(in srgb, var(--color-text-muted) 8%, transparent)',
            }}
          >
            {skills === 'off' && (
              <><strong>Disabled</strong> — No skills loaded. Zero overhead. Skills &amp; slash commands from plugins are invisible to the agent.</>
            )}
            {skills === 'user' && (
              <><strong>User</strong> — Loads ~/.claude/skills/ and ~/.claude/plugins/*/skills/ only. Recommended starting point for most setups.</>
            )}
            {skills === 'project' && (
              <><strong>User + Project</strong> — Adds the current CWD's .claude/skills/ and .claude/plugins/ — project-specific skills become available in this conversation.</>
            )}
            {skills === 'local' && (
              <><strong>User + Project + Local</strong> — Also adds .claude.local/ (gitignored overrides). Most verbose mode; useful for personal tweaks in a shared repo but inflates the context.</>
            )}
            {skillsOverhead && (
              <span className="block mt-1 opacity-80">
                Current scope bundles <strong>{(() => {
                  const cur = skillsOverhead[skills as 'off' | 'user' | 'project' | 'local']
                  return cur ? `${cur.count} SKILL.md frontmatters ≈ ${cur.tokens >= 1000 ? `${Math.round(cur.tokens / 1000)}k` : cur.tokens} tokens` : 'unknown'
                })()}</strong> into every turn's system prompt.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Skills Toggle — both backends */}
      {(
        <div
        className="flex items-center justify-between py-3 border-b"
        style={{ borderColor: tint('--color-text-muted', 10) }}
      >
          <div className="flex flex-col gap-0.5 pr-4">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)', opacity: skills === 'off' ? 0.5 : 1 }}>
              Skills
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: skills === 'off' ? 0.5 : 1 }}>
              Allow the AI to invoke discovered skills.
            </span>
          </div>
          <button
            onClick={() => setSetting('ai_skillsEnabled', skillsEnabled === 'true' ? 'false' : 'true')}
            disabled={skills === 'off'}
            className="relative w-10 h-5 rounded-full transition-colors"
            style={{
              backgroundColor: skillsEnabled === 'true' && skills !== 'off' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              opacity: skills === 'off' ? 0.3 : (skillsEnabled === 'true' ? 1 : 0.4),
            }}
            role="switch"
            aria-checked={skillsEnabled === 'true' && skills !== 'off'}
            aria-label="Toggle skills"
          >
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              style={{
                left: skillsEnabled === 'true' && skills !== 'off' ? '1.25rem' : '0.125rem',
              }}
            />
          </button>
        </div>
      )}

      {/* Include Installed Plugin Skills — both backends (PI: skillsBridge contributes paths; Claude: informational, SDK loads natively) */}
      <div
        className="flex items-center justify-between py-3 border-b"
        style={{ borderColor: tint('--color-text-muted', 10) }}
      >
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)', opacity: skills === 'off' || skillsEnabled !== 'true' ? 0.5 : 1 }}>
            Include Installed Plugin Skills
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: skills === 'off' || skillsEnabled !== 'true' ? 0.5 : 1 }}>
            Expose skills from installed Claude plugins (read from ~/.claude/plugins/installed_plugins.json). Excludes marketplace catalogs and cached versions. On PI backend this activates the plugin-skills bridge; on Claude the SDK loads installed-plugin skills natively regardless.
          </span>
        </div>
        <button
          onClick={() => setSetting('ai_skillsIncludePlugins', skillsIncludePlugins === 'true' ? 'false' : 'true')}
          disabled={skills === 'off' || skillsEnabled !== 'true'}
          className="relative w-10 h-5 rounded-full transition-colors"
          style={{
            backgroundColor: skillsIncludePlugins === 'true' && skills !== 'off' && skillsEnabled === 'true' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            opacity: skills === 'off' || skillsEnabled !== 'true' ? 0.3 : (skillsIncludePlugins === 'true' ? 1 : 0.4),
          }}
          role="switch"
          aria-checked={skillsIncludePlugins === 'true' && skills !== 'off' && skillsEnabled === 'true'}
          aria-label="Include installed plugin skills"
        >
          <span
            className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
            style={{ left: skillsIncludePlugins === 'true' && skills !== 'off' && skillsEnabled === 'true' ? '1.25rem' : '0.125rem' }}
          />
        </button>
      </div>

      {/* Per-Skill List — both backends (informational; PI cannot enforce per-skill disable, see skills-bridge) */}
      {(skills !== 'off' && skillsEnabled === 'true' && discoveredSkills.length > 0) && (
        <div
          className="py-3 border-b"
          style={{ borderColor: tint('--color-text-muted', 10) }}
        >
          <span className="text-xs font-medium mb-2 block" style={{ color: 'var(--color-text-muted)' }}>
            Discovered Skills
          </span>
          <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
            {discoveredSkills.map((skill) => {
              const isDisabled = disabledSkills.includes(skill.name)
              return (
                <label
                  key={skill.name}
                  className="flex items-center gap-2 px-2 py-1 rounded text-sm cursor-pointer hover:opacity-80"
                  style={{ color: 'var(--color-text)' }}
                >
                  <input
                    type="checkbox"
                    checked={!isDisabled}
                    onChange={() => {
                      const newDisabled = isDisabled
                        ? disabledSkills.filter(n => n !== skill.name)
                        : [...disabledSkills, skill.name]
                      setSetting('ai_disabledSkills', JSON.stringify(newDisabled))
                    }}
                    className="rounded"
                  />
                  <span className="flex-shrink-0">{skill.name}</span>
                  {skill.description && (
                    <span className="text-xs truncate min-w-0" style={{ color: 'var(--color-text-muted)' }}>
                      — {skill.description}
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* CWD Restriction — both backends (PI via cwdGuard module) */}
      {(
        <SettingRow label="CWD Write Restriction" description="Prompt before writing files outside the conversation working directory.">
          <div className="flex items-center gap-2">
            {confirmDisable && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-warning">
                  Allows writing anywhere.
                </span>
                <button
                  onClick={() => {
                    setSetting('hooks_cwdRestriction', 'false')
                    setConfirmDisable(false)
                  }}
                  className="px-2 py-0.5 rounded text-xs font-medium bg-warning text-base mobile:px-4 mobile:py-3 mobile:text-sm"
                  aria-label="Confirm disable CWD restriction"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmDisable(false)}
                  className="px-2 py-0.5 rounded text-xs mobile:px-4 mobile:py-3 mobile:text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                  aria-label="Cancel disable CWD restriction"
                >
                  Cancel
                </button>
              </div>
            )}
            <button
              onClick={() => {
                if (cwdRestriction === 'true') {
                  setConfirmDisable(true)
                } else {
                  setSetting('hooks_cwdRestriction', 'true')
                  setConfirmDisable(false)
                }
              }}
              className="relative w-10 h-5 rounded-full transition-colors"
              style={{
                backgroundColor: cwdRestriction === 'true' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                opacity: cwdRestriction === 'true' ? 1 : 0.4,
              }}
              role="switch"
              aria-checked={cwdRestriction === 'true'}
              aria-label="Toggle CWD write restriction"
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                style={{
                  left: cwdRestriction === 'true' ? '1.25rem' : '0.125rem',
                }}
              />
            </button>
          </div>
        </SettingRow>
      )}

      {/* CWD Whitelist — both backends */}
      {cwdRestriction === 'true' && (
        <div
          className="py-3 border-b"
          style={{ borderColor: tint('--color-text-muted', 10) }}
        >
          <div className="flex flex-col gap-0.5 mb-2">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Allowed Directories
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Additional directories accessible beyond the conversation CWD. Read-only entries allow reading but not writing.
            </span>
          </div>
          <CwdWhitelistEditor
            entries={cwdWhitelist}
            onChange={(entries) => setSetting('hooks_cwdWhitelist', JSON.stringify(entries))}
          />
        </div>
      )}

      {/* Share Claude Config */}
      <SettingRow label="Share Claude Config" description="Apply Claude Code config (~/.claude/settings.json hooks) to all backends. Skills, CLAUDE.md, and commands are always backend-specific.">
        <select
          value={sharedHooks}
          onChange={(e) => setSetting('settings_sharedAcrossBackends', e.target.value)}
          className="px-3 py-1.5 rounded text-sm border outline-none mobile:text-base mobile:py-2"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Share Claude config across backends"
        >
          {CONFIG_SHARING_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </SettingRow>

      {/* Default System Prompt */}
      <div className="flex flex-col gap-2 py-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Default System Prompt
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Global system prompt. Per-conversation prompts override this.
            </span>
          </div>
          <button
            onClick={() => setShowPromptEditor(true)}
            className="px-2.5 py-1 rounded text-xs font-medium transition-colors hover:opacity-80 mobile:px-4 mobile:py-3 mobile:text-sm"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
              border: '1px solid color-mix(in srgb, var(--color-text-muted) 20%, transparent)',
            }}
            aria-label="Expand system prompt editor"
          >
            Expand ↗
          </button>
        </div>
        <textarea
          value={defaultSystemPrompt}
          onChange={(e) => setSetting('ai_defaultSystemPrompt', e.target.value)}
          rows={4}
          placeholder="Enter a default system prompt..."
          className="w-full px-3 py-2 rounded text-sm border outline-none resize-y mobile:text-base"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Default system prompt"
        />
      </div>

      {/* Compact Model (global only) */}
      <div
        className="flex flex-col gap-1.5 py-3 border-b"
        style={{ borderColor: tint('--color-text-muted', 10) }}
      >
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Compact Model
        </label>
        <select
          value={isCompactModelCustom ? '__custom__' : compactModel}
          onChange={(e) => {
            const val = e.target.value
            if (val === '__custom__') {
              setSetting('ai_compactModel', compactModel || '')
            } else {
              setSetting('ai_compactModel', val)
            }
          }}
          className="px-3 py-1.5 rounded text-sm border outline-none mobile:text-base mobile:py-2"
          style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', borderColor: tint('--color-text-muted', 20) }}
          aria-label="Compact model"
        >
          <option value="">Auto (current model)</option>
          {fetchedModels.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          <option value="__custom__">Custom...</option>
        </select>
        {isCompactModelCustom && (
          <input
            type="text"
            value={compactModel}
            onChange={(e) => setSetting('ai_compactModel', e.target.value)}
            placeholder="model-id"
            className="px-3 py-1.5 rounded text-sm border outline-none font-mono mobile:text-base"
            style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', borderColor: tint('--color-text-muted', 20) }}
            aria-label="Custom compact model"
          />
        )}
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Model used when running <code>/compact</code>. Auto = uses the conversation&apos;s active model.
        </span>
      </div>

      {/* Title Model (global only) */}
      <div
        className="flex flex-col gap-1.5 py-3 border-b"
        style={{ borderColor: tint('--color-text-muted', 10) }}
      >
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Title Model
        </label>
        <select
          value={isTitleModelCustom ? '__custom__' : titleModel}
          onChange={(e) => {
            const val = e.target.value
            if (val === '__custom__') {
              setSetting('ai_titleModel', titleModel || '')
            } else {
              setSetting('ai_titleModel', val)
            }
          }}
          className="px-3 py-1.5 rounded text-sm border outline-none mobile:text-base mobile:py-2"
          style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', borderColor: tint('--color-text-muted', 20) }}
          aria-label="Title model"
        >
          <option value="">Auto (current model)</option>
          {fetchedModels.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          <option value="__custom__">Custom...</option>
        </select>
        {isTitleModelCustom && (
          <input
            type="text"
            value={titleModel}
            onChange={(e) => setSetting('ai_titleModel', e.target.value)}
            placeholder="model-id"
            className="px-3 py-1.5 rounded text-sm border outline-none font-mono mobile:text-base"
            style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', borderColor: tint('--color-text-muted', 20) }}
            aria-label="Custom title model"
          />
        )}
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Model used to auto-generate conversation titles. Auto = uses the conversation&apos;s active model.
        </span>
      </div>

      {showPromptEditor && (
        <SystemPromptEditorModal
          value={defaultSystemPrompt}
          onChange={(v) => setSetting('ai_defaultSystemPrompt', v)}
          onClose={() => setShowPromptEditor(false)}
        />
      )}
    </div>
  )
}
