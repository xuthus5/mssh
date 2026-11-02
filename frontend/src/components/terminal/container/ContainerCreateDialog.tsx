import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/i18n'
import type { ContainerEngineInfo } from '../../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { RESTART_OPTIONS, useContainerCreateForm } from './useContainerCreateForm'

interface Props {
  terminalID: string
  engines: ContainerEngineInfo[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

type CreateForm = ReturnType<typeof useContainerCreateForm>

export function ContainerCreateDialog({ terminalID, engines, open, onOpenChange, onCreated }: Props) {
  const form = useContainerCreateForm({ terminalID, engines, open, onCreated, onOpenChange })
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t('创建容器')}</DialogTitle>
        <DialogDescription>{t('通过已有容器引擎创建并启动容器；镜像不存在时请先在终端中拉取。')}</DialogDescription>
      </DialogHeader>
      {form.availableEngines.length === 0 ? <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">{t('没有检测到可用的容器引擎')}</p> : <ContainerFields form={form} />}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('取消')}</Button>
        <Button type="button" disabled={!form.canSubmit} onClick={() => { void form.submit() }}>{form.submitting ? t('创建中...') : t('创建')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function ContainerFields({ form }: { form: CreateForm }) {
  return <>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('容器引擎')}><LabeledSelect ariaLabel={t('容器引擎')} value={form.engine} options={form.availableEngines.map((item) => ({ value: item.name, label: `${item.name} ${item.version}`.trim() }))} onValueChange={form.setEngine} /></Field>
      <Field label={t('容器名称')}><Input aria-label={t('容器名称')} value={form.draft.name} onChange={(event) => form.update('name', event.target.value)} placeholder="web" /></Field>
    </div>
    <Field label={t('镜像名称')}><Input aria-label={t('镜像名称')} value={form.draft.image} onChange={(event) => form.update('image', event.target.value)} placeholder="nginx:latest" /></Field>
    {form.isContainerd && <Field label={t('containerd 命名空间')}><Input aria-label={t('containerd 命名空间')} value={form.draft.namespace} onChange={(event) => form.update('namespace', event.target.value)} placeholder="default" /></Field>}
    <Field label={t('启动参数（每行一个）')}><Textarea aria-label={t('启动参数（每行一个）')} value={form.draft.command} onChange={(event) => form.update('command', event.target.value)} placeholder={'nginx\n-g\ndaemon off;'} /></Field>
    <Field label={t('环境变量（每行一个，KEY=VALUE）')}><Textarea aria-label={t('环境变量（每行一个，KEY=VALUE）')} value={form.draft.env} onChange={(event) => form.update('env', event.target.value)} placeholder={'TZ=Asia/Shanghai\nAPP_ENV=production'} /></Field>
    <Field label={t('挂载（每行一个）')}><Textarea aria-label={t('挂载（每行一个）')} value={form.draft.volumes} onChange={(event) => form.update('volumes', event.target.value)} placeholder={form.isContainerd ? 'type=bind,src=/tmp,dst=/data' : '/data:/data'} /></Field>
    {!form.isContainerd && <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('端口映射（每行一个，host:container）')}><Textarea aria-label={t('端口映射（每行一个，host:container）')} value={form.draft.ports} onChange={(event) => form.update('ports', event.target.value)} placeholder="8080:80" /></Field>
      <Field label={t('重启策略')}><LabeledSelect ariaLabel={t('重启策略')} value={form.draft.restartPolicy} options={RESTART_OPTIONS.map((item) => ({ ...item, label: t(item.label) }))} onValueChange={(value) => form.update('restartPolicy', value)} /></Field>
    </div>}
  </>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-xs text-muted-foreground">
    <span>{label}</span>
    {children}
  </label>
}
