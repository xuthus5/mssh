import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'

interface SearchableSelectProps {
  value: string
  options: readonly string[]
  onValueChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}

export function SearchableSelect({ value, options, onValueChange, placeholder = '搜索或选择', disabled, ariaLabel }: SearchableSelectProps) {
  return <Combobox items={options} value={value} onValueChange={(nextValue) => { if (nextValue) onValueChange(nextValue) }} disabled={disabled}>
    <ComboboxInput aria-label={ariaLabel} placeholder={placeholder} className="w-full" />
    <ComboboxContent>
      <ComboboxEmpty>未找到匹配项</ComboboxEmpty>
      <ComboboxList>{(option) => <ComboboxItem key={option} value={option} style={{ fontFamily: `${JSON.stringify(option)}, sans-serif` }}>{option}</ComboboxItem>}</ComboboxList>
    </ComboboxContent>
  </Combobox>
}
