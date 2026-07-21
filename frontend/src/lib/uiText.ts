/** Lightweight UI string registry to avoid new magic Chinese scatter without keys. */
export const uiText = {
  newSession: '新建会话',
  macrosEmptyTitle: '还没有宏',
  macrosLoadFailed: '宏加载失败',
  commandCopied: '命令已复制',
  retry: '重试',
} as const

export type UITextKey = keyof typeof uiText

export function t(key: UITextKey): string {
  return uiText[key]
}
