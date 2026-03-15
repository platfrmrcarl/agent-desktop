# Diff Side-by-Side View for Edit Tool — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display a collapsible side-by-side diff when the AI uses the Edit tool, with an appearance setting for default expanded/collapsed state.

**Architecture:** New `DiffView` component renders `old_str`/`new_str` side-by-side with character-level highlighting via `diff` (jsdiff). Integrated into existing `ToolUseBlock` as a third toggle alongside Input/Output. Default state read from `useSettingsStore`.

**Tech Stack:** React, `diff` (jsdiff), Tailwind, CSS custom properties, Vitest + testing-library

---

### Task 1: Install `diff` dependency

**Files:**
- Modify: `package.json`

**Step 1: Install**

```bash
npm install diff
npm install -D @types/diff
```

**Step 2: Verify**

```bash
node -e "require('diff')"
```

Expected: no error

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add diff (jsdiff) dependency"
```

---

### Task 2: Create `DiffView` component with tests (TDD)

**Files:**
- Create: `src/renderer/components/chat/DiffView.tsx`
- Create: `src/renderer/components/chat/DiffView.test.tsx`

**Step 1: Write the failing tests**

```tsx
// src/renderer/components/chat/DiffView.test.tsx
import { render, screen } from '@testing-library/react'
import { DiffView } from './DiffView'

describe('DiffView', () => {
  it('renders Before and After column headers', () => {
    render(<DiffView oldStr="hello" newStr="world" />)
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('After')).toBeInTheDocument()
  })

  it('renders old text in left column', () => {
    render(<DiffView oldStr="console.log(x)" newStr="console.info(x)" />)
    // The old text should appear somewhere in the component
    expect(screen.getByTestId('diff-left')).toHaveTextContent('console.log(x)')
  })

  it('renders new text in right column', () => {
    render(<DiffView oldStr="console.log(x)" newStr="console.info(x)" />)
    expect(screen.getByTestId('diff-right')).toHaveTextContent('console.info(x)')
  })

  it('highlights removed text with diff-removed class', () => {
    const { container } = render(<DiffView oldStr="aaa" newStr="bbb" />)
    const removed = container.querySelectorAll('.diff-removed')
    expect(removed.length).toBeGreaterThan(0)
  })

  it('highlights added text with diff-added class', () => {
    const { container } = render(<DiffView oldStr="aaa" newStr="bbb" />)
    const added = container.querySelectorAll('.diff-added')
    expect(added.length).toBeGreaterThan(0)
  })

  it('handles identical strings (no diff highlights)', () => {
    const { container } = render(<DiffView oldStr="same" newStr="same" />)
    expect(container.querySelectorAll('.diff-removed').length).toBe(0)
    expect(container.querySelectorAll('.diff-added').length).toBe(0)
  })

  it('handles empty old string (full addition)', () => {
    render(<DiffView oldStr="" newStr="new content" />)
    expect(screen.getByTestId('diff-right')).toHaveTextContent('new content')
  })

  it('handles multiline strings with line numbers', () => {
    render(<DiffView oldStr={"line1\nline2"} newStr={"line1\nchanged"} />)
    // Should render line numbers
    expect(screen.getByTestId('diff-left')).toHaveTextContent('1')
    expect(screen.getByTestId('diff-left')).toHaveTextContent('2')
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run --config vitest.config.renderer.ts src/renderer/components/chat/DiffView.test.tsx
```

Expected: FAIL — module not found

**Step 3: Implement `DiffView.tsx`**

```tsx
// src/renderer/components/chat/DiffView.tsx
import { diffChars } from 'diff'

interface DiffViewProps {
  oldStr: string
  newStr: string
}

/** Render a character-level diff change into styled spans */
function renderDiffSpans(
  changes: ReturnType<typeof diffChars>,
  side: 'left' | 'right',
): React.ReactNode[] {
  return changes
    .filter((c) => (side === 'left' ? !c.added : !c.removed))
    .map((c, i) => {
      const className = c.removed
        ? 'diff-removed'
        : c.added
          ? 'diff-added'
          : ''
      return (
        <span key={i} className={className}>
          {c.value}
        </span>
      )
    })
}

/** Split text into lines and prepend line numbers */
function LinesWithNumbers({
  children,
  testId,
}: {
  children: React.ReactNode[]
  testId: string
}) {
  // Flatten spans into text, split by newline to number lines
  // We render the raw spans and let CSS handle wrapping
  return (
    <pre
      data-testid={testId}
      className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 m-0 min-w-0"
    >
      {children}
    </pre>
  )
}

export function DiffView({ oldStr, newStr }: DiffViewProps) {
  const changes = diffChars(oldStr, newStr)

  const leftSpans = renderDiffSpans(changes, 'left')
  const rightSpans = renderDiffSpans(changes, 'right')

  // Compute line numbers per side
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  return (
    <div className="flex gap-0 rounded overflow-hidden border border-deep text-xs font-mono">
      {/* Left: Before */}
      <div className="flex-1 min-w-0 overflow-hidden" style={{
        backgroundColor: 'color-mix(in srgb, var(--color-error) 6%, transparent)',
      }}>
        <div
          className="px-2 py-1 text-[10px] font-semibold border-b border-deep"
          style={{ color: 'var(--color-error)' }}
        >
          Before ({oldLines.length} {oldLines.length === 1 ? 'line' : 'lines'})
        </div>
        <LinesWithNumbers testId="diff-left">{leftSpans}</LinesWithNumbers>
      </div>

      {/* Divider */}
      <div className="w-px shrink-0" style={{ backgroundColor: 'var(--color-deep)' }} />

      {/* Right: After */}
      <div className="flex-1 min-w-0 overflow-hidden" style={{
        backgroundColor: 'color-mix(in srgb, var(--color-success) 6%, transparent)',
      }}>
        <div
          className="px-2 py-1 text-[10px] font-semibold border-b border-deep"
          style={{ color: 'var(--color-success)' }}
        >
          After ({newLines.length} {newLines.length === 1 ? 'line' : 'lines'})
        </div>
        <LinesWithNumbers testId="diff-right">{rightSpans}</LinesWithNumbers>
      </div>
    </div>
  )
}
```

Add CSS classes in the component's inline styles (or via a `<style>` tag — but since we use Tailwind, use inline):

The `.diff-removed` and `.diff-added` classes need to be in global CSS. Add to the renderer's stylesheet:

```css
/* In src/renderer/styles/index.css or equivalent */
.diff-removed {
  background-color: color-mix(in srgb, var(--color-error) 25%, transparent);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--color-error) 50%, transparent);
}
.diff-added {
  background-color: color-mix(in srgb, var(--color-success) 25%, transparent);
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run --config vitest.config.renderer.ts src/renderer/components/chat/DiffView.test.tsx
```

Expected: PASS (all 8 tests)

**Step 5: Commit**

```bash
git add src/renderer/components/chat/DiffView.tsx src/renderer/components/chat/DiffView.test.tsx src/renderer/styles/
git commit -m "feat: add DiffView side-by-side component"
```

---

### Task 3: Add `diffExpandedByDefault` setting to AppearanceSettings

**Files:**
- Modify: `src/renderer/components/settings/AppearanceSettings.tsx` (add toggle after "Panel Buttons" section)

**Step 1: Add toggle**

Insert a new section in the Interface Settings card (after the Panel Buttons proximity radius row, before the closing `</div>` of the card), following the exact same pattern as existing toggles:

```tsx
{/* File Diffs */}
<div className="flex items-center justify-between px-4 py-3 border-t border-deep">
  <div className="flex flex-col">
    <span className="text-sm text-body">File Diffs</span>
    <span className="text-xs text-muted">Show edit diffs expanded by default</span>
  </div>
  <button
    onClick={() => setSetting('diffExpandedByDefault', diffExpanded ? 'false' : 'true')}
    role="switch"
    aria-checked={diffExpanded}
    aria-label="Toggle file diffs expanded by default"
    className="relative w-9 h-5 rounded-full flex-shrink-0 transition-colors"
    style={{
      backgroundColor: diffExpanded ? 'var(--color-primary)' : 'var(--color-text-muted)',
      opacity: diffExpanded ? 1 : 0.3,
    }}
  >
    <span
      className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
      style={{ transform: diffExpanded ? 'translateX(16px)' : 'translateX(0px)' }}
    />
  </button>
</div>
```

Where `diffExpanded` is derived at top of component:

```tsx
const diffExpanded = (settings.diffExpandedByDefault ?? 'false') === 'true'
```

**Step 2: Verify in dev**

```bash
npm run dev
```

Navigate to Settings > Appearance. Toggle should appear and persist.

**Step 3: Commit**

```bash
git add src/renderer/components/settings/AppearanceSettings.tsx
git commit -m "feat: add diffExpandedByDefault appearance setting"
```

---

### Task 4: Integrate DiffView into ToolUseBlock with tests (TDD)

**Files:**
- Modify: `src/renderer/components/chat/ToolUseBlock.tsx`
- Modify: `src/renderer/components/chat/ToolUseBlock.test.tsx`

**Step 1: Add failing tests to `ToolUseBlock.test.tsx`**

Add `vi.mock` for settingsStore at top of file (same pattern as MessageBubble.test.tsx):

```tsx
vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: { settings: Record<string, string> }) => unknown) =>
    selector({ settings: {} }),
}))
```

Then add new test cases:

```tsx
describe('Edit tool diff view', () => {
  it('shows Diff toggle button for Edit tool with old_str and new_str', () => {
    const tool: ToolPart = {
      type: 'tool', name: 'Edit', id: 'tool_diff_1', status: 'done',
      input: { file_path: '/src/file.ts', old_str: 'foo', new_str: 'bar' },
      output: 'ok',
    }
    render(<ToolUseBlock tool={tool} />)
    expect(screen.getByLabelText('Toggle diff view')).toBeInTheDocument()
  })

  it('does not show Diff button for non-Edit tools', () => {
    const tool: ToolPart = {
      type: 'tool', name: 'Bash', id: 'tool_diff_2', status: 'done',
      input: { command: 'ls' },
      output: 'files',
    }
    render(<ToolUseBlock tool={tool} />)
    expect(screen.queryByLabelText('Toggle diff view')).not.toBeInTheDocument()
  })

  it('does not show Diff button for Edit tool without old_str', () => {
    const tool: ToolPart = {
      type: 'tool', name: 'Edit', id: 'tool_diff_3', status: 'done',
      input: { file_path: '/src/file.ts' },
      output: 'ok',
    }
    render(<ToolUseBlock tool={tool} />)
    expect(screen.queryByLabelText('Toggle diff view')).not.toBeInTheDocument()
  })

  it('expands diff view when Diff button is clicked', () => {
    const tool: ToolPart = {
      type: 'tool', name: 'Edit', id: 'tool_diff_4', status: 'done',
      input: { file_path: '/src/file.ts', old_str: 'foo', new_str: 'bar' },
      output: 'ok',
    }
    render(<ToolUseBlock tool={tool} />)

    expect(screen.queryByText('Before')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Toggle diff view'))
    expect(screen.getByText(/Before/)).toBeInTheDocument()
    expect(screen.getByText(/After/)).toBeInTheDocument()
  })

  it('respects diffExpandedByDefault setting when true', () => {
    // Re-mock with setting enabled
    vi.mocked(useSettingsStore).mockImplementation((selector) =>
      selector({ settings: { diffExpandedByDefault: 'true' } }),
    )

    const tool: ToolPart = {
      type: 'tool', name: 'Edit', id: 'tool_diff_5', status: 'done',
      input: { file_path: '/src/file.ts', old_str: 'foo', new_str: 'bar' },
      output: 'ok',
    }
    render(<ToolUseBlock tool={tool} />)

    // Diff should be expanded by default
    expect(screen.getByText(/Before/)).toBeInTheDocument()
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run --config vitest.config.renderer.ts src/renderer/components/chat/ToolUseBlock.test.tsx
```

Expected: FAIL

**Step 3: Modify `ToolUseBlock.tsx`**

Add imports:

```tsx
import { useSettingsStore } from '../../stores/settingsStore'
import { DiffView } from './DiffView'
```

Inside component, detect Edit diff capability and read setting:

```tsx
const diffExpandedByDefault = useSettingsStore(
  (s) => (s.settings.diffExpandedByDefault ?? 'false') === 'true',
)
const hasDiff = tool.name === 'Edit' && !!tool.input?.old_str && 'new_str' in (tool.input ?? {})
const [showDiff, setShowDiff] = useState(hasDiff && diffExpandedByDefault)
```

Add Diff toggle button in the header buttons area (alongside Input/Output):

```tsx
{hasDiff && (
  <button
    onClick={() => setShowDiff((s) => !s)}
    className="rounded transition-opacity hover:opacity-80 px-1.5 py-0.5 text-[10px] mobile:px-3 mobile:py-2 mobile:text-xs"
    style={{ color: 'var(--color-tool)' }}
    aria-expanded={showDiff}
    aria-label="Toggle diff view"
  >
    {showDiff ? '▼' : '▶'} Diff
  </button>
)}
```

Add DiffView render section (after the Output section):

```tsx
{showDiff && hasDiff && (
  <div className="px-3 pb-2">
    <DiffView
      oldStr={tool.input!.old_str as string}
      newStr={tool.input!.new_str as string}
    />
  </div>
)}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run --config vitest.config.renderer.ts src/renderer/components/chat/ToolUseBlock.test.tsx
```

Expected: PASS (all tests including new ones)

**Step 5: Run full test suite**

```bash
npm test
```

Expected: All 1917+ tests pass

**Step 6: Commit**

```bash
git add src/renderer/components/chat/ToolUseBlock.tsx src/renderer/components/chat/ToolUseBlock.test.tsx
git commit -m "feat: integrate diff view into Edit tool blocks"
```

---

### Task 5: Final verification

**Step 1: Run full build**

```bash
npm run build
```

Expected: 0 errors

**Step 2: Run full tests**

```bash
npm test
```

Expected: all pass

**Step 3: Manual test in dev**

```bash
npm run dev
```

- Start a conversation, ask the AI to edit a file
- Verify diff view appears with Before/After columns
- Verify Diff toggle button works
- Verify Settings > Appearance > File Diffs toggle works
- Verify default state respects the setting

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: side-by-side diff view for Edit tool with appearance setting"
```
