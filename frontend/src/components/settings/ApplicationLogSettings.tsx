import { FolderOpen } from 'lucide-react'
import { Dialogs } from '@wailsio/runtime'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'

export const DEFAULT_APP_LOG_DIR_PLACEHOLDER = '~/.mssh/logs'

interface Props {
  logDir: string
  logRetentionDays: string
  onLogDirChange: (value: string) => void
  onLogRetentionDaysChange: (value: string) => void
}

export function ApplicationLogSettingsSection({
  logDir,
  logRetentionDays,
  onLogDirChange,
  onLogRetentionDaysChange,
}: Props) {
  const pickDirectory = async () => {
    try {
      const selected = await Dialogs.OpenFile({
        Title: t('选择日志目录'),
        CanChooseFiles: false,
        CanChooseDirectories: true,
        AllowsMultipleSelection: false,
      })
      const path = Array.isArray(selected) ? selected[0] : selected
      if (path) onLogDirChange(path)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('pick log directory failed', error)
      toast(t('选择日志目录失败: ${}', message), 'error')
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{t('应用日志')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('按日期写入日志文件，并自动清理超出保留天数的旧日志。')}</p>
      </div>
      <div className="flex flex-col gap-3">
        <Field>
          <FieldContent>
            <FieldLabel htmlFor="app-log-dir">{t('日志目录')}</FieldLabel>
            <FieldDescription>{t('默认为用户家目录下的 .mssh/logs，文件名形如 2026-07-15.log。')}</FieldDescription>
          </FieldContent>
          <div className="flex items-center gap-2">
            <Input
              id="app-log-dir"
              aria-label={t('日志目录')}
              value={logDir}
              placeholder={DEFAULT_APP_LOG_DIR_PLACEHOLDER}
              onChange={(event) => onLogDirChange(event.target.value)}
            />
            <Button type="button" size="sm" variant="outline" onClick={() => { void pickDirectory() }}>
              <FolderOpen data-icon="inline-start" />
              {t('浏览')}
            </Button>
          </div>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="app-log-retention">{t('日志保留天数')}</FieldLabel>
            <FieldDescription>{t('超过保留天数的按日日志文件会被自动删除，默认 30 天。')}</FieldDescription>
          </FieldContent>
          <Input
            id="app-log-retention"
            aria-label={t('日志保留天数')}
            className="w-28"
            type="number"
            min={1}
            max={3650}
            value={logRetentionDays}
            onChange={(event) => onLogRetentionDaysChange(event.target.value)}
          />
        </Field>
      </div>
    </section>
  )
}
