import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 外置分区标题：位于卡片上方，使用 font-semibold 突出层级。 */
export function SettingsSectionHeader({ title, description }: {
  title: ReactNode
  description?: ReactNode
}) {
  return <div className="mb-2.5">
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    {description ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
  </div>
}

/** 设置卡片：分组内容统一留白，divided 时行间用分隔线。 */
export function SettingsCard({ divided = false, className, children }: {
  divided?: boolean
  className?: string
  children: ReactNode
}) {
  return <div className={cn('rounded-xl border border-border bg-card shadow-sm', divided ? 'divide-y divide-border' : 'p-4', className)}>{children}</div>
}

/** 设置行：label/description 居左，控件居右，垂直居中。 */
export function SettingsRow({ label, description, align = 'center', children }: {
  label?: ReactNode
  description?: ReactNode
  align?: 'center' | 'start'
  children: ReactNode
}) {
  return <div className={cn('flex items-center justify-between gap-4 px-4 py-3', align === 'start' && 'items-start')}>
    <div className="min-w-0 flex-1">
      {label ? <div className="text-sm font-medium text-foreground">{label}</div> : null}
      {description ? <div className={cn('text-xs leading-relaxed text-muted-foreground', label !== undefined && 'mt-0.5')}>{description}</div> : null}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
}

/** 设置卡片底部提示。 */
export function SettingsHint({ className, children }: {
  className?: string
  children: ReactNode
}) {
  return <p className={cn('mt-3 text-xs leading-relaxed text-muted-foreground', className)}>{children}</p>
}
