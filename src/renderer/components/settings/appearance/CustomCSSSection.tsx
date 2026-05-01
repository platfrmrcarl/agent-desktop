import Editor from '@monaco-editor/react'
import { useMonacoFontSize } from '../../../hooks/useMonacoFontSize'

export interface CustomCSSSectionProps {
  editing: 'create' | 'edit'
  editFilename: string
  cssContent: string
  newFilename: string
  error: string | null
  onChangeCssContent: (v: string) => void
  onChangeNewFilename: (v: string) => void
  onSave: () => void
  onCancel: () => void
}

export function CustomCSSSection({
  editing,
  editFilename,
  cssContent,
  newFilename,
  error,
  onChangeCssContent,
  onChangeNewFilename,
  onSave,
  onCancel,
}: CustomCSSSectionProps) {
  const monacoFontSize = useMonacoFontSize(13)

  return (
    <div className="rounded-lg p-4 flex flex-col gap-4 bg-base">
      <h3 className="text-sm font-semibold text-body">
        {editing === 'create' ? 'Create Theme' : `Edit: ${editFilename}`}
      </h3>

      {editing === 'create' && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Filename</label>
          <input
            className="w-full max-w-xs bg-surface border border-muted rounded px-3 py-2 text-sm outline-none focus:border-primary mobile:text-base"
            style={{ color: 'var(--color-text)' }}
            value={newFilename}
            onChange={(e) => onChangeNewFilename(e.target.value)}
            placeholder="my-theme.css"
          />
        </div>
      )}

      <div className="rounded overflow-hidden border border-muted">
        <Editor
          height="400px"
          language="css"
          theme="vs-dark"
          value={cssContent}
          onChange={(val) => onChangeCssContent(val ?? '')}
          options={{
            minimap: { enabled: false },
            fontSize: monacoFontSize,
            lineNumbers: 'on',
            wordWrap: 'on',
            scrollBeyondLastLine: false,
          }}
        />
      </div>

      {error && (
        <p className="text-xs text-error">{error}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-90 bg-primary text-contrast"
        >
          {editing === 'create' ? 'Create Theme' : 'Save Theme'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 bg-deep text-body"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
