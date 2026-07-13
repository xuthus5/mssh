import { FileText, Keyboard, Shield, Terminal } from 'lucide-react'
import { SessionAssetCenter } from '@/components/session/SessionAssetCenter'
import { useAppStore } from '@/store/appStore'
import { WORKSPACE_PANEL_ID, workspaceTabID } from '@/store/tabNavigation'

function WelcomeScreen() {
  return (
    <div className="flex min-h-0 flex-1 select-none flex-col items-center justify-center gap-6 bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-3">
          <Terminal className="h-10 w-10 text-primary" />
          <span className="text-4xl font-bold tracking-tight text-foreground">MSSH</span>
        </div>
        <span className="text-sm text-muted-foreground">Secure Shell Client & Session Manager</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="text-sm text-muted-foreground">双击会话列表中的主机开始连接</span>
        <span className="text-xs text-muted-foreground/60">或使用侧边栏新建会话</span>
      </div>
      <ShortcutCard />
      <div className="mt-2 flex gap-8">
        <Feature icon={Terminal} label="多标签终端" />
        <Feature icon={FileText} label="会话录制" />
        <Feature icon={Shield} label="密钥管理" />
      </div>
    </div>
  )
}

function ShortcutCard() {
  return (
    <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-border bg-card/50 px-6 py-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Keyboard className="h-3 w-3" />快捷键
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Ctrl+N</span><span className="text-foreground/70">新建会话</span>
        <span className="text-muted-foreground">Ctrl+W</span><span className="text-foreground/70">关闭标签页</span>
        <span className="text-muted-foreground">Ctrl+Shift+C</span><span className="text-foreground/70">复制</span>
        <span className="text-muted-foreground">Ctrl+Shift+V</span><span className="text-foreground/70">粘贴</span>
        <span className="text-muted-foreground">Ctrl+Shift+L</span><span className="text-foreground/70">清屏</span>
      </div>
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

  return (
    <div
      id={WORKSPACE_PANEL_ID}
      data-layer-id="workspace"
      role="tabpanel"
      aria-labelledby={activeSurface?.type === 'workspace' ? workspaceTabID(activeSurface.id) : undefined}
      aria-hidden={!active}
      inert={active ? undefined : true}
      className={`absolute inset-0 flex flex-col ${active ? 'visible' : 'invisible pointer-events-none'}`}
    >
      {activeSurface === null
        ? <WelcomeScreen />
        : workspaceTab === 'sessions'
          ? <SessionAssetCenter />
          : <div aria-label="宏工作区" className="flex-1 bg-background" />}
    </div>
  )
}
