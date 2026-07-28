import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { remoteTunnelExposureWarning } from '@/lib/tunnelBind'
import type { useTunnelDialogController } from '@/components/session/useTunnelDialogController'
import { t } from '@/i18n'

type Controller = ReturnType<typeof useTunnelDialogController>

const TUNNEL_TYPE_OPTIONS = [
  { value: 'local', label: '本地转发' },
  { value: 'remote', label: '远程转发' },
  { value: 'dynamic', label: '动态转发' },
]

export function TunnelDialogForm({ controller }: { controller: Controller }) {
  return <form onSubmit={controller.handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border p-3">
    <fieldset disabled={controller.busy} className="flex flex-col gap-3 border-0 p-0">
    <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-muted-foreground">{t('类型')}</label>
      <LabeledSelect ariaLabel={t('类型')} value={controller.type} options={TUNNEL_TYPE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} onValueChange={(value) => { controller.setType(value); controller.setError('') }} />
    </div>
    <TunnelAddressFields controller={controller} />
    <TunnelExposureNote controller={controller} />
    {controller.error && <p role="alert" className="text-sm text-destructive">{controller.error}</p>}
    <DialogFooter><Button type="submit" disabled={controller.busy}>{controller.pending ? t('启动中…') : t('启动')}</Button></DialogFooter>
    </fieldset>
  </form>
}

function TunnelAddressFields({ controller }: { controller: Controller }) {
  if (controller.type === 'dynamic') {
    return <div className="grid grid-cols-2 gap-3"><LocalAddressField controller={controller} /><PortField label={t('本地端口')} value={controller.localPort} placeholder="1080" onChange={controller.setLocalPort} /></div>
  }
  return <>
    <div className="grid grid-cols-2 gap-3"><LocalAddressField controller={controller} /><PortField label={t('本地端口')} value={controller.localPort} placeholder="8080" onChange={controller.setLocalPort} /></div>
    <div className="grid grid-cols-2 gap-3"><AddressField label={t('远程地址')} value={controller.remoteAddress} onChange={controller.setRemoteAddress} /><PortField label={t('远程端口')} value={controller.remotePort} placeholder="80" onChange={controller.setRemotePort} /></div>
  </>
}

function LocalAddressField({ controller }: { controller: Controller }) {
  return <AddressField label={t('本地地址')} value={controller.localAddress} onChange={(value) => { controller.setLocalAddress(value); controller.setError('') }} />
}

function AddressField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{props.label}</span><Input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder="127.0.0.1" /></label>
}

function PortField(props: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{props.label}</span><Input type="number" value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.placeholder} /></label>
}

function TunnelExposureNote({ controller }: { controller: Controller }) {
  if (controller.type === 'local' || controller.type === 'dynamic') {
    return <p className="text-xs text-muted-foreground">{t('本地/动态隧道仅允许绑定回环地址，避免意外对局域网暴露服务。')}</p>
  }
  if (controller.type !== 'remote') return null
  return <p className="text-xs text-amber-600 dark:text-amber-400">{t(remoteTunnelExposureWarning('remote', controller.remoteAddress)
    ?? '远程转发会在 SSH 服务端打开监听端口；绑定非回环地址时请确认安全边界。')}</p>
}
