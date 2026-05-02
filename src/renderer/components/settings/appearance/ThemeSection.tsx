import type { ThemeFile } from '../../../../core/types/types'
import { Toggle } from '../../shared/Toggle'

function extractColors(css: string): string[] {
  const matches = css.matchAll(/--color-\w+:\s*(#[0-9a-fA-F]{3,8})/g)
  return [...matches].map((m) => m[1]).slice(0, 6)
}

export interface ThemeSectionProps {
  themes: ThemeFile[]
  activeTheme: string | null
  themesDir: string | null
  autoThemeDialog: ThemeFile | null
  autoThemeEnabled: boolean
  autoThemeDayTheme: string
  autoThemeNightTheme: string
  autoThemeDayTime: string
  autoThemeNightTime: string
  deleteConfirm: string | null
  onSelectTheme: (theme: ThemeFile) => void
  onStartCreate: () => void
  onStartEdit: (theme: ThemeFile) => void
  onDelete: (filename: string) => void
  onSetDeleteConfirm: (filename: string | null) => void
  onOpenFolder: () => void
  onToggleAutoTheme: () => void
  onSetAutoThemeDayTheme: (v: string) => void
  onSetAutoThemeNightTheme: (v: string) => void
  onSetAutoThemeDayTime: (v: string) => void
  onSetAutoThemeNightTime: (v: string) => void
  onSetAutoThemeDayAndApply: (filename: string, theme: ThemeFile) => void
  onSetAutoThemeNightAndApply: (filename: string, theme: ThemeFile) => void
  onApplyGloballyAndDisableAuto: (theme: ThemeFile) => void
  onDismissAutoThemeDialog: () => void
}

export function ThemeSection({
  themes,
  activeTheme,
  themesDir,
  autoThemeDialog,
  autoThemeEnabled,
  autoThemeDayTheme,
  autoThemeNightTheme,
  autoThemeDayTime,
  autoThemeNightTime,
  deleteConfirm,
  onSelectTheme,
  onStartCreate,
  onStartEdit,
  onDelete,
  onSetDeleteConfirm,
  onOpenFolder,
  onToggleAutoTheme,
  onSetAutoThemeDayTheme,
  onSetAutoThemeNightTheme,
  onSetAutoThemeDayTime,
  onSetAutoThemeNightTime,
  onSetAutoThemeDayAndApply,
  onSetAutoThemeNightAndApply,
  onApplyGloballyAndDisableAuto,
  onDismissAutoThemeDialog,
}: ThemeSectionProps) {
  return (
    <>
      {/* Auto Day/Night Theme */}
      <div className="rounded-lg overflow-hidden border border-deep">
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <div className="flex flex-col">
            <span className="text-sm text-body">Auto Day/Night Theme</span>
            <span className="text-xs text-muted">Switch theme automatically based on time of day</span>
          </div>
          <Toggle enabled={autoThemeEnabled} onToggle={onToggleAutoTheme} label="Auto Day/Night Theme" />
        </div>

        {autoThemeEnabled && (
          <>
            {/* Day theme row */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
              <span className="text-sm text-body">Day theme</span>
              <div className="flex items-center gap-2">
                <select
                  value={autoThemeDayTheme}
                  onChange={(e) => onSetAutoThemeDayTheme(e.target.value)}
                  className="bg-surface text-body border border-muted rounded px-2 py-1 text-sm outline-none focus:border-primary mobile:text-base"
                  aria-label="Day theme"
                >
                  {themes.map((t) => (
                    <option key={t.filename} value={t.filename}>{t.name}</option>
                  ))}
                </select>
                <span className="text-xs text-muted">at</span>
                <input
                  type="time"
                  value={autoThemeDayTime}
                  onChange={(e) => onSetAutoThemeDayTime(e.target.value)}
                  className="bg-surface border border-muted rounded px-2 py-1 text-sm outline-none focus:border-primary mobile:text-base"
                  style={{ color: 'var(--color-text)' }}
                  aria-label="Day transition time"
                />
              </div>
            </div>

            {/* Night theme row */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-body">Night theme</span>
              <div className="flex items-center gap-2">
                <select
                  value={autoThemeNightTheme}
                  onChange={(e) => onSetAutoThemeNightTheme(e.target.value)}
                  className="bg-surface text-body border border-muted rounded px-2 py-1 text-sm outline-none focus:border-primary mobile:text-base"
                  aria-label="Night theme"
                >
                  {themes.map((t) => (
                    <option key={t.filename} value={t.filename}>{t.name}</option>
                  ))}
                </select>
                <span className="text-xs text-muted">at</span>
                <input
                  type="time"
                  value={autoThemeNightTime}
                  onChange={(e) => onSetAutoThemeNightTime(e.target.value)}
                  className="bg-surface border border-muted rounded px-2 py-1 text-sm outline-none focus:border-primary mobile:text-base"
                  style={{ color: 'var(--color-text)' }}
                  aria-label="Night transition time"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Theme Selection */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-body">Themes</h3>
          <div className="flex gap-2">
            <button
              onClick={onOpenFolder}
              className="px-3 py-1.5 rounded text-xs font-medium transition-opacity hover:opacity-90 bg-deep text-body mobile:px-4 mobile:py-3 mobile:text-sm"
            >
              Open Themes Folder
            </button>
            <button
              onClick={onStartCreate}
              className="px-3 py-1.5 rounded text-xs font-medium transition-opacity hover:opacity-90 bg-primary text-contrast mobile:px-4 mobile:py-3 mobile:text-sm"
            >
              Create New Theme
            </button>
          </div>
        </div>
        {themesDir && (
          <p className="text-xs mb-2 font-mono text-muted">{themesDir}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {themes.map((theme) => {
            const swatches = extractColors(theme.css)
            const isActive = theme.filename === activeTheme
            return (
              <button
                key={theme.filename}
                onClick={() => onSelectTheme(theme)}
                className={`relative p-3 rounded-lg text-left transition-colors bg-base ${
                  isActive ? 'border-2 border-primary' : 'border border-muted opacity-[0.85]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-body">{theme.name}</span>
                  <div className="flex items-center gap-1">
                    {isActive && (
                      <span className="text-[0.625rem] px-1.5 py-0.5 rounded font-medium bg-primary text-contrast">
                        Active
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 mb-2">
                  {swatches.map((c, i) => (
                    <span
                      key={i}
                      className="w-4 h-4 rounded-full border border-muted"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                {!theme.isBuiltin && (
                  <div className="flex gap-1 absolute top-2 right-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onStartEdit(theme) }}
                      className="w-6 h-6 rounded flex items-center justify-center text-xs hover:bg-surface transition-colors text-muted mobile:w-11 mobile:h-11"
                      title="Edit theme"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M9.1.9a1.5 1.5 0 012.12 2.12L3.88 10.37l-2.83.71.71-2.83L9.1.9z" />
                      </svg>
                    </button>
                    {deleteConfirm === theme.filename ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(theme.filename) }}
                        className="w-6 h-6 rounded flex items-center justify-center text-xs transition-colors bg-error text-contrast mobile:w-11 mobile:h-11"
                        title="Confirm delete"
                      >
                        !
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); onSetDeleteConfirm(theme.filename) }}
                        className="w-6 h-6 rounded flex items-center justify-center text-xs hover:bg-surface transition-colors text-muted mobile:w-11 mobile:h-11"
                        title="Delete theme"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                          <path d="M3 3h6v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3zm-1-1h8M5 1h2" stroke="currentColor" fill="none" strokeWidth="1" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Auto-theme click dialog */}
      {autoThemeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'var(--color-overlay)' }}>
          <div className="bg-surface rounded-lg p-4 max-w-xs w-full shadow-lg border border-muted">
            <h3 className="text-sm font-semibold text-body mb-3">
              Apply &quot;{autoThemeDialog.name}&quot;
            </h3>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => onSetAutoThemeDayAndApply(autoThemeDialog.filename, autoThemeDialog)}
                className="px-3 py-2 rounded text-sm font-medium text-left transition-colors hover:bg-deep text-body"
              >
                Set as day theme
              </button>
              <button
                onClick={() => onSetAutoThemeNightAndApply(autoThemeDialog.filename, autoThemeDialog)}
                className="px-3 py-2 rounded text-sm font-medium text-left transition-colors hover:bg-deep text-body"
              >
                Set as night theme
              </button>
              <button
                onClick={() => onApplyGloballyAndDisableAuto(autoThemeDialog)}
                className="px-3 py-2 rounded text-sm font-medium text-left transition-colors hover:bg-deep text-muted"
              >
                Apply globally (disable auto)
              </button>
            </div>
            <button
              onClick={onDismissAutoThemeDialog}
              className="mt-3 w-full px-3 py-2 rounded text-sm font-medium transition-colors bg-deep text-body"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}
