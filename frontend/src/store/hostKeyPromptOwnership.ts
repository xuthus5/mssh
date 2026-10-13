/**
 * 记录后台重连正在占用的终端页签。
 *
 * 后台自动重连（页签不在前台）触发指纹确认时，弹框需要锚定到对应页签，
 * 而不是立即打断用户当前正在操作的页签。页签在前台时不会登记所有权，
 * 弹框仍按原有全局方式展示。
 */
const claims = new Map<number, string>()
let nextClaimToken = 1

/** 登记后台重连占用的页签，返回释放函数。 */
export function claimBackgroundHostKeyPromptTab(tabId: string): () => void {
  const token = nextClaimToken++
  claims.set(token, tabId)
  return () => {
    claims.delete(token)
  }
}

/** 解析当前后台重连占用的页签；没有占用时返回 null 表示全局弹框。 */
export function currentBackgroundHostKeyPromptTab(): string | null {
  let latest: string | null = null
  for (const tabId of claims.values()) latest = tabId
  return latest
}
