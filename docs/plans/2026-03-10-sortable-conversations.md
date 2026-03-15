# Sortable Conversations & Folders Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add configurable sorting for conversations and folders in the sidebar, with global defaults and per-folder overrides.

**Architecture:** Sorting is applied renderer-side via `useMemo` in FolderTree. The SQL backend adds a `message_count` computed column. Global sort preferences are persisted in the settings store. Per-folder overrides are stored in the existing `ai_overrides` JSON on folders. The cascade is Global → Folder (same pattern as other settings).

**Tech Stack:** TypeScript, React, Zustand, sql.js, Vitest

---

### Task 1: Add `message_count` to conversations SQL query

**Files:**
- Modify: `src/main/services/conversations.ts:12-18` (conversations:list handler)
- Modify: `src/main/services/conversations.ts:220-233` (conversations:search handler)
- Test: `src/main/services/conversations.test.ts`

**Step 1: Write the failing test**

Add to `src/main/services/conversations.test.ts`:

```typescript
it('list includes message_count for each conversation', async () => {
  const conv = await ipc.invoke('conversations:create', 'With Count') as any
  db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conv.id, 'user', 'hello')
  db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conv.id, 'assistant', 'hi')

  const list = await ipc.invoke('conversations:list') as any[]
  const found = list.find((c: any) => c.id === conv.id)
  expect(found.message_count).toBe(2)
})

it('list returns message_count 0 for conversation with no messages', async () => {
  const conv = await ipc.invoke('conversations:create', 'Empty') as any
  const list = await ipc.invoke('conversations:list') as any[]
  const found = list.find((c: any) => c.id === conv.id)
  expect(found.message_count).toBe(0)
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/services/conversations.test.ts --reporter=verbose`
Expected: FAIL — `message_count` is `undefined`

**Step 3: Modify the SQL queries**

In `src/main/services/conversations.ts`, update `conversations:list` handler (line 12-18):

```typescript
ipcMain.handle('conversations:list', () => {
  return db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count
       FROM conversations c ORDER BY updated_at DESC`
    )
    .all()
})
```

Update `conversations:search` handler (line 220-233):

```typescript
ipcMain.handle('conversations:search', (_e, query: string) => {
  validateString(query, 'query', 500)
  const pattern = `%${query}%`
  return db
    .prepare(
      `SELECT DISTINCT c.*, (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.title LIKE ? OR m.content LIKE ?
       ORDER BY c.updated_at DESC
       LIMIT ${SEARCH_RESULTS_LIMIT}`
    )
    .all(pattern, pattern)
})
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/services/conversations.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/services/conversations.ts src/main/services/conversations.test.ts
git commit -m "feat(conversations): add message_count computed column to list/search queries"
```

---

### Task 2: Add sort types to shared types

**Files:**
- Modify: `src/shared/types.ts:34-50` (Conversation interface)

**Step 1: Add `message_count` to the Conversation interface and create sort types**

In `src/shared/types.ts`, add `message_count` to `Conversation` (after `color` field, before `created_at`):

```typescript
  message_count: number
```

Add sort type definitions at the end of the file (before closing):

```typescript
// ─── Sort Types ──────────────────────────────────────────────

export type SortCriterion = 'updated_at' | 'message_count' | 'title'
export type SortDirection = 'asc' | 'desc'

export interface SortConfig {
  criterion: SortCriterion
  direction: SortDirection
}
```

**Step 2: Run full build to verify type correctness**

Run: `npx tsc --noEmit`
Expected: May show some errors in renderer code that expects Conversation without `message_count` — these are OK for now, they'll be satisfied once the SQL returns it.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add message_count to Conversation, add SortConfig types"
```

---

### Task 3: Add sort utility function

**Files:**
- Create: `src/renderer/utils/sort.ts`
- Create: `src/renderer/utils/sort.test.ts`

**Step 1: Write the failing tests**

Create `src/renderer/utils/sort.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { sortConversations, sortFolders } from './sort'
import type { Conversation, Folder, SortConfig } from '../../shared/types'

function makeConv(overrides: Partial<Conversation> & { id: number }): Conversation {
  return {
    title: 'Test',
    folder_id: null,
    position: 0,
    model: 'claude',
    system_prompt: null,
    cwd: null,
    kb_enabled: 0,
    ai_overrides: null,
    cleared_at: null,
    compact_summary: null,
    sdk_session_id: null,
    color: null,
    message_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('sortConversations', () => {
  it('sorts by updated_at desc (default)', () => {
    const convs = [
      makeConv({ id: 1, updated_at: '2026-01-01T00:00:00Z' }),
      makeConv({ id: 2, updated_at: '2026-01-03T00:00:00Z' }),
      makeConv({ id: 3, updated_at: '2026-01-02T00:00:00Z' }),
    ]
    const sorted = sortConversations(convs, { criterion: 'updated_at', direction: 'desc' })
    expect(sorted.map(c => c.id)).toEqual([2, 3, 1])
  })

  it('sorts by updated_at asc', () => {
    const convs = [
      makeConv({ id: 1, updated_at: '2026-01-03T00:00:00Z' }),
      makeConv({ id: 2, updated_at: '2026-01-01T00:00:00Z' }),
    ]
    const sorted = sortConversations(convs, { criterion: 'updated_at', direction: 'asc' })
    expect(sorted.map(c => c.id)).toEqual([2, 1])
  })

  it('sorts by message_count desc', () => {
    const convs = [
      makeConv({ id: 1, message_count: 5 }),
      makeConv({ id: 2, message_count: 20 }),
      makeConv({ id: 3, message_count: 10 }),
    ]
    const sorted = sortConversations(convs, { criterion: 'message_count', direction: 'desc' })
    expect(sorted.map(c => c.id)).toEqual([2, 3, 1])
  })

  it('sorts by title asc (case-insensitive)', () => {
    const convs = [
      makeConv({ id: 1, title: 'Zebra' }),
      makeConv({ id: 2, title: 'apple' }),
      makeConv({ id: 3, title: 'Banana' }),
    ]
    const sorted = sortConversations(convs, { criterion: 'title', direction: 'asc' })
    expect(sorted.map(c => c.id)).toEqual([2, 3, 1])
  })

  it('sorts by title desc', () => {
    const convs = [
      makeConv({ id: 1, title: 'Apple' }),
      makeConv({ id: 2, title: 'Zebra' }),
    ]
    const sorted = sortConversations(convs, { criterion: 'title', direction: 'desc' })
    expect(sorted.map(c => c.id)).toEqual([2, 1])
  })
})

describe('sortFolders', () => {
  it('sorts by title asc', () => {
    const folders = [
      { id: 1, name: 'Zulu' },
      { id: 2, name: 'Alpha' },
    ] as Folder[]
    const stats = new Map<number, { updated_at: string; message_count: number }>()
    const sorted = sortFolders(folders, { criterion: 'title', direction: 'asc' }, stats)
    expect(sorted.map(f => f.id)).toEqual([2, 1])
  })

  it('sorts by message_count desc using stats map', () => {
    const folders = [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ] as Folder[]
    const stats = new Map([
      [1, { updated_at: '2026-01-01T00:00:00Z', message_count: 5 }],
      [2, { updated_at: '2026-01-01T00:00:00Z', message_count: 20 }],
    ])
    const sorted = sortFolders(folders, { criterion: 'message_count', direction: 'desc' }, stats)
    expect(sorted.map(f => f.id)).toEqual([2, 1])
  })

  it('sorts by updated_at desc using stats map', () => {
    const folders = [
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ] as Folder[]
    const stats = new Map([
      [1, { updated_at: '2026-01-03T00:00:00Z', message_count: 0 }],
      [2, { updated_at: '2026-01-01T00:00:00Z', message_count: 0 }],
    ])
    const sorted = sortFolders(folders, { criterion: 'updated_at', direction: 'desc' }, stats)
    expect(sorted.map(f => f.id)).toEqual([1, 2])
  })

  it('returns position order when sort is default (updated_at desc) for manual ordering', () => {
    const folders = [
      { id: 1, name: 'B', position: 1 },
      { id: 2, name: 'A', position: 0 },
    ] as Folder[]
    const stats = new Map<number, { updated_at: string; message_count: number }>()
    const sorted = sortFolders(folders, { criterion: 'updated_at', direction: 'desc' }, stats, true)
    expect(sorted.map(f => f.id)).toEqual([2, 1])
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/utils/sort.test.ts --reporter=verbose`
Expected: FAIL — module not found

**Step 3: Implement the sort utilities**

Create `src/renderer/utils/sort.ts`:

```typescript
import type { Conversation, Folder, SortConfig } from '../../shared/types'

export function sortConversations(convs: Conversation[], sort: SortConfig): Conversation[] {
  const sorted = [...convs]
  const dir = sort.direction === 'asc' ? 1 : -1

  sorted.sort((a, b) => {
    switch (sort.criterion) {
      case 'updated_at':
        return dir * a.updated_at.localeCompare(b.updated_at)
      case 'message_count':
        return dir * (a.message_count - b.message_count)
      case 'title':
        return dir * a.title.toLowerCase().localeCompare(b.title.toLowerCase())
    }
  })

  return sorted
}

export interface FolderStats {
  updated_at: string
  message_count: number
}

/**
 * Sort folders by criterion. When usePositionOrder is true and sort is default
 * (updated_at desc), folders keep their manual drag-and-drop position order.
 */
export function sortFolders(
  folders: Folder[],
  sort: SortConfig,
  stats: Map<number, FolderStats>,
  usePositionOrder = false,
): Folder[] {
  // Default sort = keep manual position order
  if (usePositionOrder && sort.criterion === 'updated_at' && sort.direction === 'desc') {
    return [...folders].sort((a, b) => a.position - b.position)
  }

  const sorted = [...folders]
  const dir = sort.direction === 'asc' ? 1 : -1

  sorted.sort((a, b) => {
    switch (sort.criterion) {
      case 'title':
        return dir * a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      case 'message_count': {
        const aCount = stats.get(a.id)?.message_count ?? 0
        const bCount = stats.get(b.id)?.message_count ?? 0
        return dir * (aCount - bCount)
      }
      case 'updated_at': {
        const aDate = stats.get(a.id)?.updated_at ?? ''
        const bDate = stats.get(b.id)?.updated_at ?? ''
        return dir * aDate.localeCompare(bDate)
      }
    }
  })

  return sorted
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/utils/sort.test.ts --reporter=verbose`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/utils/sort.ts src/renderer/utils/sort.test.ts
git commit -m "feat(sort): add sortConversations and sortFolders utility functions"
```

---

### Task 4: Integrate sorting into FolderTree

**Files:**
- Modify: `src/renderer/components/sidebar/FolderTree.tsx`
- Modify: `src/renderer/stores/settingsStore.ts` (read sort settings)

**Step 1: Add sort state reader helper**

In `FolderTree.tsx`, add imports and a helper to resolve effective sort config at the top:

```typescript
import type { SortConfig, SortCriterion, SortDirection } from '../../../shared/types'
import { sortConversations, sortFolders } from '../../utils/sort'
import type { FolderStats } from '../../utils/sort'
```

**Step 2: Compute folder stats and sorted data in SidebarTree**

Inside `SidebarTree()`, after the existing `recursiveConvCounts` useMemo, add:

```typescript
// Global sort config from settings
const globalSortCriterion = (globalSettings.sort_criterion as SortCriterion) || 'updated_at'
const globalSortDirection = (globalSettings.sort_direction as SortDirection) || 'desc'
const globalSort: SortConfig = { criterion: globalSortCriterion, direction: globalSortDirection }

// Resolve per-folder sort config (folder override > global)
const getFolderSort = useCallback((folder: Folder): SortConfig => {
  if (!folder.ai_overrides) return globalSort
  try {
    const overrides = JSON.parse(folder.ai_overrides)
    return {
      criterion: overrides.sort_criterion || globalSort.criterion,
      direction: overrides.sort_direction || globalSort.direction,
    }
  } catch {
    return globalSort
  }
}, [globalSort])

// Cumulative message counts (sum of message_count across all conversations recursively)
const recursiveMessageCounts = useMemo(() => {
  const result = new Map<number, number>()
  const compute = (folderId: number): number => {
    if (result.has(folderId)) return result.get(folderId)!
    const folderConvs = convsByFolder.get(folderId) ?? []
    const direct = folderConvs.reduce((sum, c) => sum + (c.message_count ?? 0), 0)
    const children = childrenByParent.get(folderId) ?? []
    const total = direct + children.reduce((sum, f) => sum + compute(f.id), 0)
    result.set(folderId, total)
    return total
  }
  for (const f of folders) compute(f.id)
  return result
}, [folders, convsByFolder, childrenByParent])

// Most recent updated_at per folder (recursive)
const recursiveUpdatedAt = useMemo(() => {
  const result = new Map<number, string>()
  const compute = (folderId: number): string => {
    if (result.has(folderId)) return result.get(folderId)!
    const folderConvs = convsByFolder.get(folderId) ?? []
    let latest = ''
    for (const c of folderConvs) {
      if (c.updated_at > latest) latest = c.updated_at
    }
    for (const child of (childrenByParent.get(folderId) ?? [])) {
      const childLatest = compute(child.id)
      if (childLatest > latest) latest = childLatest
    }
    result.set(folderId, latest)
    return latest
  }
  for (const f of folders) compute(f.id)
  return result
}, [folders, convsByFolder, childrenByParent])

// Combined folder stats for sort function
const folderStats = useMemo(() => {
  const stats = new Map<number, FolderStats>()
  for (const f of folders) {
    stats.set(f.id, {
      updated_at: recursiveUpdatedAt.get(f.id) ?? '',
      message_count: recursiveMessageCounts.get(f.id) ?? 0,
    })
  }
  return stats
}, [folders, recursiveUpdatedAt, recursiveMessageCounts])

// Sorted convsByFolder (applies per-folder sort)
const sortedConvsByFolder = useMemo(() => {
  const map = new Map<number, Conversation[]>()
  for (const [folderId, convs] of convsByFolder) {
    const folder = foldersById.get(folderId)
    const sort = folder ? getFolderSort(folder) : globalSort
    map.set(folderId, sortConversations(convs, sort))
  }
  return map
}, [convsByFolder, foldersById, getFolderSort, globalSort])

// Sorted childrenByParent (applies global sort to folder ordering)
const sortedChildrenByParent = useMemo(() => {
  const map = new Map<number | null, Folder[]>()
  for (const [parentId, children] of childrenByParent) {
    map.set(parentId, sortFolders(children, globalSort, folderStats, true))
  }
  return map
}, [childrenByParent, globalSort, folderStats])
```

**Step 3: Replace `convsByFolder` and `childrenByParent` usage with sorted versions**

Throughout SidebarTree and its JSX, replace:
- `convsByFolder` → `sortedConvsByFolder` (in FolderRow props and visibleOrder computation)
- `childrenByParent` → `sortedChildrenByParent` (in root folder rendering and FolderRow props)

Keep the original `convsByFolder` and `childrenByParent` for index lookups (counts, etc.), but use sorted versions for rendering.

**Step 4: Update the `onConversationUpdated` listener**

In `src/renderer/stores/conversationsStore.ts` (line 321-329), remove the `.sort()` call since sorting is now handled by FolderTree:

```typescript
if (typeof window !== 'undefined' && window.agent?.events?.onConversationUpdated) {
  window.agent.events.onConversationUpdated((conversationId: number) => {
    const now = new Date().toISOString()
    useConversationsStore.setState((s) => ({
      conversations: s.conversations
        .map((c) => c.id === conversationId ? { ...c, updated_at: now } : c),
    }))
  })
}
```

**Step 5: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: PASS (existing tests should still pass)

**Step 6: Commit**

```bash
git add src/renderer/components/sidebar/FolderTree.tsx src/renderer/stores/conversationsStore.ts
git commit -m "feat(sidebar): integrate sort logic into FolderTree with per-folder overrides"
```

---

### Task 5: Add sort dropdown UI to sidebar header

**Files:**
- Modify: `src/renderer/components/sidebar/Sidebar.tsx`

**Step 1: Add the SortDropdown component and integrate it**

Add a `SortDropdown` component inside `Sidebar.tsx` (below `SelectionBar`):

```typescript
import type { SortCriterion, SortDirection } from '../../../shared/types'

const SORT_CRITERIA: { value: SortCriterion; label: string }[] = [
  { value: 'updated_at', label: 'Last message date' },
  { value: 'message_count', label: 'Message count' },
  { value: 'title', label: 'Alphabetical' },
]

function SortDropdown() {
  const { settings, setSetting } = useSettingsStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const criterion = (settings.sort_criterion as SortCriterion) || 'updated_at'
  const direction = (settings.sort_direction as SortDirection) || 'desc'

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleCriterionChange = (value: SortCriterion) => {
    setSetting('sort_criterion', value)
    setOpen(false)
  }

  const toggleDirection = () => {
    setSetting('sort_direction', direction === 'asc' ? 'desc' : 'asc')
  }

  // Check if non-default sort is active
  const isCustomSort = criterion !== 'updated_at' || direction !== 'desc'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Sort conversations"
        className="p-1 mobile:w-11 mobile:h-11 mobile:flex mobile:items-center mobile:justify-center mobile:p-0 rounded transition-colors hover:bg-[var(--color-bg)]"
        style={{ color: isCustomSort ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
        aria-label="Sort conversations"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 rounded-lg shadow-lg py-1 text-sm min-w-[180px] z-50"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-bg)',
          }}
        >
          {SORT_CRITERIA.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleCriterionChange(opt.value)}
              className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-bg)] flex items-center justify-between"
              style={{
                backgroundColor: 'transparent',
                color: criterion === opt.value ? 'var(--color-primary)' : 'var(--color-text)',
              }}
            >
              <span>{opt.label}</span>
              {criterion === opt.value && <span className="text-xs">✓</span>}
            </button>
          ))}
          <div
            className="mx-2 my-1"
            style={{ borderTop: '1px solid var(--color-bg)' }}
          />
          <button
            onClick={toggleDirection}
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-bg)] flex items-center gap-2"
            style={{ backgroundColor: 'transparent', color: 'var(--color-text)' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              style={{ transform: direction === 'asc' ? 'rotate(180deg)' : 'none' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            <span>{direction === 'asc' ? 'Ascending' : 'Descending'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Wire SortDropdown into the sidebar header**

In the Sidebar header `<div className="flex items-center gap-1 ...">`, add `<SortDropdown />` before the import button:

```tsx
<SortDropdown />
```

Add the missing imports at the top:

```typescript
import { useSettingsStore } from '../../stores/settingsStore'
```

**Step 3: Run the app and verify visually**

Run: `npm run dev`
Expected: Sort button appears in sidebar header. Clicking opens dropdown with 3 criteria + direction toggle.

**Step 4: Commit**

```bash
git add src/renderer/components/sidebar/Sidebar.tsx
git commit -m "feat(sidebar): add sort dropdown UI to sidebar header"
```

---

### Task 6: Add sort override to folder context menu

**Files:**
- Modify: `src/renderer/components/sidebar/FolderTree.tsx` (context menu section, ~line 867-910)

**Step 1: Add "Sort by" sub-menu to the folder context menu**

In the context menu section of SidebarTree (where `menuFolderId !== null`), add a sort section after the "Folder Settings" item and before the divider/delete:

```tsx
<ContextMenuDivider />
<ContextMenuItem
  onClick={() => {
    const folder = foldersById.get(menuFolderId!)
    if (!folder) return
    const overrides = folder.ai_overrides ? JSON.parse(folder.ai_overrides) : {}
    const currentCriterion = overrides.sort_criterion || null
    // Cycle: null → title → message_count → updated_at → null
    const criteria: (SortCriterion | null)[] = [null, 'updated_at', 'message_count', 'title']
    const currentIdx = criteria.indexOf(currentCriterion)
    const nextCriterion = criteria[(currentIdx + 1) % criteria.length]
    const newOverrides = { ...overrides }
    if (nextCriterion === null) {
      delete newOverrides.sort_criterion
      delete newOverrides.sort_direction
    } else {
      newOverrides.sort_criterion = nextCriterion
      newOverrides.sort_direction = overrides.sort_direction || 'desc'
    }
    const json = Object.keys(newOverrides).length > 0 ? JSON.stringify(newOverrides) : null
    updateFolder(menuFolderId!, { ai_overrides: json })
    setMenuFolderId(null)
  }}
>
  Sort: {(() => {
    const folder = foldersById.get(menuFolderId!)
    if (!folder?.ai_overrides) return 'Inherited'
    try {
      const o = JSON.parse(folder.ai_overrides)
      if (!o.sort_criterion) return 'Inherited'
      const labels: Record<string, string> = { updated_at: 'Date', message_count: 'Messages', title: 'Name' }
      return labels[o.sort_criterion] || 'Inherited'
    } catch { return 'Inherited' }
  })()}
</ContextMenuItem>
<ContextMenuItem
  onClick={() => {
    const folder = foldersById.get(menuFolderId!)
    if (!folder) return
    const overrides = folder.ai_overrides ? JSON.parse(folder.ai_overrides) : {}
    const currentDir = overrides.sort_direction || 'desc'
    overrides.sort_direction = currentDir === 'asc' ? 'desc' : 'asc'
    updateFolder(menuFolderId!, { ai_overrides: JSON.stringify(overrides) })
    setMenuFolderId(null)
  }}
>
  Direction: {(() => {
    const folder = foldersById.get(menuFolderId!)
    if (!folder?.ai_overrides) return '↓ Desc'
    try {
      const o = JSON.parse(folder.ai_overrides)
      return o.sort_direction === 'asc' ? '↑ Asc' : '↓ Desc'
    } catch { return '↓ Desc' }
  })()}
</ContextMenuItem>
```

**Step 2: Add the SortCriterion import**

Make sure `SortCriterion` is imported at the top of FolderTree.tsx (should already be from Task 4).

**Step 3: Run the app and verify visually**

Run: `npm run dev`
Expected: Right-clicking a folder shows "Sort: Inherited" and "Direction: ↓ Desc" items. Clicking cycles through options.

**Step 4: Commit**

```bash
git add src/renderer/components/sidebar/FolderTree.tsx
git commit -m "feat(sidebar): add sort override to folder context menu"
```

---

### Task 7: Add default sort settings to GeneralSettings

**Files:**
- Modify: `src/renderer/components/settings/GeneralSettings.tsx`

**Step 1: Add sort settings section**

After the auto-retry settings section (after line 311 `</>)`), add:

```tsx
{/* Default sort order */}
<div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
  <div className="flex flex-col gap-0.5 pr-4">
    <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
      Default conversation sort
    </span>
    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
      How conversations and folders are sorted in the sidebar.
    </span>
  </div>
  <div className="flex items-center gap-2">
    <select
      value={settings.sort_criterion ?? 'updated_at'}
      onChange={(e) => setSetting('sort_criterion', e.target.value)}
      className="text-xs rounded px-2 py-1 border border-[var(--color-text-muted)]/20 mobile:text-base mobile:py-2"
      style={{ backgroundColor: 'var(--color-base)', color: 'var(--color-text)' }}
      aria-label="Sort criterion"
    >
      <option value="updated_at">Last message date</option>
      <option value="message_count">Message count</option>
      <option value="title">Alphabetical</option>
    </select>
    <select
      value={settings.sort_direction ?? 'desc'}
      onChange={(e) => setSetting('sort_direction', e.target.value)}
      className="text-xs rounded px-2 py-1 border border-[var(--color-text-muted)]/20 mobile:text-base mobile:py-2"
      style={{ backgroundColor: 'var(--color-base)', color: 'var(--color-text)' }}
      aria-label="Sort direction"
    >
      <option value="desc">Descending</option>
      <option value="asc">Ascending</option>
    </select>
  </div>
</div>
```

**Step 2: Run the app and verify**

Run: `npm run dev`
Expected: GeneralSettings shows "Default conversation sort" with two dropdowns.

**Step 3: Commit**

```bash
git add src/renderer/components/settings/GeneralSettings.tsx
git commit -m "feat(settings): add default sort preferences to GeneralSettings"
```

---

### Task 8: Run full test suite and verify build

**Files:** None (verification only)

**Step 1: Run all tests**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

**Step 2: Run TypeScript build**

Run: `npm run build`
Expected: 0 errors, 0 warnings

**Step 3: Manual smoke test**

Run: `npm run dev`
Verify:
1. Sort dropdown in sidebar header works (all 3 criteria + direction toggle)
2. Conversations re-sort immediately when changing criterion
3. Folders re-sort immediately (except default sort preserves manual position order)
4. Folder context menu shows sort override options
5. Folder override takes precedence over global sort for conversations within that folder
6. GeneralSettings shows sort preferences and changes are reflected in sidebar
7. Sort preferences persist across app restarts

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```
