import { useEffect, useRef } from 'react'
import { useGitPanelStore } from '../../../stores/gitPanelStore'

export function useGitRefresh(cwd: string | null, active: boolean): void {
  const refresh = useGitPanelStore((s) => s.refresh)
  const debounced = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Trigger 1: tab becomes active or cwd changes
  useEffect(() => {
    if (!cwd || !active) return
    refresh(cwd)
  }, [cwd, active, refresh])

  // Trigger 2: window focus
  useEffect(() => {
    if (!cwd || !active) return
    const onFocus = () => refresh(cwd)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [cwd, active, refresh])

  // Trigger 3: Bash tool call completion involving git
  useEffect(() => {
    if (!cwd || !active) return
    const onBashResult = (event: Event) => {
      const detail = (event as CustomEvent<{ command: string }>).detail
      if (!detail?.command) return
      if (!/\bgit\s+\w/.test(detail.command)) return
      if (debounced.current) clearTimeout(debounced.current)
      debounced.current = setTimeout(() => refresh(cwd), 200)
    }
    window.addEventListener('agent:bash-tool-result', onBashResult as EventListener)
    return () => {
      window.removeEventListener('agent:bash-tool-result', onBashResult as EventListener)
      if (debounced.current) clearTimeout(debounced.current)
    }
  }, [cwd, active, refresh])
}
