import { useState, useEffect } from 'react'
import { Toggle } from '../../shared/Toggle'
import { parseFontScale } from '../../../utils/fontScale'

export interface FontWindowSectionProps {
  fontSize: string
  windowTitle: string
  showTitlebar: boolean
  alwaysVisible: boolean
  panelButtonRadius: string
  chatLayout: string
  diffExpanded: boolean
  heatmapEnabled: boolean
  heatmapMode: string
  heatmapMin: string
  heatmapMax: string
  onSetFontSize: (v: string) => void
  onSetWindowTitle: (v: string) => void
  onToggleTitlebar: () => void
  onToggleAlwaysVisible: () => void
  onSetPanelButtonRadius: (v: string) => void
  onSetChatLayout: (v: 'tight' | 'wide') => void
  onToggleDiffExpanded: () => void
  onToggleHeatmap: () => void
  onSetHeatmapMode: (v: 'relative' | 'fixed') => void
  onSetHeatmapMin: (v: string) => void
  onSetHeatmapMax: (v: string) => void
}

export function FontWindowSection({
  fontSize,
  windowTitle,
  showTitlebar,
  alwaysVisible,
  panelButtonRadius,
  chatLayout,
  diffExpanded,
  heatmapEnabled,
  heatmapMode,
  heatmapMin,
  heatmapMax,
  onSetFontSize,
  onSetWindowTitle,
  onToggleTitlebar,
  onToggleAlwaysVisible,
  onSetPanelButtonRadius,
  onSetChatLayout,
  onToggleDiffExpanded,
  onToggleHeatmap,
  onSetHeatmapMode,
  onSetHeatmapMin,
  onSetHeatmapMax,
}: FontWindowSectionProps) {
  const currentScale = parseFontScale(fontSize)
  const [customInputValue, setCustomInputValue] = useState<string>(String(currentScale))

  useEffect(() => {
    setCustomInputValue(String(currentScale))
  }, [currentScale])

  return (
    <>
      {/* Interface Settings */}
      <div className="rounded-lg overflow-hidden border border-deep">
        {/* Show Title Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <span className="text-sm text-body">Show Title Bar</span>
          <Toggle enabled={showTitlebar} onToggle={onToggleTitlebar} label="Show Title Bar" />
        </div>

        {/* Window Title */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <span className="text-sm text-body">Window Title</span>
          <input
            type="text"
            value={windowTitle}
            onChange={(e) => onSetWindowTitle(e.target.value)}
            placeholder="Agent Desktop"
            className="w-48 bg-surface border border-muted rounded px-2 py-1 text-sm outline-none focus:border-primary mobile:text-base"
            style={{ color: 'var(--color-text)' }}
            aria-label="Custom window title"
          />
        </div>

        {/* Font Scale */}
        <div className="flex flex-col px-4 py-3 border-b border-deep gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-body">Font Scale</span>
            <span className="text-xs text-muted">{currentScale.toFixed(2)}× · ~{Math.round(currentScale * 16)}px</span>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {[
              { value: '0.85', label: 'Small' },
              { value: '1', label: 'Normal' },
              { value: '1.25', label: 'Large' },
              { value: '1.5', label: 'XL' },
              { value: '2', label: 'XXL' },
            ].map((preset) => {
              const active = Math.abs(currentScale - parseFloat(preset.value)) < 0.01
              return (
                <button
                  key={preset.value}
                  onClick={() => onSetFontSize(preset.value)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors mobile:px-4 mobile:py-3 mobile:text-sm ${
                    active ? 'bg-primary text-contrast' : 'bg-surface text-body'
                  }`}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Custom</span>
            <input
              type="number"
              min={0.5}
              max={3}
              step={0.05}
              value={customInputValue}
              onChange={(e) => {
                const v = e.target.value
                setCustomInputValue(v)
                if (v === '') return
                const n = Number(v)
                if (!isNaN(n) && n >= 0.5 && n <= 3) onSetFontSize(String(n))
              }}
              className="w-20 bg-surface border border-muted rounded px-2 py-1 text-sm text-center outline-none focus:border-primary mobile:text-base"
              style={{ color: 'var(--color-text)' }}
              aria-label="Custom font scale"
            />
            <span className="text-xs text-muted">×</span>
          </div>
        </div>

        {/* Chat Layout */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <span className="text-sm text-body">Chat Layout</span>
          <div className="flex gap-1">
            {(['tight', 'wide'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => onSetChatLayout(mode)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors mobile:px-4 mobile:py-3 mobile:text-sm ${
                  chatLayout === mode ? 'bg-primary text-contrast' : 'bg-surface text-body'
                }`}
              >
                {mode === 'tight' ? 'Tight' : 'Wide'}
              </button>
            ))}
          </div>
        </div>

        {/* Panel Buttons — Always Visible */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <span className="text-sm text-body">Panel Buttons</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">Always visible</span>
            <Toggle enabled={alwaysVisible} onToggle={onToggleAlwaysVisible} label="Panel Buttons Always Visible" />
          </div>
        </div>

        {/* Panel Buttons — Proximity Radius */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <span className="text-sm text-muted pl-4">Proximity radius</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={50}
              step={1}
              value={panelButtonRadius}
              onChange={(e) => {
                const v = e.target.value
                if (v !== '' && Number(v) >= 0 && Number(v) <= 50) onSetPanelButtonRadius(v)
              }}
              className="w-16 bg-surface border border-muted rounded px-2 py-1 text-sm text-center outline-none focus:border-primary mobile:text-base"
              style={{ color: 'var(--color-text)' }}
              aria-label="Panel button proximity radius"
            />
            <span className="text-xs text-muted">%</span>
          </div>
        </div>

        {/* File Diffs */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex flex-col">
            <span className="text-sm text-body">File Diffs</span>
            <span className="text-xs text-muted">Show edit diffs expanded by default</span>
          </div>
          <Toggle enabled={diffExpanded} onToggle={onToggleDiffExpanded} label="File Diffs Expanded by Default" />
        </div>
      </div>

      {/* Folder Heatmap */}
      <div className="rounded-lg overflow-hidden border border-deep">
        {/* Enable/Disable */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <div className="flex flex-col">
            <span className="text-sm text-body">Folder Heatmap</span>
            <span className="text-xs text-muted">Color folders by conversation count (green→red)</span>
          </div>
          <Toggle enabled={heatmapEnabled} onToggle={onToggleHeatmap} label="Folder Heatmap" />
        </div>

        {heatmapEnabled && (
          <>
            {/* Mode: Relative / Fixed */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
              <span className="text-sm text-body">Mode</span>
              <div className="flex gap-1">
                {(['relative', 'fixed'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => onSetHeatmapMode(mode)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors mobile:px-4 mobile:py-3 mobile:text-sm ${
                      heatmapMode === mode ? 'bg-primary text-contrast' : 'bg-surface text-body'
                    }`}
                  >
                    {mode === 'relative' ? 'Relative' : 'Fixed'}
                  </button>
                ))}
              </div>
            </div>

            {/* Fixed thresholds */}
            {heatmapMode === 'fixed' && (
              <>
                <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
                  <span className="text-sm text-muted pl-4">Min (green)</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={heatmapMin}
                      onChange={(e) => {
                        const v = e.target.value
                        if (v !== '' && Number(v) >= 0) onSetHeatmapMin(v)
                      }}
                      className="w-16 bg-surface border border-muted rounded px-2 py-1 text-sm text-center outline-none focus:border-primary mobile:text-base"
                      style={{ color: 'var(--color-text)' }}
                      aria-label="Heatmap minimum threshold"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted pl-4">Max (red)</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={heatmapMax}
                      onChange={(e) => {
                        const v = e.target.value
                        if (v !== '' && Number(v) >= 1) onSetHeatmapMax(v)
                      }}
                      className="w-16 bg-surface border border-muted rounded px-2 py-1 text-sm text-center outline-none focus:border-primary mobile:text-base"
                      style={{ color: 'var(--color-text)' }}
                      aria-label="Heatmap maximum threshold"
                    />
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}
