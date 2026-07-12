import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox'
import type { ThemeProfile } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

interface Props {
  mode: 'dark' | 'light'
  profiles: ThemeProfile[]
  value: number
  onValueChange: (id: number) => void
}

export function ThemeModeSelector({ mode, profiles, value, onValueChange }: Props) {
  const profileByName = useMemo(() => new Map(profiles.map((profile) => [profile.name, profile])), [profiles])
  const names = useMemo(() => profiles.map((profile) => profile.name), [profiles])
  const selected = profiles.find((profile) => profile.id === value)
  const label = mode === 'dark' ? 'Dark Mode 终端主题' : 'Light Mode 终端主题'
  return <div className="flex min-w-0 flex-col gap-2">
    <label className="text-xs font-medium text-muted-foreground">{label}</label>
    <Combobox items={names} value={selected?.name ?? ''} onValueChange={(name) => {
      const profile = profileByName.get(name ?? '')
      if (!profile) return
      const compatible = profile.definition?.mode === mode || profile.definition?.mode === 'universal'
      if (!compatible && !window.confirm(`${profile.name} 与 ${label} 不兼容，仍要使用吗？`)) return
      onValueChange(profile.id)
    }}>
      <ComboboxInput aria-label={label} placeholder="搜索终端主题" className="w-full" />
      <ComboboxContent><ComboboxEmpty>未找到终端主题</ComboboxEmpty><ComboboxList>{(name) => {
        const profile = profileByName.get(name)
        if (!profile) return null
        return <ComboboxItem key={profile.id} value={name}>
          <span className="min-w-0 flex-1 truncate">{profile.name}</span>
          <Badge variant="outline">{profile.definition?.mode ?? 'unknown'}</Badge>
          <Badge variant="secondary">{profile.definition?.source_type ?? 'custom'}</Badge>
        </ComboboxItem>
      }}</ComboboxList></ComboboxContent>
    </Combobox>
  </div>
}
