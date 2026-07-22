import { ArrowLeft, Cable, KeyRound, Network, ScrollText, Search, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import SessionTree from '@/components/session/SessionTree'
import QuickCommands from '@/components/session/QuickCommands'
import { SidebarDialogs } from '@/components/layout/SidebarDialogs'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { useResizablePanel } from '@/hooks/useResizablePanel'
import { useSidebarDialogs, useSidebarFilter, useSidebarMacros } from '@/hooks/useSidebarState'
import { useAppStore } from '@/store/appStore'
import { workspaceTabID } from '@/store/tabNavigation'
import { t } from '@/i18n'


const overviewItems = [
  { id: 'sessions', labelKey: '会话', icon: Server },
  { id: 'keys', labelKey: '密钥配置', icon: KeyRound },
  { id: 'tunnels', labelKey: '隧道配置', icon: Network },
  { id: 'serial', labelKey: '串口', icon: Cable },
  { id: 'audit', labelKey: '审计日志', icon: ScrollText },
] as const

function OverviewPanel() {
  const section = useAppStore((state) => state.overviewSection)
  const setSection = useAppStore((state) => state.setOverviewSection)
  const leaveOverview = useAppStore((state) => state.leaveOverview)
  return <div className="flex min-h-0 flex-1 flex-col p-2">
    <div className="px-2 pb-3 pt-1"><p className="text-sm font-semibold text-foreground">{t('总览')}</p><p className="text-xs text-muted-foreground">{t('资产与连接配置')}</p></div>
    <nav aria-label={t('总览导航')} className="flex flex-col gap-1">
      {overviewItems.map(({ id, labelKey, icon: Icon }) => <Button key={id} type="button" variant={section === id ? 'secondary' : 'ghost'} className="justify-start" aria-pressed={section === id} onClick={() => setSection(id)}><Icon data-icon="inline-start" />{t(labelKey)}</Button>)}
    </nav>
    <div className="mt-auto border-t border-border pt-2"><Button type="button" variant="ghost" className="w-full justify-start" onClick={leaveOverview}><ArrowLeft data-icon="inline-start" />{t('返回工作区')}</Button></div>
  </div>
}

function SessionPanel({ workspace, filter, editSession }: {
  workspace: ReturnType<typeof useSessionWorkspace>
  filter: ReturnType<typeof useSidebarFilter>
  editSession: ReturnType<typeof useSidebarDialogs>['editSession']
}) {
  const retry = () => { void Promise.all([workspace.listFolders(), workspace.listSessions()]) }
  const hasSessionData = workspace.folders.length > 0 || workspace.sessions.length > 0
  return <>
    <div className="flex flex-col gap-1.5 border-b border-border/50 px-2 py-2"><div className="relative"><Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={filter.searchQuery} onChange={(event) => filter.setSearchQuery(event.target.value)} placeholder={t('搜索会话...')} className="h-7 pl-7 text-xs" /></div></div>
    <div className="flex items-center justify-between border-b border-border/30 px-3 py-1"><span className="text-[11px] text-muted-foreground">{filter.searchQuery.trim() ? t('匹配 ${} 个会话', filter.filteredSessions.length) : t('共 ${} 个会话', workspace.sessions.length)}</span>{filter.searchQuery.trim() && <span className="text-[10px] text-muted-foreground/60">{t('已筛选')}</span>}</div>
    <div className="min-h-0 flex-1">
      {workspace.error ? <Alert variant="destructive" className="m-2"><AlertDescription>{workspace.error}<Button size="xs" variant="outline" className="mt-2" onClick={retry}>{t('重试')}</Button></AlertDescription></Alert> : !hasSessionData && workspace.loading ? <div className="flex flex-col gap-2 p-3"><Skeleton className="h-7 w-full" /><Skeleton className="h-7 w-4/5" /><Skeleton className="h-7 w-3/5" /></div> : <SessionTree folders={filter.filteredFolders} sessions={filter.filteredSessions} onConnect={workspace.connect} onEditSession={editSession} onSelectFolder={(id) => window.dispatchEvent(new CustomEvent('mssh:select-folder', { detail: id }))} navigationOnly revealAll={Boolean(filter.searchQuery.trim())} />}
    </div>
  </>
}

export default function Sidebar() {
  const activeTab = useAppStore((state) => state.workspaceTab)
  const overviewActive = useAppStore((state) => state.activeSurface?.type === 'workspace' && state.activeSurface.id === 'overview')
  const panel = useResizablePanel()
  const workspace = useSessionWorkspace()
  const dialogs = useSidebarDialogs(workspace)
  const filter = useSidebarFilter(workspace.folders, workspace.sessions)
  const macro = useSidebarMacros()
  return <div style={{ width: panel.displayedWidth }} className="relative shrink-0 transition-[width] duration-200 ease-out">
    <aside id="sidebar-navigation" style={{ width: panel.width }} aria-labelledby={workspaceTabID(activeTab)} aria-hidden={panel.collapsed} inert={panel.collapsed ? true : undefined} className={`relative flex h-full flex-col border-r border-border bg-card transition-transform duration-200 ease-out ${panel.collapsed ? '-translate-x-full pointer-events-none' : 'translate-x-0'}`}>
      {!panel.collapsed && <div {...panel.resizeHandleProps} className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/60 focus-visible:after:bg-primary active:after:bg-primary" />}
      {overviewActive ? <OverviewPanel /> : activeTab === 'sessions' ? <SessionPanel workspace={workspace} filter={filter} editSession={dialogs.editSession} /> : <div className="min-h-0 flex-1"><QuickCommands commands={macro.macros} onExecute={macro.execute} onAdd={macro.add} onDelete={macro.remove} showAddForm /></div>}
      <SidebarDialogs sessionDialogOpen={dialogs.sessionDialogOpen} onSessionOpenChange={(open) => { dialogs.setSessionDialogOpen(open); if (!open) dialogs.setEditingSession(null) }} editingSession={dialogs.editingSession} onSaveSession={dialogs.saveSession} folders={workspace.folders} environments={workspace.environments} projects={workspace.projects} assetTags={workspace.tags} onCreateEnvironment={workspace.createEnvironment} onCreateProject={workspace.createProject} onCreateTag={workspace.createTag} folderDialogOpen={dialogs.folderDialogOpen} onFolderOpenChange={(open) => { dialogs.setFolderDialogOpen(open); if (!open) { dialogs.setEditingFolder(null); dialogs.setFolderName('') } }} editingFolder={dialogs.editingFolder} folderName={dialogs.folderName} setFolderName={dialogs.setFolderName} onCreateOrUpdateFolder={dialogs.saveFolder} />
    </aside>
  </div>
}
