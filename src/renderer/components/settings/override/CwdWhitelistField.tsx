import type { CwdWhitelistEntry } from '../../../../shared/types'
import { CwdWhitelistEditor } from '../CwdWhitelistEditor'
import { FieldCard, InheritedText } from './primitives'

export interface CwdWhitelistFieldProps {
  isCwdWhitelistOverridden: boolean
  cwdWhitelistDraft: CwdWhitelistEntry[]
  cwdWhitelistInherited: CwdWhitelistEntry[]
  inheritedSource: string
  onToggleCwdWhitelistOverride: () => void
  onCwdWhitelistChange: (entries: CwdWhitelistEntry[]) => void
}

export function CwdWhitelistField({
  isCwdWhitelistOverridden,
  cwdWhitelistDraft,
  cwdWhitelistInherited,
  inheritedSource,
  onToggleCwdWhitelistOverride,
  onCwdWhitelistChange,
}: CwdWhitelistFieldProps) {
  if (isCwdWhitelistOverridden) {
    return (
      <FieldCard label="CWD Whitelist" active onToggle={onToggleCwdWhitelistOverride} wide>
        <CwdWhitelistEditor entries={cwdWhitelistDraft} onChange={onCwdWhitelistChange} />
      </FieldCard>
    )
  }

  return (
    <FieldCard label="CWD Whitelist" active={false} onToggle={onToggleCwdWhitelistOverride}>
      <InheritedText
        value={cwdWhitelistInherited.length > 0
          ? `${cwdWhitelistInherited.length} entries`
          : 'No entries'}
        source={inheritedSource}
      />
    </FieldCard>
  )
}
