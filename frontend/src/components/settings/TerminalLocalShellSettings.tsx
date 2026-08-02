import { useState } from 'react'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t } from '@/i18n'

export const SHELL_PRESET_DEFAULT = '__default__'
export const SHELL_PRESET_CUSTOM = '__custom__'

interface Props {
  shell: string
  args: string
  cwd: string
  login: boolean
  candidates: string[]
  onShellChange: (value: string) => void
  onArgsChange: (value: string) => void
  onCwdChange: (value: string) => void
  onLoginChange: (value: boolean) => void
}

/** True when `shell` is an empty or whitespace-only string (system default). */
function isShellDefault(shell: string): boolean {
  return shell.trim() === ''
}

/** The mode currently represented by the persisted `shell` value. */
function shellSelectValue(shell: string, candidates: readonly string[]): string {
  if (isShellDefault(shell)) return SHELL_PRESET_DEFAULT
  if (candidates.includes(shell)) return shell
  return SHELL_PRESET_CUSTOM
}

function ShellPathField(props: {
  shell: string
  candidates: string[]
  onChange: (value: string) => void
}) {
  const { shell, candidates, onChange } = props
  const [selected, setSelected] = useState(() => shellSelectValue(shell, candidates))
  return <Field className="md:col-span-2">
    <FieldContent>
      <FieldLabel htmlFor="terminal-local-shell">{t('Shell 路径')}</FieldLabel>
      <p className="text-xs text-muted-foreground">{t('可以从列表中选择系统探测到的 Shell，或选择自定义后手动填写。')}</p>
      <FieldDescription>{t('留空则使用系统默认（Unix: $SHELL，Windows: ComSpec/cmd.exe）。')}</FieldDescription>
    </FieldContent>
    <div className="flex flex-col gap-2">
      <Select value={selected} onValueChange={(nextValue) => {
        if (!nextValue) return
        setSelected(nextValue)
        if (nextValue === SHELL_PRESET_DEFAULT) onChange('')
        else if (nextValue !== SHELL_PRESET_CUSTOM) onChange(nextValue)
      }}>
        <SelectTrigger id="terminal-local-shell" aria-label={t('Shell 路径')} className="w-full justify-start">
          <SelectValue placeholder={t('选择或自定义 Shell')}>
            <span>{selected === SHELL_PRESET_CUSTOM ? t('自定义…') : selected === SHELL_PRESET_DEFAULT ? t('系统默认') : selected}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SHELL_PRESET_DEFAULT}>{t('系统默认')}</SelectItem>
          {candidates.map((candidate) => <SelectItem key={candidate} value={candidate}>{candidate}</SelectItem>)}
          <SelectItem value={SHELL_PRESET_CUSTOM}>{t('自定义…')}</SelectItem>
        </SelectContent>
      </Select>
      {selected === SHELL_PRESET_CUSTOM ? (
        <Input id="terminal-local-shell-custom" aria-label={t('Shell 路径（自定义）')} value={shell}
          placeholder="/bin/zsh" onChange={(event) => onChange(event.target.value)} />
      ) : null}
    </div>
  </Field>
}

function ShellArgumentFields({ args, cwd, onArgsChange, onCwdChange }: Pick<Props, 'args' | 'cwd' | 'onArgsChange' | 'onCwdChange'>) {
  return <>
    <Field>
      <FieldLabel htmlFor="terminal-local-shell-args">{t('启动参数')}</FieldLabel>
      <Input id="terminal-local-shell-args" aria-label={t('启动参数')} value={args}
        placeholder="-l" onChange={(event) => onArgsChange(event.target.value)} />
    </Field>
    <Field>
      <FieldContent>
        <FieldLabel htmlFor="terminal-local-shell-cwd">{t('工作目录')}</FieldLabel>
        <FieldDescription>{t('留空则使用用户家目录。')}</FieldDescription>
      </FieldContent>
      <Input id="terminal-local-shell-cwd" aria-label={t('工作目录')} value={cwd}
        placeholder="~" onChange={(event) => onCwdChange(event.target.value)} />
    </Field>
  </>
}

function ShellLoginField({ checked, onChange }: { checked: boolean; onChange: Props['onLoginChange'] }) {
  return <Field orientation="horizontal" className="md:col-span-2">
    <FieldContent>
      <FieldLabel htmlFor="terminal-local-shell-login">{t('以登录 Shell 启动')}</FieldLabel>
      <FieldDescription>{t('Unix 下默认附加 -l；若自定义了启动参数则不再自动附加。')}</FieldDescription>
    </FieldContent>
    <Switch id="terminal-local-shell-login" aria-label={t('以登录 Shell 启动')}
      checked={checked} onCheckedChange={onChange} />
  </Field>
}

export function TerminalLocalShellSettingsSection(props: Props) {
  return <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
    <div className="mb-3">
      <h3 className="text-sm font-medium text-foreground">{t('本地终端')}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t('配置本机交互 Shell 的默认路径、参数、工作目录与登录行为。')}</p>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <ShellPathField shell={props.shell} candidates={props.candidates} onChange={props.onShellChange} />
      <ShellArgumentFields args={props.args} cwd={props.cwd} onArgsChange={props.onArgsChange} onCwdChange={props.onCwdChange} />
      <ShellLoginField checked={props.login} onChange={props.onLoginChange} />
    </div>
  </section>
}