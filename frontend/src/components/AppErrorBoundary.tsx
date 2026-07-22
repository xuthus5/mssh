import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
  retryKey: number
}

/** Root render boundary so a single component crash does not blank the whole window. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, retryKey: 0 }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('application render error', error, info.componentStack)
  }

  private retry = () => {
    this.setState((state) => ({ failed: false, retryKey: state.retryKey + 1 }))
  }

  private reload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.failed) {
      return <div key={this.state.retryKey} className="contents">{this.props.children}</div>
    }
    return (
      <div className="grid h-screen w-screen place-items-center bg-background p-6 text-foreground">
        <Card role="alert" className="w-full max-w-md shadow-sm">
          <CardHeader>
            <CardTitle>{t('应用渲染失败')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('页面遇到意外错误。你可以重试恢复，或重新加载应用。')}</p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={this.reload}>{t('重新加载')}</Button>
              <Button onClick={this.retry}>{t('重试')}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }
}
