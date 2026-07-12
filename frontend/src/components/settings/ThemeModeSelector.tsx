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
  const labels = useMemo(() => profileLabels(profiles), [profiles])
  const profileByName = useMemo(() => new Map(labels.map(({ label, profile }) => [label, profile])), [labels])
  const names = useMemo(() => labels.map(({ label }) => label), [labels])
  const selected = profiles.find((profile) => profile.id === value)
  const selectedLabel = labels.find((item) => item.profile.id === selected?.id)?.label
  const label = mode === 'dark' ? 'Dark Mode 终端主题' : 'Light Mode 终端主题'
  return <div className="flex min-w-0 flex-col gap-2">
    <label className="text-xs font-medium text-muted-foreground">{label}</label>
    <Combobox items={names} value={selectedLabel ?? ''} onValueChange={(name) => {
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

function profileLabels(profiles: ThemeProfile[]) {
  const counts = new Map<string, number>()
  profiles.forEach((profile) => counts.set(profile.name, (counts.get(profile.name) ?? 0) + 1))
  return profiles.map((profile) => ({ profile, label: counts.get(profile.name) === 1 ? profile.name : `${profile.name} · ${profile.definition?.source_type ?? 'custom'} · ${profile.id}` }))
}
