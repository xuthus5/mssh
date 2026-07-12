import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { isHexColor, safeHexColor } from '@/components/settings/terminalThemeValidation'

const ANSI_NAMES = ['黑色', '红色', '绿色', '黄色', '蓝色', '洋红', '青色', '白色', '亮黑', '亮红', '亮绿', '亮黄', '亮蓝', '亮洋红', '亮青', '亮白']

interface Props {
  colors: string[]
  onChange: (index: number, color: string) => void
}

function nextAnsiIndex(key: string, index: number, total: number): number | undefined {
  if (key === 'Home') return 0
  if (key === 'End') return total - 1
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % total
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + total) % total
  return undefined
}

export function AnsiPaletteEditor({ colors, onChange }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedName = ANSI_NAMES[selectedIndex]
  const selectedColor = colors[selectedIndex] ?? '#000000'
  const valid = isHexColor(selectedColor)
  const selectWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = nextAnsiIndex(event.key, index, colors.length)
    if (nextIndex === undefined || colors.length === 0) return
    event.preventDefault()
    setSelectedIndex(nextIndex)
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus()
  }
  return <FieldGroup className="gap-4">
    <Field>
      <FieldLabel>ANSI 16 色</FieldLabel>
      <FieldDescription>选择一个色块后，在下方进行精确编辑。</FieldDescription>
      <div role="radiogroup" aria-label="ANSI 16 色" className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {colors.map((color, index) => <button
          key={index}
          type="button"
          aria-label={`ANSI ${index} ${ANSI_NAMES[index]}`}
          role="radio"
          aria-checked={selectedIndex === index}
          tabIndex={selectedIndex === index ? 0 : -1}
          className={cn('aspect-square rounded-lg border border-border shadow-sm outline-none transition-transform hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50', selectedIndex === index && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
          style={{ backgroundColor: color }}
          onClick={() => setSelectedIndex(index)}
          onKeyDown={(event) => selectWithKeyboard(event, index)}
        />)}
      </div>
    </Field>
    <Field data-invalid={!valid}>
      <FieldLabel htmlFor="ansi-color-hex">{selectedName} HEX</FieldLabel>
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
        <input aria-label={`${selectedName} 颜色`} type="color" value={safeHexColor(selectedColor)} onChange={(event) => onChange(selectedIndex, event.target.value)} className="size-8 self-center rounded-lg border border-input bg-transparent p-0.5" />
        <Input id="ansi-color-hex" aria-label={`${selectedName} HEX`} aria-invalid={!valid} value={selectedColor} onChange={(event) => onChange(selectedIndex, event.target.value)} />
      </div>
      {!valid && <FieldError>请输入 #RRGGBB 格式的颜色值。</FieldError>}
    </Field>
  </FieldGroup>
}
