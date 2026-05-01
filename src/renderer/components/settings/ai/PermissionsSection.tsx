import { useState } from 'react'
import { CONFIG_SHARING_OPTIONS } from '../../../../shared/constants'
import type { CwdWhitelistEntry } from '../../../../shared/types'
import { tint } from '../../../utils/colorMix'
import { SettingRow } from '../../shared/SettingRow'
import { CwdWhitelistEditor } from '../CwdWhitelistEditor'

export interface PermissionsSectionProps {
  permissionMode: string
  requirePlanApproval: string
  cwdRestriction: string
  cwdWhitelist: CwdWhitelistEntry[]
  sharedHooks: string
  onPermissionModeChange: (value: string) => void
  onRequirePlanApprovalChange: (value: string) => void
  onCwdRestrictionChange: (value: string) => void
  onCwdWhitelistChange: (entries: CwdWhitelistEntry[]) => void
  onSharedHooksChange: (value: string) => void
}

/**
 * Permission mode, plan approval toggle, CWD restriction (with disable
 * confirmation), CWD whitelist editor, and Share Claude Config select.
 */
export function PermissionsSection(props: PermissionsSectionProps) {
  const {
    permissionMode,
    requirePlanApproval,
    cwdRestriction,
    cwdWhitelist,
    sharedHooks,
    onPermissionModeChange,
    onRequirePlanApprovalChange,
    onCwdRestrictionChange,
    onCwdWhitelistChange,
    onSharedHooksChange,
  } = props

  const [confirmDisable, setConfirmDisable] = useState(false)

  return (
    <>
      <SettingRow label="Permission Mode" description="Controls how the SDK handles tool permission prompts.">
        <select
          value={permissionMode}
          onChange={(e) => onPermissionModeChange(e.target.value)}
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

      <div
        className="flex items-center justify-between py-3 border-b"
        style={{ borderColor: tint('--color-text-muted', 10) }}
      >
        <div className="flex flex-col gap-0.5 pr-4">
          <span
            className="text-sm font-medium"
            style={{ color: 'var(--color-text)', opacity: permissionMode === 'bypassPermissions' ? 1 : 0.5 }}
          >
            Ask before leaving Plan mode
          </span>
          <span
            className="text-xs"
            style={{ color: 'var(--color-text-muted)', opacity: permissionMode === 'bypassPermissions' ? 1 : 0.5 }}
          >
            Show an approval popup when the agent calls ExitPlanMode, even in Bypass Permissions.
          </span>
        </div>
        <button
          onClick={() => onRequirePlanApprovalChange(requirePlanApproval === 'true' ? 'false' : 'true')}
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

      <SettingRow
        label="CWD Write Restriction"
        description="Prompt before writing files outside the conversation working directory."
      >
        <div className="flex items-center gap-2">
          {confirmDisable && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-warning">Allows writing anywhere.</span>
              <button
                onClick={() => {
                  onCwdRestrictionChange('false')
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
                onCwdRestrictionChange('true')
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
              style={{ left: cwdRestriction === 'true' ? '1.25rem' : '0.125rem' }}
            />
          </button>
        </div>
      </SettingRow>

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
          <CwdWhitelistEditor entries={cwdWhitelist} onChange={onCwdWhitelistChange} />
        </div>
      )}

      <SettingRow
        label="Share Claude Config"
        description="Apply Claude Code config (~/.claude/settings.json hooks) to all backends. Skills, CLAUDE.md, and commands are always backend-specific."
      >
        <select
          value={sharedHooks}
          onChange={(e) => onSharedHooksChange(e.target.value)}
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
    </>
  )
}
