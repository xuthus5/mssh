import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox'
import type { ThemeProfile } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

interface Props {
  mode: 'dark' | 'light' | 'fixed'
  profiles: ThemeProfile[]
  value: number
  disabled?: boolean
  onValueChange: (id: number) => void
}

export function ThemeModeSelector({ mode, profiles, value, disabled = false, onValueChange }: Props) {
  const compatibleProfiles = useMemo(() => mode === 'fixed' ? profiles : profiles.filter((profile) => profile.definition?.mode === mode || profile.definition?.mode === 'universal'), [mode, profiles])
  const labels = useMemo(() => profileLabels(compatibleProfiles), [compatibleProfiles])
  const profileByName = useMemo(() => new Map(labels.map(({ label, profile }) => [label, profile])), [labels])
  const names = useMemo(() => labels.map(({ label }) => label), [labels])
  const selected = compatibleProfiles.find((profile) => profile.id === value)
  const selectedLabel = labels.find((item) => item.profile.id === selected?.id)?.label
  const label = mode === 'dark' ? 'Dark Mode 终端主题' : mode === 'light' ? 'Light Mode 终端主题' : '固定终端主题'
  return <div className="flex min-w-0 flex-col gap-2">
    <label className="text-xs font-medium text-muted-foreground">{label}</label>
    <Combobox items={names} value={selectedLabel ?? ''} disabled={disabled} onValueChange={(name) => {
      const profile = profileByName.get(name ?? '')
      if (!profile) return
      onValueChange(profile.id)
    }}>
      <ComboboxInput aria-label={label} placeholder="搜索终端主题" className="w-full" />
      <ComboboxContent><ComboboxEmpty>未找到终端主题</ComboboxEmpty><ComboboxList>{(name) => {
        const profile = profileByName.get(name)
        if (!profile) return null
        return <ComboboxItem key={profile.id} value={name}>
          <span className="flex shrink-0 gap-1">{profileSwatches(profile).map((color, index) => <span key={`${profile.id}-${index}`} data-testid="theme-color-swatch" className="size-3 rounded-sm border border-border" style={{ backgroundColor: color }} />)}</span>
          <span className="min-w-0 flex-1 truncate">{profile.name}</span>
          <Badge variant="outline">{profile.definition?.mode ?? 'unknown'}</Badge>
          <Badge variant="secondary">{profile.definition?.source_type ?? 'custom'}</Badge>
        </ComboboxItem>
      }}</ComboboxList></ComboboxContent>
    </Combobox>
  </div>
}

function profileSwatches(profile: ThemeProfile): string[] {
  try {
    const colors = JSON.parse(profile.definition?.color_payload ?? '{}') as { background?: string; ansi?: string[] }
    return [colors.background, colors.ansi?.[1], colors.ansi?.[2], colors.ansi?.[4]].filter((color): color is string => typeof color === 'string')
  } catch {
    return []
  }
}

function profileLabels(profiles: ThemeProfile[]) {
  const counts = new Map<string, number>()
  profiles.forEach((profile) => counts.set(profile.name, (counts.get(profile.name) ?? 0) + 1))
  return profiles.map((profile) => ({ profile, label: counts.get(profile.name) === 1 ? profile.name : `${profile.name} · ${profile.definition?.source_type ?? 'custom'} · ${profile.id}` }))
}
