import { useState } from 'react'
import { SETTING_SOURCES_OPTIONS } from '../../../../shared/constants'
import type { SlashCommand } from '../../../../shared/types'
import { tint } from '../../../utils/colorMix'
import { SystemPromptEditorModal } from '../SystemPromptEditorModal'

export type SkillsScope = 'off' | 'user' | 'project' | 'local'

export type SkillsOverhead = Record<SkillsScope, { tokens: number; count: number }> | null

export interface SkillsPromptSectionProps {
  skills: string
  skillsEnabled: string
  skillsIncludePlugins: string
  disabledSkills: string[]
  discoveredSkills: SlashCommand[]
  skillsOverhead: SkillsOverhead
  defaultSystemPrompt: string
  onSkillsChange: (value: string) => void
  onSkillsEnabledChange: (value: string) => void
  onSkillsIncludePluginsChange: (value: string) => void
  onDisabledSkillsChange: (next: string[]) => void
  onDefaultSystemPromptChange: (value: string) => void
}

/**
 * Setting Sources scope, Skills toggle, plugin-skills toggle,
 * per-skill disable list, and the default system prompt editor
 * (with Expand modal).
 */
export function SkillsPromptSection(props: SkillsPromptSectionProps) {
  const {
    skills,
    skillsEnabled,
    skillsIncludePlugins,
    disabledSkills,
    discoveredSkills,
    skillsOverhead,
    defaultSystemPrompt,
    onSkillsChange,
    onSkillsEnabledChange,
    onSkillsIncludePluginsChange,
    onDisabledSkillsChange,
    onDefaultSystemPromptChange,
  } = props

  const [showPromptEditor, setShowPromptEditor] = useState(false)
  const skillsScope = skills as SkillsScope

  return (
    <>
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
            onChange={(e) => onSkillsChange(e.target.value)}
            className="px-3 py-1.5 rounded text-sm border outline-none whitespace-nowrap mobile:text-base mobile:py-2"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderColor: tint('--color-text-muted', 20),
            }}
            aria-label="Select setting sources"
          >
            {SETTING_SOURCES_OPTIONS.map((opt) => {
              const o = skillsOverhead?.[opt.value as SkillsScope]
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
                const cur = skillsOverhead[skillsScope]
                return cur ? `${cur.count} SKILL.md frontmatters ≈ ${cur.tokens >= 1000 ? `${Math.round(cur.tokens / 1000)}k` : cur.tokens} tokens` : 'unknown'
              })()}</strong> into every turn's system prompt.
            </span>
          )}
        </div>
      </div>

      <div
        className="flex items-center justify-between py-3 border-b"
        style={{ borderColor: tint('--color-text-muted', 10) }}
      >
        <div className="flex flex-col gap-0.5 pr-4">
          <span
            className="text-sm font-medium"
            style={{ color: 'var(--color-text)', opacity: skills === 'off' ? 0.5 : 1 }}
          >
            Skills
          </span>
          <span
            className="text-xs"
            style={{ color: 'var(--color-text-muted)', opacity: skills === 'off' ? 0.5 : 1 }}
          >
            Allow the AI to invoke discovered skills.
          </span>
        </div>
        <button
          onClick={() => onSkillsEnabledChange(skillsEnabled === 'true' ? 'false' : 'true')}
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

      <div
        className="flex items-center justify-between py-3 border-b"
        style={{ borderColor: tint('--color-text-muted', 10) }}
      >
        <div className="flex flex-col gap-0.5 pr-4">
          <span
            className="text-sm font-medium"
            style={{ color: 'var(--color-text)', opacity: skills === 'off' || skillsEnabled !== 'true' ? 0.5 : 1 }}
          >
            Include Installed Plugin Skills
          </span>
          <span
            className="text-xs"
            style={{ color: 'var(--color-text-muted)', opacity: skills === 'off' || skillsEnabled !== 'true' ? 0.5 : 1 }}
          >
            Expose skills from installed Claude plugins (read from ~/.claude/plugins/installed_plugins.json). Excludes marketplace catalogs and cached versions. On PI backend this activates the plugin-skills bridge; on Claude the SDK loads installed-plugin skills natively regardless.
          </span>
        </div>
        <button
          onClick={() => onSkillsIncludePluginsChange(skillsIncludePlugins === 'true' ? 'false' : 'true')}
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
                      const next = isDisabled
                        ? disabledSkills.filter((n) => n !== skill.name)
                        : [...disabledSkills, skill.name]
                      onDisabledSkillsChange(next)
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
          onChange={(e) => onDefaultSystemPromptChange(e.target.value)}
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

      {showPromptEditor && (
        <SystemPromptEditorModal
          value={defaultSystemPrompt}
          onChange={onDefaultSystemPromptChange}
          onClose={() => setShowPromptEditor(false)}
        />
      )}
    </>
  )
}
