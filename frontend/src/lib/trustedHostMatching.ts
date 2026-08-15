import type { Folder, Session } from '@/lib/sessionModels'

/** 从 known_hosts 的主机字段提取归一化主机名（去端口、去括号、小写）。 */
export function normalizeTrustedHost(hosts: string): string {
  const raw = hosts.trim()
  const bracketed = /^\[([^\]]+)](?::\d+)?$/.exec(raw)
  if (bracketed) return bracketed[1].toLowerCase()
  const plain = /^([^:]+)(?::\d+)?$/.exec(raw)
  return (plain?.[1] ?? raw).toLowerCase()
}

/** 匹配已信任主机条目对应的会话（主机名相同且端口匹配或主机无端口）。 */
export function matchSessionsForTrustedHost(hosts: string, sessions: Session[]): Session[] {
  const host = normalizeTrustedHost(hosts)
  const hasPort = /:\d+$/.test(hosts.trim())
  return sessions.filter((session) => {
    const sessionHost = session.host.trim().toLowerCase()
    if (sessionHost !== host) return false
    if (!hasPort) return true
    const portMatch = /:(\d+)$/.exec(hosts.trim())
    return portMatch ? Number(portMatch[1]) === session.port : true
  })
}

/** 构建会话 id → 分组名 的索引。 */
export function trustedHostFolderNames(folders: Folder[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const folder of folders) {
    if (!names.has(folder.id)) names.set(folder.id, folder.name)
  }
  return names
}

/** 已信任主机搜索文本：覆盖主机、会话名称、用户名、分组、环境、项目与指纹。 */
export function trustedHostSearchText(options: {
  hosts: string
  sessions: Session[]
  folderNames: Map<string, string>
  algorithm: string
  fingerprint: string
}): string {
  const { hosts, sessions, folderNames, algorithm, fingerprint } = options
  const parts = [hosts, algorithm, fingerprint]
  for (const session of sessions) {
    parts.push(session.name, session.username)
    if (session.folderId) parts.push(folderNames.get(session.folderId) ?? '')
    if (session.environment) parts.push(session.environment.name)
    if (session.project) parts.push(session.project.name, session.project.code)
    for (const tag of session.tags ?? []) parts.push(tag.name)
  }
  return parts.join('\n').toLocaleLowerCase()
}

/** 判断已信任主机条目是否匹配搜索词。 */
export function trustedHostMatches(options: {
  hosts: string
  sessions: Session[]
  folderNames: Map<string, string>
  algorithm: string
  fingerprint: string
  query: string
}): boolean {
  const q = options.query.trim().toLocaleLowerCase()
  if (!q) return true
  return trustedHostSearchText(options).includes(q)
}
