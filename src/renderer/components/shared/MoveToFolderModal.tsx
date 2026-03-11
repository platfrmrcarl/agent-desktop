import { useEffect, useRef } from 'react'
import type { Folder } from '../../../shared/types'

interface Props {
  folders: Folder[]
  onSelect: (folderId: number | null) => void
  onClose: () => void
  title?: string
}

export function MoveToFolderModal({ folders, onSelect, onClose, title = 'Move to folder' }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
      role="dialog"
      aria-label={title}
    >
      <div
        className="rounded-lg shadow-xl w-full max-w-xs mx-4"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-bg)',
          color: 'var(--color-text)',
        }}
      >
        <div
          className="px-4 py-3"
          style={{ borderBottom: '1px solid var(--color-bg)' }}
        >
          <h2 className="text-sm font-medium">{title}</h2>
        </div>

        <div className="py-1 max-h-64 overflow-y-auto">
          <button
            onClick={() => onSelect(null)}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--color-bg)] flex items-center gap-2"
            style={{ backgroundColor: 'transparent', color: 'var(--color-text-muted)' }}
            role="menuitem"
          >
            No folder
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => onSelect(f.id)}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--color-bg)] flex items-center gap-2"
              style={{ backgroundColor: 'transparent' }}
              role="menuitem"
            >
              {f.color && (
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: f.color }}
                />
              )}
              <span className="truncate">{f.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
