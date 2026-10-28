import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { normalizeRemotePath } from '@/lib/fileMutationCoordinator'
import { t } from '@/i18n'


interface Props {
  currentPath: string
  onNavigateUp: () => void
  onNavigateTo: (path: string) => void
}

export function FilePathBar({ currentPath, onNavigateUp, onNavigateTo }: Props) {
  const editor = usePathEditor(currentPath, onNavigateTo)
  return <div className="border-b border-border">
    <div className="flex items-center gap-1 px-3 py-1.5">
      <button type="button" aria-label={t('上级目录')} className="flex-shrink-0 rounded p-0.5 hover:bg-muted" onClick={() => { editor.close(); onNavigateUp() }}><ArrowUp className="size-3.5" /></button>
      {editor.editing ? <PathEditor editor={editor} /> : <>
        <PathBreadcrumbs currentPath={currentPath} onNavigateTo={onNavigateTo} />
        <Button size="xs" variant="ghost" onClick={editor.open}><Pencil />{t('编辑路径')}</Button>
      </>}
    </div>
    {editor.inputError ? <p role="alert" className="px-3 pb-1.5 text-xs text-destructive">{editor.inputError}</p> : null}
  </div>
}

function usePathEditor(currentPath: string, onNavigateTo: (path: string) => void) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentPath)
  const [inputError, setInputError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setValue(currentPath)
  }, [currentPath, editing])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const close = () => {
    setEditing(false)
    setInputError('')
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) {
      setInputError(t('请输入目录路径'))
      return
    }
    if (!trimmed.startsWith('/')) {
      setInputError(t('目录路径必须以 / 开头'))
      return
    }
    close()
    onNavigateTo(normalizeRemotePath(trimmed))
  }

  const keyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    close()
  }

  return { editing, value, inputError, inputRef, open: () => setEditing(true), close, setValue, clearError: () => setInputError(''), submit, keyDown }
}

function PathEditor({ editor }: { editor: ReturnType<typeof usePathEditor> }) {
  return <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={editor.submit} onKeyDown={editor.keyDown}>
    <Input ref={editor.inputRef} aria-label={t('目录路径')} aria-invalid={Boolean(editor.inputError)} maxLength={4096} className="h-7 min-w-0 flex-1 text-sm" value={editor.value} placeholder="/var/log" onChange={(event) => { editor.setValue(event.target.value); editor.clearError() }} />
    <Button size="xs" type="submit">{t('前往')}</Button>
    <Button size="icon-xs" variant="ghost" type="button" aria-label={t('取消')} onClick={editor.close}><X /></Button>
  </form>
}

function PathBreadcrumbs({ currentPath, onNavigateTo }: Pick<Props, 'currentPath' | 'onNavigateTo'>) {
  const breadcrumbs = currentPath.split('/').filter(Boolean).map((name, index, parts) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}` }))
  return <div className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap">
    {currentPath === '/' ? <span className="text-sm text-muted-foreground">/</span> : breadcrumbs.map((crumb) => <span key={crumb.path} className="flex items-center text-sm"><span className="text-muted-foreground">/</span><button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => onNavigateTo(crumb.path)}>{crumb.name}</button></span>)}
  </div>
}
