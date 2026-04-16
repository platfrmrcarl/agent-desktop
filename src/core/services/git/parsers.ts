import type { GitStatus, GitFileStatus, GitCommit, GitBranch, GitStashEntry } from '@shared/git-types'

export const LOG_FORMAT = '%H%x00%P%x00%s%x00%b%x00%an%x00%ae%x00%aI%x00%D%x1e'
export const BRANCH_FORMAT = '%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(objectname)%00%(contents:subject)%00%(committerdate:iso-strict)%00%(HEAD)'
export const STASH_FORMAT = '%gd%x00%gs%x00%gD%x00%cI'

const NUL = '\x00'
const RS = '\x1e'

export function parseStatusPorcelainV2(raw: string): GitStatus {
  const lines = raw.split('\n').filter(Boolean)
  let branch: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let detached = false
  const files: GitFileStatus[] = []

  for (const line of lines) {
    if (line.startsWith('# branch.head ')) {
      const v = line.slice('# branch.head '.length)
      if (v === '(detached)') { detached = true; branch = null }
      else branch = v
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length)
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/# branch\.ab \+(\d+) -(\d+)/)
      if (m) { ahead = Number(m[1]); behind = Number(m[2]) }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const isRename = line.startsWith('2 ')
      const parts = line.split(' ')
      const xy = parts[1]
      const index = (xy[0] === '.' ? '.' : xy[0]) as GitFileStatus['index']
      const worktree = (xy[1] === '.' ? '.' : xy[1]) as GitFileStatus['worktree']
      if (isRename) {
        const tail = parts.slice(9).join(' ')
        const [newPath, oldPath] = tail.split('\t')
        files.push({ path: newPath, index, worktree, renamedFrom: oldPath })
      } else {
        const path = parts.slice(8).join(' ')
        files.push({ path, index, worktree })
      }
    } else if (line.startsWith('? ')) {
      files.push({ path: line.slice(2), index: '?', worktree: '?' })
    }
  }

  return { branch, upstream, ahead, behind, detached, files, clean: files.length === 0 }
}

export function parseLogFormat(raw: string): GitCommit[] {
  if (!raw) return []
  const entries = raw.split(RS).filter(Boolean)
  return entries.map((entry) => {
    const [sha, parentsStr, subject, body, authorName, authorEmail, authorDate, refsStr] = entry.split(NUL)
    const parents = parentsStr ? parentsStr.split(' ').filter(Boolean) : []
    const refs = refsStr ? refsStr.split(',').map(s => s.trim()).filter(Boolean) : []
    return {
      sha,
      shortSha: sha.slice(0, 7),
      parents,
      subject: subject ?? '',
      body: body ?? '',
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authorDate: authorDate ?? '',
      refs,
    }
  })
}

export function parseBranchList(raw: string): GitBranch[] {
  if (!raw.trim()) return []
  const rows = raw.split('\n').filter(Boolean).map(line => line.split(NUL))
  // Remote-tracking branches are those referenced as upstreams by local branches
  const upstreamNames = new Set(rows.map(r => r[1]).filter(Boolean))
  return rows.map(([name, upstream, track, sha, subj, date, head]) => {
    const isRemote = upstreamNames.has(name)
    let ahead: number | null = null
    let behind: number | null = null
    if (track) {
      const ahm = track.match(/ahead (\d+)/)
      const bhm = track.match(/behind (\d+)/)
      ahead = ahm ? Number(ahm[1]) : 0
      behind = bhm ? Number(bhm[1]) : 0
    }
    return {
      name,
      isCurrent: head === '*',
      isRemote,
      upstream: upstream || null,
      ahead: upstream ? (ahead ?? 0) : null,
      behind: upstream ? (behind ?? 0) : null,
      lastCommitSha: sha,
      lastCommitSubject: subj,
      lastCommitDate: date,
    }
  })
}

export function parseStashList(raw: string): GitStashEntry[] {
  if (!raw.trim()) return []
  return raw.split('\n').filter(Boolean).map((line) => {
    const [gd, message, branch, date] = line.split(NUL)
    const m = gd.match(/stash@\{(\d+)\}/)
    return {
      index: m ? Number(m[1]) : 0,
      message,
      branch,
      date,
    }
  })
}
