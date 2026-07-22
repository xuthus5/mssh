import { t } from '@/i18n'
import type { AutoSaveStatus as Status } from '@/hooks/useAutoSave'

interface Props {
  status: Status
  error?: string | null
  className?: string
}

export function AutoSaveStatusIndicator({ status, error, className }: Props) {
  const text =
    status === 'pending' ? t('待保存...')
      : status === 'saving' ? t('正在保存...')
        : status === 'saved' ? t('已自动保存')
          : status === 'error' ? t('自动保存失败: ${}', error || t('未知错误'))
            : t('更改将自动保存')
  const tone =
    status === 'error' ? 'text-destructive'
      : status === 'saved' ? 'text-muted-foreground'
        : 'text-muted-foreground'
  return (
    <p className={className ?? `text-xs ${tone}`} role="status" aria-live="polite">
      {text}
    </p>
  )
}
