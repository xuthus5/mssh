import { type ReactNode } from 'react'
import { Fingerprint, RefreshCw, Trash2 } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { SettingsCard, SettingsSectionHeader } from '@/components/settings/settings-ui'
import { SecurityService } from '@/lib/wails'
import { t } from '@/i18n'
import { useSecurityPanel, type HostKeyEntry } from '@/hooks/useSecurityPanel'

type SecurityController = ReturnType<typeof useSecurityPanel>
export type SecurityConfirmAction = null | { type: 'rotate' } | { type: 'host'; entry: HostKeyEntry }

interface SecurityPanelActions {
  confirmAction: SecurityConfirmAction
  setConfirmAction: (action: SecurityConfirmAction) => void
  setupPassword: () => void
  rotatePassword: () => void
  unlockPassword: () => void
  savePreferences: (requireLaunch: boolean, rememberUnlock: boolean) => void
  confirm: () => Promise<void>
}

interface SecurityPanelViewProps {
  security: SecurityController
  actions: SecurityPanelActions
}

export function SecurityPanelView({ security, actions }: SecurityPanelViewProps) {
  return (
    <div className="flex flex-col">
      <SecurityErrors security={security} />
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{t('安全')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('管理应用密码与已信任主机指纹。')}</p>
      </div>
      <div className="space-y-6">
        <ApplicationPasswordSection security={security} actions={actions} />
        <TrustedHostsSection security={security} onRemove={(entry) => actions.setConfirmAction({ type: 'host', entry })} />
      </div>
      <SecurityConfirmation security={security} actions={actions} />
    </div>
  )
}

function SecurityErrors({ security }: { security: SecurityController }) {
  return (
    <>
      {security.loadError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {t('加载安全设置失败: ${}', security.loadError)}
          <Button size="xs" variant="outline" className="ml-2" onClick={() => { void security.load() }}>{t('重试')}</Button>
        </div>
      ) : null}
      {security.formError ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{security.formError}</div> : null}
      {security.actionError ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{security.actionError}</div> : null}
    </>
  )
}

function ApplicationPasswordSection({ security, actions }: SecurityPanelViewProps) {
  return (
    <div>
      <SettingsSectionHeader title={t('应用密码')} description={t('统一保护本机敏感数据与云同步备份。轮转密码会触发数据重新加密；非同设备若密码不一致将导致同步失败。')} />
      <SettingsCard>
        <div className="space-y-4">
          <SecurityStatusSummary security={security} />
          {!security.status.configured
            ? <PasswordSetupForm security={security} actions={actions} />
            : <PasswordRotationForm security={security} actions={actions} />}
        </div>
      </SettingsCard>
    </div>
  )
}

function SecurityStatusSummary({ security }: { security: SecurityController }) {
  const status = security.status
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
      <p>{t('状态：${}', status.configured ? (status.unlocked ? t('已配置 · 已解锁') : t('已配置 · 已锁定')) : t('未配置'))}</p>
      {status.updated_at ? <p>{t('最近更新：${}', status.updated_at)}</p> : null}
      <p>{t('同步与加密导出依赖此密码派生的数据密钥，请在所有设备保持一致。')}</p>
    </div>
  )
}

function PasswordSetupForm({ security, actions }: SecurityPanelViewProps) {
  return (
    <div className="space-y-3">
      <Field label={t('设置应用密码')}>
        <Input type="password" value={security.password} onChange={(event) => { security.setPassword(event.target.value); security.setFormError('') }} placeholder={t('至少 12 个字符')} aria-label={t('设置应用密码')} />
      </Field>
      <Field label={t('确认应用密码')}>
        <Input type="password" value={security.confirmPassword} onChange={(event) => { security.setConfirmPassword(event.target.value); security.setFormError('') }} aria-label={t('确认应用密码')} />
      </Field>
      <PreferenceToggles
        disabled={security.busy || security.loading} requireLaunch={security.requireLaunch}
        rememberUnlock={security.rememberUnlock} onRequireLaunch={security.setRequireLaunch}
        onRememberUnlock={security.setRememberUnlock}
      />
      <Button size="sm" disabled={security.busy || security.loading} onClick={actions.setupPassword}>{t('创建应用密码')}</Button>
    </div>
  )
}

function PasswordRotationForm({ security, actions }: SecurityPanelViewProps) {
  return (
    <div className="space-y-3">
      <Field label={t('当前密码')}>
        <Input type="password" value={security.currentPassword} onChange={(event) => security.setCurrentPassword(event.target.value)} aria-label={t('当前密码')} />
      </Field>
      <Field label={t('新密码')}>
        <Input type="password" value={security.newPassword} onChange={(event) => { security.setNewPassword(event.target.value); security.setFormError('') }} placeholder={t('至少 12 个字符')} aria-label={t('新密码')} />
      </Field>
      <Field label={t('确认新密码')}>
        <Input type="password" value={security.confirmNewPassword} onChange={(event) => { security.setConfirmNewPassword(event.target.value); security.setFormError('') }} aria-label={t('确认新密码')} />
      </Field>
      <PreferenceToggles
        disabled={security.busy} requireLaunch={security.requireLaunch} rememberUnlock={security.rememberUnlock}
        onRequireLaunch={(value) => actions.savePreferences(value, security.rememberUnlock)}
        onRememberUnlock={(value) => actions.savePreferences(security.requireLaunch, value)}
      />
      <PasswordActionButtons security={security} actions={actions} />
    </div>
  )
}

function PasswordActionButtons({ security, actions }: SecurityPanelViewProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={security.busy} onClick={actions.rotatePassword}>{t('轮转密码并重加密')}</Button>
      {security.status.unlocked ? (
        <Button size="sm" variant="outline" disabled={security.busy} onClick={() => void security.run(t('已锁定'), '锁定失败: ${}', () => SecurityService.Lock())}>{t('锁定')}</Button>
      ) : (
        <Button size="sm" variant="outline" disabled={security.busy || !security.currentPassword} onClick={actions.unlockPassword}>{t('解锁')}</Button>
      )}
    </div>
  )
}

function TrustedHostsSection({ security, onRemove }: { security: SecurityController; onRemove: (entry: HostKeyEntry) => void }) {
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t('已信任主机')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('管理 SSH known_hosts 指纹。指纹变化时连接会被阻止。')}</p>
        </div>
        <Button size="icon-sm" variant="outline" aria-label={t('刷新主机指纹')} onClick={() => void security.load()}><RefreshCw /></Button>
      </div>
      <SettingsCard>
        <div className="space-y-2">
          <TrustedHostsContent security={security} onRemove={onRemove} />
        </div>
      </SettingsCard>
    </div>
  )
}

function TrustedHostsContent({ security, onRemove }: { security: SecurityController; onRemove: (entry: HostKeyEntry) => void }) {
  if (security.loading) return <p className="text-sm text-muted-foreground">{t('正在加载主机指纹...')}</p>
  if (security.loadError) return <p className="text-sm text-muted-foreground">{t('主机指纹暂不可用，请先修复上方加载错误。')}</p>
  if (security.entries.length === 0) return <p className="text-sm text-muted-foreground">{t('尚未信任任何 SSH 主机。')}</p>
  return security.entries.map((entry) => (
    <div key={`${entry.line}-${entry.fingerprint}`} className="flex items-center gap-3 rounded-xl border border-border p-3">
      <Fingerprint className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{entry.hosts}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">{entry.algorithm} · {entry.fingerprint}</div>
      </div>
      <Button size="icon-xs" variant="ghost" aria-label={t('删除 ${} 的主机指纹', entry.hosts)} onClick={() => onRemove(entry)}><Trash2 /></Button>
    </div>
  ))
}

function SecurityConfirmation({ security, actions }: SecurityPanelViewProps) {
  const action = actions.confirmAction
  return (
    <AlertDialog open={action !== null} onOpenChange={(open) => { if (!open && !security.busy) actions.setConfirmAction(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {action?.type === 'rotate'
              ? t('轮转应用密码会使用新密钥重新加密本地敏感数据（私钥、会话密码等）。其他设备必须使用相同应用密码，否则同步会失败。是否继续？')
              : t('删除 ${} 的已信任主机指纹？下次连接时将重新确认。', action?.type === 'host' ? action.entry.hosts : '')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {action?.type === 'rotate' ? t('请确认已备份当前密码策略，并在所有同步设备上使用相同应用密码。') : t('此操作不可撤销。')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={security.busy}>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction type="button" variant="destructive" disabled={security.busy} onClick={(event) => { event.preventDefault(); void actions.confirm() }}>
            {security.busy ? t('处理中…') : t('确认')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-muted-foreground">{label}</label>{children}</div>
}

interface PreferenceTogglesProps {
  disabled?: boolean
  requireLaunch: boolean
  rememberUnlock: boolean
  onRequireLaunch: (value: boolean) => void
  onRememberUnlock: (value: boolean) => void
}

function PreferenceToggles(props: PreferenceTogglesProps) {
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox disabled={props.disabled} checked={props.requireLaunch} onCheckedChange={(value) => props.onRequireLaunch(value === true)} />
        {t('每次启动都要求输入应用密码')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox disabled={props.disabled || props.requireLaunch} checked={props.rememberUnlock} onCheckedChange={(value) => props.onRememberUnlock(value === true)} />
        {t('在系统钥匙串中记住解锁状态（默认）')}
      </label>
      <p className="text-xs text-muted-foreground">{t('开启“每次启动验证”后，将忽略记住的解锁状态。')}</p>
    </div>
  )
}
