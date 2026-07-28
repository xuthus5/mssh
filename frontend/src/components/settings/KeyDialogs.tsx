import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Copy, FileKey } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { getClipboard } from '@/lib/clipboard'
import type { KeyInfo, KeyMaterial } from '@/hooks/useSettings'
import { useDialogTarget, useKeyImportDialogRuntime, type KeyImportDialogProps, type KeyImportDialogRuntime } from '@/components/settings/keyDialogRuntime'
import { t } from '@/i18n'


const bitsOptions: Record<KeyInfo['type'], { value: string; label: string }[]> = {
  rsa: [{ value: '2048', label: '2048' }, { value: '4096', label: '4096' }],
  ed25519: [{ value: '256', label: '256' }],
  ecdsa: [{ value: '256', label: '256 (P-256)' }, { value: '384', label: '384 (P-384)' }, { value: '521', label: '521 (P-521)' }],
}
const defaultBits: Record<KeyInfo['type'], string> = { rsa: '2048', ed25519: '256', ecdsa: '256' }
const keyTypes = [{ value: 'rsa', label: 'RSA' }, { value: 'ed25519', label: 'Ed25519' }, { value: 'ecdsa', label: 'ECDSA' }]

interface GenerateProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerate: (name: string, type: KeyInfo['type'], bits: number) => Promise<KeyMaterial | undefined>
  onGenerated: (material: KeyMaterial) => void
}

export function KeyGenerateDialog({ open, onOpenChange, onGenerate, onGenerated }: GenerateProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<KeyInfo['type']>('ed25519')
  const [bits, setBits] = useState('256')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const target = useDialogTarget(open)
  const requestID = useRef(0)
  const active = useRef(false)
  const options = useMemo(() => bitsOptions[type], [type])
  useEffect(() => {
    if (!open) { setName(''); setFormError(''); setType('ed25519'); setBits('256') }
  }, [open])
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen || !active.current) onOpenChange(nextOpen)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (active.current) return
    active.current = true
    const targetToken = target.capture()
    const request = ++requestID.current
    const isLatest = () => target.isMounted(targetToken) && requestID.current === request
    const isCurrent = () => isLatest() && target.isCurrent(targetToken)
    setSaving(true); setFormError('')
    try {
      const material = await onGenerate(name, type, Number(bits))
      if (!material || !isCurrent()) return
      onOpenChange(false); setName(''); onGenerated(material)
    } catch (error) {
      if (isCurrent()) setFormError(t('生成密钥失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (isLatest()) { active.current = false; setSaving(false) }
    }
  }
  return <Dialog open={open} onOpenChange={handleOpenChange}><DialogContent showCloseButton={!saving} className="sm:max-w-md" aria-busy={saving}><DialogHeader><DialogTitle>{t('生成密钥')}</DialogTitle></DialogHeader>
    <form onSubmit={submit}><FieldGroup>
      {formError ? <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert> : null}
      <Field><FieldLabel htmlFor="generate-key-name">{t('名称')}</FieldLabel><Input id="generate-key-name" aria-label={t('密钥名称')} disabled={saving} value={name} onChange={(event) => setName(event.target.value)} required /></Field>
      <Field><FieldLabel>{t('类型')}</FieldLabel><LabeledSelect ariaLabel={t('密钥类型')} disabled={saving} value={type} options={keyTypes} onValueChange={(value) => { const next = value as KeyInfo['type']; setType(next); setBits(defaultBits[next]) }} /></Field>
      <Field><FieldLabel>{t('位数')}</FieldLabel><LabeledSelect ariaLabel={t('密钥位数')} disabled={saving} value={bits} options={options} onValueChange={setBits} /></Field>
    </FieldGroup><DialogFooter className="mt-4"><Button type="submit" disabled={saving}>{saving ? t('生成中...') : t('生成密钥')}</Button></DialogFooter></form>
  </DialogContent></Dialog>
}

export function KeyImportDialog(props: KeyImportDialogProps) {
  const model = useKeyImportDialogRuntime(props)
  return <Dialog open={props.open} onOpenChange={model.handleOpenChange}><DialogContent showCloseButton={!model.pending} className="sm:max-w-2xl" aria-busy={model.pending}><DialogHeader><DialogTitle>{t('导入密钥')}</DialogTitle></DialogHeader><KeyImportForm model={model} /></DialogContent></Dialog>
}

function KeyImportForm({ model }: { model: KeyImportDialogRuntime }) {
  return <form onSubmit={model.submit}><FieldGroup>
    {model.formError ? <Alert variant="destructive"><AlertDescription>{model.formError}</AlertDescription></Alert> : null}
    <Field><FieldLabel htmlFor="import-key-name">{t('名称')}</FieldLabel><Input id="import-key-name" aria-label={t('导入名称')} disabled={model.pending} value={model.name} onChange={(event) => model.changeName(event.target.value)} required /></Field>
    <Field><div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="import-private-key">{t('私钥内容')}</FieldLabel><Button type="button" size="xs" variant="outline" disabled={model.pending} onClick={() => { void model.browse() }}><FileKey data-icon="inline-start" />{model.browsing ? t('选择中...') : t('选择文件')}</Button></div>
      <Textarea id="import-private-key" aria-label={t('导入私钥内容')} disabled={model.pending} className="min-h-48 font-mono text-xs" value={model.privateKey} onChange={(event) => model.changePrivateKey(event.target.value)} required />
      <FieldDescription>{t('文件选择器默认打开用户家目录下的 .ssh 文件夹。')}</FieldDescription>
    </Field>
  </FieldGroup><DialogFooter className="mt-4"><Button type="submit" disabled={model.pending}>{model.saving ? t('导入中...') : t('确认导入')}</Button></DialogFooter></form>
}

export type KeyMaterialMode = 'generated' | 'view' | 'edit'

function MaterialField({
  label, value, editable, disabled, onChange, onCopy,
}: {
  label: string
  value: string
  editable: boolean
  disabled: boolean
  onChange: (value: string) => void
  onCopy: (label: string, value: string) => Promise<void>
}) {
  return <Field><div className="flex items-center justify-between gap-2"><FieldLabel>{label}{t('内容')}</FieldLabel><Button type="button" size="xs" variant="outline" disabled={disabled} aria-label={t('复制${}', label)} onClick={() => { void onCopy(label, value) }}><Copy data-icon="inline-start" />{t('复制')}</Button></div>
    <Textarea aria-label={t('${}内容', label)} className="min-h-36 font-mono text-xs" value={value} readOnly={!editable} onChange={(event) => onChange(event.target.value)} />
  </Field>
}

interface MaterialProps {
  state: { mode: KeyMaterialMode; material: KeyMaterial } | null
  onOpenChange: (open: boolean) => void
  onUpdate: (material: KeyMaterial) => Promise<KeyMaterial | undefined>
}

function useKeyMaterialActions({ state, draft, onOpenChange, onUpdate }: MaterialProps & { draft: KeyMaterial | null }) {
  const [saving, setSaving] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [formError, setFormError] = useState('')
  const targetKey = state ? `${state.mode}:${state.material.id}` : null
  const target = useDialogTarget(targetKey)
  const copyRequest = useRef(0)
  const saveRequest = useRef(0)
  const saveActive = useRef(false)
  useEffect(() => {
    copyRequest.current++
    setCopyError('')
    setFormError('')
  }, [targetKey])
  const copyValue = async (label: string, value: string) => {
    const targetToken = target.capture()
    const request = ++copyRequest.current
    const isCurrent = () => target.isCurrent(targetToken) && copyRequest.current === request
    try {
      await getClipboard().writeText(value)
      if (isCurrent()) {
        setCopyError('')
        toast(t('${}已复制', label), 'success')
      }
    } catch (error) {
      if (isCurrent()) setCopyError(t('复制${}失败: ${}', label, error instanceof Error ? error.message : String(error)))
    }
  }
  const save = async () => {
    if (!draft || saveActive.current) return
    saveActive.current = true
    const targetToken = target.capture()
    const request = ++saveRequest.current
    const isLatest = () => target.isMounted(targetToken) && saveRequest.current === request
    const isCurrent = () => isLatest() && target.isCurrent(targetToken)
    setSaving(true)
    setCopyError('')
    setFormError('')
    try {
      if (await onUpdate(draft)) { if (isCurrent()) onOpenChange(false) }
    } catch (error) {
      if (isCurrent()) setFormError(t('更新密钥失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (isLatest()) { saveActive.current = false; setSaving(false) }
    }
  }
  const handleOpenChange = (open: boolean) => { if (open || !saveActive.current) onOpenChange(open) }
  return { saving, copyError, formError, copyValue, save, handleOpenChange }
}

export function KeyMaterialDialog({ state, onOpenChange, onUpdate }: MaterialProps) {
  const [draft, setDraft] = useState<KeyMaterial | null>(state?.material ?? null)
  useEffect(() => { setDraft(state?.material ?? null) }, [state])
  const actions = useKeyMaterialActions({ state, draft, onOpenChange, onUpdate })
  if (!state || !draft) return null
  const editable = state.mode === 'edit'
  const title = state.mode === 'generated' ? t('密钥已生成') : editable ? t('编辑密钥') : t('查看密钥')
  return <Dialog open onOpenChange={actions.handleOpenChange}><DialogContent showCloseButton={!actions.saving} className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" aria-busy={actions.saving}><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
    <Alert><AlertDescription>{t('私钥属于敏感凭据。仅复制到可信位置，不要通过聊天、邮件或日志传输。')}</AlertDescription></Alert>
    {actions.formError ? <Alert variant="destructive"><AlertDescription>{actions.formError}</AlertDescription></Alert> : null}
    {actions.copyError ? <Alert variant="destructive"><AlertDescription>{actions.copyError}</AlertDescription></Alert> : null}
    <FieldGroup>
      <Field><FieldLabel htmlFor="key-material-name">{t('名称')}</FieldLabel><Input id="key-material-name" aria-label={t('密钥名称')} value={draft.name} readOnly={!editable || actions.saving} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <MaterialField label={t('公钥')} value={draft.publicKey} editable={editable && !actions.saving} disabled={actions.saving} onChange={(publicKey) => setDraft({ ...draft, publicKey })} onCopy={actions.copyValue} />
      <MaterialField label={t('私钥')} value={draft.privateKey} editable={editable && !actions.saving} disabled={actions.saving} onChange={(privateKey) => setDraft({ ...draft, privateKey })} onCopy={actions.copyValue} />
    </FieldGroup>
    <DialogFooter>{editable && <Button type="button" disabled={actions.saving} onClick={() => { void actions.save() }}>{actions.saving ? t('保存中...') : t('保存密钥')}</Button>}</DialogFooter>
  </DialogContent></Dialog>
}
