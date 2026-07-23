import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { FolderTree, List } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { AutoSaveStatusIndicator } from '@/components/settings/AutoSaveStatus'
import { useAutoSave } from '@/hooks/useAutoSave'
import type { SFTPSettings } from '@/lib/sftpSettings'
import { t } from '@/i18n'

interface Props {
  settings: SFTPSettings
  onSave: (settings: SFTPSettings) => Promise<void>
  settingsReady?: boolean
  loadError?: string
  onReload?: () => void
}

export function SFTPSettingsPanel({ settings, onSave, settingsReady = true, loadError = '', onReload }: Props) {
  const [draft, setDraft] = useState(settings)
  useEffect(() => setDraft(settings), [settings])
  const update = (updates: Partial<SFTPSettings>) => setDraft((current) => ({ ...current, ...updates }))
  const persist = useCallback(async (next: SFTPSettings) => {
    await onSave(next)
  }, [onSave])
  const autoSave = useAutoSave({ value: draft, onSave: persist, isReady: settingsReady, delayMs: 350 })

  return (
    <div className="flex flex-col gap-4 pt-2">
      {loadError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {t('加载 SFTP 设置失败: ${}', loadError)}
          {onReload ? (
            <Button type="button" size="xs" variant="outline" className="ml-2" onClick={() => { onReload() }}>{t('重试')}</Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('SFTP 文件管理')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('控制远程文件面板的显示方式和目录联动行为。')}</p>
        </div>
        <AutoSaveStatusIndicator status={autoSave.status} error={autoSave.error} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('文件显示')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('选择远程目录内容的可见范围。')}</p>
        </CardHeader>
        <CardContent>
          <SettingSwitch
            id="sftp-show-hidden"
            label={t('显示隐藏文件')}
            description={t('显示名称以点号开头的文件和目录。')}
            checked={draft.showHiddenFiles}
            onCheckedChange={(checked) => update({ showHiddenFiles: checked })}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('目录联动')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('让文件面板跟随当前终端所在的远程目录。')}</p>
        </CardHeader>
        <CardContent>
          <SettingSwitch
            id="sftp-follow-terminal"
            label={t('追随终端目录')}
            description={t('终端发送 OSC 7 工作目录信息时，文件面板自动切换到该目录。')}
            checked={draft.followTerminalDirectory}
            onCheckedChange={(checked) => update({ followTerminalDirectory: checked })}
          />
          <Alert className="mt-4">
            <AlertDescription>
              {t('如果远端 Shell 未发送工作目录信息，可在文件面板点击“同步当前目录”手动请求一次。')}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('默认视图')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('每次打开 SFTP 文件面板时采用的初始视图。')}</p>
        </CardHeader>
        <CardContent>
          <div role="group" aria-label={t('SFTP 默认视图')} className="flex gap-2">
            <ViewButton
              active={draft.defaultView === 'list'}
              icon={<List />}
              label={t('列表视图')}
              onClick={() => update({ defaultView: 'list' })}
            />
            <ViewButton
              active={draft.defaultView === 'tree'}
              icon={<FolderTree />}
              label={t('树状视图')}
              onClick={() => update({ defaultView: 'tree' })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function SettingSwitch({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function ViewButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <Button type="button" variant={active ? 'secondary' : 'outline'} className="flex-1" onClick={onClick}>
      {icon}
      {label}
    </Button>
  )
}
