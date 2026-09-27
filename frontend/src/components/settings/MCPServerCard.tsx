import { useCallback, useEffect, useState } from 'react'
import { Copy, Plug, PlugZap, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { toast } from '@/components/ui/toast'
import { getClipboard } from '@/lib/clipboard'
import { AIService, SessionService } from '@/lib/wails'
import { t } from '@/i18n'
import { AIMCPServerInput, type AIMCPServerStatus, type Session } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

interface MCPServerController {
  status: AIMCPServerStatus | null
  sessions: Session[]
  sessionID: number
  port: string
  pending: string | null
  error: string
  setupCommand: string
  selectSession: (value: string) => void
  changePort: (value: string) => void
  start: () => void
  stop: () => void
  regenerate: () => void
  copyToken: () => void
  copySetupCommand: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function useMCPServerState() {
  const [status, setStatus] = useState<AIMCPServerStatus | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionID, setSessionID] = useState(0)
  const [port, setPort] = useState('')
  const [error, setError] = useState('')
  const applyStatus = useCallback((next: AIMCPServerStatus) => {
    setStatus(next)
    setSessionID(next.session_id)
    setPort(next.port > 0 ? String(next.port) : '')
  }, [])
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [nextStatus, nextSessions] = await Promise.all([AIService.GetAgentMCPServerStatus(), SessionService.ListSessions(null)])
        if (!active) return
        applyStatus(nextStatus)
        setSessions(nextSessions ?? [])
      } catch (loadError) {
        if (active) setError(errorMessage(loadError))
      }
    })()
    return () => { active = false }
  }, [applyStatus])
  return { status, sessions, sessionID, setSessionID, port, setPort, error, setError, applyStatus }
}

function useMCPCopyActions(run: (name: string, action: () => Promise<void>) => Promise<void>, status: AIMCPServerStatus | null, setupCommand: string) {
  const copyToken = useCallback(() => {
    void run('copy', async () => {
      if (!status?.token) return
      await getClipboard().writeText(status.token)
      toast(t('已复制 MCP Token'), 'success')
    })
  }, [run, status])
  const copySetupCommand = useCallback(() => {
    void run('setup', async () => {
      if (!setupCommand) return
      await getClipboard().writeText(setupCommand)
      toast(t('已复制接入命令'), 'success')
    })
  }, [run, setupCommand])
  return { copyToken, copySetupCommand }
}

function useMCPServerController(): MCPServerController {
  const state = useMCPServerState()
  const { applyStatus, setError } = state
  const [pending, setPending] = useState<string | null>(null)
  const run = useCallback(async (name: string, action: () => Promise<void>) => {
    setPending(name)
    setError('')
    try {
      await action()
    } catch (actionError) {
      setError(errorMessage(actionError))
    } finally {
      setPending(null)
    }
  }, [setError])
  const start = useCallback(() => {
    void run('start', async () => {
      const parsedPort = state.port.trim() === '' ? 0 : Number(state.port)
      if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) throw new Error(t('端口需在 0 到 65535 之间'))
      applyStatus(await AIService.StartAgentMCPServer(new AIMCPServerInput({ session_id: state.sessionID, port: parsedPort })))
    })
  }, [applyStatus, run, state.port, state.sessionID])
  const stop = useCallback(() => {
    void run('stop', async () => {
      await AIService.StopAgentMCPServer()
      applyStatus(await AIService.GetAgentMCPServerStatus())
    })
  }, [applyStatus, run])
  const regenerate = useCallback(() => {
    void run('regenerate', async () => { applyStatus(await AIService.RegenerateAgentMCPToken()) })
  }, [applyStatus, run])
  const setupCommand = state.status?.token && state.status.url
    ? `cmdc mcp add --transport http --scope user --header "Authorization: Bearer ${state.status.token}" mssh ${state.status.url}`
    : ''
  const { copyToken, copySetupCommand } = useMCPCopyActions(run, state.status, setupCommand)
  return {
    status: state.status, sessions: state.sessions, sessionID: state.sessionID, port: state.port,
    pending, error: state.error, setupCommand, selectSession: (value) => state.setSessionID(Number(value)),
    changePort: (value) => state.setPort(value), start, stop, regenerate, copyToken, copySetupCommand,
  }
}

export function MCPServerCard() {
  const controller = useMCPServerController()
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm">{t('MCP 服务')}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t('开启后外部 CLI 可通过本机地址与 Token 接入 MSSH MCP。')}</p>
        </div>
        <Button size="sm" variant="outline" disabled={controller.pending !== null} onClick={controller.regenerate}>
          <RefreshCw data-icon="inline-start" className={controller.pending === 'regenerate' ? 'animate-spin' : ''} />
          {t('重新生成 Token')}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        <MCPBindingRow controller={controller} />
        <MCPEndpointRow controller={controller} />
        {controller.error ? <p className="text-xs text-destructive" role="alert">{controller.error}</p> : null}
      </CardContent>
    </Card>
  )
}

function MCPBindingRow({ controller }: { controller: MCPServerController }) {
  return <div className="grid gap-2 md:grid-cols-2">
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{t('绑定会话')}</span>
      <LabeledSelect value={String(controller.sessionID)} onValueChange={controller.selectSession} ariaLabel={t('绑定会话')} options={controller.sessions.map((session) => ({ value: String(session.id), label: session.name }))} />
    </div>
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{t('监听端口（0 为随机端口）')}</span>
      <Input value={controller.port} onChange={(event) => controller.changePort(event.target.value)} inputMode="numeric" placeholder="0" aria-label={t('监听端口')} disabled={controller.status?.running === true} />
    </div>
  </div>
}

function MCPEndpointRow({ controller }: { controller: MCPServerController }) {
  const running = controller.status?.running === true
  const canStart = running || controller.sessionID > 0
  return <div className="rounded-lg border border-border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
        {running ? <PlugZap className="size-4 shrink-0 text-emerald-600" /> : <Plug className="size-4 shrink-0 text-muted-foreground" />}
        <span className="truncate">{running ? controller.status?.url : t('MCP 服务未启动')}</span>
      </span>
      <span className="flex gap-2">
        <Button size="sm" disabled={controller.pending !== null || !running} onClick={controller.copyToken}>
          <Copy data-icon="inline-start" />
          {t('复制 Token')}
        </Button>
        <Button size="sm" variant={running ? 'destructive' : 'default'} disabled={controller.pending !== null || !canStart} onClick={running ? controller.stop : controller.start}>
          {running ? t('停止') : t('启动')}
        </Button>
      </span>
    </div>
    {controller.status?.token ? <div className="mt-2 grid gap-1">
      <code className="truncate font-mono text-xs text-foreground" title={`Authorization: Bearer ${controller.status.token}`}>Authorization: Bearer {controller.status.token}</code>
      <p className="text-xs text-muted-foreground">{t('在外部 CLI 的 MCP 配置中，将上方地址填为 url，并在请求头加入上面的 Authorization。')}</p>
      {controller.setupCommand ? <>
        <span className="mt-1 text-xs text-muted-foreground">{t('接入命令（以 Command Code 为例）')}</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={controller.setupCommand}>{controller.setupCommand}</code>
          <Button size="sm" variant="outline" disabled={controller.pending !== null} onClick={controller.copySetupCommand}>{t('复制接入命令')}</Button>
        </div>
      </> : null}
    </div> : null}
  </div>
}
