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
