import { FileText, Keyboard, Plus, Shield, Terminal, Workflow } from 'lucide-react'
import { OverviewContent } from '@/components/layout/OverviewContent'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useAppStore } from '@/store/appStore'
import { WORKSPACE_PANEL_ID, workspaceTabID } from '@/store/tabNavigation'
import { APP_NEW_SESSION_EVENT, emitAppEvent } from '@/lib/appEvents'
import { SESSION_QUICK_SEARCH_EVENT } from '@/lib/sessionQuickSearch'
import QuickCommands from '@/components/session/QuickCommands'
import { useEffect, useState } from 'react'
import { MacroService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { t } from '@/lib/uiText'

function platformModKey(): string {
  if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)) return '⌘'
  return 'Ctrl'
}

function WelcomeScreen() {
  const mod = platformModKey()
  return (
    <div className="flex min-h-0 flex-1 select-none flex-col items-center justify-center gap-6 bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-3">
          <Terminal className="h-10 w-10 text-primary" />
          <span className="text-4xl font-bold tracking-tight text-foreground">MSSH</span>
        </div>
        <span className="text-sm text-muted-foreground">{t('welcomeTagline')}</span>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Button size="lg" onClick={() => emitAppEvent(APP_NEW_SESSION_EVENT)}>
          <Plus />{t('newSession')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('welcomeHint')}</span>
      </div>
      <ShortcutCard mod={mod} />
      <div className="mt-2 flex gap-8">
        <Feature icon={Terminal} label={t('featureMultiTab')} />
        <Feature icon={FileText} label={t('featureRecording')} />
        <Feature icon={Shield} label={t('featureKeys')} />
      </div>
    </div>
  )
}

function ShortcutCard({ mod }: { mod: string }) {
  const rows = [
    [`${mod}+N`, t('newSession')],
    [`${mod}+W`, '关闭标签页'],
    [`${mod}+F`, '快速搜索会话'],
    [`${mod}+Shift+C`, '复制'],
    [`${mod}+Shift+V`, '粘贴'],
    [`${mod}+Shift+L`, '清屏'],
  ]
  return (
    <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-border bg-card/50 px-6 py-4">
      <div className="flex items-center gap-1.5 rounded-xl text-xs text-muted-foreground">
        <Keyboard className="h-3 w-3" />{t('shortcuts')}
      </div>
      <span className="text-[10px] text-muted-foreground/70">{t('shortcutsPlatformHint')}</span>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        {rows.flatMap(([key, label]) => [
          <span key={`${key}-k`} className="text-muted-foreground">{key}</span>,
          <span key={`${key}-l`} className="text-foreground/70">{label}</span>,
        ])}
      </div>
      <button type="button" className="text-xs text-primary hover:underline" onClick={() => window.dispatchEvent(new CustomEvent(SESSION_QUICK_SEARCH_EVENT))}>
        {t('openQuickSearch')}
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
    toast(t('macrosNeedTerminal'), 'info')
    return
  }
  if (state.connectionStatus[tab.terminalId] !== 'connected') {
    toast(t('macrosTerminalDisconnected'), 'warning')
    return
  }
  try {
    await MacroService.Execute(tab.terminalId, command)
    toast(t('macrosSent'), 'success')
  } catch (error: unknown) {
    toast(`${t('macrosExecuteFailed')}: ${error instanceof Error ? error.message : String(error)}`, 'error')
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
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void reload() }, [])
  if (loading) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t('macrosLoading')}</div>
  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Workflow /></EmptyMedia>
            <EmptyTitle>{t('macrosLoadFailed')}</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        <Button onClick={() => { void reload() }}>{t('retry')}</Button>
      </div>
    )
  }
  if (macros.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6" aria-label="宏工作区">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Workflow /></EmptyMedia>
            <EmptyTitle>{t('macrosEmptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('macrosEmptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        <Button variant="outline" onClick={() => useAppStore.getState().activateWorkspace('macros')}>{t('macrosOpenSidebar')}</Button>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background p-4" aria-label="宏工作区">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">{t('macrosWorkspaceTitle')}</h2>
        <Button size="sm" variant="outline" onClick={() => { void reload() }}>{t('macrosRefresh')}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border">
        <QuickCommands
          commands={macros}
          showAddForm={false}
          onExecute={(command) => { void executeMacroOnActiveTerminal(command) }}
          onAdd={() => {}}
          onDelete={(id) => {
            void MacroService.Delete(Number(id)).then(reload).catch((error: unknown) => {
              toast(`删除宏失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
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
