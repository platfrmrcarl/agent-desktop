import { useEffect, useRef, useState } from 'react'

interface Cache { cwd: string; result: boolean; checkedAt: number }
const CACHE_TTL_MS = 30_000

let cache: Cache | null = null

export function useIsGitRepo(cwd: string | null): { isRepo: boolean; loading: boolean } {
  const [state, setState] = useState<{ isRepo: boolean; loading: boolean }>({
    isRepo: false,
    loading: cwd !== null,
  })
  const lastCwd = useRef<string | null>(null)

  useEffect(() => {
    if (cwd === null) {
      cache = null
      setState({ isRepo: false, loading: false })
      return
    }
    if (cache && cache.cwd === cwd && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
      setState({ isRepo: cache.result, loading: false })
      return
    }
    if (lastCwd.current === cwd) return
    lastCwd.current = cwd
    setState({ isRepo: false, loading: true })
    window.agent.git.isRepo(cwd).then((result) => {
      cache = { cwd, result, checkedAt: Date.now() }
      setState({ isRepo: result, loading: false })
    }).catch(() => {
      setState({ isRepo: false, loading: false })
    })
  }, [cwd])

  return state
}
