import { FileText, Keyboard, Plus, Shield, Terminal, Workflow } from 'lucide-react'
import { OverviewContent } from '@/components/layout/OverviewContent'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useAppStore } from '@/store/appStore'
import { WORKSPACE_PANEL_ID, workspaceTabID } from '@/store/tabNavigation'
import { APP_NEW_LOCAL_TERMINAL_EVENT, APP_NEW_SESSION_EVENT, emitAppEvent } from '@/lib/appEvents'
import { SESSION_QUICK_SEARCH_EVENT } from '@/lib/sessionQuickSearch'
import QuickCommands from '@/components/session/QuickCommands'
import { useEffect, useState } from 'react'
import { MacroService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { useShortcutStore } from '@/store/shortcutStore'
import { SHORTCUT_DEFINITIONS, formatChordDisplay } from '@/lib/shortcuts'

function WelcomeScreen() {
  return (
    <div className="flex min-h-0 flex-1 select-none flex-col items-center justify-center gap-6 bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-3">
          <Terminal className="h-10 w-10 text-primary" />
          <span className="text-4xl font-bold tracking-tight text-foreground">MSSH</span>
        </div>
        <span className="text-sm text-muted-foreground">{t('Secure Shell Client & Session Manager')}</span>
      </div>
      <div className="flex flex-col items-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button size="lg" onClick={() => emitAppEvent(APP_NEW_SESSION_EVENT)}>
            <Plus />{t('新建会话')}
          </Button>
          <Button size="lg" variant="outline" onClick={() => emitAppEvent(APP_NEW_LOCAL_TERMINAL_EVENT)}>
            <Terminal />{t('本地终端')}
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">{t('也可双击侧边栏会话列表中的主机开始连接')}</span>
      </div>
      <ShortcutCard />
      <div className="mt-2 flex gap-8">
        <Feature icon={Terminal} label={t('多标签终端')} />
        <Feature icon={FileText} label={t('会话录制')} />
        <Feature icon={Shield} label={t('密钥管理')} />
      </div>
    </div>
  )
}

function ShortcutCard() {
  const bindings = useShortcutStore((state) => state.bindings)
  const rows = SHORTCUT_DEFINITIONS.map((definition) => ({
    key: formatChordDisplay(bindings[definition.id]),
    label: t(definition.label),
    id: definition.id,
  }))
  return (
    <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-border bg-card/50 px-6 py-4">
      <div className="flex items-center gap-1.5 rounded-xl text-xs text-muted-foreground">
        <Keyboard className="h-3 w-3" />{t('快捷键')}
      </div>
      <span className="text-[10px] text-muted-foreground/70">{t('macOS 使用 ⌘，Windows/Linux 使用 Ctrl')}</span>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        {rows.flatMap((row) => [
          <span key={`${row.id}-k`} className="text-muted-foreground">{row.key}</span>,
          <span key={`${row.id}-l`} className="text-foreground/70">{row.label}</span>,
        ])}
      </div>
      <button type="button" className="text-xs text-primary hover:underline" onClick={() => window.dispatchEvent(new CustomEvent(SESSION_QUICK_SEARCH_EVENT))}>
        {t('打开快速搜索')}
      </button>
    </div>
  )
}

function Feature({ icon: Icon, label }: { icon: typeof Terminal; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Icon className="h-5 w-5 text-muted-foreground/50" />
      <span className="text-[11px] text-muted-foreground/50">{label}</span>
    </div>
  )
}


export async function executeMacroOnActiveTerminal(command: string) {
  const state = useAppStore.getState()
  const surface = state.activeSurface
  const tab = surface && surface.type === 'terminal'
    ? state.tabs.find((item) => item.id === surface.id)
    : state.tabs.find((item) => item.type === 'terminal')
  if (!tab || tab.type !== 'terminal') {
    toast(t('请先连接终端后再执行宏'), 'info')
    return
  }
  if (state.connectionStatus[tab.terminalId] !== 'connected') {
    toast(t('当前终端未连接，无法执行宏'), 'warning')
    return
  }
  try {
    await MacroService.Execute(tab.terminalId, command)
    toast(t('宏已发送到活动终端'), 'success')
  } catch (error: unknown) {
    toast(t('执行宏失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
  }
}

function MacrosWorkspace() {
  const [macros, setMacros] = useState<Array<{ id: string; name: string; shortcut: string; command: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reload = async () => {
    setLoading(true)
    setError('')
    try {
      const items = await MacroService.List()
      setMacros((items ?? []).map((item: { id: number | string; name: string; shortcut?: string; command: string }) => ({
        id: String(item.id),
        name: item.name,
        shortcut: item.shortcut ?? '',
        command: item.command,
      })))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      logger.error('macros workspace load failed', err)
      toast(t('加载宏失败: ${}', message), 'error')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void reload() }, [])
  if (loading) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t('加载宏...')}</div>
  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Workflow /></EmptyMedia>
            <EmptyTitle>{t('宏加载失败')}</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        <Button onClick={() => { void reload() }}>{t('重试')}</Button>
      </div>
    )
  }
  if (macros.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6" aria-label={t('宏工作区')}>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Workflow /></EmptyMedia>
            <EmptyTitle>{t('还没有宏')}</EmptyTitle>
            <EmptyDescription>{t('在侧边栏「宏」中新增命令，或在此管理快捷命令模板。')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        <Button variant="outline" onClick={() => useAppStore.getState().activateWorkspace('macros')}>{t('打开侧边栏宏面板')}</Button>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background p-4" aria-label={t('宏工作区')}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">{t('宏工作区')}</h2>
        <Button size="sm" variant="outline" onClick={() => { void reload() }}>{t('刷新')}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border">
        <QuickCommands
          commands={macros}
          showAddForm={false}
          onExecute={(command) => { void executeMacroOnActiveTerminal(command) }}
          onAdd={() => {}}
          onDelete={(id) => {
            void MacroService.Delete(Number(id)).then(reload).catch((error: unknown) => {
              toast(t('删除宏失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
            })
          }}
        />
      </div>
      {/* keep workspace connect available for empty states elsewhere */}
    </div>
  )
}

export function WorkspaceContent() {
  const activeSurface = useAppStore((state) => state.activeSurface)
  const workspaceTab = useAppStore((state) => state.workspaceTab)
  const active = activeSurface === null || activeSurface.type === 'workspace'

  return (
    <div
      id={WORKSPACE_PANEL_ID}
      data-layer-id="workspace"
      role="region"
      aria-labelledby={activeSurface?.type === 'workspace' ? workspaceTabID(activeSurface.id) : undefined}
      aria-hidden={!active}
      inert={active ? undefined : true}
      className={`absolute inset-0 flex flex-col ${active ? 'visible' : 'invisible pointer-events-none'}`}
    >
      {activeSurface === null
        ? <WelcomeScreen />
        : activeSurface.type === 'workspace' && activeSurface.id === 'overview'
          ? <OverviewContent />
          : workspaceTab === 'sessions'
            ? <WelcomeScreen />
            : <MacrosWorkspace />}
    </div>
  )
}
