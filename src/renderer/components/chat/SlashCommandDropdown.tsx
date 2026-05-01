import { useEffect, useRef } from 'react'
import type { SlashCommand } from '../../../shared/types'
import { fuzzyMatch, fuzzyHighlight } from '../../utils/fuzzyMatch'
import { useClickOutside } from '../../hooks/useClickOutside'

interface SlashCommandDropdownProps {
  commands: SlashCommand[]
  filter: string
  selectedIndex: number
  onSelect: (cmd: SlashCommand) => void
  onClose: () => void
}

export function SlashCommandDropdown({ commands, filter, selectedIndex, onSelect, onClose }: SlashCommandDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  const filtered = filter
    ? commands
        .map((cmd) => ({ cmd, ...fuzzyMatch(filter, cmd.name) }))
        .filter((r) => r.match)
        .sort((a, b) => b.score - a.score)
        .map((r) => ({ ...r.cmd, _indices: r.indices }))
    : commands.map((cmd) => ({ ...cmd, _indices: [] as number[] }))

  // Scroll selected item into view
  useEffect(() => {
    if (typeof selectedRef.current?.scrollIntoView === 'function') {
      selectedRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  useClickOutside(listRef, onClose)

  if (filtered.length === 0) {
    return (
      <div
        ref={listRef}
        className="absolute bottom-full left-0 right-0 mb-1 rounded shadow-lg text-xs py-2 px-3 z-50"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-text-muted)',
          color: 'var(--color-text-muted)',
        }}
      >
        No commands found
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 rounded shadow-lg text-xs max-h-[240px] overflow-y-auto py-1 z-50"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-text-muted)',
      }}
      role="listbox"
      aria-label="Slash commands"
    >
      {filtered.map((cmd, i) => {
        const isSelected = i === selectedIndex
        return (
          <button
            key={`${cmd.source}:${cmd.name}`}
            ref={isSelected ? selectedRef : undefined}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(cmd)}
            className="w-full text-left px-3 py-1.5 mobile:py-2.5 flex items-center gap-2 transition-colors"
            style={{
              backgroundColor: isSelected ? 'var(--color-bg)' : 'transparent',
              color: 'var(--color-text)',
            }}
          >
            <span style={{ color: 'var(--color-text-muted)' }}>/</span>
            <span className="font-medium">
              {filter && cmd._indices.length > 0 ? fuzzyHighlight(cmd.name, cmd._indices) : cmd.name}
            </span>
            {cmd.description && (
              <span className="truncate min-w-0 flex-1" style={{ color: 'var(--color-text-muted)' }}>
                {cmd.description}
              </span>
            )}
            {cmd.source !== 'builtin' && (
              <span
                className="ml-auto text-[0.625rem] px-1 rounded flex-shrink-0"
                style={{
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {cmd.source}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
