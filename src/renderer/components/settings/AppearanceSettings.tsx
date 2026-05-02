import { useState, useEffect } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import type { ThemeFile } from '../../../core/types/types'
import { applyFontScale } from '../../utils/fontScale'
import { FontWindowSection } from './appearance/FontWindowSection'
import { ThemeSection } from './appearance/ThemeSection'
import { CustomCSSSection } from './appearance/CustomCSSSection'

const TEMPLATE_CSS = `/* My Custom Theme */
:root {
  --color-bg: #1a1a2e;
  --color-surface: #16213e;
  --color-deep: #0f3460;
  --color-primary: #e94560;
  --color-text: #eaeaea;
  --color-text-muted: #a0a0a0;
  --color-accent: #533483;
  --color-success: #00d26a;
  --color-error: #ff4757;
  --color-warning: #ffc107;
  --color-tool: #00bcd4;
  --color-text-contrast: #fff;
  --color-overlay: rgba(0, 0, 0, 0.5);
}
`

export function AppearanceSettings() {
  const { themes, activeTheme, settings, loadThemes, loadSettings, applyTheme, setSetting } = useSettingsStore()

  const [editing, setEditing] = useState<'create' | 'edit' | null>(null)
  const [editFilename, setEditFilename] = useState('')
  const [cssContent, setCssContent] = useState('')
  const [newFilename, setNewFilename] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [themesDir, setThemesDir] = useState<string | null>(null)
  const [autoThemeDialog, setAutoThemeDialog] = useState<ThemeFile | null>(null)

  useEffect(() => {
    loadThemes()
    loadSettings()
  }, [loadThemes, loadSettings])

  const currentFontSize = settings.fontSize ?? '1'
  useEffect(() => {
    applyFontScale(currentFontSize)
  }, [currentFontSize])

  const handleSelectTheme = (theme: ThemeFile) => {
    const autoThemeEnabled = (settings.autoTheme_enabled ?? 'false') === 'true'
    if (autoThemeEnabled) {
      setAutoThemeDialog(theme)
    } else {
      applyTheme(theme)
    }
  }

  const handleStartCreate = () => {
    setEditing('create')
    setNewFilename('my-theme.css')
    setCssContent(TEMPLATE_CSS)
    setError(null)
  }

  const handleStartEdit = (theme: ThemeFile) => {
    setEditing('edit')
    setEditFilename(theme.filename)
    setCssContent(theme.css)
    setError(null)
  }

  const handleSave = async () => {
    try {
      setError(null)
      if (editing === 'create') {
        const filename = newFilename.trim()
        if (!filename) { setError('Filename is required'); return }
        const safeName = filename.endsWith('.css') ? filename : filename + '.css'
        await window.agent.themes.create(safeName, cssContent)
      } else if (editing === 'edit') {
        await window.agent.themes.save(editFilename, cssContent)
      }
      await loadThemes()
      setEditing(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleDelete = async (filename: string) => {
    try {
      await window.agent.themes.delete(filename)
      await loadThemes()
      setDeleteConfirm(null)
      if (activeTheme === filename && themes.length > 0) {
        const fallback = themes.find((t) => t.filename !== filename)
        if (fallback) applyTheme(fallback)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleOpenFolder = async () => {
    try {
      const dir = await window.agent.themes.getDir()
      setThemesDir(dir)
      await window.agent.files.revealInFileManager(dir)
    } catch {
      const dir = await window.agent.themes.getDir()
      setThemesDir(dir)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <FontWindowSection
        fontSize={currentFontSize}
        windowTitle={settings.windowTitle ?? ''}
        showTitlebar={(settings.showTitlebar ?? 'true') === 'true'}
        alwaysVisible={(settings.panelButtonAlwaysVisible ?? 'false') === 'true'}
        panelButtonRadius={settings.panelButtonRadius ?? '10'}
        chatLayout={settings.chatLayout ?? 'tight'}
        diffExpanded={(settings.diffExpandedByDefault ?? 'false') === 'true'}
        heatmapEnabled={(settings.heatmap_enabled ?? 'false') === 'true'}
        heatmapMode={settings.heatmap_mode ?? 'relative'}
        heatmapMin={settings.heatmap_min ?? '0'}
        heatmapMax={settings.heatmap_max ?? '50'}
        onSetFontSize={(v) => setSetting('fontSize', v)}
        onSetWindowTitle={(v) => setSetting('windowTitle', v)}
        onToggleTitlebar={() => setSetting('showTitlebar', (settings.showTitlebar ?? 'true') === 'true' ? 'false' : 'true')}
        onToggleAlwaysVisible={() => setSetting('panelButtonAlwaysVisible', (settings.panelButtonAlwaysVisible ?? 'false') === 'false' ? 'true' : 'false')}
        onSetPanelButtonRadius={(v) => setSetting('panelButtonRadius', v)}
        onSetChatLayout={(v) => setSetting('chatLayout', v)}
        onToggleDiffExpanded={() => setSetting('diffExpandedByDefault', (settings.diffExpandedByDefault ?? 'false') === 'true' ? 'false' : 'true')}
        onToggleHeatmap={() => setSetting('heatmap_enabled', (settings.heatmap_enabled ?? 'false') === 'true' ? 'false' : 'true')}
        onSetHeatmapMode={(v) => setSetting('heatmap_mode', v)}
        onSetHeatmapMin={(v) => setSetting('heatmap_min', v)}
        onSetHeatmapMax={(v) => setSetting('heatmap_max', v)}
      />

      <ThemeSection
        themes={themes}
        activeTheme={activeTheme}
        themesDir={themesDir}
        autoThemeDialog={autoThemeDialog}
        autoThemeEnabled={(settings.autoTheme_enabled ?? 'false') === 'true'}
        autoThemeDayTheme={settings.autoTheme_dayTheme ?? 'default-light.css'}
        autoThemeNightTheme={settings.autoTheme_nightTheme ?? 'default-dark.css'}
        autoThemeDayTime={settings.autoTheme_dayTime ?? '07:00'}
        autoThemeNightTime={settings.autoTheme_nightTime ?? '21:00'}
        deleteConfirm={deleteConfirm}
        onSelectTheme={handleSelectTheme}
        onStartCreate={handleStartCreate}
        onStartEdit={handleStartEdit}
        onDelete={handleDelete}
        onSetDeleteConfirm={setDeleteConfirm}
        onOpenFolder={handleOpenFolder}
        onToggleAutoTheme={() => setSetting('autoTheme_enabled', (settings.autoTheme_enabled ?? 'false') === 'true' ? 'false' : 'true')}
        onSetAutoThemeDayTheme={(v) => setSetting('autoTheme_dayTheme', v)}
        onSetAutoThemeNightTheme={(v) => setSetting('autoTheme_nightTheme', v)}
        onSetAutoThemeDayTime={(v) => setSetting('autoTheme_dayTime', v)}
        onSetAutoThemeNightTime={(v) => setSetting('autoTheme_nightTime', v)}
        onSetAutoThemeDayAndApply={(filename, theme) => {
          setSetting('autoTheme_dayTheme', filename)
          applyTheme(theme)
          setAutoThemeDialog(null)
        }}
        onSetAutoThemeNightAndApply={(filename, theme) => {
          setSetting('autoTheme_nightTheme', filename)
          applyTheme(theme)
          setAutoThemeDialog(null)
        }}
        onApplyGloballyAndDisableAuto={(theme) => {
          setSetting('autoTheme_enabled', 'false')
          applyTheme(theme)
          setAutoThemeDialog(null)
        }}
        onDismissAutoThemeDialog={() => setAutoThemeDialog(null)}
      />

      {editing && (
        <CustomCSSSection
          editing={editing}
          editFilename={editFilename}
          cssContent={cssContent}
          newFilename={newFilename}
          error={error}
          onChangeCssContent={setCssContent}
          onChangeNewFilename={setNewFilename}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setError(null) }}
        />
      )}
    </div>
  )
}
