# Git Panel — Design Spec

**Date:** 2026-04-16
**Status:** Draft, pending user approval
**Scope:** Add a semi-interactive Git repository visualizer as a new tab in the right sidebar of Agent Desktop.

---

## 1. Problem

The right sidebar currently hosts a single view (`FileExplorerPanel`) showing a preview of the selected file. When the agent works inside a git repository, the user has no way to see the state of that repository without asking the agent or opening an external tool. This breaks flow and hides information that is most useful precisely when the agent is modifying the repo.

## 2. Goal

Add a **Git** tab to the right sidebar that:

- Displays repository state when the conversation's CWD is a git repository.
- Is disabled (visible but non-interactive) when the CWD is not a git repository or is null.
- Auto-refreshes when the agent executes `git` commands via Bash tool calls.
- Exposes a small set of **reversible** actions (semi-interactive scope): `checkout` of existing branches, `stash save/pop`, `fetch`. No commit, push, merge, rebase, reset, or history-rewriting operations.

## 3. Non-Goals

- Full git GUI (commit composer, conflict resolution, push/pull UI).
- Integration with remote hosting (GitHub/GitLab API, PR listings).
- Diff viewer beyond what the existing file preview provides.
- Multi-repo / submodule navigation.
- Performance benchmarking beyond a smoke test at 500 commits.

## 4. User Stories

1. *As a user whose agent just ran `git commit -am "…"`, I want the Git panel to reflect the new commit in the graph without manual refresh.*
2. *As a user inspecting an unfamiliar repo, I want to see the current branch, ahead/behind counts, and a visual graph of recent commits with merges.*
3. *As a user reviewing uncommitted work, I want a Status sub-tab listing modified / staged / untracked files.*
4. *As a user who wants to switch branches quickly, I want to click a branch in the Branches sub-tab and have it checked out (only if no uncommitted changes would be lost — git's own safety).*
5. *As a user whose conversation CWD is not a repo, I want the Git tab to be clearly disabled with an explanatory tooltip, not silently missing.*

## 5. Architecture Overview

```
FileExplorerPanel (existing — becomes internal)
  │
  └─ RightSidebarPanel (NEW container)
       ├─ TabBar : [ Preview ] [ Git ]
       ├─ PreviewTab      ← former FileExplorerPanel, unchanged logic
       └─ GitTab          ← new
            ├─ GitHeader (current branch, ahead/behind, refresh button)
            └─ SubTabs : [ Graph ] [ Status ] [ Branches ] [ Stash ]
```

Backend:

```
src/core/services/git/    ← new module, spawn('git', ...) wrapper
src/core/handlers/git.ts  ← new IPC handler registration
src/preload/ api.d.ts + index.ts  ← new `git` namespace on window.agent
```

Isolation rules (per project CLAUDE.md):

- Two distinct Zustand stores: `useRightSidebarStore` (just `activeTab`) and `useGitPanelStore` (git data + per-subtab loading/errors).
- No coupling between Preview and Git sub-panels beyond both reading the active conversation's CWD.
- No abstraction layer over `git`: the service exposes exactly the 9 functions the panel uses (including lazy commit detail) and no more.

## 6. Main Process — Git Service

### 6.1 Module layout

```
src/core/services/git/
  index.ts                    ← barrel, exports public API
  types.ts                    ← GitStatus, GitCommit, GitBranch, GitStashEntry, GitError
  spawn.ts                    ← runGit(cwd, args[], opts) => Promise<{stdout, stderr, code}>
  parsers.ts                  ← parseStatusPorcelainV2, parseLogFormat, parseBranchListFormat
  repo.ts                     ← isGitRepo(cwd)
  status.ts                   ← getStatus(cwd)
  log.ts                      ← getLogGraph(cwd, opts), getCommitDetail(cwd, sha)
  branches.ts                 ← listBranches(cwd)
  stash.ts                    ← listStash, stashSave, stashPop
  actions.ts                  ← checkoutBranch, fetch
  __fixtures__/               ← parser fixtures
```

### 6.2 Public API (10 functions)

| Function | Signature | Notes |
|---|---|---|
| `isGitRepo` | `(cwd: string \| null) => Promise<boolean>` | Uses `git rev-parse --git-dir`. Returns `false` for null/invalid cwd. |
| `getStatus` | `(cwd: string) => Promise<GitStatus>` | Porcelain v2 parsing. |
| `getLogGraph` | `(cwd: string, opts: { limit?: number; branch?: string }) => Promise<GitCommit[]>` | `--topo-order --pretty=format:…`. Default `limit = 500`. |
| `getCommitDetail` | `(cwd: string, sha: string) => Promise<{ body: string; files: GitCommitFile[] }>` | Lazy-loaded on click. `GitCommitFile` type is defined in §7 — distinct from `GitFileStatus` (working-tree state) because a file in a commit has one status (A/M/D/R/C), not two sides. |
| `listBranches` | `(cwd: string) => Promise<GitBranch[]>` | `git branch -vv --format=…` for both `refs/heads/` and `refs/remotes/`. |
| `listStash` | `(cwd: string) => Promise<GitStashEntry[]>` | `git stash list --pretty=…`. |
| `stashSave` | `(cwd: string, message?: string) => Promise<void>` | `git stash push -m <msg>`. Message optional. |
| `stashPop` | `(cwd: string, index: number) => Promise<void>` | `git stash pop stash@{<index>}`. |
| `checkoutBranch` | `(cwd: string, name: string) => Promise<void>` | Validates name exists via `git rev-parse`. Rejects non-existing with `GitError.not-found`. |
| `fetch` | `(cwd: string, remote?: string) => Promise<void>` | Timeout 30s (vs default 10s) due to network. |

Note: 10 functions total. Two more than the 8 originally brainstormed: `isGitRepo` (detection) and `getCommitDetail` (lazy body + changed-files loader).

### 6.3 Spawn constraints

- **Always** `spawn('git', args, { cwd, shell: false, env })`. Never `shell: true`. Never string interpolation into argv.
- Timeout 10s per command (30s for `fetch`). On timeout: kill process, reject with `GitError.timeout`.
- Env passed as-is plus `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0` (avoid prompts / lock contention).
- Stderr captured and included in `exec-failed` errors.

### 6.4 IPC layer

File: `src/core/handlers/git.ts`, pattern copied from `src/core/handlers/conversations.ts`:

```ts
export function registerGitHandlers(registrar: HandleRegistrar): void {
  registrar.handle('git:isRepo', async (_e, cwd) => isGitRepo(cwd))
  registrar.handle('git:status', async (_e, cwd) => getStatus(cwd))
  registrar.handle('git:logGraph', async (_e, cwd, opts) => getLogGraph(cwd, opts))
  registrar.handle('git:commitDetail', async (_e, cwd, sha) => getCommitDetail(cwd, sha))
  registrar.handle('git:branches', async (_e, cwd) => listBranches(cwd))
  registrar.handle('git:stashList', async (_e, cwd) => listStash(cwd))
  registrar.handle('git:checkout', async (_e, cwd, name) => checkoutBranch(cwd, name))
  registrar.handle('git:stashSave', async (_e, cwd, message) => stashSave(cwd, message))
  registrar.handle('git:stashPop', async (_e, cwd, index) => stashPop(cwd, index))
  registrar.handle('git:fetch', async (_e, cwd, remote) => fetch(cwd, remote))
}
```

Registered in `src/core/handlers/index.ts → registerCoreHandlers()` alongside the existing handlers.

### 6.5 Preload

New namespace on `window.agent.git` in both `src/preload/api.d.ts` (types) and `src/preload/index.ts` (impl). Each method is a thin `ipcRenderer.invoke` wrapper.

## 7. Data Contracts

Plain, JSON-serializable structures (no Date, no Map, no classes):

```ts
export interface GitFileStatus {
  path: string
  index: 'M'|'A'|'D'|'R'|'C'|'?'|' '     // staged side
  worktree: 'M'|'A'|'D'|'R'|'C'|'?'|' '  // unstaged side
  renamedFrom?: string
}

export interface GitStatus {
  branch: string | null          // null = detached HEAD
  upstream: string | null
  ahead: number
  behind: number
  detached: boolean
  files: GitFileStatus[]
  clean: boolean                 // files.length === 0
}

export interface GitCommit {
  sha: string
  shortSha: string
  parents: string[]              // full shas — required for graph layout
  subject: string
  body: string                   // empty string in list; populated by getCommitDetail
  authorName: string
  authorEmail: string
  authorDate: string             // ISO 8601
  refs: string[]                 // ["HEAD -> master", "origin/master", "tag: v1.0"]
}

export interface GitBranch {
  name: string
  isCurrent: boolean
  isRemote: boolean
  upstream: string | null
  ahead: number | null
  behind: number | null
  lastCommitSha: string
  lastCommitSubject: string
  lastCommitDate: string
}

export interface GitCommitFile {
  path: string
  status: 'A'|'M'|'D'|'R'|'C'       // added, modified, deleted, renamed, copied
  renamedFrom?: string               // set when status === 'R' or 'C'
}

export interface GitStashEntry {
  index: number                  // 0 = most recent
  message: string
  branch: string
  date: string
}

export type GitError =
  | { kind: 'not-a-repo' }
  | { kind: 'timeout'; cmd: string[] }
  | { kind: 'exec-failed'; cmd: string[]; code: number; stderr: string }
  | { kind: 'not-found'; target: string }
```

Graph-internal types (`src/renderer/components/panel/git/graph/types.ts`):

```ts
export interface GraphNode {
  commit: GitCommit
  x: number         // column index (0 = leftmost track)
  y: number         // row index = position in commits[]
  color: string     // e.g. 'var(--accent)'
}

export interface GraphEdge {
  from: GraphNode
  to: GraphNode
  kind: 'direct' | 'merge'
  color: string
}

export interface GraphLayout {
  nodes: GraphNode[]
  edges: GraphEdge[]
  columns: number
}
```

## 8. Renderer — Components & Store

### 8.1 File layout

```
src/renderer/components/panel/
  RightSidebarPanel.tsx          ← NEW: tab container, ~60 LOC
  PreviewTab.tsx                 ← the existing FileExplorerPanel, renamed. Zero logic change.
  git/
    index.tsx                    ← <GitTab />: header + sub-tab router
    GitHeader.tsx                ← branch, ahead/behind, refresh button
    GitGraph.tsx                 ← custom SVG DAG
    GitStatus.tsx                ← working-tree file list
    GitBranches.tsx              ← local + remote, click → checkout
    GitStash.tsx                 ← stash list, pop/save actions
    useGitRefresh.ts             ← hook with 3 refresh triggers
    graph/
      layout.ts                  ← pure function: commits → GraphLayout
      colors.ts                  ← palette of 6 CSS-var-based colors, cyclic
      types.ts                   ← GraphNode, GraphEdge, GraphLayout

src/renderer/stores/
  rightSidebarStore.ts           ← { activeTab, setActiveTab }
  gitPanelStore.ts               ← all git data + per-subtab loading/errors + actions
```

### 8.2 `RightSidebarPanel.tsx`

Minimal container. Pseudo-code:

```tsx
const { activeTab, setActiveTab } = useRightSidebarStore()
const cwd = useActiveConversationCwd()          // existing selector
const { isRepo, loading } = useIsGitRepo(cwd)   // new hook

return (
  <div className="flex flex-col h-full">
    <TabBar>
      <Tab active={activeTab === 'preview'} onClick={() => setActiveTab('preview')}>
        Preview
      </Tab>
      <Tab
        active={activeTab === 'git'}
        disabled={!isRepo}
        title={!isRepo ? 'Ce dossier n\'est pas un repo git' : undefined}
        onClick={() => isRepo && setActiveTab('git')}
      >
        Git {loading && <Spinner />}
      </Tab>
    </TabBar>
    {activeTab === 'preview' ? <PreviewTab /> : <GitTab />}
  </div>
)
```

### 8.3 `useGitPanelStore`

```ts
interface GitPanelState {
  activeSubTab: 'graph' | 'status' | 'branches' | 'stash'
  isRepoCache: { cwd: string; result: boolean; checkedAt: number } | null
  status: GitStatus | null
  commits: GitCommit[] | null
  branches: GitBranch[] | null
  stashes: GitStashEntry[] | null
  selectedCommitSha: string | null
  commitDetail: { sha: string; body: string; files: GitFileStatus[] } | null
  loading: { status: boolean; log: boolean; branches: boolean; stash: boolean }
  errors: {
    status: GitError | null
    log: GitError | null
    branches: GitError | null
    stash: GitError | null
    action: GitError | null
  }
  lastRefreshAt: number

  // actions
  setActiveSubTab: (tab: GitPanelState['activeSubTab']) => void
  refresh: () => Promise<void>              // parallel refresh of all 4 data fetches
  refreshOne: (key: 'status' | 'log' | 'branches' | 'stash') => Promise<void>
  selectCommit: (sha: string) => Promise<void>  // also loads commitDetail
  checkout: (branch: string) => Promise<void>
  stashSave: (message?: string) => Promise<void>
  stashPop: (index: number) => Promise<void>
  fetch: (remote?: string) => Promise<void>
  reset: () => void                         // on conversation change or cwd change
}
```

`refresh()` uses `Promise.allSettled` so one failing fetch doesn't kill the others.

### 8.4 `useGitRefresh` hook

Three triggers, all calling the same `refresh()`:

1. `useEffect([activeConversationId, activeTab])` — refresh when Git tab becomes active.
2. Subscription to the streaming bus: when a `Bash` tool-result chunk arrives and its command matches `/\bgit\s+\w/`, debounced 200ms → `refresh()`.
3. `window.addEventListener('focus', ...)` — refresh when the OS re-focuses the app.

### 8.5 Graph rendering (`GitGraph.tsx` + `graph/layout.ts`)

`layout(commits)` algorithm (pure, testable):

1. Iterate commits in the order returned by `git log --topo-order`.
2. Maintain `activeTracks: (sha | null)[]` — sha expected on each column.
3. For each commit C:
   - Column = index of the track whose expected sha is `C.sha` (or lowest free column if none).
   - Emit `GraphNode` at (column, rowIndex).
   - Clear that slot in `activeTracks`.
   - For each parent P of C:
     - First parent reuses C's column.
     - Subsequent parents get a new track (lowest free column).
     - Emit `GraphEdge` from the parent-to-be to C, kind = 'direct' for first parent, 'merge' otherwise.
4. Color of each track assigned cyclically from the 6-color palette defined in `graph/colors.ts`. Palette entries are CSS var references (`var(--accent)`, `var(--accent-2)`, etc.).

`GitGraph.tsx` renders an SVG:
- Width = `columns * trackWidth + padding`; height = `nodes.length * rowHeight`.
- Nodes: `<circle>` at (x, y), filled with node color, with short sha + subject text to the right.
- Edges: `<path d="…">` with the edge color. Straight segments for direct, curved for merges.
- Click on node → `selectCommit(sha)` → detail panel at the bottom.

### 8.6 Styling

- All colors via CSS custom properties. No hardcoded hex in `src/renderer/components/panel/git/**`. Verification: `grep -r "#[0-9a-fA-F]\{3,6\}" src/renderer/components/panel/git/` returns zero matches at PR time.
- Tints via `color-mix(in srgb, var(--xxx) NN%, transparent)` (same pattern as existing folder tinting).
- Status file icons use existing `--success` (staged), `--warning` (modified), `--danger` (deleted) vars.

## 9. Error Handling

Four error categories, four UI treatments:

| Error kind | Cause | UI response |
|---|---|---|
| `not-a-repo` | CWD has no `.git` tree | Git tab rendered disabled, tooltip "Ce dossier n'est pas un repo git" |
| `timeout` | Command > 10s (or 30s for fetch) | In-subtab red banner + Retry button. Other subtabs unaffected. |
| `exec-failed` | Git exited non-zero | Toast with short reason + collapsible `<details>` with full stderr. |
| `not-found` | Checkout of missing branch | Toast "Branche introuvable" + auto-refresh branch list. |

Isolation: `refresh()` uses `Promise.allSettled`. Each resolved/rejected result writes to its own `errors[key]` slot.

## 10. Edge Cases

- **CWD is null** → `isGitRepo` short-circuits to `false`. Git tab disabled with tooltip "Aucun dossier de travail".
- **Repo initialized during session** (`git init` via Bash tool) → `useGitRefresh` detects the Bash event, re-runs `isGitRepo`, tab becomes enabled live.
- **CWD changed during session** → `useIsGitRepo` watches `cwd` (not just `activeConversationId`), re-checks.
- **Detached HEAD** → `GitStatus.detached === true`. Header shows a ⚠️ badge; no blocking; subtabs remain functional.
- **Worktrees / submodules** → `git rev-parse --git-dir` handles these correctly, so detection works. Parsing is unchanged (porcelain v2 is stable across these).
- **Giant repos** (>500 commits) → Graph is capped at `limit: 500`. A "Load more" button extends the window in 500-commit chunks (post-v1 extension point; v1 stops at 500 with a note).
- **Concurrent streams** (two conversations streaming simultaneously) → Panel only shows the *active* conversation's state. Switch conversation → `reset()` + `refresh()`.

## 11. Safety Net (semi-interactive scope)

By construction, the following have **no IPC handler and no service function**:

- `git reset`, `git rebase`, `git merge`, `git commit`, `git push`
- `git branch -d`, `git branch -D`, `git tag -d`
- `git stash drop`, `git stash clear`
- `git clean`
- Any command accepting arbitrary argv from renderer.

Defense in depth: even if the renderer is compromised, the destructive surface is architecturally unreachable.

## 12. Testing Strategy

Three zones, each with distinct tooling:

### 12.1 Parsers (pure unit tests)

File: `src/core/services/git/parsers.test.ts`. Fixtures in `src/core/services/git/__fixtures__/` as `.txt` files:

- `status-clean.txt`, `status-modified-staged.txt`, `status-detached.txt`, `status-rename.txt`, `status-untracked.txt`
- `log-linear.txt`, `log-with-merge.txt`, `log-octopus.txt`, `log-multiple-branches.txt`
- `branches-with-tracking.txt`, `branches-detached.txt`, `branches-no-upstream.txt`
- `stash-empty.txt`, `stash-multiple.txt`

Target coverage: >90% lines for `parsers.ts`.

### 12.2 Service (integration, real git)

File: `src/core/services/git/service.integration.test.ts`. Pattern:

```ts
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'agent-git-test-'))
  await runGit(tmpDir, ['init', '-b', 'main'])
  await runGit(tmpDir, ['config', 'user.email', 'test@test'])
  await runGit(tmpDir, ['config', 'user.name', 'Test'])
  await runGit(tmpDir, ['commit', '--allow-empty', '-m', 'initial'])
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})
```

Covered scenarios:
- `isGitRepo`: true in tmpDir, false in `os.tmpdir()` root, false for null/undefined.
- `getStatus`: clean → add file → modified → `git add` → staged.
- `getLogGraph`: create 3 commits + 1 branch + 1 merge; verify `parents[]` and `refs[]`.
- `listBranches`: local + remote (simulated via a second tmpDir as remote).
- `checkoutBranch`: existing branch succeeds; non-existing rejects with `GitError.not-found`.
- `stashSave` + `stashPop`: round-trip with a modified file.
- `fetch`: **mocked**, not real-network. Unit test argv only.

### 12.3 Renderer (jsdom + React Testing Library)

- `RightSidebarPanel.test.tsx`: tab switching, disabled state when `isRepo === false`.
- `git/index.test.tsx`: subtab routing.
- `GitGraph.test.tsx`: snapshot of SVG output for a fixed layout; click-node → `selectCommit` called.
- `GitStatus.test.tsx`: renders files with correct icons.
- `GitBranches.test.tsx`: click on branch → `window.agent.git.checkout` called with correct args.
- `graph/layout.test.ts`: **pure**, no React. Linear, 2-branch merge, 3-way merge, octopus merge, detached. Snapshot of GraphLayout. Target coverage >95%.

Mocking: shared `createMockGitApi()` helper in `src/renderer/test-utils/`.

Coverage goals respect project thresholds (70% lines / 60% branches globally); critical pieces (`parsers`, `graph/layout`) exceed.

### 12.4 Out of scope

- Playwright e2e — not in current stack.
- Perf benchmarks — just one smoke test ensuring 500-commit layout completes < 100ms.

## 13. Accessibility

- Tab bar buttons are `<button>` elements with `aria-selected` and `aria-controls`.
- Disabled Git tab: `aria-disabled="true"` + `title` attribute for tooltip.
- Graph SVG: `role="img"` with `aria-label` summarizing ("Git graph, N commits, current branch X").
- Keyboard: left/right arrows switch tabs when focus is on the tab bar.

## 14. Cascade / Settings

Nothing to add to the settings cascade. The Git panel reads `Conversation.cwd` (with fallback to `Folder.default_cwd`), which already cascades per existing conventions. No new settings key, no DB schema change.

## 15. Migration / Backwards Compatibility

- Renaming `FileExplorerPanel.tsx → PreviewTab.tsx` is internal; the component is already consumed by only one parent. Update the import in that parent.
- No user-facing breaking change. Users who don't work in git repos see the tab disabled — same as if it didn't exist functionally.
- No data migration. No DB change.

## 16. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `git` binary not installed on user's system | Detect at first `isGitRepo` call (`spawn` error). If ENOENT, surface "Git non installé" in the Git tab and disable it globally for the session. |
| Porcelain v2 format changes across git versions | Version is stable since git 2.11 (2016). Parsers tested against known fixtures; any regression is caught in integration tests. |
| Graph layout slow on huge repos | Hard cap at 500 commits in v1; smoke test enforces <100ms. Extension point for "Load more" is designed but not implemented. |
| Checkout fails silently when working tree dirty | Rely on git's own refusal; capture stderr, show toast with the git error message verbatim. |
| Multiple rapid Bash events triggering storm of refreshes | 200ms debounce in `useGitRefresh`. |

## 17. Open Questions

None at spec-approval time. All clarifications resolved during brainstorming:

- Scope: semi-interactive (B).
- Graph rendering: custom SVG (B).
- Sub-tab layout: horizontal sub-tabs inside Git tab (C).
- Refresh strategy: event-based (B).

## 18. Summary of Deliverables

- 1 new module: `src/core/services/git/` (10 files incl. fixtures dir).
- 1 new handler file: `src/core/handlers/git.ts`, registered in `handlers/index.ts`.
- Preload updates: new `git` namespace in `api.d.ts` and `index.ts`.
- 1 new renderer container: `RightSidebarPanel.tsx`.
- 1 rename: `FileExplorerPanel.tsx → PreviewTab.tsx`.
- 1 new renderer module: `src/renderer/components/panel/git/` (~10 files).
- 2 new Zustand stores: `rightSidebarStore.ts`, `gitPanelStore.ts`.
- Tests: parsers (unit), service (integration, real git), renderer (jsdom), graph layout (pure unit).

Estimated scope: ~2500 LOC incl. tests.
