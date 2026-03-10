import type { Conversation, Folder, SortConfig } from '../../shared/types'

export function sortConversations(convs: Conversation[], sort: SortConfig): Conversation[] {
  const sorted = [...convs]
  const dir = sort.direction === 'asc' ? 1 : -1

  sorted.sort((a, b) => {
    switch (sort.criterion) {
      case 'updated_at':
        return dir * a.updated_at.localeCompare(b.updated_at)
      case 'message_count':
        return dir * ((a.message_count ?? 0) - (b.message_count ?? 0))
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
