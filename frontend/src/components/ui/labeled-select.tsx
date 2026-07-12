import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface LabeledSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface LabeledSelectProps {
  value: string
  options: readonly LabeledSelectOption[]
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  ariaLabel?: string
}

export function LabeledSelect({
  value,
  options,
  onValueChange,
  placeholder = '请选择',
  className,
  disabled,
  ariaLabel,
}: LabeledSelectProps) {
  const selectedLabel = options.find((option) => option.value === value)?.label

  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue ?? '')} disabled={disabled}>
      <SelectTrigger aria-label={ariaLabel} className={cn('w-full', className)}>
        <SelectValue placeholder={placeholder}>
          <span>{selectedLabel ?? placeholder}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
