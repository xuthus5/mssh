import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Fingerprint, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { SecurityService, SessionService } from '@/lib/wails'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import type { SecurityStatus } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

type HostKeyEntry = { line: number; hosts: string; algorithm: string; fingerprint: string }

const emptyStatus: SecurityStatus = {
  configured: false,
  unlocked: false,
  require_password_on_launch: false,
  remember_unlock: true,
  updated_at: '',
}

export function SecurityPanel() {
  const [status, setStatus] = useState<SecurityStatus>(emptyStatus)
  const [entries, setEntries] = useState<HostKeyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [requireLaunch, setRequireLaunch] = useState(false)
  const [rememberUnlock, setRememberUnlock] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmAction, setConfirmAction] = useState<null | { type: 'rotate' } | { type: 'host'; entry: HostKeyEntry }>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await SecurityService.Status()
      setStatus(next)
      setRequireLaunch(next.require_password_on_launch)
      setRememberUnlock(next.remember_unlock)
      setEntries(await SessionService.ListHostKeys())
    } catch (error) {
      toast(t('加载安全设置失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const run = async (action: string, operation: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await operation()
      await load()
      toast(action, 'success')
      setPassword(''); setConfirmPassword(''); setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword('')
    } catch (error) {
      toast(t('${}失败: ${}', action, error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      setBusy(false)
    }
  }

  const setupPassword = () => {
    if (password.length < 12) return toast(t('应用密码至少需要 12 个字符'), 'error')
    if (password !== confirmPassword) return toast(t('两次输入的密码不一致'), 'error')
    void run(t('应用密码已设置'), () => SecurityService.Setup({
      password, require_password_on_launch: requireLaunch, remember_unlock: rememberUnlock,
    }))
  }

  const rotatePassword = () => {
    if (newPassword.length < 12) return toast(t('应用密码至少需要 12 个字符'), 'error')
    if (newPassword !== confirmNewPassword) return toast(t('两次输入的密码不一致'), 'error')
    setConfirmAction({ type: 'rotate' })
  }

  const savePreferences = (nextRequireLaunch: boolean, nextRememberUnlock: boolean) => {
    setRequireLaunch(nextRequireLaunch)
    setRememberUnlock(nextRememberUnlock)
    if (!status.configured) return
    void run(t('安全偏好已保存'), () => SecurityService.SavePreferences({
      require_password_on_launch: nextRequireLaunch, remember_unlock: nextRememberUnlock,
    }))
  }

  const remove = (entry: HostKeyEntry) => {
    setConfirmAction({ type: 'host', entry })
  }

  const confirmSecurityAction = async () => {
    if (!confirmAction) return
    if (confirmAction.type === 'rotate') {
      setConfirmAction(null)
      void run(t('应用密码已轮转'), () => SecurityService.Rotate({
        current_password: currentPassword, new_password: newPassword,
      }))
      return
    }
    try {
      await SessionService.DeleteHostKey(confirmAction.entry.line)
      setConfirmAction(null)
      await load()
      toast(t('主机指纹已删除'), 'success')
    } catch (error) {
      toast(t('删除主机指纹失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    }
  }

  return (
    <div className="space-y-4 pt-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" />{t('应用密码')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('统一保护本机敏感数据与云同步备份。轮转密码会触发数据重新加密；非同设备若密码不一致将导致同步失败。')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p>{t('状态：${}', status.configured ? (status.unlocked ? t('已配置 · 已解锁') : t('已配置 · 已锁定')) : t('未配置'))}</p>
            {status.updated_at ? <p>{t('最近更新：${}', status.updated_at)}</p> : null}
            <p>{t('同步与加密导出依赖此密码派生的数据密钥，请在所有设备保持一致。')}</p>
          </div>

          {!status.configured ? (
            <div className="space-y-3">
              <Field label={t('设置应用密码')}>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('至少 12 个字符')} aria-label={t('设置应用密码')} />
              </Field>
              <Field label={t('确认应用密码')}>
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} aria-label={t('确认应用密码')} />
              </Field>
              <PreferenceToggles requireLaunch={requireLaunch} rememberUnlock={rememberUnlock} onRequireLaunch={setRequireLaunch} onRememberUnlock={setRememberUnlock} />
              <Button size="sm" disabled={busy || loading} onClick={setupPassword}>{t('创建应用密码')}</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label={t('当前密码')}>
                <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} aria-label={t('当前密码')} />
              </Field>
              <Field label={t('新密码')}>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('至少 12 个字符')} aria-label={t('新密码')} />
              </Field>
              <Field label={t('确认新密码')}>
                <Input type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} aria-label={t('确认新密码')} />
              </Field>
              <PreferenceToggles requireLaunch={requireLaunch} rememberUnlock={rememberUnlock} onRequireLaunch={(value) => savePreferences(value, rememberUnlock)} onRememberUnlock={(value) => savePreferences(requireLaunch, value)} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={rotatePassword}>{t('轮转密码并重加密')}</Button>
                {status.unlocked ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(t('已锁定'), () => SecurityService.Lock())}>{t('锁定')}</Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy || !currentPassword} onClick={() => void run(t('已解锁'), () => SecurityService.Unlock({ password: currentPassword, remember_unlock: rememberUnlock }))}>{t('解锁')}</Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" />{t('已信任主机')}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t('管理 SSH known_hosts 指纹。指纹变化时连接会被阻止。')}</p>
          </div>
          <Button size="icon-sm" variant="outline" aria-label={t('刷新主机指纹')} onClick={() => void load()}><RefreshCw /></Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">{t('正在加载主机指纹...')}</p>
            : entries.length === 0 ? <p className="text-sm text-muted-foreground">{t('尚未信任任何 SSH 主机。')}</p>
              : entries.map((entry) => (
                <div key={`${entry.line}-${entry.fingerprint}`} className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <Fingerprint className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{entry.hosts}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{entry.algorithm} · {entry.fingerprint}</div>
                  </div>
                  <Button size="icon-xs" variant="ghost" aria-label={t('删除 ${} 的主机指纹', entry.hosts)} onClick={() => void remove(entry)}><Trash2 /></Button>
                </div>
              ))}
        </CardContent>
      </Card>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open && !busy) setConfirmAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === 'rotate'
                ? t('轮转应用密码会使用新密钥重新加密本地敏感数据（私钥、会话密码等）。其他设备必须使用相同应用密码，否则同步会失败。是否继续？')
                : t('删除 ${} 的已信任主机指纹？下次连接时将重新确认。', confirmAction?.type === 'host' ? confirmAction.entry.hosts : '')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === 'rotate'
                ? t('请确认已备份当前密码策略，并在所有同步设备上使用相同应用密码。')
                : t('此操作不可撤销。')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('取消')}</AlertDialogCancel>
            <AlertDialogAction type="button" variant="destructive" disabled={busy} onClick={() => { void confirmSecurityAction() }}>
              {busy ? t('处理中…') : t('确认')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-muted-foreground">{label}</label>{children}</div>
}

function PreferenceToggles(props: {
  requireLaunch: boolean
  rememberUnlock: boolean
  onRequireLaunch: (value: boolean) => void
  onRememberUnlock: (value: boolean) => void
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={props.requireLaunch} onCheckedChange={(v) => props.onRequireLaunch(v === true)} />
        {t('每次启动都要求输入应用密码')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={props.rememberUnlock} disabled={props.requireLaunch} onCheckedChange={(v) => props.onRememberUnlock(v === true)} />
        {t('在系统钥匙串中记住解锁状态（默认）')}
      </label>
      <p className="text-xs text-muted-foreground">{t('开启“每次启动验证”后，将忽略记住的解锁状态。')}</p>
    </div>
  )
}
