import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'

interface Props {
  shell: string
  args: string
  cwd: string
  login: boolean
  onShellChange: (value: string) => void
  onArgsChange: (value: string) => void
  onCwdChange: (value: string) => void
  onLoginChange: (value: boolean) => void
}

export function TerminalLocalShellSettingsSection({
  shell,
  args,
  cwd,
  login,
  onShellChange,
  onArgsChange,
  onCwdChange,
  onLoginChange,
}: Props) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{t('本地终端')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('配置本机交互 Shell 的默认路径、参数、工作目录与登录行为。')}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field className="md:col-span-2">
          <FieldContent>
            <FieldLabel htmlFor="terminal-local-shell">{t('Shell 路径')}</FieldLabel>
            <p className="text-xs text-muted-foreground">{t('仅允许系统认可的 Shell（Unix 参考 /etc/shells）。')}</p>
            <FieldDescription>
              {t('留空则使用系统默认（Unix: $SHELL，Windows: ComSpec/cmd.exe）。')}
            </FieldDescription>
          </FieldContent>
          <Input
            id="terminal-local-shell"
            aria-label={t('Shell 路径')}
            value={shell}
            placeholder="/bin/zsh"
            onChange={(event) => onShellChange(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="terminal-local-shell-args">{t('启动参数')}</FieldLabel>
          <Input
            id="terminal-local-shell-args"
            aria-label={t('启动参数')}
            value={args}
            placeholder="-l"
            onChange={(event) => onArgsChange(event.target.value)}
          />
        </Field>
        <Field>
          <FieldContent>
            <FieldLabel htmlFor="terminal-local-shell-cwd">{t('工作目录')}</FieldLabel>
            <FieldDescription>{t('留空则使用用户家目录。')}</FieldDescription>
          </FieldContent>
          <Input
            id="terminal-local-shell-cwd"
            aria-label={t('工作目录')}
            value={cwd}
            placeholder="~"
            onChange={(event) => onCwdChange(event.target.value)}
          />
        </Field>
        <Field orientation="horizontal" className="md:col-span-2">
          <FieldContent>
            <FieldLabel htmlFor="terminal-local-shell-login">{t('以登录 Shell 启动')}</FieldLabel>
            <FieldDescription>
              {t('Unix 下默认附加 -l；若自定义了启动参数则不再自动附加。')}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="terminal-local-shell-login"
            aria-label={t('以登录 Shell 启动')}
            checked={login}
            onCheckedChange={onLoginChange}
          />
        </Field>
      </div>
    </section>
  )
}
