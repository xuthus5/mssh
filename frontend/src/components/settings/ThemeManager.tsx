import { useState } from 'react'
import { Download } from 'lucide-react'
import { ThemeDeleteDialog } from '@/components/settings/ThemeDeleteDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SettingsCard, SettingsSectionHeader } from '@/components/settings/settings-ui'
import { ThemeImportResults } from '@/components/settings/ThemeImportResults'
import { ThemeManagerRow } from '@/components/settings/ThemeManagerRow'
import { useThemeManagerRuntime, type ThemeManagerProps, type ThemeManagerRuntime } from '@/components/settings/themeManagerRuntime'
import { useSettingsWindowHide } from '@/hooks/useSettingsWindowHide'
import { t } from '@/i18n'

export function ThemeManager(props: ThemeManagerProps) {
  const model = useThemeManagerRuntime(props)
  const [rowResetRevision, setRowResetRevision] = useState(0)
  useSettingsWindowHide(() => {
    model.dismissTransientState()
    setRowResetRevision((current) => current + 1)
  })
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <SettingsSectionHeader title={t('主题管理')} description={t('导入、创建并管理终端配色主题。')} />
        <Button type="button" size="sm" variant="outline" disabled={model.importing || model.deleting || model.pendingRows.size > 0} onClick={() => { void model.importFiles() }}><Download data-icon="inline-start" />{model.importing ? t('导入中…') : t('导入 iTerm2 主题')}</Button>
      </div>
      <SettingsCard>
        <div className="flex flex-col gap-4">
          <ThemeActionErrors model={model} />
          <Input aria-label={t('搜索终端主题')} placeholder={t('搜索名称或来源')} value={model.query} onChange={(event) => model.setQuery(event.target.value)} />
          {model.summary && <ThemeImportResults summary={model.summary} />}
          <ThemeTable props={props} model={model} rowResetRevision={rowResetRevision} />
        </div>
      </SettingsCard>
      <ThemeDeleteDialog
        target={model.deleteTarget}
        pending={model.deleting}
        error={model.deleteError}
        onOpenChange={model.handleDeleteOpenChange}
        onConfirm={() => { void model.confirmDelete() }}
      />
    </div>
  )
}

function ThemeActionErrors({ model }: { model: ThemeManagerRuntime }) {
  const errors = [model.actionError, ...model.rowErrors.values()].filter(Boolean)
  if (errors.length === 0) return null
  return <Alert variant="destructive"><AlertDescription className="space-y-1">{errors.map((error, index) => <p key={`${index}-${error}`}>{error}</p>)}</AlertDescription></Alert>
}

function ThemeTable({ props, model, rowResetRevision }: { props: ThemeManagerProps; model: ThemeManagerRuntime; rowResetRevision: number }) {
  return <Table><TableHeader><TableRow><TableHead>{t('名称')}</TableHead><TableHead>{t('模式')}</TableHead><TableHead>{t('来源')}</TableHead><TableHead>{t('许可证')}</TableHead><TableHead className="text-right">{t('操作')}</TableHead></TableRow></TableHeader><TableBody>{model.filtered.map((profile) => <ThemeManagerRow key={profile.id} profile={profile} resetRevision={rowResetRevision} disabled={model.importing || model.deleting || model.pendingRows.has(profile.id)} deleteDisabled={model.importing || model.deleting || model.pendingRows.size > 0} onCreateProfile={props.onCreateProfile} onUpdateProfile={props.onUpdateProfile} onRequestDelete={model.requestDelete} runAction={model.runAction} />)}</TableBody></Table>
}
