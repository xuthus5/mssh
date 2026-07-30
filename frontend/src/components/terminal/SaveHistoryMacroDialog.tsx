import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { emitMacroCatalogChanged, runMacroMutation, useMacroMutationState } from '@/lib/macroMutationCoordinator'
import { MacroService } from '@/lib/wails'
import type { MacroInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

interface SaveHistoryMacroDialogProps {
  command: string | null
  onClose: () => void
}

export function SaveHistoryMacroDialog({ command, onClose }: SaveHistoryMacroDialogProps) {
  const model = useSaveHistoryMacro(command, onClose)
  return <Dialog open={command !== null} onOpenChange={(open) => { if (!open && !model.busy) onClose() }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t('保存为宏')}</DialogTitle>
        <DialogDescription>{t('为这条历史命令命名，保存后可从宏列表重复使用。')}</DialogDescription>
      </DialogHeader>
      <form className="contents" onSubmit={(event) => { void model.save(event) }}>
        <MacroFields command={command} model={model} />
        {model.error ? <Alert variant="destructive"><AlertDescription>{model.error}</AlertDescription></Alert> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={model.busy} onClick={onClose}>{t('取消')}</Button>
          <Button type="submit" disabled={model.busy || !model.name.trim()}>
            {model.busy ? <Spinner data-icon="inline-start" /> : null}
            {t('保存宏')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

function useSaveHistoryMacro(command: string | null, onClose: () => void) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const source = useRef(Symbol('command-history-macro')).current
  const busy = useMacroMutationState((state) => state.busy)
  useEffect(() => {
    setName('')
    setError('')
  }, [command])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const macroName = name.trim()
    if (!command || !macroName || busy) return
    setError('')
    try {
      const input = {
        id: 0, name: macroName, command, shortcut: '', delay_ms: 0, sort_order: 0,
      } satisfies MacroInput
      await runMacroMutation(async () => { await MacroService.Create(input) })
      emitMacroCatalogChanged(source)
      toast(t('已保存为宏'), 'success')
      onClose()
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(t('创建宏失败: ${}', message))
    }
  }
  return { name, setName, error, busy, save }
}

type MacroDialogModel = ReturnType<typeof useSaveHistoryMacro>

function MacroFields({ command, model }: { command: string | null; model: MacroDialogModel }) {
  return <FieldGroup>
    <Field>
      <FieldLabel htmlFor="history-macro-name">{t('宏名称')}</FieldLabel>
      <Input id="history-macro-name" value={model.name} disabled={model.busy} autoFocus
        onChange={(event) => model.setName(event.target.value)} />
    </Field>
    <Field>
      <FieldLabel>{t('命令')}</FieldLabel>
      <code className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/40 p-2 font-mono text-xs">
        {command}
      </code>
    </Field>
  </FieldGroup>
}
