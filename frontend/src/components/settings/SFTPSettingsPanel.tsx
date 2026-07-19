import { useEffect, useState, type ReactNode } from 'react'
import { FolderTree, List, Save } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import type { SFTPSettings } from '@/lib/sftpSettings'

interface Props {
  settings: SFTPSettings
  onSave: (settings: SFTPSettings) => Promise<void>
}

export function SFTPSettingsPanel({ settings, onSave }: Props) {
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(settings), [settings])
  const update = (updates: Partial<SFTPSettings>) => setDraft((current) => ({ ...current, ...updates }))
  const save = async () => {
    setSaving(true)
    try { await onSave(draft) } catch (_error) { return } finally { setSaving(false) }
  }
  return <div className="flex flex-col gap-4 pt-2">
    <div><h2 className="text-lg font-semibold">SFTP 文件管理</h2><p className="mt-1 text-sm text-muted-foreground">控制远程文件面板的显示方式和目录联动行为。</p></div>
    <Card><CardHeader><CardTitle className="text-sm">文件显示</CardTitle><p className="mt-1 text-sm text-muted-foreground">选择远程目录内容的可见范围。</p></CardHeader><CardContent><SettingSwitch id="sftp-show-hidden" label="显示隐藏文件" description="显示名称以点号开头的文件和目录。" checked={draft.showHiddenFiles} onCheckedChange={(checked) => update({ showHiddenFiles: checked })} /></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-sm">目录联动</CardTitle><p className="mt-1 text-sm text-muted-foreground">让文件面板跟随当前终端所在的远程目录。</p></CardHeader><CardContent><SettingSwitch id="sftp-follow-terminal" label="追随终端目录" description="终端发送 OSC 7 工作目录信息时，文件面板自动切换到该目录。" checked={draft.followTerminalDirectory} onCheckedChange={(checked) => update({ followTerminalDirectory: checked })} /><Alert className="mt-4"><AlertDescription>如果远端 Shell 未发送工作目录信息，文件面板会保持当前目录。</AlertDescription></Alert></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-sm">默认视图</CardTitle><p className="mt-1 text-sm text-muted-foreground">每次打开 SFTP 文件面板时采用的初始视图。</p></CardHeader><CardContent><div role="group" aria-label="SFTP 默认视图" className="flex gap-2"><ViewButton active={draft.defaultView === 'list'} icon={<List />} label="列表视图" onClick={() => update({ defaultView: 'list' })} /><ViewButton active={draft.defaultView === 'tree'} icon={<FolderTree />} label="树状视图" onClick={() => update({ defaultView: 'tree' })} /></div></CardContent></Card>
    <div className="flex justify-end"><Button type="button" size="sm" disabled={saving} onClick={() => { void save() }}>{saving ? '保存中...' : <><Save data-icon="inline-start" />保存 SFTP 设置</>}</Button></div>
  </div>
}

function SettingSwitch({ id, label, description, checked, onCheckedChange }: { id: string; label: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <div className="flex items-start justify-between gap-4"><div><label htmlFor={id} className="text-sm font-medium">{label}</label><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><Switch id={id} checked={checked} onCheckedChange={onCheckedChange} /></div>
}

function ViewButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <Button type="button" variant={active ? 'secondary' : 'outline'} className="flex-1" onClick={onClick}>{icon}{label}</Button>
}
