import { ShieldAlert } from 'lucide-react'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { useThemeCatalogStore } from '@/hooks/useThemeCatalog'
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
  const ligaturesEnabled = useThemeCatalogStore((state) => state.globalStyle.ligatures_enabled)
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
      {renderer !== 'dom' && ligaturesEnabled ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <span>{t('已开启字体连字，但 ${} 渲染器下连字可能无法生效，建议切换为 DOM 渲染器。', renderer === 'canvas' ? 'Canvas' : 'WebGL')}</span>
        </div>
      ) : null}
    </section>
  )
}
