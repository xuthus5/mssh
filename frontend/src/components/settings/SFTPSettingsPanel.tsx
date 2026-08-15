import { useCallback, type ReactNode } from 'react'
import { FolderTree, List } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SettingsCard, SettingsRow, SettingsSectionHeader } from '@/components/settings/settings-ui'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useDraftSync } from '@/hooks/useDraftSync'
import type { SFTPSettings } from '@/lib/sftpSettings'
import { t } from '@/i18n'

interface Props {
  settings: SFTPSettings
  onSave: (settings: SFTPSettings) => Promise<void>
  settingsReady?: boolean
  loadError?: string
  onReload?: () => void
}

function createDraft(settings: SFTPSettings): SFTPSettings {
  return { ...settings }
}

export function SFTPSettingsPanel({ settings, onSave, settingsReady = true, loadError = '', onReload }: Props) {
  const { draft, setDraft, acknowledgeSaved, baselineRevision } = useDraftSync({ source: settings, createDraft })
  const update = (updates: Partial<SFTPSettings>) => setDraft((current) => ({ ...current, ...updates }))
  const persist = useCallback(async (next: SFTPSettings) => {
    await onSave(next)
    acknowledgeSaved(next)
  }, [acknowledgeSaved, onSave])
  const autoSave = useAutoSave({ value: draft, onSave: persist, isReady: settingsReady, delayMs: 350, baselineRevision, notify: true })

  return (
    <div className="flex flex-col">
      <LoadError error={loadError} onReload={onReload} />
      <PanelHeader />
      <div className="space-y-6">
        <DisplaySection draft={draft} update={update} />
        <DirectorySection draft={draft} update={update} />
        <DefaultViewSection draft={draft} update={update} />
      </div>
    </div>
  )
}

function LoadError({ error, onReload }: { error: string; onReload?: () => void }) {
  if (!error) return null
  return <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{t('加载 SFTP 设置失败: ${}', error)}{onReload ? <Button type="button" size="xs" variant="outline" className="ml-2" onClick={onReload}>{t('重试')}</Button> : null}</div>
}

function PanelHeader() {
  return <div className="mb-4"><h2 className="text-lg font-semibold">{t('SFTP 文件管理')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('控制远程文件面板的显示方式和目录联动行为。')}</p></div>
}

type SettingsCardProps = { draft: SFTPSettings; update: (updates: Partial<SFTPSettings>) => void }

function DisplaySection({ draft, update }: SettingsCardProps) {
  return <div>
    <SettingsSectionHeader title={t('文件显示')} description={t('选择远程目录内容的可见范围。')} />
    <SettingsCard divided>
      <SettingSwitch id="sftp-show-hidden" label={t('显示隐藏文件')} description={t('显示名称以点号开头的文件和目录。')} checked={draft.showHiddenFiles} onCheckedChange={(checked) => update({ showHiddenFiles: checked })} />
    </SettingsCard>
  </div>
}

function DirectorySection({ draft, update }: SettingsCardProps) {
  return <div>
    <SettingsSectionHeader title={t('目录联动')} description={t('让文件面板跟随当前终端所在的远程目录。')} />
    <SettingsCard divided>
      <SettingSwitch id="sftp-follow-terminal" label={t('追随终端目录')} description={t('终端发送 OSC 7 工作目录信息时，文件面板自动切换到该目录。')} checked={draft.followTerminalDirectory} onCheckedChange={(checked) => update({ followTerminalDirectory: checked })} />
    </SettingsCard>
    <Alert className="mt-3"><AlertDescription>{t('开启后，SSH 终端登录时会在后台检测当前 Shell，并向 .bashrc、.zshrc 等配置文件自动注入 OSC 7 工作目录指令；如果已存在 MSSH 管理块，则不会重复写入。')}</AlertDescription></Alert>
  </div>
}

function DefaultViewSection({ draft, update }: SettingsCardProps) {
  return <div>
    <SettingsSectionHeader title={t('默认视图')} description={t('每次打开 SFTP 文件面板时采用的初始视图。')} />
    <SettingsCard>
      <div role="group" aria-label={t('SFTP 默认视图')} className="flex gap-2"><ViewButton active={draft.defaultView === 'list'} icon={<List />} label={t('列表视图')} onClick={() => update({ defaultView: 'list' })} /><ViewButton active={draft.defaultView === 'tree'} icon={<FolderTree />} label={t('树状视图')} onClick={() => update({ defaultView: 'tree' })} /></div>
    </SettingsCard>
  </div>
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
    <SettingsRow label={label} description={description}>
      <Switch id={id} aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
    </SettingsRow>
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
