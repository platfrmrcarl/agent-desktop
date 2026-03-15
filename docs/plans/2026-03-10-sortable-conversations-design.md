# Sortable Conversations & Folders — Design

## Overview

Add configurable sorting for conversations and folders in the sidebar, with global defaults and per-folder overrides.

## Sort Criteria

- `updated_at` — date of last message (default)
- `message_count` — total messages in conversation (or cumulative for folders)
- `title` — alphabetical by name

Each criterion supports `asc` / `desc` direction. Default: `updated_at` / `desc`.

## Cascade

Global → Folder override. No conversation-level override (doesn't make sense).

- **Global settings**: `sort_criterion` and `sort_direction` persisted via settings store
- **Folder override**: stored in `ai_overrides` JSON (`sort_criterion` / `sort_direction`). `null` = inherit global.

## Data

### message_count on conversations

Added via SQL subquery in `conversations:list`:

```sql
SELECT c.*, (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count
FROM conversations c ORDER BY updated_at DESC
```

No new column — computed at query time.

### Cumulative message_count for folders

Computed renderer-side in a `useMemo` (sum of `message_count` across conversations in folder + sub-folders recursively). Same pattern as existing `recursiveConvCounts`.

### Sorting location

SQL keeps `ORDER BY updated_at DESC` as backend default. Dynamic re-sorting happens **renderer-side** in `convsByFolder` useMemo and folder ordering logic.

## UI

### Sidebar header

Sort button (icon) next to existing buttons. Opens dropdown:
- 3 criteria radio options
- Asc/desc toggle
- Applies global sort immediately, persists via settings store

### Folder context menu

New "Sort by..." item with sub-menu:
- 3 criteria + direction toggle
- Sets folder-level override in `ai_overrides`

### GeneralSettings page

New "Default Sort" section:
- Select for criterion
- Toggle for direction

## Sorting behavior

### Conversations within a folder

Sorted by effective criterion (folder override > global).

### Folders themselves

Sorted by global criterion:
- `updated_at` = most recent message across all conversations in the folder
- `message_count` = cumulative total across folder + sub-folders
- `title` = folder name

### Interaction with manual drag & drop order

When a sort other than default (`updated_at desc`) is active, sort **replaces** manual position order. When returning to default sort, manual `position` order is restored.

## Files impacted

- `src/main/services/conversations.ts` — add `message_count` subquery
- `src/shared/types.ts` — extend `Conversation` with `message_count`, add sort types
- `src/renderer/stores/conversationsStore.ts` — sort state + sort logic
- `src/renderer/stores/settingsStore.ts` — persist sort preferences
- `src/renderer/components/sidebar/Sidebar.tsx` — sort dropdown UI
- `src/renderer/components/sidebar/FolderTree.tsx` — apply sorting in useMemo, folder context menu
- `src/renderer/components/settings/GeneralSettings.tsx` — default sort section
