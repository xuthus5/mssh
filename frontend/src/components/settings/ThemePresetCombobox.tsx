import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import type { ThemePreset } from '@/components/settings/terminalThemePresets'

interface Props {
  presets: ThemePreset[]
  value: string
  onValueChange: (preset: ThemePreset) => void
}

function PresetPalette({ preset }: { preset: ThemePreset }) {
  return <span aria-hidden="true" className="ml-auto flex items-center gap-1">
    {[preset.background, ...preset.ansi.slice(1, 6)].map((color, index) => (
      <span key={`${preset.name}-${index}`} className="size-3 rounded-sm border border-border" style={{ backgroundColor: color }} />
    ))}
  </span>
}

export function ThemePresetCombobox({ presets, value, onValueChange }: Props) {
  const presetByName = useMemo(() => new Map(presets.map((preset) => [preset.name, preset])), [presets])
  const names = useMemo(() => presets.map((preset) => preset.name), [presets])
  const selectedPreset = presetByName.get(value)
  return <div className="flex flex-col gap-2">
    <Combobox items={names} value={value} onValueChange={(name) => {
      const preset = presetByName.get(name ?? '')
      if (preset) onValueChange(preset)
    }}>
      <ComboboxInput aria-label="主题预设" placeholder="自定义主题 · 搜索预设" className="w-full" />
      <ComboboxContent>
        <ComboboxEmpty>未找到主题预设</ComboboxEmpty>
        <ComboboxList>{(name) => {
          const preset = presetByName.get(name)
          if (!preset) return null
          return <ComboboxItem key={name} value={name}>
            <span className="font-medium">{name}</span>
            <PresetPalette preset={preset} />
          </ComboboxItem>
        }}</ComboboxList>
      </ComboboxContent>
    </Combobox>
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>当前预设</span>
      <span className="font-medium text-foreground">{value || '自定义'}</span>
      {selectedPreset && <PresetPalette preset={selectedPreset} />}
    </div>
  </div>
}
import { useMemo } from 'react'
