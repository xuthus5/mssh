import { type ReactNode } from 'react'
import { KeyRound, Shield, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n'
import { useVaultGate } from '@/hooks/useVaultGate'

type VaultGateController = ReturnType<typeof useVaultGate>

interface VaultGateProps {
  children: ReactNode
  clearOnSettingsHide?: boolean
}

export function VaultGate({ children, clearOnSettingsHide = false }: VaultGateProps) {
  const gate = useVaultGate({ clearOnSettingsHide })
  if (gate.mode === 'ready') return <>{children}</>
  return <VaultGateScreen gate={gate} />
}

function VaultGateScreen({ gate }: { gate: VaultGateController }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-md shadow-sm">
        <VaultGateHeader mode={gate.mode} />
        <CardContent className="space-y-3">
          {gate.mode === 'loading' && <p className="text-sm text-muted-foreground">{t('请稍候…')}</p>}
          {(gate.mode === 'setup' || gate.mode === 'unlock') && <VaultGateForm gate={gate} />}
          {gate.mode === 'error' && <VaultGateError gate={gate} />}
        </CardContent>
      </Card>
    </div>
  )
}

function VaultGateHeader({ mode }: Pick<VaultGateController, 'mode'>) {
  return (
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
  )
}

function VaultGateForm({ gate }: { gate: VaultGateController }) {
  return (
    <>
      <VaultPasswordField gate={gate} />
      {gate.mode === 'setup' && !gate.restoreMode && <VaultConfirmPasswordField gate={gate} />}
      {gate.mode === 'setup' && !gate.restoreMode && <VaultSetupPreferences gate={gate} />}
      {gate.mode === 'unlock' && <VaultUnlockPreference gate={gate} />}
      {gate.error && <p className="text-sm text-destructive" role="alert">{gate.error}</p>}
      <VaultGateActions gate={gate} />
    </>
  )
}

function VaultPasswordField({ gate }: { gate: VaultGateController }) {
  const submit = () => {
    if (gate.mode === 'setup' && gate.restoreMode) void gate.restoreFromBackup()
    else if (gate.mode === 'setup') gate.setup()
    else gate.unlock()
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{t('应用密码')}</label>
      <Input
        type="password"
        disabled={gate.busy}
        value={gate.password}
        onChange={(event) => gate.setPassword(event.target.value)}
        placeholder={gate.mode === 'setup' ? t('至少 12 个字符') : undefined}
        aria-label={t('应用密码')}
        onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
      />
    </div>
  )
}

function VaultConfirmPasswordField({ gate }: { gate: VaultGateController }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{t('确认应用密码')}</label>
      <Input
        type="password"
        disabled={gate.busy}
        value={gate.confirmPassword}
        onChange={(event) => gate.setConfirmPassword(event.target.value)}
        aria-label={t('确认应用密码')}
        onKeyDown={(event) => { if (event.key === 'Enter') gate.setup() }}
      />
    </div>
  )
}

function VaultSetupPreferences({ gate }: { gate: VaultGateController }) {
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={gate.requireLaunch} disabled={gate.busy} onCheckedChange={(value) => gate.setRequireLaunch(value === true)} />
        {t('每次启动都要求输入应用密码')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={gate.rememberUnlock}
          disabled={gate.busy || gate.requireLaunch}
          onCheckedChange={(value) => gate.setRememberUnlock(value === true)}
        />
        {t('在系统钥匙串中记住解锁状态（默认）')}
      </label>
    </div>
  )
}

function VaultUnlockPreference({ gate }: { gate: VaultGateController }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={gate.rememberUnlock}
        disabled={gate.busy || gate.status.require_password_on_launch}
        onCheckedChange={(value) => gate.setRememberUnlock(value === true)}
      />
      {t('在系统钥匙串中记住解锁状态（默认）')}
    </label>
  )
}

function VaultGateActions({ gate }: { gate: VaultGateController }) {
  if (gate.mode === 'setup' && gate.restoreMode) {
    return (
      <div className="flex flex-col gap-2">
        <Button className="w-full" disabled={gate.busy} onClick={() => void gate.restoreFromBackup()}>
          <Upload data-icon="inline-start" />
          {t('从加密备份恢复')}
        </Button>
        <Button className="w-full" variant="outline" disabled={gate.busy} onClick={gate.exitRestoreMode}>
          {t('返回创建应用密码')}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <Button className="w-full" disabled={gate.busy} onClick={() => { if (gate.mode === 'setup') gate.setup(); else gate.unlock() }}>
        {gate.mode === 'setup' ? t('创建应用密码') : t('解锁')}
      </Button>
      {gate.mode === 'setup' && (
        <Button className="w-full" variant="outline" disabled={gate.busy} onClick={gate.enterRestoreMode}>
          {t('我有其他设备的加密备份')}
        </Button>
      )}
    </div>
  )
}

function VaultGateError({ gate }: { gate: VaultGateController }) {
  return (
    <>
      {gate.error && <p className="text-sm text-destructive" role="alert">{gate.error}</p>}
      <Button className="w-full" variant="outline" disabled={gate.busy} onClick={() => void gate.refresh()}>
        {t('重试')}
      </Button>
    </>
  )
}
