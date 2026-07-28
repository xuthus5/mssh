import { FolderOpen } from 'lucide-react'
import { Dialogs } from '@wailsio/runtime'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useRef, useState } from 'react'
import { useSettingsWindowHide } from '@/hooks/useSettingsWindowHide'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'

export const DEFAULT_APP_LOG_DIR_PLACEHOLDER = '~/.mssh/logs'

interface Props {
  logDir: string
  logRetentionDays: string
  onLogDirChange: (value: string) => void
  onLogRetentionDaysChange: (value: string) => void
}

function useLogDirectoryPicker(onLogDirChange: Props['onLogDirChange']) {
  const [pickerError, setPickerError] = useState('')
  const [picking, setPicking] = useState(false)
  const requestID = useRef(0)
  const active = useRef(false)
  const pickDirectory = async () => {
    if (active.current) return
    active.current = true
    const request = ++requestID.current
    setPicking(true)
    setPickerError('')
    try {
      const selected = await Dialogs.OpenFile({
        Title: t('选择日志目录'),
        CanChooseFiles: false,
        CanChooseDirectories: true,
        AllowsMultipleSelection: false,
      })
      const path = Array.isArray(selected) ? selected[0] : selected
      if (requestID.current === request && path) onLogDirChange(path)
    } catch (error) {
      if (requestID.current !== request) return
      const message = error instanceof Error ? error.message : String(error)
      logger.error('pick log directory failed', error)
      setPickerError(t('选择日志目录失败: ${}', message))
    } finally {
      active.current = false
      setPicking(false)
    }
  }
  useSettingsWindowHide(() => {
    requestID.current++
    setPickerError('')
  })
  return { pickerError, pickDirectory, picking }
}

function LogDirectoryField({ logDir, onChange, onPick, picking }: {
  logDir: string
  onChange: Props['onLogDirChange']
  onPick: () => void
  picking: boolean
}) {
  return (
    <Field>
      <FieldContent>
        <FieldLabel htmlFor="app-log-dir">{t('日志目录')}</FieldLabel>
        <FieldDescription>{t('默认为用户家目录下的 .mssh/logs，文件名形如 2026-07-15.log。')}</FieldDescription>
      </FieldContent>
      <div className="flex items-center gap-2">
        <Input id="app-log-dir" aria-label={t('日志目录')} value={logDir} disabled={picking}
          placeholder={DEFAULT_APP_LOG_DIR_PLACEHOLDER} onChange={(event) => onChange(event.target.value)} />
        <Button type="button" size="sm" variant="outline" disabled={picking} onClick={onPick}>
          <FolderOpen data-icon="inline-start" />{picking ? t('选择中...') : t('浏览')}
        </Button>
      </div>
    </Field>
  )
}

function LogRetentionField({ value, onChange }: { value: string; onChange: Props['onLogRetentionDaysChange'] }) {
  return <Field orientation="horizontal">
    <FieldContent>
      <FieldLabel htmlFor="app-log-retention">{t('日志保留天数')}</FieldLabel>
      <FieldDescription>{t('超过保留天数的按日日志文件会被自动删除，默认 30 天。')}</FieldDescription>
    </FieldContent>
    <Input id="app-log-retention" aria-label={t('日志保留天数')} className="w-28" type="number"
      min={1} max={3650} value={value} onChange={(event) => onChange(event.target.value)} />
  </Field>
}

export function ApplicationLogSettingsSection(props: Props) {
  const { pickerError, pickDirectory, picking } = useLogDirectoryPicker(props.onLogDirChange)
  return <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
    <div className="mb-3">
      <h3 className="text-sm font-medium text-foreground">{t('应用日志')}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t('按日期写入日志文件，并自动清理超出保留天数的旧日志。')}</p>
    </div>
    {pickerError ? <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{pickerError}</div> : null}
    <div className="flex flex-col gap-3">
      <LogDirectoryField logDir={props.logDir} onChange={props.onLogDirChange} onPick={() => { void pickDirectory() }} picking={picking} />
      <LogRetentionField value={props.logRetentionDays} onChange={props.onLogRetentionDaysChange} />
    </div>
  </section>
}
