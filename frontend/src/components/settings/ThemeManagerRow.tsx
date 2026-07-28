import { useEffect, useRef, useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TableCell, TableRow } from '@/components/ui/table'
import type { ThemeProfile, ThemeProfileInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'

export type ThemeActionRunner = (profileID: number, action: () => Promise<unknown> | unknown, onSuccess?: () => void) => Promise<void>

interface Props {
  profile: ThemeProfile
  resetRevision: number
  disabled?: boolean
  deleteDisabled?: boolean
  onCreateProfile: (input: ThemeProfileInput) => Promise<unknown> | unknown
  onUpdateProfile: (input: ThemeProfileInput) => Promise<void> | void
  onRequestDelete: (profile: ThemeProfile) => void
  runAction: ThemeActionRunner
}

function useThemeManagerRowState(profile: ThemeProfile, resetRevision: number) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile.name)
  const lifecycle = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  useEffect(() => {
    setEditing(false)
    setName(profile.name)
  }, [profile.name, resetRevision])
  const input = (): ThemeProfileInput => ({
    id: profile.id,
    name,
    theme_id: profile.theme_id,
    follow_global_style: profile.follow_global_style,
    font_family: profile.font_family,
    font_size: profile.font_size,
    cursor_style: profile.cursor_style,
    color_overrides: profile.color_overrides,
  } as ThemeProfileInput)
  return { editing, setEditing, name, setName, lifecycle, input }
}

export function ThemeManagerRow({ profile, resetRevision, disabled = false, deleteDisabled = false, onCreateProfile, onUpdateProfile, onRequestDelete, runAction }: Props) {
  const state = useThemeManagerRowState(profile, resetRevision)
  return (
    <TableRow aria-busy={disabled}>
      <TableCell>
        {state.editing ? (
          <Input aria-label={t('重命名 ${}', profile.name)} disabled={disabled} value={state.name} onChange={(event) => state.setName(event.target.value)} />
        ) : profile.name}
      </TableCell>
      <TableCell><Badge variant="outline">{profile.definition?.mode}</Badge></TableCell>
      <TableCell>{profile.definition?.source_type}</TableCell>
      <TableCell>{profile.definition?.source_license || t('未知')}</TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {state.editing ? (
            <Button type="button" size="xs" disabled={disabled} onClick={() => {
              const lifecycleToken = state.lifecycle.current
              void runAction(profile.id, () => onUpdateProfile(state.input()), () => {
                if (state.lifecycle.current === lifecycleToken) state.setEditing(false)
              })
            }}>{t('保存名称')}</Button>
          ) : <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => state.setEditing(true)}>{t('重命名')}</Button>}
          <Button type="button" size="icon-xs" variant="ghost" disabled={disabled} aria-label={t('复制 ${}', profile.name)} onClick={() => {
            void runAction(profile.id, () => onCreateProfile({ ...state.input(), id: 0, name: t('${} 副本', profile.name) } as ThemeProfileInput))
          }}><Copy /></Button>
          <Button type="button" size="icon-xs" variant="ghost" disabled={deleteDisabled} aria-label={t('删除 ${}', profile.name)} onClick={() => onRequestDelete(profile)}><Trash2 /></Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
