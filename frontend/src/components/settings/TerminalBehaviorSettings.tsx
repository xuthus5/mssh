import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Switch } from '@/components/ui/switch'
import {
  normalizeTerminalRightClickAction,
  type TerminalBehaviorSettings,
  type TerminalRightClickAction,
} from '@/store/terminalBehaviorStore'

const RIGHT_CLICK_OPTIONS = [
  { value: 'menu', label: '显示菜单' },
  { value: 'paste', label: '粘贴' },
] as const

interface Props extends TerminalBehaviorSettings {
  onRightClickActionChange: (value: TerminalRightClickAction) => void
  onCopyOnSelectChange: (value: boolean) => void
}

export function TerminalBehaviorSettingsSection({
  rightClickAction,
  copyOnSelect,
  onRightClickActionChange,
  onCopyOnSelectChange,
}: Props) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">行为</h3>
        <p className="mt-1 text-xs text-muted-foreground">控制终端中的鼠标和剪贴板交互。</p>
      </div>
      <div className="flex flex-col gap-3">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>鼠标右键行为</FieldLabel>
            <FieldDescription>选择显示操作菜单或直接粘贴剪贴板内容。</FieldDescription>
          </FieldContent>
          <LabeledSelect
            ariaLabel="鼠标右键行为"
            value={rightClickAction}
            options={RIGHT_CLICK_OPTIONS}
            onValueChange={(value) => onRightClickActionChange(normalizeTerminalRightClickAction(value))}
            className="w-40"
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="terminal-copy-on-select">选择即复制</FieldLabel>
            <FieldDescription>选中文本后自动写入系统剪贴板。</FieldDescription>
          </FieldContent>
          <Switch
            id="terminal-copy-on-select"
            checked={copyOnSelect}
            onCheckedChange={(value) => onCopyOnSelectChange(value)}
          />
        </Field>
      </div>
    </section>
  )
}
