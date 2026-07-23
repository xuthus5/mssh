import { useEffect, useState } from 'react'
import { KeyRound, Network, Server } from 'lucide-react'
import { KeyManager } from '@/components/settings/KeyManager'
import TunnelDialog from '@/components/session/TunnelDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useKeySettings } from '@/hooks/useSettings'
import { useSessionWorkspace } from '@/hooks/SessionWorkspaceContext'
import { useTunnelManager } from '@/hooks/useTunnelManager'
import { SessionAssetCenter } from '@/components/session/SessionAssetCenter'
import { useAppStore } from '@/store/appStore'
import { AuditPanel } from '@/components/layout/AuditPanel'
import { SerialPortCenter } from '@/components/serial/SerialPortCenter'
import { t } from '@/i18n'


export function OverviewContent() {
  const selected = useAppStore((state) => state.overviewSection)
  if (selected === 'keys') return <OverviewKeys />
  if (selected === 'tunnels') return <OverviewTunnels />
  if (selected === 'serial') return <SerialPortCenter />
  if (selected === 'audit') return <AuditPanel />
  return <SessionAssetCenter />
}

function OverviewKeys() {
  const settings = useKeySettings()
  return <section className="flex min-h-0 flex-1 flex-col overflow-auto bg-background p-5"><header className="mb-5 flex items-center gap-3"><KeyRound className="size-5 text-primary" /><div><h1 className="text-xl font-semibold">{t('密钥配置')}</h1><p className="text-sm text-muted-foreground">{t('管理 SSH 身份与公私钥材料')}</p></div><Badge variant="secondary" className="ml-auto">{settings.keys.length} {t('个密钥')}</Badge></header><Card><CardHeader><CardTitle className="text-sm">{t('SSH 密钥')}</CardTitle></CardHeader><CardContent><KeyManager keys={settings.keys} onGenerate={settings.generateKey} onImport={settings.importKey} onDelete={settings.deleteKey} onExport={settings.exportKey} onLoadMaterial={settings.loadKeyMaterial} onUpdate={settings.updateKey} onSelectImportFile={settings.selectKeyImportFile} /></CardContent></Card></section>
}

function OverviewTunnels() {
  const workspace = useSessionWorkspace()
  const [sessionID, setSessionID] = useState(workspace.sessions[0]?.id ?? '')
  const [open, setOpen] = useState(false)
  const manager = useTunnelManager(sessionID ? Number(sessionID) : undefined)
  useEffect(() => { if (!workspace.sessions.some((session) => session.id === sessionID)) setSessionID(workspace.sessions[0]?.id ?? '') }, [sessionID, workspace.sessions])
  useEffect(() => { void manager.load() }, [manager.load])
  const selectedSession = workspace.sessions.find((session) => session.id === sessionID)
  return <section className="flex min-h-0 flex-1 flex-col overflow-auto bg-background p-5"><header className="mb-5 flex items-center gap-3"><Network className="size-5 text-primary" /><div><h1 className="text-xl font-semibold">{t('隧道配置')}</h1><p className="text-sm text-muted-foreground">{t('按会话管理本地、远程和动态转发')}</p></div></header><Card><CardHeader className="flex flex-row items-center justify-between gap-4"><CardTitle className="text-sm">{t('隧道列表')}</CardTitle><div className="flex items-center gap-2"><LabeledSelect ariaLabel={t('隧道所属会话')} value={sessionID} options={workspace.sessions.map((session) => ({ value: session.id, label: session.name }))} onValueChange={setSessionID} /><Button type="button" disabled={!selectedSession} onClick={() => setOpen(true)}>{t('管理隧道')}</Button></div></CardHeader><CardContent>{selectedSession ? <TunnelTable tunnels={manager.tunnels} /> : <div className="flex items-center gap-3 text-sm text-muted-foreground"><Server className="size-4" />{t('请先创建会话')}</div>}</CardContent></Card><TunnelDialog open={open} onOpenChange={setOpen} tunnels={manager.tunnels} onStart={manager.start} onStop={manager.stop} onDelete={manager.remove} sessionId={sessionID} /></section>
}

function TunnelTable({ tunnels }: { tunnels: ReturnType<typeof useTunnelManager>['tunnels'] }) {
  return <div className="rounded-xl border"><Table><TableHeader><TableRow><TableHead>{t('类型')}</TableHead><TableHead>{t('本地端点')}</TableHead><TableHead>{t('远程端点')}</TableHead><TableHead>{t('状态')}</TableHead></TableRow></TableHeader><TableBody>{tunnels.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t('当前会话暂无隧道')}</TableCell></TableRow> : tunnels.map((tunnel) => <TableRow key={tunnel.id}><TableCell>{tunnelTypeLabel(tunnel.type)}</TableCell><TableCell>{tunnel.localAddress}:{tunnel.localPort}</TableCell><TableCell>{tunnel.type === 'dynamic' ? '-' : `${tunnel.remoteAddress}:${tunnel.remotePort}`}</TableCell><TableCell><Badge variant={tunnel.running ? 'default' : 'outline'}>{tunnel.running ? t('运行中') : t('已停止')}</Badge></TableCell></TableRow>)}</TableBody></Table></div>
}

function tunnelTypeLabel(type: 'local' | 'remote' | 'dynamic') {
  return ({ local: t('本地转发'), remote: t('远程转发'), dynamic: t('动态转发') })[type]
}
