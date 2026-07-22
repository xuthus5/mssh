import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { LabeledSelect } from '@/components/ui/labeled-select'
import {
  normalizeTerminalRenderer,
  type TerminalRenderer,
} from '@/store/terminalBehaviorStore'
import { t } from '@/i18n'

function rendererOptions() {
  return [
    { value: 'dom', label: t('DOM') },
    { value: 'canvas', label: t('Canvas') },
    { value: 'webgl', label: 'WebGL' },
  ] as const
}

interface Props {
  renderer: TerminalRenderer
  onRendererChange: (value: TerminalRenderer) => void
}

export function TerminalRendererSettingsSection({ renderer, onRendererChange }: Props) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{t('渲染')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('选择终端画面渲染后端。DOM 兼容性最好；Canvas / WebGL 在大量输出时更流畅。')}
        </p>
      </div>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel>{t('渲染器')}</FieldLabel>
          <FieldDescription>
            {t('WebGL 不可用时会自动回退到 Canvas，再失败则使用 DOM。默认 DOM。')}
          </FieldDescription>
        </FieldContent>
        <LabeledSelect
          ariaLabel={t('渲染器')}
          value={renderer}
          options={[...rendererOptions()]}
          onValueChange={(value) => onRendererChange(normalizeTerminalRenderer(value))}
          className="w-40"
        />
      </Field>
    </section>
  )
}
