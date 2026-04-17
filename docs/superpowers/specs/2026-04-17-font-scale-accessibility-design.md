# Font Scale Accessibility — Design Spec

**Date:** 2026-04-17
**Status:** Draft, ready for review
**Scope:** Renderer-wide font sizing system (desktop + web client)

---

## Problem

The existing `fontSize` setting (stored in DB, edited via `Settings → Appearance`) appears to do nothing in the web client: changing the value produces no visible effect. Root causes:

1. `tailwind.config.ts:28-30` hardcodes `text-base: ['14px', …]` — pixel-locked, does not scale with the root font-size.
2. `src/renderer/styles/globals.css:63` sets `html { font-size: 14px }` in `@layer base`. The inline style written by the app (`documentElement.style.fontSize = X + 'px'`) correctly overrides it via specificity, but the net visual effect is muted because the majority of rendered text uses `text-base` or `mobile:text-base` (both pixel-locked).
3. 62 pixel-fixed sizing points scattered across the codebase (`style={{ fontSize: N }}` inline styles and `text-[Xpx]` Tailwind arbitrary values) do not respond to the root font-size at all.

As a result, the setting exists but has no meaningful effect. This is common to desktop and web, but most noticeable in web/mobile mode because `__AGENT_WEB_MODE__` forces the compact layout where these pixel-locked paths dominate.

## Goal

Introduce a clean, accessibility-respecting font scaling system:

- The setting expresses a relative **scale factor** (`1`, `1.25`, `1.5`) rather than an absolute pixel count.
- The app's root font-size inherits from the user agent (respects browser / OS accessibility preferences).
- All renderer text — including Monaco editors, plugin-injected extension UIs, and Tailwind arbitrary pixel sizes — responds uniformly to the scale factor.
- The existing DB setting migrates transparently: legacy px values (`"14"`, `"20"`) convert to scale (`0.88`, `1.25`) on first read, without schema changes.

## Non-Goals

- No redesign of component densities. A +~7% baseline increase (14px → 16px UA default) is explicitly accepted.
- No cross-platform UA font-size overrides. If a user configures an unusual base in their browser, the app follows it — that's the point.
- No change to icon sizes, padding, or layout-defining spacing. Only text.

## Architecture

### Source of truth

The DB setting `fontSize` (key preserved for backward compatibility — no schema migration) stores a decimal string representing a scale factor. Default `"1"`. Range `0.5`–`3.0`.

### Application mechanism

A CSS custom property `--font-scale` on `<html>` drives the root font-size via:

```css
html {
  font-size: calc(var(--font-scale, 1) * 100%);
  line-height: 1.5;
  overflow: hidden;
}
```

`100%` resolves to the user agent's inherited font-size (typically 16px, but respects user preferences). Multiplied by `--font-scale`, this becomes the new `1rem`. All `rem`-based Tailwind utilities (`text-sm`, `text-xs`, `text-base`, `text-lg`, etc.) scale automatically.

The JS layer writes the scale via `documentElement.style.setProperty('--font-scale', value)` — not via `style.fontSize` directly. This keeps presentation separate from data and allows themes to override `--font-scale` if they wish.

### Helper module

A new small module `src/renderer/utils/fontScale.ts`:

```ts
export function parseFontScale(raw: string | undefined): number {
  if (!raw) return 1
  const n = parseFloat(raw)
  if (isNaN(n) || n <= 0) return 1
  // Legacy px value (pre-migration): "14", "20" etc. → scale on 16px UA base
  if (n > 4) return Math.round((n / 16) * 100) / 100
  return n
}

export function applyFontScale(raw: string | undefined): void {
  const scale = parseFontScale(raw)
  document.documentElement.style.setProperty('--font-scale', String(scale))
}

export function pxToRem(px: number): string {
  return `${px / 16}rem`
}
```

Used by `App.tsx`, `OverlayChat.tsx`, `AppearanceSettings.tsx`, and (for `pxToRem`) the extension UIs.

### Monaco editor hook

A new hook `src/renderer/hooks/useMonacoFontSize.ts`:

```ts
import { useSettingsStore } from '../stores/settingsStore'
import { parseFontScale } from '../utils/fontScale'

export function useMonacoFontSize(basePx: number): number {
  const scale = useSettingsStore((s) => parseFontScale(s.settings.fontSize))
  return Math.round(basePx * scale)
}
```

Monaco's `fontSize` option is a number (px), not CSS — so each Monaco instance subscribes to the settings store and recomputes its `fontSize` on scale change. Re-render cost is negligible; Monaco instances are limited.

## Concrete Changes

### Core (5 files)

1. **`tailwind.config.ts:28-30`** — delete the `fontSize.base` override entirely. Tailwind defaults restore: `text-base = 1rem`.
2. **`src/renderer/styles/globals.css:62-66`** — replace `html { font-size: 14px; … }` with `html { font-size: calc(var(--font-scale, 1) * 100%); … }`.
3. **`src/renderer/utils/fontScale.ts`** — new file (see above).
4. **`src/renderer/App.tsx:49-53`** — replace inline `style.fontSize` write with `applyFontScale(settings.fontSize)`.
5. **`src/renderer/components/overlay/OverlayChat.tsx:46-48`** — same replacement.

### Settings UI (1 file)

6. **`src/renderer/components/settings/AppearanceSettings.tsx`** —
   - Replace the `useEffect` that writes `style.fontSize` (lines 58-60) with a call to `applyFontScale(currentFontSize)`.
   - Replace the `<input type="number" min={8} max={32}>` control (lines 167-186) with a preset bar + optional custom input:
     - Presets: `0.85×`, `1×`, `1.25×`, `1.5×`, `2×` (labels: Small / Normal / Large / XL / XXL).
     - Custom input: `type="number"` step `0.05`, min `0.5`, max `3`.
     - Read value via `parseFontScale(settings.fontSize)` so legacy px values display correctly.

### Monaco call sites (5 files)

Wire `useMonacoFontSize(basePx)` at each Monaco instance:

7. **`src/renderer/components/settings/AppearanceSettings.tsx:577`** — `fontSize: 13` → `fontSize: useMonacoFontSize(13)`.
8. **`src/renderer/components/settings/SystemPromptEditorModal.tsx:72`** — same.
9. **`src/renderer/components/panel/PreviewTab.tsx:503`** — same.
10. **`src/renderer/components/panel/ExpandedViewerModal.tsx:147`** — same.
11. **`src/renderer/components/artifacts/NotebookPreview.tsx:719`** — `fontSize: 12` → `useMonacoFontSize(12)`.

### Inline CSS `style={{ fontSize: N }}` (4 files, 10 occurrences)

Rewrite as rem strings using `pxToRem()`:

12. **`src/renderer/components/extensions/ExtensionDialog.tsx`** — 6 occurrences (lines 32, 41, 64, 118, 146, 259).
13. **`src/renderer/components/extensions/ExtensionWidget.tsx:14`** — 1 occurrence.
14. **`src/renderer/components/extensions/ExtensionToast.tsx`** — 2 occurrences (lines 26, 40).
15. **`src/renderer/components/mcp/McpServerForm.tsx:211`** — 1 occurrence (`'12px'` → `pxToRem(12)`).

### Tailwind arbitrary `text-[Xpx]` (20 files, 47 occurrences)

Mechanical substitution, preserving identical rendering at scale 1.0 on a 16px UA base:

- `text-[9px]` → `text-[0.5625rem]`
- `text-[10px]` → `text-[0.625rem]`
- `text-[11px]` → `text-[0.6875rem]`

Also handle the single `mobile:text-[11px]` variant the same way.

Files:

- `src/renderer/components/scheduler/TaskFormModal.tsx`
- `src/renderer/components/settings/AISettings.tsx`
- `src/renderer/components/settings/OverrideFormFields.tsx`
- `src/renderer/components/settings/ShortcutSettings.tsx`
- `src/renderer/components/settings/AppearanceSettings.tsx` (one occurrence, for the "Active" theme badge)
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

Execution: `sed -i` three passes (one per px value), then grep to confirm no remaining matches.

## Migration

**Transparent, no schema change.** The `fontSize` setting key is preserved. `parseFontScale()` detects legacy px values (`n > 4`) on read and converts to scale on the fly. After the user saves any new value through the redesigned UI, the stored value is a scale factor, and the legacy branch is never taken for that user again. Old values left unchanged in DB still parse correctly indefinitely.

## Testing

### Unit tests (new)

- `src/renderer/utils/fontScale.test.ts`:
  - `parseFontScale(undefined)` → `1`.
  - `parseFontScale("")` → `1`.
  - `parseFontScale("foo")` → `1`.
  - `parseFontScale("0")` → `1` (invalid / zero guard).
  - `parseFontScale("1.25")` → `1.25`.
  - `parseFontScale("14")` → `0.88` (legacy px, 14/16 rounded to 2 decimals).
  - `parseFontScale("20")` → `1.25`.
  - `parseFontScale("32")` → `2`.
  - `pxToRem(16)` → `"1rem"`.
  - `pxToRem(13)` → `"0.8125rem"`.

- `src/renderer/hooks/useMonacoFontSize.test.ts`:
  - With settings `fontSize: "1"`, `useMonacoFontSize(13)` returns `13`.
  - With settings `fontSize: "1.5"`, `useMonacoFontSize(13)` returns `20`.
  - With settings `fontSize: "20"` (legacy), `useMonacoFontSize(13)` returns `16` (13 × 1.25).
  - Updating the store triggers a rerender returning the new value.

### Manual visual smoke test

- Scale `1.0`: app renders near-identically to pre-change state (slight +7% due to 14px→16px UA baseline shift; `text-sm` = 0.875rem = 14px, matching the previous `text-base` literal).
- Scale `0.85`: app becomes compact, still readable, matches pre-change densities roughly.
- Scale `1.5`: all text grows uniformly, including message bubbles, tool blocks, status line, Monaco editors, extension dialogs, badges (`text-[10px]` badges included).
- Browser zoom (Ctrl++): orthogonal to `--font-scale`; both stack multiplicatively.
- Chrome `chrome://settings` → default font-size 20px: app root becomes `20 * scale` px — confirms UA respect.

### Regression checklist

- Tool blocks badges (`text-[10px]`) still readable at scale 1.0.
- Chat status line (`text-[10px]`) still readable.
- Git graph references (`text-[10px]`) still readable.
- Monaco cursor alignment correct after scale change (Monaco recomputes layout on fontSize change).

## Execution Order

1. Create `fontScale.ts` + unit tests. Merge-safe, no consumers yet.
2. Create `useMonacoFontSize.ts` + unit tests. Merge-safe.
3. Update `tailwind.config.ts` + `globals.css`. This is the breaking change: densities shift immediately. Ship with step 4 atomically.
4. Update `App.tsx` + `OverlayChat.tsx` + `AppearanceSettings.tsx` (application logic + UI). Together with step 3, the default (scale 1) app is fully functional.
5. Wire Monaco hook in 5 call sites.
6. Rewrite 10 inline `fontSize` styles in extensions / McpServerForm.
7. Execute mechanical `text-[Xpx]` → `text-[Xrem]` substitution across 20 files.
8. Manual regression pass + fixes.

Steps 5, 6, 7 are independent and can be parallelized across sub-agents. Step 8 is serial and performed by the orchestrator.

## Risks

- **Baseline density shift (+~7%)**: accepted. If a specific layout breaks (text overflow in a fixed-width container), fix the container, not the font-size.
- **`text-[Xpx]` regressions**: the `sed`-based rewrite is syntactically exact. Post-grep confirms no residual pixel-locked sizes.
- **Monaco re-render cost**: one rerender per scale change per mounted Monaco instance. Limited (≤5 typical). Non-blocking.
- **Legacy setting interpretation**: a user who had `fontSize: "3"` (px) in the legacy schema would be misinterpreted as scale 3.0. Extremely unlikely (min was 8px in the old UI). Accepted residual risk.

## Out of Scope

- Icon sizes, padding, layout-defining spacing — only text.
- Icon fonts / SVG sizing — inherits `font-size` via `1em`-based declarations, which continues to work.
- Per-theme font-scale overrides — themes can set `--font-scale` via CSS if they want, but no UI is exposed for it.
