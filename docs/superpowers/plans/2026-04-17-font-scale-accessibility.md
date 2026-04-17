# Font Scale Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken px-based `fontSize` setting with a `--font-scale` CSS variable driven scaling system that respects browser accessibility preferences and uniformly scales all renderer text (Tailwind, inline styles, Monaco editors, extensions).

**Architecture:** A single CSS custom property `--font-scale` on `<html>` multiplies the user agent font-size (`100%`). A new utility module `fontScale.ts` centralizes parsing (with legacy-px migration) and application. Monaco editors (which need a number, not CSS) subscribe to the settings store via a dedicated hook. All 62 pixel-fixed sizing points (Tailwind `text-[Xpx]` arbitraries + inline `style={{ fontSize: N }}`) get mechanically rewritten to rem so Tailwind's rem-based utilities scale automatically.

**Tech Stack:** TypeScript, React, Zustand, Tailwind v3, Vitest, Monaco Editor.

**Spec:** `docs/superpowers/specs/2026-04-17-font-scale-accessibility-design.md`

---

## File Structure

**New files:**
- `src/renderer/utils/fontScale.ts` — parsing, application, px-to-rem helpers
- `src/renderer/utils/fontScale.test.ts` — unit tests
- `src/renderer/hooks/useMonacoFontSize.ts` — reactive hook for Monaco editors
- `src/renderer/hooks/useMonacoFontSize.test.ts` — unit tests

**Modified (core):**
- `tailwind.config.ts` — remove `fontSize.base` override
- `src/renderer/styles/globals.css` — switch `html` font-size to `calc(var(--font-scale, 1) * 100%)`
- `src/renderer/App.tsx` — apply scale via helper at boot
- `src/renderer/components/overlay/OverlayChat.tsx` — same
- `src/renderer/components/settings/AppearanceSettings.tsx` — new UI (presets + custom input), apply via helper

**Modified (Monaco — 5 files):**
- `src/renderer/components/settings/AppearanceSettings.tsx` (Monaco line 577)
- `src/renderer/components/settings/SystemPromptEditorModal.tsx`
- `src/renderer/components/panel/PreviewTab.tsx`
- `src/renderer/components/panel/ExpandedViewerModal.tsx`
- `src/renderer/components/artifacts/NotebookPreview.tsx`

**Modified (inline fontSize rewrites — 4 files):**
- `src/renderer/components/extensions/ExtensionDialog.tsx`
- `src/renderer/components/extensions/ExtensionWidget.tsx`
- `src/renderer/components/extensions/ExtensionToast.tsx`
- `src/renderer/components/mcp/McpServerForm.tsx`

**Modified (Tailwind `text-[Xpx]` mechanical substitution — 20 files):**
Listed in Task 8.

---

## Task 1: Create fontScale utility + tests

**Files:**
- Create: `src/renderer/utils/fontScale.ts`
- Create: `src/renderer/utils/fontScale.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `src/renderer/utils/fontScale.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { parseFontScale, applyFontScale, pxToRem } from './fontScale'

describe('parseFontScale', () => {
  it('returns 1 when input is undefined', () => {
    expect(parseFontScale(undefined)).toBe(1)
  })

  it('returns 1 when input is empty string', () => {
    expect(parseFontScale('')).toBe(1)
  })

  it('returns 1 when input is not numeric', () => {
    expect(parseFontScale('foo')).toBe(1)
  })

  it('returns 1 when input is zero or negative', () => {
    expect(parseFontScale('0')).toBe(1)
    expect(parseFontScale('-1')).toBe(1)
  })

  it('returns scale value when input is a small decimal (modern format)', () => {
    expect(parseFontScale('1')).toBe(1)
    expect(parseFontScale('1.25')).toBe(1.25)
    expect(parseFontScale('0.85')).toBe(0.85)
  })

  it('converts legacy px values (> 4) to scale on 16px UA base', () => {
    expect(parseFontScale('14')).toBe(0.88)
    expect(parseFontScale('16')).toBe(1)
    expect(parseFontScale('20')).toBe(1.25)
    expect(parseFontScale('32')).toBe(2)
  })

  it('rounds legacy conversions to 2 decimals', () => {
    expect(parseFontScale('15')).toBe(0.94)
  })
})

describe('pxToRem', () => {
  it('converts px number to rem string on 16px base', () => {
    expect(pxToRem(16)).toBe('1rem')
    expect(pxToRem(13)).toBe('0.8125rem')
    expect(pxToRem(12)).toBe('0.75rem')
    expect(pxToRem(14)).toBe('0.875rem')
  })
})

describe('applyFontScale', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--font-scale')
  })

  it('sets --font-scale CSS variable on <html>', () => {
    applyFontScale('1.25')
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.25')
  })

  it('uses parsed (migrated) value for legacy input', () => {
    applyFontScale('20')
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.25')
  })

  it('falls back to 1 when input is undefined', () => {
    applyFontScale(undefined)
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1')
  })
})
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/utils/fontScale.test.ts`
Expected: FAIL — module `./fontScale` does not exist.

- [ ] **Step 1.3: Write the implementation**

Create `src/renderer/utils/fontScale.ts`:

```ts
/**
 * Parse a raw font-scale string into a numeric multiplier.
 *
 * Handles legacy-px storage (values > 4 are treated as pixels on a 16px UA
 * base) so the DB setting does not need a schema migration.
 */
export function parseFontScale(raw: string | undefined): number {
  if (!raw) return 1
  const n = parseFloat(raw)
  if (isNaN(n) || n <= 0) return 1
  if (n > 4) return Math.round((n / 16) * 100) / 100
  return n
}

/**
 * Write the scale factor to the --font-scale CSS variable on <html>.
 */
export function applyFontScale(raw: string | undefined): void {
  const scale = parseFontScale(raw)
  document.documentElement.style.setProperty('--font-scale', String(scale))
}

/**
 * Convert a px number to a rem string on the 16px base.
 */
export function pxToRem(px: number): string {
  return `${px / 16}rem`
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/utils/fontScale.test.ts`
Expected: PASS (all ~15 tests green).

- [ ] **Step 1.5: Commit**

```bash
git add src/renderer/utils/fontScale.ts src/renderer/utils/fontScale.test.ts
git commit -m "feat(fontscale): add parseFontScale, applyFontScale, pxToRem helpers"
```

---

## Task 2: Create useMonacoFontSize hook + tests

**Files:**
- Create: `src/renderer/hooks/useMonacoFontSize.ts`
- Create: `src/renderer/hooks/useMonacoFontSize.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `src/renderer/hooks/useMonacoFontSize.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMonacoFontSize } from './useMonacoFontSize'
import { useSettingsStore } from '../stores/settingsStore'

describe('useMonacoFontSize', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: {}, themes: [], activeTheme: null, isLoading: false })
  })

  it('returns the base size when scale is 1', () => {
    useSettingsStore.setState({ settings: { fontSize: '1' } })
    const { result } = renderHook(() => useMonacoFontSize(13))
    expect(result.current).toBe(13)
  })

  it('returns basePx * scale rounded', () => {
    useSettingsStore.setState({ settings: { fontSize: '1.5' } })
    const { result } = renderHook(() => useMonacoFontSize(13))
    expect(result.current).toBe(20)
  })

  it('migrates legacy px values transparently', () => {
    useSettingsStore.setState({ settings: { fontSize: '20' } })
    const { result } = renderHook(() => useMonacoFontSize(13))
    // parseFontScale('20') = 1.25 → 13 * 1.25 = 16.25 → round = 16
    expect(result.current).toBe(16)
  })

  it('falls back to base when fontSize is unset', () => {
    const { result } = renderHook(() => useMonacoFontSize(13))
    expect(result.current).toBe(13)
  })

  it('rerenders with new value when the store updates', () => {
    useSettingsStore.setState({ settings: { fontSize: '1' } })
    const { result } = renderHook(() => useMonacoFontSize(13))
    expect(result.current).toBe(13)
    act(() => {
      useSettingsStore.setState({ settings: { fontSize: '2' } })
    })
    expect(result.current).toBe(26)
  })
})
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/hooks/useMonacoFontSize.test.ts`
Expected: FAIL — hook does not exist.

- [ ] **Step 2.3: Write the implementation**

Create `src/renderer/hooks/useMonacoFontSize.ts`:

```ts
import { useSettingsStore } from '../stores/settingsStore'
import { parseFontScale } from '../utils/fontScale'

/**
 * Reactive Monaco fontSize based on the --font-scale setting.
 * Returns Math.round(basePx * scale), recomputed on store changes.
 */
export function useMonacoFontSize(basePx: number): number {
  const scale = useSettingsStore((s) => parseFontScale(s.settings.fontSize))
  return Math.round(basePx * scale)
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/hooks/useMonacoFontSize.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 2.5: Commit**

```bash
git add src/renderer/hooks/useMonacoFontSize.ts src/renderer/hooks/useMonacoFontSize.test.ts
git commit -m "feat(fontscale): add useMonacoFontSize reactive hook"
```

---

## Task 3: Core CSS + Tailwind — switch root font-size to --font-scale

**Files:**
- Modify: `tailwind.config.ts:28-30`
- Modify: `src/renderer/styles/globals.css:62-66`

This is the breaking change at the rendering layer. Ship it atomically with Task 4 so the boot-time application code lands simultaneously.

- [ ] **Step 3.1: Remove `fontSize.base` override in Tailwind config**

Edit `tailwind.config.ts`. Current (lines 28-30):

```ts
      fontSize: {
        base: ['14px', { lineHeight: '1.5' }],
      },
```

Delete these three lines (and the trailing comma on the preceding line if needed). Tailwind defaults restore: `text-base = 1rem`.

Final `theme.extend` excerpt should look like:

```ts
    extend: {
      colors: {
        base: 'var(--color-bg)',
        // ... unchanged
        overlay: 'var(--color-overlay)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      spacing: {
        '1u': '4px',
        // ... unchanged
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
      },
    },
```

- [ ] **Step 3.2: Update `html` rule in globals.css**

Edit `src/renderer/styles/globals.css`. Current (lines 62-66):

```css
  html {
    font-size: 14px;
    line-height: 1.5;
    overflow: hidden;
  }
```

Replace with:

```css
  html {
    font-size: calc(var(--font-scale, 1) * 100%);
    line-height: 1.5;
    overflow: hidden;
  }
```

The `100%` inherits the user agent font-size (typically 16px, but respects OS/browser accessibility prefs).

- [ ] **Step 3.3: Run build to verify config is valid**

Run: `npm run build`
Expected: PASS (Tailwind compiles, TypeScript compiles).

- [ ] **Step 3.4: Commit**

```bash
git add tailwind.config.ts src/renderer/styles/globals.css
git commit -m "refactor(fontscale): switch root font-size to --font-scale CSS variable"
```

---

## Task 4: Wire applyFontScale at application boot

**Files:**
- Modify: `src/renderer/App.tsx:49-53`
- Modify: `src/renderer/components/overlay/OverlayChat.tsx:46-48`

- [ ] **Step 4.1: Replace inline `style.fontSize` in App.tsx**

Edit `src/renderer/App.tsx`. Current (lines 49-53):

```tsx
      // Apply saved font size
      const { settings } = useSettingsStore.getState()
      if (settings.fontSize) {
        document.documentElement.style.fontSize = settings.fontSize + 'px'
      }
```

Replace with:

```tsx
      // Apply saved font scale
      const { settings } = useSettingsStore.getState()
      applyFontScale(settings.fontSize)
```

Add the import at the top of the file (alphabetically with other `../utils/` imports):

```tsx
import { applyFontScale } from './utils/fontScale'
```

- [ ] **Step 4.2: Replace inline `style.fontSize` in OverlayChat.tsx**

Edit `src/renderer/components/overlay/OverlayChat.tsx`. Current (lines 46-48):

```tsx
      if (settings.fontSize) {
        document.documentElement.style.fontSize = settings.fontSize + 'px'
      }
```

Replace with:

```tsx
      applyFontScale(settings.fontSize)
```

Add the import:

```tsx
import { applyFontScale } from '../../utils/fontScale'
```

- [ ] **Step 4.3: Run the app and verify boot applies the scale**

Run: `npm run dev`

Manual check: the app boots without console errors. Open DevTools → Elements → `<html>` — inspect inline style. You should see `--font-scale: 1` (or the migrated value if you had a legacy `fontSize` setting).

- [ ] **Step 4.4: Run full test suite to catch regressions**

Run: `npm test`
Expected: all existing tests still pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/components/overlay/OverlayChat.tsx
git commit -m "refactor(fontscale): apply scale via applyFontScale helper at boot"
```

---

## Task 5: Rewrite AppearanceSettings UI (presets + custom input)

**Files:**
- Modify: `src/renderer/components/settings/AppearanceSettings.tsx`

- [ ] **Step 5.1: Update the `useEffect` that applies the scale**

In `AppearanceSettings.tsx`, current (lines 58-60):

```tsx
  useEffect(() => {
    document.documentElement.style.fontSize = currentFontSize + 'px'
  }, [currentFontSize])
```

Replace with:

```tsx
  useEffect(() => {
    applyFontScale(currentFontSize)
  }, [currentFontSize])
```

Add the import at the top of the file:

```tsx
import { applyFontScale, parseFontScale } from '../../utils/fontScale'
```

- [ ] **Step 5.2: Redefine the initial value to use parseFontScale**

Current (line 46):

```tsx
  const currentFontSize = settings.fontSize ?? '14'
```

Replace with:

```tsx
  const currentFontSize = settings.fontSize ?? '1'
  const currentScale = parseFontScale(currentFontSize)
```

The `currentScale` is the numeric value used by the UI. `currentFontSize` stays a string for the raw setting value (used in `setSetting`).

- [ ] **Step 5.3: Replace the Font Size input block**

Current (lines 167-186):

```tsx
        {/* Font Size */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <span className="text-sm text-body">Font Size</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={8}
              max={32}
              value={currentFontSize}
              onChange={(e) => {
                const v = e.target.value
                if (v !== '' && Number(v) >= 8 && Number(v) <= 32) setSetting('fontSize', v)
              }}
              className="w-16 bg-surface text-body border border-muted rounded px-2 py-1 text-sm text-center outline-none focus:border-primary mobile:text-base"
              aria-label="Font size in pixels"
            />
            <span className="text-xs text-muted">px</span>
          </div>
        </div>
```

Replace with:

```tsx
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
                  onClick={() => setSetting('fontSize', preset.value)}
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
              value={currentScale}
              onChange={(e) => {
                const v = e.target.value
                if (v === '') return
                const n = Number(v)
                if (!isNaN(n) && n >= 0.5 && n <= 3) setSetting('fontSize', String(n))
              }}
              className="w-20 bg-surface text-body border border-muted rounded px-2 py-1 text-sm text-center outline-none focus:border-primary mobile:text-base"
              aria-label="Custom font scale"
            />
            <span className="text-xs text-muted">×</span>
          </div>
        </div>
```

- [ ] **Step 5.4: Verify the UI in dev mode**

Run: `npm run dev`

Manual checks:
- Open Settings → Appearance. The Font Scale row shows the scale and a ~px readout.
- Click each preset; watch the app text resize instantly (all `text-sm`/`text-xs` should scale).
- Enter `0.75` in custom input; watch the app shrink.
- Close Settings; the scale persists (saved to DB).

- [ ] **Step 5.5: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5.6: Commit**

```bash
git add src/renderer/components/settings/AppearanceSettings.tsx
git commit -m "feat(fontscale): replace px input with scale factor presets + custom input"
```

---

## Task 6: Wire Monaco editors via useMonacoFontSize

**Files (5 call sites):**
- Modify: `src/renderer/components/settings/AppearanceSettings.tsx:577`
- Modify: `src/renderer/components/settings/SystemPromptEditorModal.tsx:72`
- Modify: `src/renderer/components/panel/PreviewTab.tsx:503`
- Modify: `src/renderer/components/panel/ExpandedViewerModal.tsx:147`
- Modify: `src/renderer/components/artifacts/NotebookPreview.tsx:719`

For each file, add the hook import and replace the literal `fontSize: N` Monaco option with `fontSize: useMonacoFontSize(N)`.

- [ ] **Step 6.1: AppearanceSettings.tsx (Monaco editor, base 13)**

Add import (alongside other hook imports):

```tsx
import { useMonacoFontSize } from '../../hooks/useMonacoFontSize'
```

Inside the `AppearanceSettings` function, before the `return`, add:

```tsx
  const monacoFontSize = useMonacoFontSize(13)
```

Current line 577 (inside `<Editor options={...}>`):

```tsx
                fontSize: 13,
```

Replace with:

```tsx
                fontSize: monacoFontSize,
```

- [ ] **Step 6.2: SystemPromptEditorModal.tsx (base 13)**

Add import:

```tsx
import { useMonacoFontSize } from '../../hooks/useMonacoFontSize'
```

Inside the component body, before `return`:

```tsx
  const monacoFontSize = useMonacoFontSize(13)
```

Current (line 72):

```tsx
              fontSize: 13,
```

Replace with:

```tsx
              fontSize: monacoFontSize,
```

- [ ] **Step 6.3: PreviewTab.tsx (base 13)**

Add import:

```tsx
import { useMonacoFontSize } from '../../hooks/useMonacoFontSize'
```

Inside the component body, before `return`:

```tsx
  const monacoFontSize = useMonacoFontSize(13)
```

Current (line 503):

```tsx
      options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', scrollBeyondLastLine: false }}
```

Replace with:

```tsx
      options={{ minimap: { enabled: false }, fontSize: monacoFontSize, wordWrap: 'on', scrollBeyondLastLine: false }}
```

- [ ] **Step 6.4: ExpandedViewerModal.tsx (base 13)**

Add import:

```tsx
import { useMonacoFontSize } from '../../hooks/useMonacoFontSize'
```

Inside component body:

```tsx
  const monacoFontSize = useMonacoFontSize(13)
```

Current (line 147):

```tsx
        fontSize: 13,
```

Replace with:

```tsx
        fontSize: monacoFontSize,
```

- [ ] **Step 6.5: NotebookPreview.tsx (base 12)**

Add import:

```tsx
import { useMonacoFontSize } from '../../hooks/useMonacoFontSize'
```

Inside component body (or the relevant sub-component if the editor is nested):

```tsx
  const monacoFontSize = useMonacoFontSize(12)
```

Current (line 719):

```tsx
                  fontSize: 12,
```

Replace with:

```tsx
                  fontSize: monacoFontSize,
```

Note: if the Monaco options object is defined in a child component or memoized inside a loop, hoist the hook call to the nearest functional component body. React's rules of hooks apply.

- [ ] **Step 6.6: Run build and tests**

Run: `npm run build && npm test`
Expected: both pass.

- [ ] **Step 6.7: Visual check**

Run: `npm run dev`. Open each Monaco surface (Theme editor, System Prompt editor, Preview tab, Expanded viewer, Notebook preview). Change Font Scale to 1.5. All Monaco editors should grow proportionally.

- [ ] **Step 6.8: Commit**

```bash
git add src/renderer/components/settings/AppearanceSettings.tsx \
        src/renderer/components/settings/SystemPromptEditorModal.tsx \
        src/renderer/components/panel/PreviewTab.tsx \
        src/renderer/components/panel/ExpandedViewerModal.tsx \
        src/renderer/components/artifacts/NotebookPreview.tsx
git commit -m "refactor(fontscale): wire Monaco editors via useMonacoFontSize hook"
```

---

## Task 7: Rewrite inline `style={{ fontSize: N }}` in extensions + McpServerForm

**Files (4 files, 10 occurrences):**
- Modify: `src/renderer/components/extensions/ExtensionDialog.tsx` (6 occurrences: lines 32, 41, 64, 118, 146, 259)
- Modify: `src/renderer/components/extensions/ExtensionWidget.tsx` (1 occurrence: line 14)
- Modify: `src/renderer/components/extensions/ExtensionToast.tsx` (2 occurrences: lines 26, 40)
- Modify: `src/renderer/components/mcp/McpServerForm.tsx` (1 occurrence: line 211)

Strategy: use the `pxToRem` helper. Replace `fontSize: N` (number) or `fontSize: 'Npx'` (string) with `fontSize: pxToRem(N)`. This keeps the literal pixel count visible in source while yielding a rem string that scales.

- [ ] **Step 7.1: ExtensionDialog.tsx**

Add import at top:

```tsx
import { pxToRem } from '../../utils/fontScale'
```

Replace 6 occurrences:

| Line | Before                                                    | After                                                             |
|------|-----------------------------------------------------------|-------------------------------------------------------------------|
| 32   | `fontSize: 16,`                                           | `fontSize: pxToRem(16),`                                          |
| 41   | `fontSize: 13,`                                           | `fontSize: pxToRem(13),`                                          |
| 64   | `fontSize: 13,`                                           | `fontSize: pxToRem(13),`                                          |
| 118  | `fontSize: 13,`                                           | `fontSize: pxToRem(13),`                                          |
| 146  | `<p style={{ color: 'var(--color-text)', margin: '0 0 12px 0', fontSize: 13 }}>` | `<p style={{ color: 'var(--color-text)', margin: '0 0 12px 0', fontSize: pxToRem(13) }}>` |
| 259  | `fontSize: 13,`                                           | `fontSize: pxToRem(13),`                                          |

- [ ] **Step 7.2: ExtensionWidget.tsx**

Add import:

```tsx
import { pxToRem } from '../../utils/fontScale'
```

Line 14: `fontSize: 12,` → `fontSize: pxToRem(12),`

- [ ] **Step 7.3: ExtensionToast.tsx**

Add import:

```tsx
import { pxToRem } from '../../utils/fontScale'
```

Line 26: `fontSize: 13,` → `fontSize: pxToRem(13),`
Line 40: `fontSize: 14,` → `fontSize: pxToRem(14),`

- [ ] **Step 7.4: McpServerForm.tsx**

Add import:

```tsx
import { pxToRem } from '../../utils/fontScale'
```

Line 211: `style={{ minHeight: '100px', fontFamily: 'monospace', fontSize: '12px' }}`
Replace with: `style={{ minHeight: '100px', fontFamily: 'monospace', fontSize: pxToRem(12) }}`

- [ ] **Step 7.5: Verify no residual inline fontSize literals in these files**

Run:

```bash
grep -nE "fontSize:\s*([0-9]+|['\"][0-9]+px['\"])" \
  src/renderer/components/extensions/ExtensionDialog.tsx \
  src/renderer/components/extensions/ExtensionWidget.tsx \
  src/renderer/components/extensions/ExtensionToast.tsx \
  src/renderer/components/mcp/McpServerForm.tsx
```

Expected: no matches (only `pxToRem(N)` calls remain).

- [ ] **Step 7.6: Run build + tests**

Run: `npm run build && npm test`
Expected: both pass.

- [ ] **Step 7.7: Commit**

```bash
git add src/renderer/components/extensions/ExtensionDialog.tsx \
        src/renderer/components/extensions/ExtensionWidget.tsx \
        src/renderer/components/extensions/ExtensionToast.tsx \
        src/renderer/components/mcp/McpServerForm.tsx
git commit -m "refactor(fontscale): rewrite inline fontSize literals via pxToRem"
```

---

## Task 8: Mechanical substitution of Tailwind `text-[Xpx]` arbitrary values

**Files (20 files, 47 occurrences):**

- `src/renderer/components/scheduler/TaskFormModal.tsx`
- `src/renderer/components/settings/AISettings.tsx`
- `src/renderer/components/settings/OverrideFormFields.tsx`
- `src/renderer/components/settings/ShortcutSettings.tsx`
- `src/renderer/components/settings/AppearanceSettings.tsx`
- `src/renderer/components/settings/CwdWhitelistEditor.tsx`
- `src/renderer/components/settings/FolderSettingsPopover.tsx`
- `src/renderer/components/mcp/McpServerList.tsx`
- `src/renderer/components/panel/NewConversationFromFilesModal.tsx`
- `src/renderer/components/panel/PreviewTab.tsx`
- `src/renderer/components/panel/git/GitGraph.tsx`
- `src/renderer/components/panel/git/GitBranches.tsx`
- `src/renderer/components/attachments/AttachmentPreview.tsx`
- `src/renderer/components/chat/ToolApprovalBlock.tsx`
- `src/renderer/components/chat/TaskGroupBlock.tsx`
- `src/renderer/components/chat/SlashCommandDropdown.tsx`
- `src/renderer/components/chat/MessageBubble.tsx`
- `src/renderer/components/chat/ChatStatusLine.tsx`
- `src/renderer/components/chat/DiffView.tsx`
- `src/renderer/components/chat/ToolUseBlock.tsx`
- `src/renderer/components/artifacts/NotebookPreview.tsx`

Strategy: three `sed` passes, one per pixel value. Each produces identical rendering at scale 1.0 on a 16px UA base.

Substitution map:

| Before            | After                  | Equivalent at 16px base |
|-------------------|------------------------|-------------------------|
| `text-[9px]`      | `text-[0.5625rem]`     | 9px                     |
| `text-[10px]`     | `text-[0.625rem]`      | 10px                    |
| `text-[11px]`     | `text-[0.6875rem]`     | 11px                    |

The `mobile:text-[11px]` prefix (used in `ChatStatusLine.tsx`) rewrites under the same rule — `mobile:` is a Tailwind variant, not part of the utility name.

- [ ] **Step 8.1: Run the three sed substitutions**

Run (from repo root):

```bash
# Pass 1: 9px
grep -rl 'text-\[9px\]' src/renderer | xargs sed -i 's/text-\[9px\]/text-[0.5625rem]/g'

# Pass 2: 10px (also catches mobile:text-[10px] et al.)
grep -rl 'text-\[10px\]' src/renderer | xargs sed -i 's/text-\[10px\]/text-[0.625rem]/g'

# Pass 3: 11px (also catches mobile:text-[11px])
grep -rl 'text-\[11px\]' src/renderer | xargs sed -i 's/text-\[11px\]/text-[0.6875rem]/g'
```

- [ ] **Step 8.2: Verify no residual `text-[Xpx]` anywhere**

Run:

```bash
grep -rnE 'text-\[[0-9]+px\]' src/renderer
```

Expected: zero matches.

- [ ] **Step 8.3: Check the diff sanity**

Run: `git diff --stat src/renderer`

Expected: about 20 files modified, ~47 insertions / ~47 deletions (one-for-one line changes).

Spot-check: `git diff src/renderer/components/chat/MessageBubble.tsx` — every changed line should show exactly one `text-[Xpx]` → `text-[Yrem]` substitution, no other churn.

- [ ] **Step 8.4: Run build + tests**

Run: `npm run build && npm test`
Expected: both pass. No test depends on the literal `text-[10px]` class name (tests target behavior, not className strings).

- [ ] **Step 8.5: Commit**

```bash
git add src/renderer
git commit -m "refactor(fontscale): convert Tailwind arbitrary text-[Xpx] sizes to rem"
```

---

## Task 9: Manual regression + fixes

**Files:** none initially; fix-forward only if issues are found.

- [ ] **Step 9.1: Start the app**

Run: `npm run dev`

- [ ] **Step 9.2: Scale 1.0 regression pass**

With Font Scale set to `Normal (1×)`, walk through:

- Sidebar folders/conversations list readable, no layout overflow.
- Message bubbles render with expected proportions.
- Chat status line badges (scale buttons, tool names) render, text still readable.
- Git graph commit rows, branch badges readable.
- Tool use blocks, diff blocks, code blocks render correctly.
- Attachment preview thumbnails correct.
- Settings page — every tab loads without overflow.
- Monaco editors (theme editor, system prompt editor, file preview) render at expected size.

Baseline shift accepted: all text is ~7% larger than pre-change (since UA default is 16px instead of the previous hardcoded 14px, and Tailwind `text-sm` = 0.875rem = 14px now matches where `text-base` used to be). This is by design.

- [ ] **Step 9.3: Scale 1.5 visual test**

Set Font Scale to `XL (1.5×)`. Confirm:

- Every text element grows proportionally.
- Monaco editors grow.
- Extension dialogs (if reachable) grow.
- Tooltips, badges, status lines — all grow.

- [ ] **Step 9.4: Scale 0.85 visual test**

Set Font Scale to `Small (0.85×)`. Confirm:

- Compact rendering, all text still legible.
- No text clipping in fixed-width containers (if found, note it as a follow-up — fix the container, not the font).

- [ ] **Step 9.5: Browser accessibility test (web mode only)**

Run headless: `npm run build:headless && node out/headless/index.js --server`

In Chrome: `chrome://settings` → Appearance → Font size → set to "Very large". Open the web client. Root should now render at (browser default × scale). Confirm everything still scales cleanly.

- [ ] **Step 9.6: Legacy migration test**

In the app DB (manually via SQL on `~/.config/agent-desktop/agent.db`, or via a fresh install restoring an old backup), set `settings.fontSize = '20'`. Restart the app. Font Scale setting should display `1.25×` (migrated). The Custom input should show `1.25`. Raw stored value in DB is still `"20"` until the user changes it — the next save will overwrite with `"1.25"` (or whatever the user picks).

- [ ] **Step 9.7: Fix any regressions found**

If a specific layout breaks at scale 1.0 (text overflow, clipping in a fixed container), fix the offending container's width/padding. Commit each fix as a separate commit with a descriptive message. If none, skip this step.

- [ ] **Step 9.8: Final commit**

If no regressions were found, skip. Otherwise, commit each fix:

```bash
git add <fixed-file>
git commit -m "fix(fontscale): <specific regression description>"
```

---

## Summary checklist

At the end, you should have:

- [ ] 2 new utility files + tests (fontScale, useMonacoFontSize)
- [ ] Tailwind config cleanup (fontSize.base removed)
- [ ] globals.css root rule using --font-scale
- [ ] App.tsx + OverlayChat.tsx using applyFontScale
- [ ] AppearanceSettings UI: preset buttons + custom decimal input, live scale readout
- [ ] 5 Monaco editors wired to useMonacoFontSize
- [ ] 10 inline fontSize literals rewritten via pxToRem
- [ ] 47 Tailwind `text-[Xpx]` rewrites to rem
- [ ] All tests passing
- [ ] Manual regression pass completed at scales 0.85 / 1.0 / 1.5
- [ ] Legacy migration verified

Total commits: ~8–10 (one per task, plus fix commits if needed).
