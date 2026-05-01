import type { Meta, StoryObj } from '@storybook/react'
import { PermissionsSection, type PermissionsSectionProps } from './PermissionsSection'

const noop = () => {}

const baseArgs: PermissionsSectionProps = {
  permissionMode: 'bypassPermissions',
  requirePlanApproval: 'true',
  cwdRestriction: 'true',
  cwdWhitelist: [],
  sharedHooks: 'true',
  onPermissionModeChange: noop,
  onRequirePlanApprovalChange: noop,
  onCwdRestrictionChange: noop,
  onCwdWhitelistChange: noop,
  onSharedHooksChange: noop,
}

const meta: Meta<typeof PermissionsSection> = {
  title: 'Settings/AI/PermissionsSection',
  component: PermissionsSection,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof PermissionsSection>

export const Default: Story = {}

export const NonBypassDisablesPlanApproval: Story = {
  args: {
    permissionMode: 'default',
    requirePlanApproval: 'false',
  },
}

export const WithWhitelistEntries: Story = {
  args: {
    cwdRestriction: 'true',
    cwdWhitelist: [
      { path: '/home/user/projects/foo', access: 'readwrite' },
      { path: '/home/user/notes', access: 'read' },
    ],
  },
}
