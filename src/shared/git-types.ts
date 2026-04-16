export interface GitFileStatus {
  path: string
  index: 'M' | 'A' | 'D' | 'R' | 'C' | '?' | ' '
  worktree: 'M' | 'A' | 'D' | 'R' | 'C' | '?' | ' '
  renamedFrom?: string
}

export interface GitStatus {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  detached: boolean
  files: GitFileStatus[]
  clean: boolean
}

export interface GitCommit {
  sha: string
  shortSha: string
  parents: string[]
  subject: string
  body: string
  authorName: string
  authorEmail: string
  authorDate: string
  refs: string[]
}

export interface GitCommitFile {
  path: string
  status: 'A' | 'M' | 'D' | 'R' | 'C'
  renamedFrom?: string
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

export interface GitStashEntry {
  index: number
  message: string
  branch: string
  date: string
}

export type GitError =
  | { kind: 'not-a-repo' }
  | { kind: 'timeout'; cmd: string[] }
  | { kind: 'exec-failed'; cmd: string[]; code: number; stderr: string }
  | { kind: 'not-found'; target: string }
  | { kind: 'not-installed' }

export class GitOperationError extends Error {
  readonly error: GitError
  constructor(error: GitError) {
    super(`git: ${error.kind}`)
    this.name = 'GitOperationError'
    this.error = error
  }
}
