import { Component, createContext, useContext, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { logger } from '@/lib/logger'

interface Props {
  children: ReactNode
  onClose: () => void
}

interface State {
  failed: boolean
  retryKey: number
}

export type TerminalRuntimeErrorReporter = (error: unknown, source: string) => void

const TerminalRuntimeErrorContext = createContext<TerminalRuntimeErrorReporter>((error, source) => {
  logger.error('unscoped terminal runtime error', { source, error })
})

export function useTerminalRuntimeErrorReporter() {
  return useContext(TerminalRuntimeErrorContext)
}

export class TerminalErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, retryKey: 0 }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('terminal layer render error', error, info.componentStack)
  }

  private reportRuntimeError: TerminalRuntimeErrorReporter = (error, source) => {
    logger.error('terminal layer runtime error', { source, error })
    this.setState({ failed: true })
  }

  private retry = () => {
    this.setState((state) => ({ failed: false, retryKey: state.retryKey + 1 }))
  }

  render() {
    if (!this.state.failed) {
      return (
        <TerminalRuntimeErrorContext value={this.reportRuntimeError}>
          <div key={this.state.retryKey} className="contents">{this.props.children}</div>
        </TerminalRuntimeErrorContext>
      )
    }
    return (
      <div className="grid h-full w-full place-items-center bg-background p-6">
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>终端渲染失败</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={this.props.onClose}>关闭标签</Button>
            <Button onClick={this.retry}>重试</Button>
          </CardContent>
        </Card>
      </div>
    )
  }
}
