import { useRef, type ReactNode } from 'react'
import { FileText, Keyboard, Plus, Shield, Terminal } from 'lucide-react'
import { OverviewContent } from '@/components/layout/OverviewContent'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/appStore'
import { WORKSPACE_PANEL_ID, workspaceTabID } from '@/store/tabNavigation'
import { APP_NEW_LOCAL_TERMINAL_EVENT, APP_NEW_SESSION_EVENT, emitAppEvent } from '@/lib/appEvents'
import { SESSION_QUICK_SEARCH_EVENT } from '@/lib/sessionQuickSearch'
import { t } from '@/i18n'
import { MacrosWorkspace } from '@/components/layout/MacrosWorkspace'

export { executeMacroOnActiveTerminal } from '@/lib/executeMacro'
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
export function WorkspaceContent() {
  const activeSurface = useAppStore((state) => state.activeSurface)
  const workspaceTab = useAppStore((state) => state.workspaceTab)
  const active = activeSurface === null || activeSurface.type === 'workspace'
  const overviewActive = activeSurface?.type === 'workspace' && activeSurface.id === 'overview'
  const macrosActive = !overviewActive && activeSurface !== null && workspaceTab === 'macros'
  const welcomeActive = activeSurface === null || !overviewActive && workspaceTab === 'sessions'
  const overviewVisited = useRef(false)
  const macrosVisited = useRef(false)
  if (overviewActive) overviewVisited.current = true
  if (macrosActive) macrosVisited.current = true

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
      {welcomeActive ? <WelcomeScreen /> : null}
      {overviewVisited.current ? <WorkspaceLayer active={overviewActive}><OverviewContent /></WorkspaceLayer> : null}
      {macrosVisited.current ? <WorkspaceLayer active={macrosActive}><MacrosWorkspace /></WorkspaceLayer> : null}
    </div>
  )
}

function WorkspaceLayer({ active, children }: { active: boolean; children: ReactNode }) {
  return <div hidden={!active} inert={active ? undefined : true} aria-hidden={!active} className="flex min-h-0 flex-1 flex-col">
    {children}
  </div>
}
