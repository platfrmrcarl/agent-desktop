import { useRightSidebarStore } from '../../stores/rightSidebarStore'
import { useActiveConversationCwd } from '../../hooks/useActiveConversationCwd'
import { useIsGitRepo } from '../../hooks/useIsGitRepo'
import { PreviewTab } from './PreviewTab'
import { GitTab } from './git'

export function RightSidebarPanel() {
  const activeTab = useRightSidebarStore((s) => s.activeTab)
  const setActiveTab = useRightSidebarStore((s) => s.setActiveTab)
  const cwd = useActiveConversationCwd()
  const { isRepo, loading } = useIsGitRepo(cwd)

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div
        role="tablist"
        className="flex border-b border-[color:var(--contrast-12)] shrink-0"
      >
        <button
          role="tab"
          aria-selected={activeTab === 'preview'}
          onClick={() => setActiveTab('preview')}
          className={`px-3 py-1.5 text-sm ${activeTab === 'preview' ? 'bg-[color:var(--base)]' : 'opacity-70 hover:opacity-100'}`}
        >
          Preview
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'git'}
          aria-disabled={!isRepo}
          disabled={!isRepo && !loading}
          title={!isRepo ? "Ce dossier n'est pas un repo git" : undefined}
          onClick={() => isRepo && setActiveTab('git')}
          className={`px-3 py-1.5 text-sm flex items-center gap-1.5 ${
            activeTab === 'git' && isRepo ? 'bg-[color:var(--base)]' : 'opacity-70 hover:opacity-100'
          } ${!isRepo ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          Git
          {loading && <span className="w-2 h-2 rounded-full bg-[color:var(--accent)] animate-pulse" />}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'preview' ? <PreviewTab /> : isRepo ? <GitTab /> : <PreviewTab />}
      </div>
    </div>
  )
}
