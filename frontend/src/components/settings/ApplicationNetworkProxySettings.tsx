import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  normalizeProxyMode,
  type NetworkProxyMode,
} from '@/hooks/useGeneralSettings'
import { t } from '@/i18n'

function proxyModeOptions() {
  return [
    { value: 'system', label: t('跟随系统') },
    { value: 'direct', label: t('直连') },
    { value: 'manual', label: t('手动代理') },
  ] as const
}

interface Props {
  proxyMode: NetworkProxyMode
  proxyURL: string
  proxyNoProxy: string
  proxyUsername: string
  proxyPassword: string
  proxyPasswordSaved?: boolean
  clearProxyPassword?: boolean
  onProxyModeChange: (value: NetworkProxyMode) => void
  onProxyURLChange: (value: string) => void
  onProxyNoProxyChange: (value: string) => void
  onProxyUsernameChange: (value: string) => void
  onProxyPasswordChange: (value: string) => void
  onClearProxyPasswordChange?: (value: boolean) => void
}

export function ApplicationNetworkProxySettingsSection({
  proxyMode,
  proxyURL,
  proxyNoProxy,
  proxyUsername,
  proxyPassword,
  proxyPasswordSaved = false,
  clearProxyPassword = false,
  onProxyModeChange,
  onProxyURLChange,
  onProxyNoProxyChange,
  onProxyUsernameChange,
  onProxyPasswordChange,
  onClearProxyPasswordChange,
}: Props) {
  const manual = proxyMode === 'manual'
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{t('网络代理')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('用于云同步、AI 提供商与检查更新等应用网络请求，不影响 SSH ProxyCommand/ProxyJump。')}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{t('代理模式')}</FieldLabel>
            <FieldDescription>{t('系统代理读取环境变量；直连忽略代理；手动使用下方配置。')}</FieldDescription>
          </FieldContent>
          <LabeledSelect
            ariaLabel={t('代理模式')}
            value={proxyMode}
            options={[...proxyModeOptions()]}
            onValueChange={(value) => onProxyModeChange(normalizeProxyMode(value))}
            className="w-44"
          />
        </Field>
        {manual && (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="app-proxy-url" className="text-xs font-medium text-muted-foreground">{t('代理地址')}</label>
              <Input
                id="app-proxy-url"
                aria-label={t('代理地址')}
                value={proxyURL}
                placeholder="http://127.0.0.1:1080"
                onChange={(event) => onProxyURLChange(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('支持 http、https、socks5 协议。')}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="app-proxy-noproxy" className="text-xs font-medium text-muted-foreground">{t('不代理地址')}</label>
              <Input
                id="app-proxy-noproxy"
                aria-label={t('不代理地址')}
                value={proxyNoProxy}
                placeholder="localhost,127.0.0.1,.internal"
                onChange={(event) => onProxyNoProxyChange(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('逗号分隔主机名或域名后缀。')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="app-proxy-user" className="text-xs font-medium text-muted-foreground">{t('用户名（可选）')}</label>
                <Input
                  id="app-proxy-user"
                  aria-label={t('代理用户名')}
                  value={proxyUsername}
                  autoComplete="off"
                  onChange={(event) => onProxyUsernameChange(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="app-proxy-pass" className="text-xs font-medium text-muted-foreground">{t('密码（可选）')}</label>
                <Input
                  id="app-proxy-pass"
                  aria-label={t('代理密码')}
                  type="password"
                  value={proxyPassword}
                  placeholder={proxyPasswordSaved && !clearProxyPassword ? t('已安全保存，留空保持不变') : ''}
                  disabled={clearProxyPassword}
                  autoComplete="new-password"
                  onChange={(event) => onProxyPasswordChange(event.target.value)}
                />
                {proxyPasswordSaved && onClearProxyPasswordChange && (
                  <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={clearProxyPassword}
                      onCheckedChange={(checked) => onClearProxyPasswordChange(checked === true)}
                      data-testid="clear-proxy-password"
                    />
                    <span>{t('清除已保存代理密码')}</span>
                  </label>
                )}
              </div>
            </div>
          </>
        )}
        {!manual && (
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <div className="text-sm font-medium text-foreground">{t('当前模式')}</div>
              <div className="text-xs text-muted-foreground">
                {proxyMode === 'direct' ? t('所有应用 HTTP 请求直连目标主机。') : t('使用系统环境变量中的 HTTP(S)_PROXY / ALL_PROXY。')}
              </div>
            </div>
            <Switch checked={proxyMode !== 'direct'} disabled aria-label={t('代理模式状态')} />
          </div>
        )}
      </div>
    </section>
  )
}
