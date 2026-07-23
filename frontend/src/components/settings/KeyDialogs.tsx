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
import type { KeyImportFile, KeyInfo, KeyMaterial } from '@/hooks/useSettings'
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
  const options = useMemo(() => bitsOptions[type], [type])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try {
      const material = await onGenerate(name, type, Number(bits))
      if (!material) return
      onOpenChange(false); setName(''); onGenerated(material)
    } finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{t('生成密钥')}</DialogTitle></DialogHeader>
    <form onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="generate-key-name">{t('名称')}</FieldLabel><Input id="generate-key-name" aria-label={t('密钥名称')} value={name} onChange={(event) => setName(event.target.value)} required /></Field>
      <Field><FieldLabel>{t('类型')}</FieldLabel><LabeledSelect ariaLabel={t('密钥类型')} value={type} options={keyTypes} onValueChange={(value) => { const next = value as KeyInfo['type']; setType(next); setBits(defaultBits[next]) }} /></Field>
      <Field><FieldLabel>{t('位数')}</FieldLabel><LabeledSelect ariaLabel={t('密钥位数')} value={bits} options={options} onValueChange={setBits} /></Field>
    </FieldGroup><DialogFooter className="mt-4"><Button type="submit" disabled={saving}>{saving ? t('生成中...') : t('生成密钥')}</Button></DialogFooter></form>
  </DialogContent></Dialog>
}

interface ImportProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (name: string, privateKey: string) => Promise<KeyInfo | undefined>
  onSelectFile: () => Promise<KeyImportFile | undefined>
}

export function KeyImportDialog({ open, onOpenChange, onImport, onSelectFile }: ImportProps) {
  const [name, setName] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [saving, setSaving] = useState(false)
  const onSelectFileRef = useRef(onSelectFile)
  onSelectFileRef.current = onSelectFile
  const browse = async () => {
    const file = await onSelectFileRef.current()
    if (file) { setName(file.name); setPrivateKey(file.privateKey) }
  }
  useEffect(() => {
    if (!open) { setName(''); setPrivateKey(''); return }
    void browse()
  }, [open])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try { if (await onImport(name, privateKey)) onOpenChange(false) } finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{t('导入密钥')}</DialogTitle></DialogHeader>
    <form onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="import-key-name">{t('名称')}</FieldLabel><Input id="import-key-name" aria-label={t('导入名称')} value={name} onChange={(event) => setName(event.target.value)} required /></Field>
      <Field><div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="import-private-key">{t('私钥内容')}</FieldLabel><Button type="button" size="xs" variant="outline" onClick={() => { void browse() }}><FileKey data-icon="inline-start" />{t('选择文件')}</Button></div>
        <Textarea id="import-private-key" aria-label={t('导入私钥内容')} className="min-h-48 font-mono text-xs" value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} required />
        <FieldDescription>{t('文件选择器默认打开用户家目录下的 .ssh 文件夹。')}</FieldDescription>
      </Field>
    </FieldGroup><DialogFooter className="mt-4"><Button type="submit" disabled={saving}>{saving ? t('导入中...') : t('确认导入')}</Button></DialogFooter></form>
  </DialogContent></Dialog>
}

export type KeyMaterialMode = 'generated' | 'view' | 'edit'

function MaterialField({
  label, value, editable, onChange, onCopy,
}: {
  label: string
  value: string
  editable: boolean
  onChange: (value: string) => void
  onCopy: (label: string, value: string) => Promise<void>
}) {
  return <Field><div className="flex items-center justify-between gap-2"><FieldLabel>{label}{t('内容')}</FieldLabel><Button type="button" size="xs" variant="outline" aria-label={t('复制${}', label)} onClick={() => { void onCopy(label, value) }}><Copy data-icon="inline-start" />{t('复制')}</Button></div>
    <Textarea aria-label={t('${}内容', label)} className="min-h-36 font-mono text-xs" value={value} readOnly={!editable} onChange={(event) => onChange(event.target.value)} />
  </Field>
}

interface MaterialProps {
  state: { mode: KeyMaterialMode; material: KeyMaterial } | null
  onOpenChange: (open: boolean) => void
  onUpdate: (material: KeyMaterial) => Promise<KeyMaterial | undefined>
}

export function KeyMaterialDialog({ state, onOpenChange, onUpdate }: MaterialProps) {
  const [draft, setDraft] = useState<KeyMaterial | null>(state?.material ?? null)
  const [saving, setSaving] = useState(false)
  const [copyError, setCopyError] = useState('')
  useEffect(() => {
    setDraft(state?.material ?? null)
    setCopyError('')
  }, [state])
  if (!state || !draft) return null
  const editable = state.mode === 'edit'
  const title = state.mode === 'generated' ? t('密钥已生成') : editable ? t('编辑密钥') : t('查看密钥')
  const copyValue = async (label: string, value: string) => {
    try {
      await getClipboard().writeText(value)
      setCopyError('')
      toast(t('${}已复制', label), 'success')
    } catch (error) {
      setCopyError(t('复制${}失败: ${}', label, error instanceof Error ? error.message : String(error)))
    }
  }
  const save = async () => {
    setSaving(true)
    setCopyError('')
    try {
      if (await onUpdate(draft)) onOpenChange(false)
    } catch {
      // parent surfaces toast for mutation path without dialog-owned form error yet
    } finally {
      setSaving(false)
    }
  }
  return <Dialog open onOpenChange={onOpenChange}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
    <Alert><AlertDescription>{t('私钥属于敏感凭据。仅复制到可信位置，不要通过聊天、邮件或日志传输。')}</AlertDescription></Alert>
    {copyError ? <Alert variant="destructive"><AlertDescription>{copyError}</AlertDescription></Alert> : null}
    <FieldGroup>
      <Field><FieldLabel htmlFor="key-material-name">{t('名称')}</FieldLabel><Input id="key-material-name" aria-label={t('密钥名称')} value={draft.name} readOnly={!editable} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <MaterialField label={t('公钥')} value={draft.publicKey} editable={editable} onChange={(publicKey) => setDraft({ ...draft, publicKey })} onCopy={copyValue} />
      <MaterialField label={t('私钥')} value={draft.privateKey} editable={editable} onChange={(privateKey) => setDraft({ ...draft, privateKey })} onCopy={copyValue} />
    </FieldGroup>
    <DialogFooter>{editable && <Button type="button" disabled={saving} onClick={() => { void save() }}>{saving ? t('保存中...') : t('保存密钥')}</Button>}</DialogFooter>
  </DialogContent></Dialog>
}
