import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Events, Dialogs } from '@wailsio/runtime'
import { KeyRound, Shield, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { SecurityService, SyncService } from '@/lib/wails'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import type { SecurityStatus } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

const emptyStatus: SecurityStatus = {
  configured: false,
  unlocked: false,
  require_password_on_launch: false,
  remember_unlock: true,
  updated_at: '',
}

const vaultLockedEvent = 'security:vault-locked'
const vaultChangedEvent = 'security:vault-changed'

type GateMode = 'loading' | 'setup' | 'unlock' | 'ready' | 'error'

export function VaultGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SecurityStatus>(emptyStatus)
  const [mode, setMode] = useState<GateMode>('loading')
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [requireLaunch, setRequireLaunch] = useState(false)
  const [rememberUnlock, setRememberUnlock] = useState(true)
  const [busy, setBusy] = useState(false)
  const [restoreMode, setRestoreMode] = useState(false)

  const applyStatus = useCallback((next: SecurityStatus) => {
    setStatus(next)
    setRequireLaunch(next.require_password_on_launch)
    setRememberUnlock(next.remember_unlock)
    if (!next.configured) setMode('setup')
    else if (!next.unlocked) setMode('unlock')
    else setMode('ready')
  }, [])

  const refresh = useCallback(async () => {
    setError('')
    try {
      applyStatus(await SecurityService.Status())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setMode('error')
      setError(message)
      toast(t('加载安全状态失败: ${}', message), 'error')
    }
  }, [applyStatus])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const stopLocked = Events.On(vaultLockedEvent, () => {
      setMode('unlock')
      setStatus((prev) => ({ ...prev, unlocked: false }))
      setPassword('')
      setError('')
    })
    const stopChanged = Events.On(vaultChangedEvent, (event: { data?: SecurityStatus | null }) => {
      const next = event?.data
      if (!next) {
        void refresh()
        return
      }
      applyStatus(next)
      if (next.unlocked) {
        setPassword('')
        setConfirmPassword('')
        setError('')
      }
    })
    return () => {
      stopLocked()
      stopChanged()
    }
  }, [applyStatus, refresh])

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
      setPassword('')
      setConfirmPassword('')
      setRestoreMode(false)
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast(t('安全操作失败: ${}', message), 'error')
    } finally {
      setBusy(false)
    }
  }

  const setup = () => {
    if (password.length < 12) {
      setError(t('应用密码至少需要 12 个字符'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('两次输入的密码不一致'))
      return
    }
    void run(() => SecurityService.Setup({
      password,
      require_password_on_launch: requireLaunch,
      remember_unlock: rememberUnlock,
    }))
  }

  const unlock = () => {
    if (!password) {
      setError(t('请输入应用密码'))
      return
    }
    void run(() => SecurityService.Unlock({
      password,
      remember_unlock: rememberUnlock,
    }))
  }

  const restoreFromBackup = async () => {
    if (password.length < 12) {
      setError(t('应用密码至少需要 12 个字符'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const selected = await Dialogs.OpenFile({
        Title: t('选择加密备份'),
        CanChooseFiles: true,
        CanChooseDirectories: false,
        AllowsMultipleSelection: false,
        Filters: [{ DisplayName: 'mssh backup', Pattern: '*.msshbackup' }],
      })
      const path = Array.isArray(selected) ? selected[0] : selected
      if (!path) {
        setBusy(false)
        return
      }
      await SyncService.ImportWithPassword(path, password)
      setPassword('')
      setConfirmPassword('')
      setRestoreMode(false)
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast(t('安全操作失败: ${}', message), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'ready') return <>{children}</>

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {mode === 'setup' ? <Shield className="size-4" /> : <KeyRound className="size-4" />}
            {mode === 'setup' ? t('设置应用密码') : mode === 'unlock' ? t('解锁应用') : t('应用安全')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {mode === 'setup'
              ? t('首次使用需设置应用密码，用于加密本机敏感数据与云同步备份。')
              : mode === 'unlock'
                ? t('应用已锁定。请输入应用密码以继续。')
                : mode === 'loading'
                  ? t('正在检查安全状态…')
                  : t('无法读取安全状态')}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {mode === 'loading' && <p className="text-sm text-muted-foreground">{t('请稍候…')}</p>}
          {(mode === 'setup' || mode === 'unlock') && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t('应用密码')}</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'setup' ? t('至少 12 个字符') : undefined}
                  aria-label={t('应用密码')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (mode === 'setup' && restoreMode) void restoreFromBackup()
                      else if (mode === 'setup') setup()
                      else unlock()
                    }
                  }}
                />
              </div>
              {mode === 'setup' && !restoreMode && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">{t('确认应用密码')}</label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    aria-label={t('确认应用密码')}
                    onKeyDown={(e) => { if (e.key === 'Enter') setup() }}
                  />
                </div>
              )}
              {mode === 'setup' && !restoreMode && (
                <div className="space-y-2 rounded-xl border border-border p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={requireLaunch} onCheckedChange={(v) => setRequireLaunch(v === true)} />
                    {t('每次启动都要求输入应用密码')}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={rememberUnlock}
                      disabled={requireLaunch}
                      onCheckedChange={(v) => setRememberUnlock(v === true)}
                    />
                    {t('在系统钥匙串中记住解锁状态（默认）')}
                  </label>
                </div>
              )}
              {mode === 'unlock' && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={rememberUnlock}
                    disabled={status.require_password_on_launch}
                    onCheckedChange={(v) => setRememberUnlock(v === true)}
                  />
                  {t('在系统钥匙串中记住解锁状态（默认）')}
                </label>
              )}
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
              {mode === 'setup' && restoreMode ? (
                <div className="flex flex-col gap-2">
                  <Button className="w-full" disabled={busy} onClick={() => void restoreFromBackup()}>
                    <Upload data-icon="inline-start" />
                    {t('从加密备份恢复')}
                  </Button>
                  <Button className="w-full" variant="outline" disabled={busy} onClick={() => setRestoreMode(false)}>
                    {t('返回创建应用密码')}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button
                    className="w-full"
                    disabled={busy}
                    onClick={() => { if (mode === 'setup') setup(); else unlock() }}
                  >
                    {mode === 'setup' ? t('创建应用密码') : t('解锁')}
                  </Button>
                  {mode === 'setup' && (
                    <Button className="w-full" variant="outline" disabled={busy} onClick={() => { setRestoreMode(true); setConfirmPassword(''); setError('') }}>
                      {t('我有其他设备的加密备份')}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
          {mode === 'error' && (
            <>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
              <Button className="w-full" variant="outline" disabled={busy} onClick={() => void refresh()}>
                {t('重试')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
