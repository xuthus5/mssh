import { t as translate } from '@/i18n'

/** @deprecated Prefer import { t } from '@/i18n'. Kept for compatibility. */
export const uiText = {
  newSession: '新建会话',
  macrosEmptyTitle: '还没有宏',
  macrosLoadFailed: '宏加载失败',
  macrosEmptyDescription: '在侧边栏「宏」中新增命令，或在此管理快捷命令模板。',
  macrosOpenSidebar: '打开侧边栏宏面板',
  macrosWorkspaceTitle: '宏工作区',
  macrosLoading: '加载宏...',
  macrosRefresh: '刷新',
  macrosNeedTerminal: '请先连接终端后再执行宏',
  macrosTerminalDisconnected: '当前终端未连接，无法执行宏',
  macrosSent: '宏已发送到活动终端',
  macrosExecuteFailed: '执行宏失败',
  commandCopied: '命令已复制',
  retry: '重试',
  welcomeTagline: 'Secure Shell Client & Session Manager',
  welcomeHint: '也可双击侧边栏会话列表中的主机开始连接',
  shortcuts: '快捷键',
  shortcutsPlatformHint: 'macOS 使用 ⌘，Windows/Linux 使用 Ctrl',
  openQuickSearch: '打开快速搜索',
  featureMultiTab: '多标签终端',
  featureRecording: '会话录制',
  featureKeys: '密钥管理',
} as const

export type UITextKey = keyof typeof uiText

export function t(key: UITextKey): string {
  return translate(uiText[key])
}
