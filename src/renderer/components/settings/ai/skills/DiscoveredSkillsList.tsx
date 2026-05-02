import type { SlashCommand } from '../../../../../shared/types'
import { tint } from '../../../../utils/colorMix'

export interface DiscoveredSkillsListProps {
  discoveredSkills: SlashCommand[]
  disabledSkills: string[]
  onDisabledSkillsChange: (next: string[]) => void
}

export function DiscoveredSkillsList({ discoveredSkills, disabledSkills, onDisabledSkillsChange }: DiscoveredSkillsListProps) {
  return (
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
  )
}
