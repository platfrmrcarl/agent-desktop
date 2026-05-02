import React, { Suspense } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

// Lazy-load the component to avoid pulling Monaco into the Storybook bundle at startup
const CustomCSSSection = React.lazy(() =>
  import('./CustomCSSSection').then((m) => ({ default: m.CustomCSSSection }))
)

const SAMPLE_CSS = `:root {
  --color-bg: #1a1a2e;
  --color-primary: #e94560;
  --color-text: #eaeaea;
}
`

const noop = () => {}

const meta: Meta = {
  title: 'Settings/Appearance/CustomCSSSection',
  decorators: [
    (Story) => (
      <Suspense fallback={<div style={{ color: 'var(--color-text-muted)', padding: '1rem' }}>Loading editor…</div>}>
        <Story />
      </Suspense>
    ),
  ],
}

export default meta
type Story = StoryObj

export const CreateMode: Story = {
  render: () => (
    <CustomCSSSection
      editing="create"
      editFilename=""
      cssContent={SAMPLE_CSS}
      newFilename="my-theme.css"
      error={null}
      onChangeCssContent={noop}
      onChangeNewFilename={noop}
      onSave={noop}
      onCancel={noop}
    />
  ),
}

export const EditMode: Story = {
  render: () => (
    <CustomCSSSection
      editing="edit"
      editFilename="my-theme.css"
      cssContent={SAMPLE_CSS}
      newFilename=""
      error={null}
      onChangeCssContent={noop}
      onChangeNewFilename={noop}
      onSave={noop}
      onCancel={noop}
    />
  ),
}

export const WithError: Story = {
  render: () => (
    <CustomCSSSection
      editing="create"
      editFilename=""
      cssContent={SAMPLE_CSS}
      newFilename=""
      error="Filename is required"
      onChangeCssContent={noop}
      onChangeNewFilename={noop}
      onSave={noop}
      onCancel={noop}
    />
  ),
}
