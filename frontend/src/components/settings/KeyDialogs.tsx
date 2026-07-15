import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Copy, FileKey } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import type { KeyImportFile, KeyInfo, KeyMaterial } from '@/hooks/useSettings'

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
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>生成密钥</DialogTitle></DialogHeader>
    <form onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="generate-key-name">名称</FieldLabel><Input id="generate-key-name" aria-label="密钥名称" value={name} onChange={(event) => setName(event.target.value)} required /></Field>
      <Field><FieldLabel>类型</FieldLabel><LabeledSelect ariaLabel="密钥类型" value={type} options={keyTypes} onValueChange={(value) => { const next = value as KeyInfo['type']; setType(next); setBits(defaultBits[next]) }} /></Field>
      <Field><FieldLabel>位数</FieldLabel><LabeledSelect ariaLabel="密钥位数" value={bits} options={options} onValueChange={setBits} /></Field>
    </FieldGroup><DialogFooter className="mt-4"><Button type="submit" disabled={saving}>{saving ? '生成中...' : '生成密钥'}</Button></DialogFooter></form>
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
  const browse = async () => {
    const file = await onSelectFile()
    if (file) { setName(file.name); setPrivateKey(file.privateKey) }
  }
  useEffect(() => {
    if (!open) { setName(''); setPrivateKey(''); return }
    void browse()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try { if (await onImport(name, privateKey)) onOpenChange(false) } finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>导入密钥</DialogTitle></DialogHeader>
    <form onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="import-key-name">名称</FieldLabel><Input id="import-key-name" aria-label="导入名称" value={name} onChange={(event) => setName(event.target.value)} required /></Field>
      <Field><div className="flex items-center justify-between gap-2"><FieldLabel htmlFor="import-private-key">私钥内容</FieldLabel><Button type="button" size="xs" variant="outline" onClick={() => { void browse() }}><FileKey data-icon="inline-start" />选择文件</Button></div>
        <Textarea id="import-private-key" aria-label="导入私钥内容" className="min-h-48 font-mono text-xs" value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} required />
        <FieldDescription>文件选择器默认打开用户家目录下的 .ssh 文件夹。</FieldDescription>
      </Field>
    </FieldGroup><DialogFooter className="mt-4"><Button type="submit" disabled={saving}>{saving ? '导入中...' : '确认导入'}</Button></DialogFooter></form>
  </DialogContent></Dialog>
}

export type KeyMaterialMode = 'generated' | 'view' | 'edit'

function MaterialField({ label, value, editable, onChange }: { label: string; value: string; editable: boolean; onChange: (value: string) => void }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); toast(`${label}已复制`, 'success') }
    catch (error) { toast(`复制${label}失败: ${error instanceof Error ? error.message : String(error)}`, 'error') }
  }
  return <Field><div className="flex items-center justify-between gap-2"><FieldLabel>{label}内容</FieldLabel><Button type="button" size="xs" variant="outline" aria-label={`复制${label}`} onClick={() => { void copy() }}><Copy data-icon="inline-start" />复制</Button></div>
    <Textarea aria-label={`${label}内容`} className="min-h-36 font-mono text-xs" value={value} readOnly={!editable} onChange={(event) => onChange(event.target.value)} />
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
  useEffect(() => { setDraft(state?.material ?? null) }, [state])
  if (!state || !draft) return null
  const editable = state.mode === 'edit'
  const title = state.mode === 'generated' ? '密钥已生成' : editable ? '编辑密钥' : '查看密钥'
  const save = async () => {
    setSaving(true)
    try { if (await onUpdate(draft)) onOpenChange(false) } finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={onOpenChange}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
    <Alert><AlertDescription>私钥属于敏感凭据。仅复制到可信位置，不要通过聊天、邮件或日志传输。</AlertDescription></Alert>
    <FieldGroup>
      <Field><FieldLabel htmlFor="key-material-name">名称</FieldLabel><Input id="key-material-name" aria-label="密钥名称" value={draft.name} readOnly={!editable} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <MaterialField label="公钥" value={draft.publicKey} editable={editable} onChange={(publicKey) => setDraft({ ...draft, publicKey })} />
      <MaterialField label="私钥" value={draft.privateKey} editable={editable} onChange={(privateKey) => setDraft({ ...draft, privateKey })} />
    </FieldGroup>
    <DialogFooter>{editable && <Button type="button" disabled={saving} onClick={() => { void save() }}>{saving ? '保存中...' : '保存密钥'}</Button>}</DialogFooter>
  </DialogContent></Dialog>
}
