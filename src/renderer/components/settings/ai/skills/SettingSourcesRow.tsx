import { SETTING_SOURCES_OPTIONS } from '../../../../../shared/constants'
import { tint } from '../../../../utils/colorMix'
import type { SkillsScope, SkillsOverhead } from '../SkillsPromptSection'

export interface SettingSourcesRowProps {
  skills: string
  skillsOverhead: SkillsOverhead
  onSkillsChange: (value: string) => void
}

const SCOPE_DESCRIPTIONS: Record<SkillsScope, string> = {
  off: 'Disabled — No skills loaded. Zero overhead. Skills & slash commands from plugins are invisible to the agent.',
  user: 'User — Loads ~/.claude/skills/ and ~/.claude/plugins/*/skills/ only. Recommended starting point for most setups.',
  project: 'User + Project — Adds the current CWD\'s .claude/skills/ and .claude/plugins/ — project-specific skills become available in this conversation.',
  local: 'User + Project + Local — Also adds .claude.local/ (gitignored overrides). Most verbose mode; useful for personal tweaks in a shared repo but inflates the context.',
}

export function SettingSourcesRow({ skills, skillsOverhead, onSkillsChange }: SettingSourcesRowProps) {
  const skillsScope = skills as SkillsScope

  const overheadSummary = (() => {
    if (!skillsOverhead) return null
    const cur = skillsOverhead[skillsScope]
    if (!cur) return 'unknown'
    return `${cur.count} SKILL.md frontmatters ≈ ${cur.tokens >= 1000 ? `${Math.round(cur.tokens / 1000)}k` : cur.tokens} tokens`
  })()

  return (
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
        {SCOPE_DESCRIPTIONS[skillsScope]}
        {overheadSummary && (
          <span className="block mt-1 opacity-80">
            Current scope bundles <strong>{overheadSummary}</strong> into every turn's system prompt.
          </span>
        )}
      </div>
    </div>
  )
}
