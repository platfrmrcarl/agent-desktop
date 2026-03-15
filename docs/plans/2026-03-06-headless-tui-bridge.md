# Headless TUI Bridge — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Pi extension `custom()` calls functional in Electron by running TUI components headlessly and bridging render/input via IPC.

**Architecture:** `PiUIContext.custom()` calls the factory with mock TUI/Theme/KeybindingsManager stubs, obtains a headless Component, renders it to ANSI string lines, converts to HTML, and sends to the renderer as a `custom_tui` dialog. Keystrokes from the renderer are relayed back to `handleInput()` on the component; when `done()` fires, the dialog closes and the Promise resolves.

**Tech Stack:** Electron IPC, pi-tui Component interface (`render`/`handleInput`), ANSI→HTML converter, browser KeyboardEvent→terminal sequence mapper.

---

### Task 1: Shared Types — Add TUI bridge types

**Files:**
- Modify: `src/shared/piUITypes.ts`

**Step 1: Add `custom_tui` dialog variant and TUI IPC types**

In `src/shared/piUITypes.ts`, extend `PiUIDialog` with a `custom_tui` variant and add IPC message types:

```typescript
// Add to PiUIDialog union (after the existing 'custom' line):
  | { id: string; method: 'custom_tui'; html: string; timeout?: number }

// Add after PiUIComponentAction:
export interface PiUITuiInput {
  id: string
  data: string
}

export interface PiUITuiRender {
  id: string
  html: string
}
```

**Step 2: Commit**

```bash
git add src/shared/piUITypes.ts
git commit -m "feat(pi): add custom_tui dialog type and TUI bridge IPC types"
```

---

### Task 2: ANSI→HTML Converter

**Files:**
- Create: `src/main/utils/ansiToHtml.ts`
- Create: `src/main/utils/ansiToHtml.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/main/utils/ansiToHtml.test.ts
import { describe, it, expect } from 'vitest'
import { ansiToHtml, ansiLinesToHtml } from './ansiToHtml'

describe('ansiToHtml', () => {
  it('returns plain text unchanged (escaped)', () => {
    expect(ansiToHtml('hello world')).toBe('hello world')
  })

  it('escapes HTML entities', () => {
    expect(ansiToHtml('<b>test</b>')).toBe('&lt;b&gt;test&lt;/b&gt;')
  })

  it('converts bold (SGR 1)', () => {
    expect(ansiToHtml('\x1b[1mBold\x1b[0m')).toBe(
      '<span style="font-weight:bold">Bold</span>'
    )
  })

  it('converts dim (SGR 2)', () => {
    expect(ansiToHtml('\x1b[2mDim\x1b[0m')).toBe(
      '<span style="opacity:0.6">Dim</span>'
    )
  })

  it('converts italic (SGR 3)', () => {
    expect(ansiToHtml('\x1b[3mItalic\x1b[0m')).toBe(
      '<span style="font-style:italic">Italic</span>'
    )
  })

  it('converts standard foreground color (SGR 31 = red)', () => {
    expect(ansiToHtml('\x1b[31mRed\x1b[0m')).toBe(
      '<span style="color:#cc0000">Red</span>'
    )
  })

  it('converts bright foreground color (SGR 92 = bright green)', () => {
    expect(ansiToHtml('\x1b[92mGreen\x1b[0m')).toBe(
      '<span style="color:#00ff00">Green</span>'
    )
  })

  it('converts 256-color foreground (38;5;N)', () => {
    const result = ansiToHtml('\x1b[38;5;196mRed256\x1b[0m')
    expect(result).toContain('color:')
    expect(result).toContain('Red256')
  })

  it('converts RGB foreground (38;2;R;G;B)', () => {
    expect(ansiToHtml('\x1b[38;2;255;128;0mOrange\x1b[0m')).toBe(
      '<span style="color:rgb(255,128,0)">Orange</span>'
    )
  })

  it('accumulates styles across escape sequences', () => {
    const result = ansiToHtml('\x1b[1m\x1b[31mBoldRed\x1b[0m')
    expect(result).toContain('font-weight:bold')
    expect(result).toContain('color:#cc0000')
    expect(result).toContain('BoldRed')
  })

  it('resets all styles on SGR 0', () => {
    const result = ansiToHtml('\x1b[1mBold\x1b[0m Normal')
    expect(result).toBe('<span style="font-weight:bold">Bold</span> Normal')
  })

  it('returns &nbsp; for empty string', () => {
    expect(ansiToHtml('')).toBe('&nbsp;')
  })
})

describe('ansiLinesToHtml', () => {
  it('wraps each line in a div', () => {
    const result = ansiLinesToHtml(['line1', 'line2'])
    expect(result).toBe('<div>line1</div><div>line2</div>')
  })

  it('preserves ANSI conversion within lines', () => {
    const result = ansiLinesToHtml(['\x1b[1mBold\x1b[0m'])
    expect(result).toContain('<span style="font-weight:bold">Bold</span>')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/utils/ansiToHtml.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/main/utils/ansiToHtml.ts

const ANSI_RE = /\x1b\[([0-9;]*)m/g

const COLORS_16 = [
  '#000000', '#cc0000', '#00cc00', '#cccc00', '#0000cc', '#cc00cc', '#00cccc', '#cccccc',
  '#555555', '#ff0000', '#00ff00', '#ffff00', '#5555ff', '#ff00ff', '#00ffff', '#ffffff',
]

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function color256(n: number): string {
  if (n < 16) return COLORS_16[n]
  if (n >= 232) { const v = (n - 232) * 10 + 8; return `rgb(${v},${v},${v})` }
  const idx = n - 16
  const r = Math.floor(idx / 36) * 51
  const g = Math.floor((idx % 36) / 6) * 51
  const b = (idx % 6) * 51
  return `rgb(${r},${g},${b})`
}

export function ansiToHtml(text: string): string {
  const parts: string[] = []
  const activeStyles = new Map<string, string>()
  let lastIndex = 0

  for (const match of text.matchAll(ANSI_RE)) {
    const before = text.slice(lastIndex, match.index)
    if (before) parts.push(wrapWithStyles(escapeHtml(before), activeStyles))
    lastIndex = match.index! + match[0].length

    const codes = match[1] ? match[1].split(';').map(Number) : [0]
    let i = 0
    while (i < codes.length) {
      const c = codes[i]
      if (c === 0) activeStyles.clear()
      else if (c === 1) activeStyles.set('font-weight', 'bold')
      else if (c === 2) activeStyles.set('opacity', '0.6')
      else if (c === 3) activeStyles.set('font-style', 'italic')
      else if (c === 4) activeStyles.set('text-decoration', 'underline')
      else if (c >= 30 && c <= 37) activeStyles.set('color', COLORS_16[c - 30])
      else if (c >= 90 && c <= 97) activeStyles.set('color', COLORS_16[c - 82])
      else if (c >= 40 && c <= 47) activeStyles.set('background', COLORS_16[c - 40])
      else if (c >= 100 && c <= 107) activeStyles.set('background', COLORS_16[c - 92])
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
        activeStyles.set(c === 38 ? 'color' : 'background', color256(codes[i + 2] || 0))
        i += 2
      } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        const prop = c === 38 ? 'color' : 'background'
        activeStyles.set(prop, `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`)
        i += 4
      }
      i++
    }
  }

  const remaining = text.slice(lastIndex)
  if (remaining) parts.push(wrapWithStyles(escapeHtml(remaining), activeStyles))

  return parts.join('') || '&nbsp;'
}

function wrapWithStyles(html: string, styles: Map<string, string>): string {
  if (styles.size === 0) return html
  const styleStr = Array.from(styles).map(([k, v]) => `${k}:${v}`).join(';')
  return `<span style="${styleStr}">${html}</span>`
}

export function ansiLinesToHtml(lines: string[]): string {
  return lines.map(line => `<div>${ansiToHtml(line)}</div>`).join('')
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/utils/ansiToHtml.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/main/utils/ansiToHtml.ts src/main/utils/ansiToHtml.test.ts
git commit -m "feat(pi): add ANSI-to-HTML converter for TUI bridge"
```

---

### Task 3: Browser Key-to-Terminal Mapper

**Files:**
- Create: `src/renderer/utils/keyToTerminal.ts`
- Create: `src/renderer/utils/keyToTerminal.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/renderer/utils/keyToTerminal.test.ts
import { describe, it, expect } from 'vitest'
import { keyEventToTerminal } from './keyToTerminal'

function fakeKey(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods } as KeyboardEvent
}

describe('keyEventToTerminal', () => {
  it('maps Enter to \\r', () => {
    expect(keyEventToTerminal(fakeKey('Enter'))).toBe('\r')
  })

  it('maps Escape to \\x1b', () => {
    expect(keyEventToTerminal(fakeKey('Escape'))).toBe('\x1b')
  })

  it('maps Tab to \\t', () => {
    expect(keyEventToTerminal(fakeKey('Tab'))).toBe('\t')
  })

  it('maps Shift+Tab to \\x1b[Z', () => {
    expect(keyEventToTerminal(fakeKey('Tab', { shiftKey: true }))).toBe('\x1b[Z')
  })

  it('maps ArrowUp to \\x1b[A', () => {
    expect(keyEventToTerminal(fakeKey('ArrowUp'))).toBe('\x1b[A')
  })

  it('maps ArrowDown to \\x1b[B', () => {
    expect(keyEventToTerminal(fakeKey('ArrowDown'))).toBe('\x1b[B')
  })

  it('maps Space to literal space', () => {
    expect(keyEventToTerminal(fakeKey(' '))).toBe(' ')
  })

  it('maps Ctrl+C to \\x03', () => {
    expect(keyEventToTerminal(fakeKey('c', { ctrlKey: true }))).toBe('\x03')
  })

  it('maps printable characters to themselves', () => {
    expect(keyEventToTerminal(fakeKey('a'))).toBe('a')
    expect(keyEventToTerminal(fakeKey('5'))).toBe('5')
  })

  it('maps Backspace to \\x7f', () => {
    expect(keyEventToTerminal(fakeKey('Backspace'))).toBe('\x7f')
  })

  it('returns null for unhandled keys', () => {
    expect(keyEventToTerminal(fakeKey('F12'))).toBeNull()
    expect(keyEventToTerminal(fakeKey('Shift'))).toBeNull()
    expect(keyEventToTerminal(fakeKey('Control'))).toBeNull()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/utils/keyToTerminal.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/renderer/utils/keyToTerminal.ts

export function keyEventToTerminal(e: KeyboardEvent): string | null {
  // Shift+Tab before other Shift combos
  if (e.shiftKey && e.key === 'Tab') return '\x1b[Z'

  // Ctrl combos
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.key === 'Enter') return '\x1b[13;5u'
    if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
      return String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64)
    }
  }

  switch (e.key) {
    case 'Enter': return '\r'
    case 'Escape': return '\x1b'
    case 'Tab': return '\t'
    case 'Backspace': return '\x7f'
    case 'ArrowUp': return '\x1b[A'
    case 'ArrowDown': return '\x1b[B'
    case 'ArrowRight': return '\x1b[C'
    case 'ArrowLeft': return '\x1b[D'
    case 'Home': return '\x1b[H'
    case 'End': return '\x1b[F'
    case 'Delete': return '\x1b[3~'
    case 'PageUp': return '\x1b[5~'
    case 'PageDown': return '\x1b[6~'
  }

  // Printable single characters (no modifier keys)
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    return e.key
  }

  return null
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/utils/keyToTerminal.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/renderer/utils/keyToTerminal.ts src/renderer/utils/keyToTerminal.test.ts
git commit -m "feat(pi): add browser KeyboardEvent to terminal sequence mapper"
```

---

### Task 4: IPC Plumbing — Add TUI bridge channels

**Files:**
- Modify: `src/preload/index.ts:100-115` (pi section)
- Modify: `src/preload/api.d.ts:104-109` (pi section)
- Modify: `src/main/services/piExtensions.ts:85-99` (registerHandlers)
- Modify: `src/main/services/webServer.ts:217-222` (pi shim)

**Step 1: Add `sendTuiInput`, `onTuiRender`, `onTuiDone` to preload**

In `src/preload/index.ts`, inside the `pi:` section (after `respondUI`):

```typescript
    sendTuiInput: (id: string, data: string) => {
      ipcRenderer.send('pi:tuiInput', { id, data })
    },
    onTuiRender: (callback) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: unknown) => callback(payload as never)
      ipcRenderer.on('pi:tuiRender', handler)
      return () => { ipcRenderer.removeListener('pi:tuiRender', handler) }
    },
    onTuiDone: (callback) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: unknown) => callback(payload as never)
      ipcRenderer.on('pi:tuiDone', handler)
      return () => { ipcRenderer.removeListener('pi:tuiDone', handler) }
    },
```

**Step 2: Add types to `src/preload/api.d.ts`**

In the `pi:` section (after `respondUI`):

```typescript
    sendTuiInput(id: string, data: string): void
    onTuiRender(callback: (payload: { id: string; html: string }) => void): () => void
    onTuiDone(callback: (payload: { id: string }) => void): () => void
```

**Step 3: Add IPC handler in `src/main/services/piExtensions.ts`**

In `registerHandlers`, after the existing `pi:uiResponse` handler:

```typescript
  ipcMain.on('pi:tuiInput', (_event, payload: { id: string; data: string }) => {
    for (const ctx of activeContexts.values()) {
      (ctx as { handleTuiInput?: (id: string, data: string) => void }).handleTuiInput?.(payload.id, payload.data)
    }
  })
```

**Step 4: Add stubs to web server shim in `src/main/services/webServer.ts`**

In the `pi:` shim section (after `respondUI: noop`):

```typescript
      sendTuiInput: noop,
      onTuiRender: function() { return noop; },
      onTuiDone: function() { return noop; },
```

**Step 5: Commit**

```bash
git add src/preload/index.ts src/preload/api.d.ts src/main/services/piExtensions.ts src/main/services/webServer.ts
git commit -m "feat(pi): add IPC channels for TUI bridge (tuiInput, tuiRender, tuiDone)"
```

---

### Task 5: PiUIContext.custom() — Headless TUI bridge

**Files:**
- Modify: `src/main/services/piUIContext.ts`
- Modify: `src/main/services/piUIContext.test.ts`

**Step 1: Write failing tests for custom()**

Add to `src/main/services/piUIContext.test.ts`:

```typescript
  describe('custom (headless TUI bridge)', () => {
    it('calls factory with mock TUI, theme, keybindings, and done callback', async () => {
      const factory = vi.fn((_tui, _theme, _kb, done) => {
        done('result')
        return { render: () => ['line'], handleInput: vi.fn() }
      })
      const result = await ctx.custom(factory)
      expect(factory).toHaveBeenCalledTimes(1)
      expect(result).toBe('result')
    })

    it('sends pi:uiRequest with method custom_tui and rendered html', async () => {
      const factory = vi.fn((_tui, _theme, _kb, done) => {
        // Defer done so the request is sent first
        setTimeout(() => done('ok'), 10)
        return { render: () => ['hello'] }
      })
      const promise = ctx.custom(factory)
      // Wait a tick for the initial render
      await new Promise(r => setTimeout(r, 0))
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:uiRequest', expect.objectContaining({
        method: 'custom_tui',
      }))
      const call = mockWebContents.send.mock.calls.find(
        (c: unknown[]) => (c[1] as { method: string }).method === 'custom_tui'
      )
      expect((call![1] as { html: string }).html).toContain('hello')
      await promise
    })

    it('handleTuiInput forwards data to component.handleInput', async () => {
      const handleInput = vi.fn()
      const factory = vi.fn((_tui, _theme, _kb, done) => {
        setTimeout(() => done('ok'), 50)
        return { render: () => ['line'], handleInput }
      })
      const promise = ctx.custom(factory)
      await new Promise(r => setTimeout(r, 0))
      const id = lastRequestId(mockWebContents.send)
      ctx.handleTuiInput(id, '\x1b[A')
      expect(handleInput).toHaveBeenCalledWith('\x1b[A')
      await promise
    })

    it('requestRender on mock TUI triggers pi:tuiRender', async () => {
      let mockTui: { requestRender: () => void } | undefined
      const factory = vi.fn((tui, _theme, _kb, done) => {
        mockTui = tui
        setTimeout(() => done('ok'), 50)
        return { render: () => ['updated'] }
      })
      const promise = ctx.custom(factory)
      await new Promise(r => setTimeout(r, 0))
      mockTui!.requestRender()
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:tuiRender', expect.objectContaining({
        html: expect.stringContaining('updated'),
      }))
      await promise
    })

    it('sends pi:tuiDone when done() fires', async () => {
      const factory = vi.fn((_tui, _theme, _kb, done) => {
        setTimeout(() => done('result'), 10)
        return { render: () => ['line'] }
      })
      await ctx.custom(factory)
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:tuiDone', expect.objectContaining({
        id: expect.any(String),
      }))
    })

    it('resolves with undefined on cancel via handleResponse', async () => {
      const factory = vi.fn((_tui, _theme, _kb, _done) => {
        return { render: () => ['line'] }
      })
      const promise = ctx.custom(factory)
      await new Promise(r => setTimeout(r, 0))
      const id = lastRequestId(mockWebContents.send)
      ctx.handleResponse({ id, cancelled: true })
      expect(await promise).toBeUndefined()
    })

    it('dispose resolves pending custom with undefined', async () => {
      const factory = vi.fn((_tui, _theme, _kb, _done) => {
        return { render: () => ['line'], dispose: vi.fn() }
      })
      const promise = ctx.custom(factory)
      await new Promise(r => setTimeout(r, 0))
      ctx.dispose()
      expect(await promise).toBeUndefined()
    })

    it('handles async factory (returns Promise<Component>)', async () => {
      const factory = vi.fn(async (_tui, _theme, _kb, done) => {
        await new Promise(r => setTimeout(r, 5))
        done('async-result')
        return { render: () => ['async'] }
      })
      const result = await ctx.custom(factory)
      expect(result).toBe('async-result')
    })
  })
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/services/piUIContext.test.ts`
Expected: FAIL — custom() returns undefined immediately

**Step 3: Implement custom() and handleTuiInput()**

Replace the `async custom<T>()` method and update `handleResponse`/`dispose` in `src/main/services/piUIContext.ts`:

```typescript
// Add import at the top:
import { ansiLinesToHtml } from '../utils/ansiToHtml'

// Add private field after existing fields:
  private tuiBridges = new Map<string, {
    component: { render(w: number): string[]; handleInput?(data: string): void; dispose?(): void }
    width: number
  }>()

// Replace the custom<T>() method:
  async custom<T>(
    factory: (tui: unknown, theme: unknown, kb: unknown, done: (result: T) => void) => unknown
  ): Promise<T> {
    const id = randomUUID()
    const width = 80

    let component: { render(w: number): string[]; handleInput?(data: string): void; dispose?(): void } | null = null
    let resolvePromise!: (value: T) => void

    const promise = new Promise<T>((resolve) => { resolvePromise = resolve })

    const sendRender = () => {
      if (!component || this.disposed) return
      const lines = component.render(width)
      const html = ansiLinesToHtml(lines)
      this.send('pi:tuiRender', { id, html })
    }

    const mockTui = { requestRender: () => sendRender() }

    const done = (result: T) => {
      this.pending.delete(id)
      this.tuiBridges.delete(id)
      this.send('pi:tuiDone', { id })
      resolvePromise(result)
    }

    let created = factory(mockTui, this.theme, {}, done)
    if (created && typeof (created as Promise<unknown>).then === 'function') {
      created = await (created as Promise<unknown>)
    }
    component = created as typeof component

    this.pending.set(id, { resolve: resolvePromise as (v: unknown) => void, method: 'custom_tui' })
    this.tuiBridges.set(id, { component: component!, width })

    // Initial render
    const lines = component!.render(width)
    const html = ansiLinesToHtml(lines)
    this.send('pi:uiRequest', { id, method: 'custom_tui', html })

    return promise
  }

// Add handleTuiInput method (after handleResponse):
  handleTuiInput(id: string, data: string): void {
    const bridge = this.tuiBridges.get(id)
    if (!bridge) return
    bridge.component.handleInput?.(data)
  }
```

**Update `handleResponse`** to clean up TUI bridges on cancel:

```typescript
  handleResponse(response: PiUIResponse): void {
    const entry = this.pending.get(response.id)
    if (!entry) return
    this.pending.delete(response.id)

    // Clean up TUI bridge if any
    const bridge = this.tuiBridges.get(response.id)
    if (bridge) {
      this.tuiBridges.delete(response.id)
      bridge.component.dispose?.()
    }

    if (response.cancelled) {
      entry.resolve(entry.method === 'confirm' ? false : undefined)
      return
    }

    if (entry.method === 'confirm') {
      entry.resolve(response.confirmed ?? false)
    } else {
      entry.resolve(response.value)
    }
  }
```

**Update `dispose()`** to clean up TUI bridges:

```typescript
  dispose(): void {
    this.disposed = true
    for (const [, entry] of this.pending) {
      entry.resolve(entry.method === 'confirm' ? false : undefined)
    }
    this.pending.clear()
    for (const [, bridge] of this.tuiBridges) {
      bridge.component.dispose?.()
    }
    this.tuiBridges.clear()
  }
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/services/piUIContext.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/main/services/piUIContext.ts src/main/services/piUIContext.test.ts
git commit -m "feat(pi): implement headless TUI bridge in PiUIContext.custom()"
```

---

### Task 6: Renderer — CustomTUIBody in ExtensionDialog

**Files:**
- Modify: `src/renderer/components/extensions/ExtensionDialog.tsx`
- Modify: `src/renderer/hooks/usePiExtensionUI.ts`
- Modify: `src/renderer/stores/piExtensionUIStore.ts` (add `dismissDialogById`)

**Step 1: Add `dismissDialogById` to the store**

In `src/renderer/stores/piExtensionUIStore.ts`, add after `dismissDialog`:

```typescript
  dismissDialogById: (id: string) =>
    set((s) => {
      if (s.activeDialog?.id === id) {
        const [next, ...rest] = s.dialogQueue
        return { activeDialog: next ?? null, dialogQueue: rest }
      }
      return { dialogQueue: s.dialogQueue.filter((d) => d.id !== id) }
    }),
```

Add to the interface:

```typescript
  dismissDialogById: (id: string) => void
```

**Step 2: Listen for pi:tuiDone in usePiExtensionUI**

In `src/renderer/hooks/usePiExtensionUI.ts`, add listener for `pi:tuiDone`:

```typescript
// Add to selector imports:
const dismissDialogById = usePiExtensionUIStore((s) => s.dismissDialogById)

// Add inside useEffect, after unsubEvent:
    const unsubTuiDone = window.agent.pi.onTuiDone((payload: { id: string }) => {
      dismissDialogById(payload.id)
    })

// Update return:
    return () => {
      unsubRequest()
      unsubEvent()
      unsubTuiDone()
    }
```

**Step 3: Add CustomTUIBody to ExtensionDialog**

In `src/renderer/components/extensions/ExtensionDialog.tsx`:

Import `keyEventToTerminal`:

```typescript
import { keyEventToTerminal } from '../../utils/keyToTerminal'
```

Add the `CustomTUIBody` component (after `EditorBody`):

```typescript
// ─── Custom TUI ─────────────────────────────────────────────

type CustomTuiDialog = Extract<PiUIDialog, { method: 'custom_tui' }>

function CustomTUIBody({ dialog }: { dialog: CustomTuiDialog }) {
  const [html, setHtml] = useState(dialog.html)

  useEffect(() => {
    const unsub = window.agent.pi.onTuiRender((payload: { id: string; html: string }) => {
      if (payload.id === dialog.id) setHtml(payload.html)
    })
    return unsub
  }, [dialog.id])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const data = keyEventToTerminal(e)
      if (data) {
        e.preventDefault()
        e.stopImmediatePropagation()
        window.agent.pi.sendTuiInput(dialog.id, data)
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [dialog.id])

  return (
    <pre
      style={{
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 13,
        lineHeight: 1.5,
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        outline: 'none',
      }}
      tabIndex={0}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
```

Update the `ExtensionDialog` render to include `custom_tui`:

```typescript
// In the component JSX, add after the editor line:
        {dialog.method === 'custom_tui' && <CustomTUIBody dialog={dialog} />}
```

For `custom_tui`, the title is optional (may not be set), so update the title display:

```typescript
// Change the h3 title line to conditionally render:
        {dialog.title && <h3 style={titleStyle}>{dialog.title}</h3>}
```

Also widen the card for TUI dialogs — update `cardStyle` usage:

```typescript
// In the ExtensionDialog component, use a wider card for custom_tui:
        <div style={{
          ...cardStyle,
          ...(dialog.method === 'custom_tui' ? { maxWidth: 700 } : {}),
        }} role="dialog" aria-label={dialog.title ?? 'Extension dialog'}>
```

**Important:** For `custom_tui` dialogs, the ESC key should be handled by the TUI component (via `handleInput`), NOT by ExtensionDialog's global ESC handler. The `CustomTUIBody` uses `capture: true` + `stopImmediatePropagation()` which runs before the ExtensionDialog's bubble-phase handler, preventing double-cancel.

**Step 4: Commit**

```bash
git add src/renderer/components/extensions/ExtensionDialog.tsx \
        src/renderer/hooks/usePiExtensionUI.ts \
        src/renderer/stores/piExtensionUIStore.ts
git commit -m "feat(pi): add CustomTUIBody renderer for headless TUI bridge dialogs"
```

---

### Task 7: Tests for renderer changes

**Files:**
- Modify: `src/renderer/components/extensions/ExtensionDialog.test.tsx`
- Modify: `src/renderer/stores/piExtensionUIStore.test.ts`

**Step 1: Add ExtensionDialog tests for custom_tui**

Add to `src/renderer/components/extensions/ExtensionDialog.test.tsx`:

```typescript
  // ─── Custom TUI ───────────────────────────────────────────

  describe('custom_tui variant', () => {
    const dialog: PiUIDialog = {
      id: 'dlg-tui',
      method: 'custom_tui' as const,
      html: '<div><span style="font-weight:bold">Question</span></div><div>Option A</div>',
    }

    it('renders the provided HTML content', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      expect(screen.getByText('Question')).toBeInTheDocument()
      expect(screen.getByText('Option A')).toBeInTheDocument()
    })

    it('does not render a title when dialog has no title', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      expect(screen.queryByRole('heading')).toBeNull()
    })
  })
```

**Step 2: Add piExtensionUIStore test for dismissDialogById**

Add to `src/renderer/stores/piExtensionUIStore.test.ts`:

```typescript
  describe('dismissDialogById', () => {
    it('dismisses active dialog if id matches', () => {
      const { enqueueDialog, dismissDialogById } = usePiExtensionUIStore.getState()
      enqueueDialog({ id: 'a', method: 'input', title: 'Q1' } as PiUIDialog)
      dismissDialogById('a')
      expect(usePiExtensionUIStore.getState().activeDialog).toBeNull()
    })

    it('removes from queue if id matches queued dialog', () => {
      const { enqueueDialog, dismissDialogById } = usePiExtensionUIStore.getState()
      enqueueDialog({ id: 'a', method: 'input', title: 'Q1' } as PiUIDialog)
      enqueueDialog({ id: 'b', method: 'input', title: 'Q2' } as PiUIDialog)
      dismissDialogById('b')
      expect(usePiExtensionUIStore.getState().dialogQueue).toHaveLength(0)
    })

    it('promotes next queued dialog when active is dismissed', () => {
      const { enqueueDialog, dismissDialogById } = usePiExtensionUIStore.getState()
      enqueueDialog({ id: 'a', method: 'input', title: 'Q1' } as PiUIDialog)
      enqueueDialog({ id: 'b', method: 'input', title: 'Q2' } as PiUIDialog)
      dismissDialogById('a')
      expect(usePiExtensionUIStore.getState().activeDialog?.id).toBe('b')
    })
  })
```

**Step 3: Run all tests**

Run: `npx vitest run src/renderer/components/extensions/ExtensionDialog.test.tsx src/renderer/stores/piExtensionUIStore.test.ts`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/renderer/components/extensions/ExtensionDialog.test.tsx \
        src/renderer/stores/piExtensionUIStore.test.ts
git commit -m "test(pi): add tests for CustomTUIBody and dismissDialogById"
```

---

### Task 8: Full integration verification

**Step 1: Run the full test suite**

Run: `npm test`
Expected: ALL PASS (no regressions)

**Step 2: Run the build**

Run: `npm run build`
Expected: 0 errors, 0 warnings

**Step 3: Manual smoke test**

1. Start dev: `npm run dev`
2. Switch to PI backend (Settings → AI → Backend → pi)
3. In a conversation, trigger the `ask_user` tool (e.g., ask PI to ask you a question with options)
4. Verify: a dialog appears with rendered TUI content (styled text, options list)
5. Verify: arrow keys navigate options, Enter selects, Escape cancels
6. Verify: the dialog closes and PI receives the answer

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(pi): headless TUI bridge — custom() renders Pi extension UIs in Electron"
```

---

## File Summary

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/shared/piUITypes.ts` | Add `custom_tui` dialog type, TUI IPC types |
| Create | `src/main/utils/ansiToHtml.ts` | ANSI escape → HTML converter |
| Create | `src/main/utils/ansiToHtml.test.ts` | Tests for converter |
| Create | `src/renderer/utils/keyToTerminal.ts` | Browser key → terminal sequence mapper |
| Create | `src/renderer/utils/keyToTerminal.test.ts` | Tests for key mapper |
| Modify | `src/preload/index.ts` | Add `sendTuiInput`, `onTuiRender`, `onTuiDone` |
| Modify | `src/preload/api.d.ts` | Type definitions for new IPC methods |
| Modify | `src/main/services/piExtensions.ts` | Register `pi:tuiInput` IPC handler |
| Modify | `src/main/services/webServer.ts` | Add TUI stubs for web server shim |
| Modify | `src/main/services/piUIContext.ts` | Implement headless TUI bridge in `custom()` |
| Modify | `src/main/services/piUIContext.test.ts` | Tests for `custom()` and `handleTuiInput` |
| Modify | `src/renderer/stores/piExtensionUIStore.ts` | Add `dismissDialogById` |
| Modify | `src/renderer/components/extensions/ExtensionDialog.tsx` | Add `CustomTUIBody` |
| Modify | `src/renderer/hooks/usePiExtensionUI.ts` | Listen for `pi:tuiDone` |
| Modify | `src/renderer/components/extensions/ExtensionDialog.test.tsx` | Tests for `custom_tui` rendering |
| Modify | `src/renderer/stores/piExtensionUIStore.test.ts` | Tests for `dismissDialogById` |
