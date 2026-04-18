import { Component, type ReactNode } from 'react'
import { useBugReportStore } from '../stores/bugReportStore'
import { rendererErrorBuffer } from '../bootstrap/rendererErrorCapture'

interface Props {
  fallback?: ReactNode
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

function ReportCrashButton({ error }: { error: Error | null }): JSX.Element {
  const open = useBugReportStore((s) => s.open)
  const handleClick = (): void => {
    if (error) {
      rendererErrorBuffer.push({
        timestamp: new Date().toISOString(),
        source: 'renderer',
        level: 'error',
        message: `UI crash: ${error.message}\n${error.stack ?? ''}`,
      })
    }
    open({ prefillDescription: error ? `UI crash: ${error.message}` : '' })
  }
  return (
    <button
      onClick={handleClick}
      className="mt-2 px-4 py-2 text-xs rounded"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}
    >
      Signaler ce crash
    </button>
  )
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div
          className="flex-1 flex items-center justify-center p-6"
          style={{ color: 'var(--color-error)' }}
        >
          <div className="text-center max-w-md">
            <p className="text-sm font-medium mb-2">Something went wrong</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {this.state.error?.message}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-4 px-4 py-2 text-xs rounded"
              style={{
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
            >
              Try again
            </button>
            <div>
              <ReportCrashButton error={this.state.error} />
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
