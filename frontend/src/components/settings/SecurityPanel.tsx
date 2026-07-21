import { useCallback, useEffect, useState } from 'react'
import { Fingerprint, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SessionService } from '@/lib/wails'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'


type HostKeyEntry = { line: number; hosts: string; algorithm: string; fingerprint: string }

export function SecurityPanel() {
  const [entries, setEntries] = useState<HostKeyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try { setEntries(await SessionService.ListHostKeys()) }
    catch (error) { toast(t('加载主机指纹失败: ${}', error instanceof Error ? error.message : String(error)), 'error') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const remove = async (entry: HostKeyEntry) => {
    if (!window.confirm(t('删除 ${} 的已信任主机指纹？下次连接时将重新确认。', entry.hosts))) return
    try { await SessionService.DeleteHostKey(entry.line); await load(); toast(t('主机指纹已删除'), 'success') }
    catch (error) { toast(t('删除主机指纹失败: ${}', error instanceof Error ? error.message : String(error)), 'error') }
  }
  return <div className="space-y-4 pt-2"><Card><CardHeader className="flex-row items-start justify-between"><div><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4"/>{t('已信任主机')}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{t('管理 SSH known_hosts 指纹。指纹变化时连接会被阻止。')}</p></div><Button size="icon-sm" variant="outline" aria-label={t('刷新主机指纹')} onClick={() => void load()}><RefreshCw/></Button></CardHeader><CardContent className="space-y-2">{loading?<p className="text-sm text-muted-foreground">{t('正在加载主机指纹...')}</p>:entries.length===0?<p className="text-sm text-muted-foreground">{t('尚未信任任何 SSH 主机。')}</p>:entries.map(entry=><div key={`${entry.line}-${entry.fingerprint}`} className="flex items-center gap-3 rounded-xl border border-border p-3"><Fingerprint className="size-4 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{entry.hosts}</div><div className="truncate font-mono text-xs text-muted-foreground">{entry.algorithm} · {entry.fingerprint}</div></div><Button size="icon-xs" variant="ghost" aria-label={t('删除 ${} 的主机指纹', entry.hosts)} onClick={() => void remove(entry)}><Trash2/></Button></div>)}</CardContent></Card></div>
}
