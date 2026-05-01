import type { Meta, StoryObj } from '@storybook/react'
import { PiExtensionsField, type PiExtensionsFieldProps } from './PiExtensionsField'

const noop = () => {}

const EXTENSIONS = [
  { name: 'code-review', path: '/home/user/.pi/extensions/code-review.ts' },
  { name: 'test-runner', path: '/tmp/.pi/extensions/test-runner.ts' },
  { name: 'doc-gen', path: '/home/user/.pi/extensions/doc-gen.ts' },
]

const baseArgs: PiExtensionsFieldProps = {
  piExtensions: EXTENSIONS,
  piExtDisabledDraft: [],
  piExtDisabledInherited: [],
  isPiExtOverridden: false,
  inheritedSource: 'Global',
  onTogglePiExtOverride: noop,
  onTogglePiExtension: noop,
}

const meta: Meta<typeof PiExtensionsField> = {
  title: 'Settings/Override/PiExtensionsField',
  component: PiExtensionsField,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof PiExtensionsField>

export const Inherited: Story = {}

export const InheritedPartiallyDisabled: Story = {
  args: {
    piExtDisabledInherited: [EXTENSIONS[1].path],
  },
}

export const Overridden: Story = {
  args: {
    isPiExtOverridden: true,
  },
}

export const OverriddenWithSomeDisabled: Story = {
  args: {
    isPiExtOverridden: true,
    piExtDisabledDraft: [EXTENSIONS[0].path],
  },
}
