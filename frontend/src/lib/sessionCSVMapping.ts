export type SessionCSVProvider = 'mssh' | 'putty' | 'securecrt' | 'mobaxterm' | 'custom'

export interface SessionCSVField {
  key: string
  label: string
  required?: boolean
  placeholder?: string
}

export interface SessionCSVTemplate {
  id: SessionCSVProvider
  label: string
  description: string
  aliases: Record<string, string[]>
}

export type SessionCSVValues = Record<string, string>

export const SESSION_CSV_FIELDS: SessionCSVField[] = [
  { key: 'name', label: '会话名称', required: true },
  { key: 'host', label: '主机地址', required: true },
  { key: 'port', label: '端口', placeholder: '22' },
  { key: 'username', label: '用户名', required: true },
  { key: 'auth_method', label: '认证方式', placeholder: 'password' },
  { key: 'password', label: '密码' },
  { key: 'key_name', label: '密钥名称' },
  { key: 'key_public_key', label: '密钥公钥' },
  { key: 'folder_path', label: '分组路径', placeholder: '[]' },
  { key: 'environment', label: '环境' },
  { key: 'project', label: '项目' },
  { key: 'tags', label: '标签', placeholder: '[]' },
  { key: 'notes', label: '备注' },
  { key: 'keep_alive', label: '保活间隔', placeholder: '60' },
  { key: 'term_type', label: '终端类型', placeholder: 'xterm-256color' },
  { key: 'format_version', label: '格式版本', placeholder: '1' },
]

const commonAliases: Record<string, string[]> = {
  name: ['name', 'session name', 'session', 'profile', 'profile name'],
  host: ['host', 'hostname', 'host name', 'server', 'address'],
  port: ['port', 'port number', 'ssh port'],
  username: ['username', 'user', 'user name', 'login', 'login name'],
  auth_method: ['auth method', 'authentication', 'authentication method'],
  password: ['password', 'pass', 'login password'],
  key_name: ['key name', 'identity name'],
  key_public_key: ['public key', 'key public key'],
  folder_path: ['folder path', 'folder', 'group', 'category', 'path'],
  environment: ['environment', 'env'],
  project: ['project', 'project name'],
  tags: ['tags', 'tag', 'labels'],
  notes: ['notes', 'description', 'comment'],
  keep_alive: ['keep alive', 'keepalive', 'heartbeat'],
  term_type: ['terminal type', 'terminal', 'emulation'],
  format_version: ['format version', 'format_version'],
}

export const SESSION_CSV_TEMPLATES: SessionCSVTemplate[] = [
  {
    id: 'mssh', label: 'MSSH', description: 'MSSH 原生 CSV，字段可直接对应。',
    aliases: Object.fromEntries(SESSION_CSV_FIELDS.map((field) => [field.key, [field.key]])),
  },
  {
    id: 'putty', label: 'PuTTY', description: '匹配 PuTTY 常见 CSV 转换字段。',
    aliases: mergeAliases(commonAliases, {
      name: ['saved session', 'sessionname'], host: ['hostname'], port: ['portnumber'],
      username: ['auto login username', 'autologinusername'],
    }),
  },
  {
    id: 'securecrt', label: 'SecureCRT', description: '匹配 SecureCRT 常见会话清单字段。',
    aliases: mergeAliases(commonAliases, {
      name: ['session'], folder_path: ['session path', 'session folder'], term_type: ['terminal emulation'],
    }),
  },
  {
    id: 'mobaxterm', label: 'MobaXterm', description: '匹配 MobaXterm 常见书签 CSV 字段。',
    aliases: mergeAliases(commonAliases, {
      name: ['bookmark', 'bookmark name'], host: ['remote host', 'remotehost'], folder_path: ['bookmark group'],
    }),
  },
  { id: 'custom', label: '自定义', description: '按通用别名预匹配，再逐项调整。', aliases: commonAliases },
]

export function sessionCSVDefaults(): SessionCSVValues {
  return {
    format_version: '1', port: '22', auth_method: 'password', folder_path: '[]', tags: '[]',
    keep_alive: '60', term_type: 'xterm-256color',
  }
}

export function buildSessionCSVMapping(provider: SessionCSVProvider, headers: string[]): SessionCSVValues {
  const template = SESSION_CSV_TEMPLATES.find((item) => item.id === provider) ?? SESSION_CSV_TEMPLATES.at(-1)!
  const available = new Map(headers.map((header) => [normalizeSessionCSVHeader(header), header]))
  const used = new Set<string>()
  const mapping: SessionCSVValues = {}
  for (const field of SESSION_CSV_FIELDS) {
    const aliases = template.aliases[field.key] ?? []
    const source = aliases.map(normalizeSessionCSVHeader).map((alias) => available.get(alias)).find((header) => header && !used.has(header))
    mapping[field.key] = source ?? ''
    if (source) used.add(source)
  }
  return mapping
}

export function detectSessionCSVProvider(headers: string[]): SessionCSVProvider {
  const normalized = new Set(headers.map(normalizeSessionCSVHeader))
  const canonical = SESSION_CSV_FIELDS.every((field) => normalized.has(normalizeSessionCSVHeader(field.key)))
  if (canonical) return 'mssh'
  if (hasAny(normalized, ['saved session', 'sessionname', 'autologinusername'])) return 'putty'
  if (hasAny(normalized, ['session path', 'session folder', 'terminal emulation'])) return 'securecrt'
  if (hasAny(normalized, ['remote host', 'remotehost', 'bookmark', 'bookmark group'])) return 'mobaxterm'
  return 'custom'
}

export function missingSessionCSVFields(mapping: SessionCSVValues, defaults: SessionCSVValues): SessionCSVField[] {
  return SESSION_CSV_FIELDS.filter((field) => field.required && !mapping[field.key]?.trim() && !defaults[field.key]?.trim())
}

export function updateSessionCSVMapping(mapping: SessionCSVValues, target: string, source: string): SessionCSVValues {
  const next = { ...mapping }
  for (const [key, value] of Object.entries(next)) {
    if (key !== target && source && value === source) next[key] = ''
  }
  next[target] = source
  return next
}

export function sessionCSVSample(headers: string[], rows: string[][], source: string): string {
  const index = headers.indexOf(source)
  if (index < 0) return ''
  return rows.map((row) => row[index] ?? '').find((value) => value.trim()) ?? ''
}

export function normalizeSessionCSVHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_.-]+/g, ' ')
}

function mergeAliases(base: Record<string, string[]>, additions: Record<string, string[]>): Record<string, string[]> {
  const result = Object.fromEntries(Object.entries(base).map(([key, values]) => [key, [...values]]))
  for (const [key, values] of Object.entries(additions)) result[key] = [...values, ...(result[key] ?? [])]
  return result
}

function hasAny(values: Set<string>, candidates: string[]): boolean {
  return candidates.map(normalizeSessionCSVHeader).some((candidate) => values.has(candidate))
}
