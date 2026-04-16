import { useGitPanelStore } from '../../../stores/gitPanelStore'
import { useActiveConversationCwd } from '../../../hooks/useActiveConversationCwd'
import { useRightSidebarStore } from '../../../stores/rightSidebarStore'
import { GitHeader } from './GitHeader'
import { GitGraph } from './GitGraph'
import { GitStatus } from './GitStatus'
import { GitBranches } from './GitBranches'
import { GitStash } from './GitStash'
import { useGitRefresh } from './useGitRefresh'

const SUBTABS = [
  { id: 'graph', label: 'Graph' },
  { id: 'status', label: 'Status' },
  { id: 'branches', label: 'Branches' },
  { id: 'stash', label: 'Stash' },
] as const

export function GitTab() {
  const cwd = useActiveConversationCwd()
  const activeTab = useRightSidebarStore((s) => s.activeTab)
  const active = activeTab === 'git'
  const activeSubTab = useGitPanelStore((s) => s.activeSubTab)
  const setActiveSubTab = useGitPanelStore((s) => s.setActiveSubTab)

  useGitRefresh(cwd, active)

  if (!cwd) return <div className="p-4 text-sm opacity-70">Aucun dossier de travail.</div>

  return (
    <div className="flex flex-col h-full">
      <GitHeader cwd={cwd} />
      <div role="tablist" className="flex border-b border-[color:color-mix(in_srgb,var(--color-text)_12%,transparent)] text-xs shrink-0">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeSubTab === t.id}
            onClick={() => setActiveSubTab(t.id)}
            className={`px-3 py-1 ${activeSubTab === t.id ? 'bg-[color:var(--color-bg)] font-semibold' : 'opacity-70 hover:opacity-100'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeSubTab === 'graph' && <GitGraph cwd={cwd} />}
        {activeSubTab === 'status' && <GitStatus />}
        {activeSubTab === 'branches' && <GitBranches cwd={cwd} />}
        {activeSubTab === 'stash' && <GitStash cwd={cwd} />}
      </div>
    </div>
  )
}
