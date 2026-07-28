# MSSH 商业化 EARS 任务清单

本清单将商业化检视结果固化为可验收任务。状态：`done` 已有实现并通过现有测试，`todo` 待实现，`partial` 已有基础但仍需补强。

## P0 安全与核心可靠性

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SEC-001 | 当首次遇到未知主机密钥时，系统必须在写入 known_hosts 前等待用户明确确认；指纹变化必须阻断连接。 | done |
| SEC-003 | 当记录连接、认证、同步和错误日志时，系统不得输出密码、私钥、主密钥或完整敏感 URI。 | done |
| SEC-004 | 当平台安全存储可用时，系统必须优先使用；降级文件存储时必须校验目录和文件权限。 | done |
| SEC-006 | 当导入任意数据校验失败时，系统必须保持当前数据库不变，并在导入前创建恢复点。 | done |
| CONN-001 | 当连接经历创建、连接、重连、关闭和失败时，系统必须通过单一状态机发布有序状态。 | done |
| CONN-002 | 当连接异常断开时，系统必须支持可取消的指数退避重连并展示最终失败原因。 | done |
| CONN-005 | 当主机是 IPv6 字面量时，系统必须生成合法的 `[host]:port` 地址。 | done |
| SFTP-002 | 当下载中断时，系统必须保留目标文件不变，并使用临时文件原子替换。 | done |
| DESKTOP-001 | 当用户退出应用时，系统必须停止连接、传输、录制、定时器和 watcher，并保证退出幂等。 | done |

## P1 核心体验与数据可靠性

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SEC-002 | 当用户打开安全设置时，系统必须提供主机指纹查看、删除和变更对比。 | done |
| CONN-003 | 当 keep-alive 失败时，系统必须与 shell 输入超时解耦，并保证连接关闭只执行一次。 | done |
| CONN-004 | 当同一会话拥有多个终端时，关闭一个终端不得影响其他终端。 | done |
| TERM-002 | 当终端连续改变尺寸时，系统必须去抖 resize，跳过 0 尺寸和重复尺寸。 | done |
| SESSION-001 | 当会话、分组、密钥、隧道或录制被删除时，系统必须展示关联资产影响范围。 | done |
| SESSION-002 | 当用户搜索会话时，系统必须支持名称、主机、端口、用户和分组，并支持 Enter 连接。 | done |
| SFTP-001 | 当传输运行、取消、失败或完成时，系统必须由后端持久化任务状态。 | done |
| TUNNEL-001 | 当 SSH 断开或应用退出时，系统必须停止关联隧道并清理转发资源。 | done |
| RECORD-001 | 当录制或回放文件损坏、缺失或版本不匹配时，系统必须显示可恢复错误。 | done |
| HISTORY-001 | 当用户通过粘贴、多行输入、宏或 tmux 执行命令时，系统必须准确记录可识别的命令来源。 | done |
| MON-001 | 当远端探针缺少命令或超时时，系统必须局部降级且不得阻塞终端。 | done |
| UX-001 | 当请求加载、失败、成功或为空时，系统必须使用统一状态和可操作反馈。 | done |
| UX-002 | 当用户重复点击保存、删除、导入或连接时，系统必须防止重复提交和过期响应覆盖。 | done |
| QA-001 | 当系统监控面板使用概览、进程、失败和断开流程时，必须有前端回归测试。 | done |
| QA-002 | 当测试环境启用真实 SSH、tmux 和 SFTP 时，必须覆盖 PTY、resize、重连和传输恢复。 | done |

## P2 商业竞争力

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-001 | 当用户启用云同步时，系统必须提供真实连接测试、冲突处理和同步版本信息。 | done |
| PRODUCT-001 | 当用户管理会话时，系统必须支持标签、备注、环境和项目元数据。 | done |
| PRODUCT-002 | 当用户切换工作区时，系统必须恢复标签、分屏、主题和工具面板状态。 | done |
| PRODUCT-003 | 当用户选择多个会话时，系统必须支持带确认和逐节点结果的批量操作。 | done |
| PRODUCT-004 | 当企业启用审计时，系统必须记录连接、导出、删除、密钥查看和批量执行行为。 | done |
| QA-003 | 当应用长时间运行并同时进行监控、录制、传输和重连时，必须无 goroutine 和资源泄漏。 | done |
| QA-004 | 当会话规模、终端滚动和传输规模增长时，系统必须满足定义的性能预算。 | done |

## 本轮执行顺序

1. 修复 IPv6 地址拼接、Agent socket 释放和随机 ID 错误处理。
2. 补强应用关闭时 SSH、SFTP 和隧道资源清理。
3. 加固导入校验、日志脱敏和终端尺寸同步。
4. 为新增路径补测试，并运行 Go、前端、lint、构建门禁。
5. 逐项闭环产品能力、统一交互、集成测试、资源测试和性能预算，不得以占位实现冒充完成。

## 16. 2026-07-22 追加商用硬化（generic settings / crash shell）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SEC-007 | 当通过通用 SettingService 读写 settings 时，系统必须拒绝 `sync.master_key` 与 `*.secret.*` 等敏感键，敏感凭证只能经 Security/Sync 专用 API。 | done |
| DESKTOP-002 | 当任意窗口 React 树渲染抛错时，系统必须展示可恢复错误壳（重试/重新加载），不得白屏。 | done |
| SYNC-002 | 当遗留 `useSyncSettings` 持久化云配置时，系统不得再写入明文 `sync.master_key`；同步密钥仅由应用 Vault DEK 派生。 | done |

## 17. 2026-07-22 追加：解锁限速与遗留同步 API 收敛

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SEC-008 | 当应用密码解锁连续失败达到阈值时，系统必须在冷却窗口内拒绝继续尝试，防止在线暴力破解。 | done |
| SYNC-003 | 当设置壳加载时，系统不得再暴露可写明文 master_key 的遗留 `useSyncSettings` 路径；云同步仅走 `useCloudSyncCenter` + Vault 派生密钥。 | done |

## 18. 2026-07-22 商用加固波次（host key fail-closed / vault panic）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SEC-011 | 当 known_hosts 路径为空时，系统必须拒绝建立 SSH 连接（fail-closed），不得回退到 `InsecureIgnoreHostKey`。 | done |
| SEC-012 | 当 vault nonce/密文字段非法时，系统必须返回错误，不得在 GCM Open 时 panic。 | done |
| SEC-013 | 当会话服务未配置 dataDir 时，系统必须拒绝连接并提示需要主机密钥校验目录。 | done |
| QA-005 | 当执行 CI 覆盖率门禁时，`go test -race -coverpkg=./internal/...,./pkg/...` 总覆盖率应 ≥90%。 | **done**（race coverpkg total 90.0%） |

实现锚点：`internal/ssh/client.go`、`internal/service/session_connect.go`、`internal/crypto/vault.go`，以及 host key / vault / rotate / terminal exit 等测试。

## 19. 2026-07-22 历史可商用验收快照

以下记录对应 2026-07-22 的历史提交；当前工作树的结果以文档末尾最新快照为准，提交后仍需在新 `HEAD` 上复验。

| 门禁 | 结果 |
|---|---|
| golangci-lint v2.12.2 | 0 issues |
| `go test -race -coverpkg=./internal/...,./pkg/...` | 全绿；coverpkg total **90.0%** |
| Go 生产文件行数 | `check-go-source-limits.mjs` OK（≤300） |
| 前端 source limits / bundle budget | OK |
| 前端 Vitest | 139 files / 709 tests passed |
| 生产构建 `wails3 build` | 成功生成 `bin/mssh` |

安全锚点复核（代码）：

- SSH known_hosts 空路径 fail-closed（禁止 `InsecureIgnoreHostKey`）
- 会话密码 `enc1:` + Vault DEK；通用 Setting API 阻断密钥键
- 解锁失败限速；vault 非法 nonce 不 panic
- 同步密钥由 DEK 派生，不再经遗留 master_key 设置面

非阻塞残留（不阻断可商用验收，属后续增强）：

- 跨平台系统探针命令矩阵扩展
- 事件总线 Emit 零拷贝契约
- SQLite 读写分离 / 多连接架构

当时结论：在当时 EARS 清单、CI 门禁与安全锚点证据下，项目代码质量达到**可商用基线**。后续硬化波次继续扩大了并发、同步认证、传输关闭和前端状态覆盖范围。


## 2026-07-23 商用硬化波次（本地 Shell / 串口 / 快捷键）

| ID | 验收条件 | 状态 |
|---|---|---|
| TERM-SPLIT-001 | 当 tab 级重连替换 primary terminalID 时，分屏树必须同步映射，避免死窗格。 | done |
| SERIAL-001 | 当 LRU 驱逐串口终端时，系统必须释放设备独占锁。 | done |
| SERIAL-002 | 串口终端不得分屏二次 Open，也不得参与自动重连（避免 DTR 复位 MCU）。 | done |
| SERIAL-003 | 串口删除确认必须使用 shadcn AlertDialog，而非原生 confirm。 | done |
| SEC-UI-001 | 密钥删除与主机指纹删除、密码轮转确认使用 shadcn AlertDialog。 | done |
| LOCAL-001 | 本地 Shell 路径必须可解析为绝对路径且（Unix）可执行。 | done |
| LOCAL-002 | 本地/串口命令历史非正 sessionID 不得调用后端 List。 | done |
| SHORTCUT-001 | 快捷键冲突时暂停自动保存并提示用户消解。 | done |
| WORKSPACE-001 | 恢复工作区时，本地/串口 tab 不得恢复 files/system/ai 远程面板。 | done |
| SERIAL-004 | 占用中的串口配置禁止删除；Write/Break/Close 并发安全。 | done |
| LOCAL-003 | 多本地终端命令历史按 terminalInstance 分桶。 | done |
| LOCAL-004 | OpenLocal 优先复用当前终端尺寸。 | done |
| LOCAL-005 | Unix 本地 Shell 使用新会话并在关闭时向进程组发信号。 | done |
| SHORTCUT-002 | 终端工具栏复制/粘贴/清屏提示显示当前自定义快捷键。 | done |

## 2026-07-23 商用硬化波次（串口 modem / 路径 / 分屏持久化）

| ID | 验收条件 | 状态 |
|---|---|---|
| SERIAL-005 | 当查询串口信号时，系统必须返回 DTR/RTS 输出与 CTS/DSR/DCD/RI 输入状态（GetModemStatusBits）。 | done |
| SERIAL-006 | 串口工具栏必须以指示灯展示 CTS/DSR/DCD/RI，并周期性刷新输入状态。 | done |
| SERIAL-007 | 设备路径在列表、预留与配置归一时必须 canonical（Unix symlink / Windows COM）。 | done |
| SERIAL-008 | 串口中心在窗口 focus 与可见轮询时刷新设备列表（热插拔）。 | done |
| WORKSPACE-002 | 工作区快照 v3 必须按 role 持久化 SSH/本地分屏拓扑，且不得写入运行时 terminalID。 | done |
| WORKSPACE-003 | 串口标签不得持久化或多开分屏拓扑（设备独占）。 | done |
| WORKSPACE-004 | 恢复标签时 TerminalSplit 必须按 snapshot 打开额外窗格并 materialize 树。 | done |

## 2026-07-23 商用硬化波次（占用匹配 / 工作区迁移 / 终端搜索快捷键）

| ID | 验收条件 | 状态 |
|---|---|---|
| SERIAL-009 | 串口中心“使用中/在线”状态必须通过路径归一比较 active map 与设备列表，避免 symlink/COM 形式不一致导致误判。 | done |
| WORKSPACE-005 | 当持久化布局为 v2 时，系统必须迁移到 v3 后恢复，而不是直接丢弃用户标签。 | done |
| SHORTCUT-003 | 当活动面为终端标签时，Mod+F（quick-search 绑定）必须切换终端内搜索；非终端活动面仍打开会话快速搜索。 | done |

## 2026-07-23 商用硬化波次（原生 confirm 收敛）

| ID | 验收条件 | 状态 |
|---|---|---|
| UI-CONFIRM-001 | 终端池回收保护标签确认必须使用 shadcn AlertDialog（Promise 通道），不得使用 `window.confirm`。 | done |
| UI-CONFIRM-002 | 云同步热更新失败后的硬刷新确认必须使用 shadcn AlertDialog，不得使用 `window.confirm`。 | done |

## 2026-07-23 商用硬化波次（本地 Shell 安全）

| ID | 验收条件 | 状态 |
|---|---|---|
| LOCAL-006 | 本地 Shell 路径必须属于允许列表（Unix：`/etc/shells` ∪ 常见 shell；Windows：ComSpec/PowerShell 族），拒绝任意可执行文件。 | done |
| LOCAL-007 | 本地 Shell 启动参数必须支持引号分组解析，不得因空格错误拆分参数。 | done |

## 2026-07-23 商用硬化波次（分屏恢复清理 / 系统保留快捷键）

| ID | 验收条件 | 状态 |
|---|---|---|
| WORKSPACE-006 | 当分屏布局恢复被取消或组件卸载时，系统必须关闭已打开的额外窗格终端，避免连接泄漏。 | done |
| SHORTCUT-004 | 当用户绑定系统保留快捷键（如 Mod+Q、Alt+F4、Mod+Tab）时，系统必须拒绝保存并提示。 | done |

## 2026-07-23 商用硬化波次（设置窗确认宿主）

| ID | 验收条件 | 状态 |
|---|---|---|
| UI-CONFIRM-003 | 设置窗口必须挂载 `ConfirmDialogHost`，与主窗口共用 Promise 确认通道。 | done |
| UI-CONFIRM-004 | 当确认宿主未挂载时，`requestConfirm` 必须立即 fail-closed 返回 false，不得永久挂起调用方。 | done |

## 2026-07-23 商用硬化波次（i18n 完整度 / 串口信号轮询）

| ID | 验收条件 | 状态 |
|---|---|---|
| I18N-001 | 英文目录不得残留中文值；生产 UI 字符串切换英文后展示英文。 | done |
| I18N-002 | 明显错误的粘连英文（如 Opensettings、searchname）必须修正为可读英文。 | done |
| I18N-003 | 运行时拼接与模板字面量中的中文提示必须走 `t()` 通道。 | done |
| SERIAL-010 | 当串口终端不存在或已关闭时，信号工具栏必须停止轮询并禁用控制，避免日志刷屏。 | done |

## 2026-07-23 商用硬化波次（系统监控停轮询）

| ID | 验收条件 | 状态 |
|---|---|---|
| MON-002 | 当终端不存在或已关闭时，系统监控面板必须停止 SystemInfo/ProcessInfo 轮询，避免日志与后端探测刷屏。 | done |
| TERM-GONE-001 | 前端共享 `isTerminalGone` 判定，串口信号与系统监控在终端失效时 fail-closed 停止轮询。 | done |

## 2026-07-23 商用硬化波次（打开终端尺寸继承）

| ID | 验收条件 | 状态 |
|---|---|---|
| TERM-SIZE-001 | 当分屏、工作区恢复、会话/串口/本地/批量打开终端时，系统必须优先继承当前活动终端尺寸，而非固定 80x24。 | done |
| TERM-SIZE-002 | 当不存在可用终端尺寸时，系统必须回退到 80x24 默认值。 | done |

## 2026-07-23 商用硬化波次（代理密码加密）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-PROXY-001 | 应用网络代理密码必须使用 vault DEK 加密落库；通用 Setting API 读取时不得返回明文或密文。 | done |
| SEC-PROXY-002 | 空密码写入必须保留已保存密钥；明确清除动作必须删除密钥并更新 live proxy 配置。 | done |
| SEC-PROXY-003 | 设置页必须展示“已安全保存/清除”语义，自动保存不得因脱敏空值误删代理密码。 | done |

## 2026-07-23 商用硬化波次（分屏非活动窗格尺寸）

| ID | 验收条件 | 状态 |
|---|---|---|
| SPLIT-FIT-001 | 当分屏/布局改变导致非活动窗格尺寸变化时，系统仍必须对 xterm 执行 fit 并向后端同步 PTY 尺寸。 | done |
| SPLIT-FIT-002 | 非活动窗格尺寸同步不得抢焦点或触发 activation recover 的 focus 路径。 | done |

## 2026-07-23 商用硬化波次（主密码轮转覆盖凭证）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-ROTATE-001 | 当用户轮转应用主密码时，系统必须重加密会话密码、SSH 私钥、应用代理密码与云同步凭据。 | done |
| SEC-ROTATE-002 | 轮转后使用新 DEK 必须能解密代理密码与 sync.secret.* 凭据，旧 DEK 不得再打开密文。 | done |

## 2026-07-23 商用硬化波次（启动应用网络代理）

| ID | 验收条件 | 状态 |
|---|---|---|
| PROXY-BOOT-001 | 当应用启动时，系统必须从持久化设置加载并应用网络代理配置（含手动 URL/认证）。 | done |
| PROXY-BOOT-002 | 当 vault 解锁成功（含手动解锁/自动解锁/首次设置/密码轮转）后，系统必须重新应用代理配置以便解密代理密码。 | done |

## 2026-07-23 商用硬化波次（轮转原子性 / CSV 导出二次验证）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-ROTATE-003 | 主密码轮转重加密必须先准备全部密文，再在同一数据库事务中提交；中途失败不得留下新旧 DEK 混杂数据。 | done |
| SEC-EXPORT-001 | 当 CSV 导出包含已保存会话密码时，系统必须要求验证应用密码（step-up），验证失败不得写出明文密码。 | done |
| SEC-EXPORT-002 | 设置页/导出会话 UI 在勾选包含密码时必须收集应用密码确认，未填写时禁止提交。 | done |

## 2026-07-23 商用硬化波次（导出路径权限）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-FS-001 | 原子写私有文件时，仅新建缺失父目录为 0700；不得修改已存在的用户导出目录权限。 | done |
| SEC-FS-002 | 导出/备份文件本身必须为 0600。 | done |

## 2026-07-23 商用硬化波次（隧道回环绑定前端对齐）

| ID | 验收条件 | 状态 |
|---|---|---|
| TUNNEL-BIND-001 | 本地/动态隧道前端创建时必须拒绝非回环本地地址（如 0.0.0.0），与后端策略一致。 | done |
| TUNNEL-BIND-002 | 表单需展示回环绑定说明；非法地址不得调用创建/启动 API。 | done |

## 2026-07-23 商用硬化波次（AI 提供商 URL / 非活动主题刷新）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-AI-URL-001 | AI Provider BaseURL 仅允许 http/https；禁止 URL userinfo 凭据。 | done |
| SEC-AI-URL-002 | 必须拒绝链路本地/未指定/组播及云元数据主机（169.254.0.0/16、metadata.google.internal 等）。 | done |
| SEC-AI-URL-003 | 非本机回环主机必须使用 HTTPS。 | done |
| THEME-FIT-001 | 主题变更时非活动分屏窗格仍必须 fit 刷新视觉主题；仅活动窗格失败才标记 recoveryPending。 | done |

## 2026-07-23 商用硬化波次（命令历史敏感过滤 / 锁定调度同步）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-HIST-001 | 后端 CommandHistory.Add 必须过滤空命令与敏感命令模式，与前端 isSensitiveCommand 策略对齐；敏感命令不得写入数据库。 | done |
| SEC-HIST-002 | 敏感命令被拒绝时不得返回错误（前端静默跳过），避免刷错误日志。 | done |
| SYNC-SCHED-001 | 定时云同步在应用 vault 锁定或未配置时必须跳过本轮，不得将运行时状态置为 error，也不得写入失败同步事件。 | done |
| SYNC-SCHED-002 | vault 解锁后下一定时 tick 必须可继续执行同步（调度器保持运行）。 | done |

## 2026-07-23 商用硬化波次（HTTP 重定向 SSRF）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-HTTP-001 | 应用共享 HTTP 客户端（AI/同步/检查更新）必须限制重定向次数（<=5）。 | done |
| SEC-HTTP-002 | 重定向目标必须拒绝非 http(s)、URL 凭据、链路本地/元数据主机，且非回环主机强制 HTTPS。 | done |
| SEC-HTTP-003 | 跨主机重定向必须剥离 Authorization 与常见 API Key 头，防止密钥泄漏。 | done |

## 2026-07-23 商用硬化波次（解锁后同步追赶）

| ID | 验收条件 | 状态 |
|---|---|---|
| SYNC-SCHED-003 | 应用 vault 解锁成功后必须触发一次 best-effort 定时策略同步（NotifyVaultUnlocked），不得阻塞解锁主路径。 | done |
| SYNC-SCHED-004 | 当同步未启用或 vault 仍不可用时，解锁追赶必须静默跳过，不得将状态置为 error。 | done |
| SYNC-SCHED-005 | 启动时若 vault 已自动解锁，必须在注册 afterUnlock 钩子后立即执行一次追赶，覆盖钩子注册时序竞态。 | done |

## 2026-07-23 商用硬化波次（SFTP 远程路径校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SFTP-PATH-001 | ListDir/Delete/Mkdir/Rename 必须拒绝空远程路径与含 NUL 的路径，与上传/下载策略对齐。 | done |
| SFTP-PATH-002 | 非法远程路径必须在建立 SSH/SFTP 连接前失败返回。 | done |

## 2026-07-23 商用硬化波次（同步端点 URL 策略）

| ID | 验收条件 | 状态 |
|---|---|---|
| SYNC-URL-001 | WebDAV/Gist/云端端点 URL 必须拒绝 URL userinfo 凭据。 | done |
| SYNC-URL-002 | 同步端点必须拒绝链路本地/未指定/组播及云元数据主机（与 AI URL 策略一致）。 | done |
| SYNC-URL-003 | 非回环主机仍必须 HTTPS；仅 loopback 允许 HTTP 本地调试。 | done |

## 2026-07-23 商用硬化波次（S3/WebDAV 配置期 URL 校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SYNC-URL-004 | 保存同步配置时，S3 自定义 Endpoint 与 WebDAV URL 必须通过 HTTPS/主机策略校验。 | done |
| SYNC-URL-005 | 创建 S3 provider 时必须再次校验 Endpoint（防御直接构造路径）。 | done |
| SYNC-URL-006 | 空 S3 Endpoint（使用 AWS 默认）必须允许。 | done |

## 2026-07-23 商用硬化波次（应用代理 URL 校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| PROXY-URL-001 | 手动代理 URL 不得包含 userinfo 凭据；认证必须使用独立 username/password 字段。 | done |
| PROXY-URL-002 | 手动代理 URL 必须拒绝链路本地/未指定/组播及云元数据主机。 | done |
| PROXY-URL-003 | 仍允许 http/https/socks5/socks5h 与局域网/公网代理主机（企业场景）。 | done |

## 2026-07-23 商用硬化波次（主机密钥变更错误 UX）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-HOSTKEY-001 | 当 known_hosts 中已有指纹且远端呈现不同密钥时，连接必须被阻断（不得 TOFU 覆盖）。 | done |
| SEC-HOSTKEY-002 | 变更错误信息必须包含主机名、期望指纹与呈现指纹，并提示可在安全设置删除旧指纹。 | done |
| SEC-HOSTKEY-003 | 连接失败对话框必须对 host-key change 错误追加本地化商业提示（中英）。 | done |

## 2026-07-23 商用硬化波次（HTTP dial-time SSRF）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-HTTP-004 | 共享 HTTP Transport 必须使用安全 DialContext：阻断链路本地/未指定/组播/169.254 元数据 IP。 | done |
| SEC-HTTP-005 | 主机名解析后必须对每个候选 IP 再次校验；全部被阻断时不得建立连接（缓解 DNS rebinding 到元数据）。 | done |
| SEC-HTTP-006 | 代理场景下仍保留 proxy Transport，并叠加 DialContext 与 CheckRedirect 策略。 | done |

## 2026-07-23 商用硬化波次（命令历史敏感规则误杀）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-HIST-003 | 敏感命令过滤不得把通用短选项 `-p`（如 `ps -p`、`pacman -Syu`）误判为敏感。 | done |
| SEC-HIST-004 | 仍必须拦截 `--password`、mysql/psql `-psecret`、sshpass `-p`、Bearer/export KEY 等明确凭据形态。 | done |

## 2026-07-23 商用硬化波次（known_hosts 并发写）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-HOSTKEY-004 | 并发首次连接写入 known_hosts 时必须串行化 create/append，避免交叉写损坏。 | done |
| SEC-HOSTKEY-005 | append 成功后必须 Sync 落盘，降低异常退出丢指纹风险。 | done |

## 2026-07-23 商用硬化波次（known_hosts 删除与写入共享锁）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-HOSTKEY-006 | 删除主机指纹（read-modify-write）必须与 TOFU append 共用进程级锁，避免并发连接接受指纹时覆盖删除结果。 | done |
| SEC-HOSTKEY-007 | 删除路径必须先写临时文件（0600）、Sync 后再 Rename 替换。 | done |
| SEC-HOSTKEY-008 | 对外暴露 `WithKnownHostsLock` 供 service 层安全改写 known_hosts。 | done |

## 2026-07-23 商用硬化波次（静默自动保存错误提示）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-AUTOSAVE-001 | quiet 自动保存仅抑制成功 toast，失败时仍必须弹出错误 toast。 | done |
| UX-AUTOSAVE-002 | 通用设置、SFTP、AI 设置、云同步配置保存路径均遵守上述错误可见性。 | done |

## 2026-07-23 商用硬化波次（性能预算对齐 + 日志目录校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| PERF-BUDGET-001 | 性能预算文档必须与 `performance_test.go` 常量一致（list 750ms / transfer 3s / output+parse 500ms），并说明 CI/race slack 与本地 profiling 目标差异。 | done |
| PERF-BUDGET-002 | 硬门禁不得再引用已废弃的 250ms list / 2s transfer 作为 CI 失败阈值。 | done |
| LOG-DIR-001 | 用户配置 `application.log_dir` 必须拒绝含 NUL、超长路径、清理后为 `.`/`..` 的目录。 | done |
| LOG-DIR-002 | 非法 log_dir 必须在持久化前由 `validateRuntimeSettings`/`ValidateDir` 失败，不得写入 DB，也不得调用 log Configure。 | done |
| LOG-DIR-003 | 空 log_dir 仍归一为默认 `~/.mssh/logs`；合法相对/绝对路径经 `filepath.Clean` 后使用。 | done |

## 2026-07-23 商用硬化波次（known_hosts 列表读锁）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-HOSTKEY-009 | `ListHostKeys` 必须在 `WithKnownHostsLock` 下读取，避免与 TOFU append/delete 并发产生撕裂读。 | done |
| SEC-HOSTKEY-010 | known_hosts 扫描单行缓冲必须有上界（64KiB），超长行按读错误失败而非无限扩容。 | done |

## 2026-07-23 商用硬化波次（AI 命令写入超时）

| ID | 验收条件 | 状态 |
|---|---|---|
| AI-EXEC-001 | `ExecuteCommand` 写入终端必须受 `security.command_timeout_seconds` 约束；超时返回明确错误并记录 failed 审计。 | done |
| AI-EXEC-002 | AI 注入终端的命令字节长度必须有上界（32KiB），超限拒绝执行。 | done |

## 2026-07-23 商用硬化波次（远程隧道暴露提示）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-TUNNEL-001 | 创建/编辑远程转发时，UI 必须提示远端监听暴露风险（尤其 0.0.0.0/:: 与非回环地址）。 | done |
| SEC-TUNNEL-002 | `remoteTunnelExposureWarning` 对 local/dynamic 返回 null，对 loopback remote 不报警。 | done |

## 2026-07-23 商用硬化波次（宏执行策略对齐 AI）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-MACRO-001 | 宏执行必须加载当前 AI 安全策略（deny/allow/auto-readonly 默认值），不得使用空 security 配置绕过自定义 deny。 | done |
| SEC-MACRO-002 | 宏写入终端必须复用 AI 命令超时与 32KiB 长度上界，超时/超限记录审计并失败。 | done |
| SEC-MACRO-003 | 创建/更新宏时必须校验名称非空、命令非空、命令长度上界、DelayMs ∈ [0,60000]。 | done |

## 2026-07-23 商用硬化波次（AI 上下文 MaxOutputBytes）

| ID | 验收条件 | 状态 |
|---|---|---|
| AI-CTX-001 | 前端 `captureTerminalContext` 必须在行数截断后，再按 `security.max_output_bytes` 做 UTF-8 字节截断（保留尾部上下文）。 | done |
| AI-CTX-002 | 后端 `Chat` 在脱敏后必须对终端上下文应用 `clampAITextBytes`，并在拼接会话/系统摘要后再次截断，防止绕过。 | done |
| AI-CTX-003 | 字节截断不得拆分 UTF-8 码点；超预算时从头部丢弃整 rune。 | done |

## 2026-07-23 商用硬化波次（分屏次级窗格池保护与 reparent 恢复）

| ID | 验收条件 | 状态 |
|---|---|---|
| TERM-SPLIT-POOL-001 | 标签分屏树中的全部 live 终端 ID（含本地 Shell 次级窗格）必须纳入 protectedTerminalIDs，不得被终端池当作 orphan 静默回收。 | done |
| TERM-SPLIT-POOL-002 | persistTabSplitLayout 必须同步写入 splitPaneIDs，随树变化更新。 | done |
| TERM-SPLIT-POOL-003 | 分屏槽位 reparent 后必须触发 xterm fit/renderer 恢复，避免旧窗格空白不可操作。 | done |

## 2026-07-23 商用硬化波次（串口设备路径校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-SERIAL-001 | 创建/更新串口配置时必须拒绝空路径、NUL、超长路径。 | done |
| SEC-SERIAL-002 | Unix 串口设备路径必须为绝对路径且位于允许前缀（/dev/tty*、/dev/cu.*、/dev/serial/、/dev/pts/、/dev/rfcomm*）。 | done |
| SEC-SERIAL-003 | Windows 串口设备必须规范为 COM 端口形式。 | done |

## 2026-07-23 商用硬化波次（分屏 pane 生命周期闭环）

| ID | 验收条件 | 状态 |
|---|---|---|
| TERM-SPLIT-POOL-004 | 关闭标签时必须关闭并清理全部 splitPaneIDs（含次级窗格），不得只关闭 primary 导致后端会话泄漏。 | done |
| TERM-SPLIT-POOL-005 | replace/promote primary 与次级窗格 reconnect 时必须同步 rewrite splitPaneIDs，避免 protected 集合残留 stale ID 或漏保护新 ID。 | done |
| TERM-SPLIT-POOL-006 | removeTabLocal 必须 scrub 全部 pane 的 terminalPool/connectionStatus/recordingState/activePane。 | done |

## 2026-07-23 商用硬化波次（分屏次级窗格自动重连）

| ID | 验收条件 | 状态 |
|---|---|---|
| TERM-RECONNECT-001 | 启用自动重连时，次级分屏 pane 断线必须能被识别（splitPaneIDs），不得仅匹配 primary terminalId。 | done |
| TERM-RECONNECT-002 | 次级分屏自动重连必须通过 TerminalSplit 树内 reconnect（事件 `mssh:reconnect-split-pane`），保持布局与 splitPaneIDs 同步。 | done |
| TERM-RECONNECT-003 | 串口连接仍不得自动重连。 | done |

## 2026-07-23 商用硬化波次（密钥/备份操作错误可见）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SETTINGS-001 | 删除 SSH 密钥失败时必须 toast 错误，不得仅写 debug 日志并静默保持对话框关闭。 | done |
| UX-SETTINGS-002 | 导出/导入本地加密备份失败时必须 toast 错误；成功时给出明确成功反馈。 | done |
| UX-SETTINGS-003 | KeyManager 确认删除必须 await onDelete；失败时保持对话框可重试。 | done |

## 2026-07-23 商用硬化波次（终端 Write/Resize 边界）

| ID | 验收条件 | 状态 |
|---|---|---|
| TERM-IO-001 | TerminalService.Write 必须拒绝超过 1MiB 的单次写入载荷，防止 IPC 粘贴洪泛与内存放大。 | done |
| TERM-IO-002 | TerminalService.Write 必须拒绝非法 UTF-8 载荷。 | done |
| TERM-IO-003 | TerminalService.Resize 必须将 cols/rows 限制在 [1,1000]/[1,500]，非法几何拒绝且不触达 PTY。 | done |

## 2026-07-23 商用硬化波次（设置加载门禁防默认值覆盖）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SETTINGS-004 | 通用设置加载失败时必须 toast 错误，并将 `settingsReady=false`，禁止自动保存用默认值覆盖远端配置。 | done |
| UX-SETTINGS-005 | SFTP 设置加载失败时必须 toast 错误，并将 `settingsReady=false`，禁止自动保存覆盖。 | done |
| UX-SETTINGS-006 | 通用/终端/SFTP 面板 autosave 必须以 settingsReady 为 isReady 门禁；加载成功前不得触发 onSave。 | done |
| UX-SETTINGS-007 | 密钥列表加载失败必须 toast 错误，不得静默为空列表。 | done |

## 2026-07-23 商用硬化波次（会话核心字段校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-SESSION-001 | Create/UpdateSession 必须校验 name/host/username 非空与长度上限，并拒绝 NUL。 | done |
| SEC-SESSION-002 | Port 必须在 1–65535；KeepAlive 必须在 0–86400。 | done |
| SEC-SESSION-003 | AuthMethod 必须为 password/key/agent/keyboard-interactive；key 认证必须提供有效 key_id。 | done |
| SEC-SESSION-004 | term_type 若提供必须满足长度上限；folder/key/environment/project 可选 ID 必须 >0。 | done |

## 2026-07-23 商用硬化波次（隧道创建字段校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-TUNNEL-003 | Create/Update/Start 隧道必须校验 session_id、name、type，拒绝空名与未知类型。 | done |
| SEC-TUNNEL-004 | local/remote 端口范围必须合法；非 dynamic 隧道 remote_port ∈ [1,65535] 且 remote_host 必填。 | done |
| SEC-TUNNEL-005 | host 字段禁止 NUL 与超长；local/dynamic 仍强制 loopback 绑定。 | done |

## 2026-07-23 商用硬化波次（分组名与密钥参数校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-FOLDER-001 | Create/UpdateFolder 必须 trim 并校验名称非空、长度 ≤128、无 NUL；parent_id 若提供必须 >0。 | done |
| SEC-KEY-001 | 密钥名称必须非空、长度 ≤128、无 NUL。 | done |
| SEC-KEY-002 | RSA 位数默认 3072；显式 bits 必须在 2048–8192 且为 8 的倍数。 | done |

## 2026-07-23 商用硬化波次（命令历史长度与列表上限/资产排序/宏字段/AI 提供商/侧栏宏 UX）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-HIST-010 | 命令历史写入必须拒绝 NUL 与超长命令（默认 8KiB）；超限静默丢弃，不得撑爆 DB。 | done |
| SEC-HIST-011 | 命令历史列表默认上限必须收紧为 1000 条，防止一次加载过量。 | done |
| SEC-ASSET-010 | 环境/项目 SortOrder 必须 ∈ [0, 1_000_000]；名称/编码/描述禁止 NUL。 | done |
| SEC-MACRO-010 | 宏名称/快捷键长度、SortOrder 与 NUL 必须校验；与既有命令长度/延迟上限一并生效。 | done |
| SEC-AI-PROV-010 | AI 提供商名称/模型/URL/APIKey 长度与 Provider 枚举必须校验，拒绝 NUL 与未知类型。 | done |
| UX-MACRO-010 | 侧栏宏加载/创建/删除/执行失败必须 toast 错误，不得仅写日志。 | done |

## 2026-07-23 商用硬化波次（串口文本边界 + 会话分组操作错误可见）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-SERIAL-010 | 串口配置 Name/Notes 必须有长度上限并拒绝 NUL；SortOrder ∈ [0, 1_000_000]。 | done |
| UX-SESSION-010 | create/update/delete 分组失败必须 toast，并向上抛错供调用方保持对话框可重试。 | done |
| UX-SESSION-011 | delete/move 会话失败必须 toast 并抛错，不得仅写日志。 | done |
| UX-SESSION-012 | setDefaultFolder 与 listTunnels 失败必须 toast，默认分组设置失败需可感知。 | done |
| UX-SESSION-013 | 侧栏保存分组仅在成功后关闭对话框；资产中心删除失败保持确认框。 | done |

## 2026-07-23 商用硬化波次（串口/资产分类/快捷键加载错误可见）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SERIAL-010 | 串口配置列表加载失败必须 toast，并保留页面 error 状态。 | done |
| UX-ASSET-010 | 资产分类列表加载失败必须 toast，不得仅写日志与 setError。 | done |
| UX-SHORTCUT-010 | 快捷键设置加载失败必须 toast，并回退默认绑定。 | done |

## 2026-07-23 商用硬化波次（云同步/SFTP树加载可见 + 本地Shell设置边界）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SYNC-010 | 云同步 Dashboard 加载失败必须 toast，并保留 error 状态。 | done |
| UX-SFTP-010 | SFTP 树展开目录加载失败必须 toast，并收回展开状态。 | done |
| SEC-LOCALSHELL-010 | 通过 SettingService 写入 local shell path/args/cwd 时必须拒绝 NUL 与超长值；path 不得含父目录穿越。 | done |

## 2026-07-23 商用硬化波次（SFTP 操作/AI 设置加载可见 + 会话移动 ID 校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SFTP-011 | 文件列表加载失败必须 toast，并写入 error 状态。 | done |
| UX-SFTP-012 | 删除/重命名/建目录失败必须 toast 并向上抛错。 | done |
| UX-SFTP-013 | 取消传输失败必须 toast 并向上抛错。 | done |
| UX-AI-010 | AI 设置 Dashboard 加载失败必须 toast。 | done |
| SEC-SESSION-010 | MoveSession/MoveFolder/SetDefaultFolder 必须拒绝 id<=0 与非法 folder/parent id。 | done |

## 2026-07-23 商用硬化波次（删除 ID 校验 + 会话/主题列表加载可见）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-SESSION-011 | DeleteSession/DeleteFolder 必须拒绝 id<=0。 | done |
| UX-SESSION-020 | 加载分组/会话/最近会话失败必须 toast，并写入 error。 | done |
| UX-SESSION-021 | 断开终端失败必须 toast。 | done |
| UX-THEME-010 | 主题目录加载失败必须 toast，并保留 store error。 | done |

## 2026-07-23 商用硬化波次（列表 folder_id / 串口删除 / 密钥删除 ID 校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-SESSION-012 | ListSessions 的 folderID 若提供必须 >0。 | done |
| SEC-SERIAL-011 | Serial Delete 必须拒绝 id<=0。 | done |
| SEC-KEY-010 | Key Delete/UsageCount/ExportPublicKey 必须拒绝 id<=0。 | done |

## 2026-07-23 商用硬化波次（宏/命令历史/隧道删除与启停 ID 校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-MACRO-011 | Macro Delete 必须拒绝 id<=0。 | done |
| SEC-HIST-012 | CommandHistory Add/List/Clear 的 sessionID 与 Delete id 必须 >0。 | done |
| SEC-TUNNEL-010 | Tunnel Delete/Start/Stop 必须拒绝 id<=0。 | done |

## 2026-07-23 商用硬化波次（资产/AI/主题/日志/同步版本删除 ID 校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-ASSET-011 | DeleteTag/Environment/Project 必须拒绝 id<=0。 | done |
| SEC-AI-010 | DeleteProvider/DeleteConversation 必须拒绝 id<=0。 | done |
| SEC-THEME-010 | DeleteProfile/DeleteDefinition 必须拒绝 id<=0。 | done |
| SEC-LOG-010 | LogService.Delete 必须拒绝 id<=0。 | done |
| SEC-SYNC-010 | Sync DeleteVersion 必须拒绝 id<=0。 | done |

## 2026-07-23 商用硬化波次（Get/Update/Restore 正向 ID 校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-SESSION-013 | GetSession 必须拒绝 id<=0。 | done |
| SEC-SERIAL-012 | Serial Get 必须拒绝 id<=0。 | done |
| SEC-THEME-011 | Theme GetProfile/UpdateProfile 必须拒绝 id<=0。 | done |
| SEC-SYNC-011 | Sync RestoreVersion 必须拒绝 id<=0。 | done |
| SEC-KEY-011 | Key GetMaterial/Update 必须拒绝 id<=0。 | done |
| SEC-AI-011 | ListConversations/ListMessages/TestProvider 必须拒绝 id<=0。 | done |
| SEC-ASSET-012 | GetSessionAssetDetail 必须拒绝 sessionID<=0。 | done |
| SEC-MACRO-012 | Macro Update 必须拒绝 id<=0。 | done |
| SEC-TUNNEL-011 | Tunnel Update 必须拒绝 id<=0。 | done |

## 2026-07-23 商用硬化波次（连接/SFTP/日志 sessionID 校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-SESSION-014 | sessionForConnect 必须拒绝 id<=0。 | done |
| SEC-SFTP-010 | FileService.connect 必须拒绝 sessionID<=0。 | done |
| SEC-LOG-011 | LogService.List(sessionID) 若提供必须 >=0（0=本地/无会话日志，负值拒绝）。 | done |

## 2026-07-23 商用硬化波次（分屏布局恢复可见错误）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SPLIT-010 | 持久化分屏布局恢复失败必须 toast 并给出错误信息。 | done |

## 2026-07-23 商用硬化波次（审计批量/宏执行输入校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-AUDIT-010 | RecordBatch 必须拒绝 sessionID<=0。 | done |
| SEC-MACRO-013 | Macro Execute 必须拒绝空 terminalID。 | done |

## 2026-07-23 商用硬化波次（终端/录制/传输/连接 attempt 空 ID 校验 + attach 可见）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-TERM-020 | Terminal Write/Resize/Close/Attach 必须拒绝空 terminalID。 | done |
| SEC-LOG-012 | Start/StopTerminalRecording 必须拒绝空 terminalID。 | done |
| SEC-SFTP-011 | CancelTransfer 必须拒绝空 taskID。 | done |
| SEC-SESSION-015 | DecideHostKey/CancelConnect 必须拒绝空 attemptID。 | done |
| UX-TERM-020 | 终端 Attach 失败必须 toast。 | done |

## 2026-07-23 商用硬化波次（终端 Open / SystemInfo / AI Execute ID）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-TERM-021 | Terminal Open 必须拒绝 sessionID<=0。 | done |
| SEC-TERM-022 | SystemInfo 必须拒绝空 terminalID。 | done |
| SEC-AI-012 | ExecuteCommand 必须拒绝 sessionID<=0 与空 terminalID。 | done |

## 2026-07-23 商用硬化波次（ProcessInfo / AI Chat / 导入导出路径）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-TERM-023 | ProcessInfo 必须拒绝空 terminalID。 | done |
| SEC-AI-013 | Chat 必须拒绝空白 terminalID。 | done |
| SEC-IO-010 | Sync Export/Import/ImportWithPassword 必须拒绝空/无效本地路径。 | done |
| SEC-IO-011 | Session CSV Export/Import/Preview 必须拒绝空/无效本地路径。 | done |
| SEC-IO-012 | Theme ImportFiles 必须拒绝空/无效本地路径。 | done |

## 2026-07-23 商用硬化波次（录制回放路径限制 + 加载可见）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-LOG-013 | GetRecording 必须拒绝空路径，且仅允许 dataDir/recordings 下文件。 | done |
| UX-PLAYBACK-010 | 回放加载失败必须 toast 并在终端提示失败。 | done |

## 2026-07-23 商用硬化波次（连接 wrapper / AI provider / 资产刷新 / 会话录制可见）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-SESSION-016 | GetClientWrapper 必须拒绝空 connID。 | done |
| SEC-AI-014 | SaveProvider 必须拒绝 id<0。 | done |
| UX-ASSET-010 | refreshAssets 失败必须 toast 并写入 error。 | done |
| UX-LOG-010 | SessionLog 加载/删除失败必须 toast。 | done |

## 2026-07-23 商用硬化波次（AI 面板 / 命令历史 / 工作区 / 关于页可见错误）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-AI-010 | AI 终端面板加载失败必须 toast 并保留面板内错误文案。 | done |
| UX-AI-011 | AI 发送消息失败必须 toast。 | done |
| UX-AI-012 | AI 对话历史加载失败必须 toast。 | done |
| UX-AI-013 | AI 审批执行与只读自动执行失败必须 toast。 | done |
| UX-HIST-010 | sessionID>0 时命令历史 List 失败必须 toast。 | done |
| UX-MACRO-010 | 宏工作区 List 失败必须 toast。 | done |
| UX-ABOUT-010 | About Info 加载失败必须 toast。 | done |
| UX-WORKSPACE-010 | 工作区恢复/保存失败必须 toast。 | done |

## 2026-07-23 商用硬化波次（串口/删除影响/设置 key 校验 + 日志目录选择可见）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-SERIAL-013 | OpenSerial 必须拒绝 serialPortID<=0。 | done |
| SEC-SERIAL-014 | SerialSetSignals/SerialSignals/SerialBreak 必须拒绝空 terminalID。 | done |
| SEC-SESSION-017 | SessionDeleteImpact 必须拒绝 id<=0。 | done |
| SEC-ASSET-013 | Environment/Project/Tag DeleteImpact 必须拒绝 id<=0。 | done |
| SEC-SETTING-010 | Setting Get/Delete 必须拒绝空 key。 | done |
| UX-LOG-011 | 选择应用日志目录失败必须 toast。 | done |

## 2026-07-23 商用硬化波次（录制 sessionID / SerialBreak 时长 / StopIfActive）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-LOG-014 | StartTerminalRecording 必须拒绝 sessionID<0；0 表示本地/无会话录制。 | done |
| SEC-LOG-015 | StopTerminalRecordingIfActive 必须拒绝空 terminalID。 | done |
| SEC-SERIAL-015 | SerialBreak 必须拒绝 durationMs<0。 | done |

## 2026-07-23 商用硬化波次（审计可见错误 + AI provider / Audit session 校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-AI-015 | AI Settings 的 default/fallback provider id 必须 >0（若提供）。 | done |
| SEC-AUDIT-011 | Audit List 的 sessionID 若提供必须 >0。 | done |
| UX-AUDIT-010 | 审计设置加载失败必须 toast，并在面板中展示错误。 | done |
| UX-AUDIT-011 | 审计开关切换失败必须 toast。 | done |
| UX-AUDIT-012 | 审计日志加载失败必须 toast。 | done |

## 2026-07-23 商用硬化波次（宏/密钥输入 + 批量/CSV/重连可见错误）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-MACRO-014 | Macro Execute 必须拒绝空白 command。 | done |
| SEC-KEY-012 | Key Import 必须拒绝空白 private key。 | done |
| UX-BATCH-010 | 批量操作宏列表失败必须 toast。 | done |
| UX-BATCH-011 | 批量删除影响分析失败必须 toast。 | done |
| UX-CSV-010 | 会话 CSV 预览/导入失败必须 toast 并保留对话框错误。 | done |
| UX-RECONNECT-010 | SSH 自动重连最终失败必须 toast。 | done |

## 2026-07-23 商用硬化波次（密钥更新校验 + 会话/串口可见错误）

| ID | 验收条件 | 状态 |
|---|---|---|
| SEC-KEY-013 | Key Update 必须拒绝空白 private key。 | done |
| UX-SESSION-010 | 会话对话框加载密钥列表失败必须 toast。 | done |
| UX-SERIAL-010 | 串口设备列表失败必须 toast。 | done |
| UX-SERIAL-011 | 串口占用状态查询失败必须 toast。 | done |

## 2026-07-23 商用硬化波次（Vault/资产创建 toast + 主题分配 ID）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-VAULT-010 | 安全状态 Status 加载失败必须 toast 并保留面板错误。 | done |
| UX-VAULT-011 | 安全操作（setup/unlock/lock/rotate 等）失败必须 toast。 | done |
| UX-ASSET-011 | 会话资产快速创建失败必须 toast 并保留行内错误。 | done |
| SEC-THEME-012 | validateThemeAssignments 必须拒绝 profile id<=0。 | done |

## 2026-07-23 商用硬化波次（会话资产对话框 + 串口保存 toast）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-ASSET-012 | 资产分类保存失败必须 toast 并保留对话框错误。 | done |
| UX-ASSET-013 | 资产分类删除影响加载失败必须 toast 并保留错误。 | done |
| UX-ASSET-014 | 资产分类删除失败必须 toast 并保留对话框错误。 | done |
| UX-ASSET-015 | 批量更新会话资产失败必须 toast 并保留对话框错误。 | done |
| UX-SESSION-011 | 会话保存失败必须 toast 并保留对话框错误。 | done |
| UX-SERIAL-012 | 串口配置保存失败必须 toast 并保留对话框错误。 | done |

## 2026-07-23 商用硬化波次（隧道创建失败保留表单 + 传输恢复 toast）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TUNNEL-010 | 新建隧道启动失败必须 toast，且保留表单以便重试。 | done |
| UX-TRANSFER-010 | 启动时恢复传输记录失败必须 toast。 | done |

## 2026-07-23 商用硬化波次（隧道重启保留 id）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TUNNEL-011 | 已有隧道列表点击启动必须带上 tunnel id，禁止重复 Create。 | done |

## 2026-07-23 商用硬化波次（隧道删除）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TUNNEL-012 | 隧道列表必须支持删除配置，并在失败时 toast。 | done |

## 2026-07-23 商用硬化波次（CSV 导出 / 会话删除对话框 toast）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-CSV-011 | 会话 CSV 导出失败必须 toast 并保留对话框错误。 | done |
| UX-SESSION-012 | 会话/分组删除影响加载失败必须 toast。 | done |
| UX-SESSION-013 | 会话/分组删除确认失败必须 toast 并保留对话框错误。 | done |

## 2026-07-23 商用硬化波次（隧道删除确认）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TUNNEL-013 | 删除隧道前必须弹出确认框，取消时不调用删除。 | done |

## 2026-07-23 商用硬化波次（SSH 连接对话框主机密钥失败可见）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-CONNECT-010 | 主机密钥接受/拒绝/取消连接失败必须进入 failed 状态并 toast。 | done |

## 2026-07-23 商用硬化波次（AI/安全失败文案）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-AI-014 | AI 设置操作失败 toast 必须使用明确失败文案，不得拼接成功文案。 | done |
| UX-SEC-010 | 安全面板操作失败 toast 必须使用明确失败文案，不得拼接成功文案。 | done |

## 2026-07-23 商用硬化波次（云同步失败文案）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SYNC-010 | 云同步操作失败 toast 必须使用明确失败文案，不得从成功文案裁剪生成。 | done |

## 2026-07-23 商用硬化波次（关于页/终端宏加载可见）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-ABOUT-011 | 检查更新失败必须 toast，并保留面板提示。 | done |
| UX-ABOUT-012 | 打开外部链接失败必须 toast。 | done |
| UX-MACRO-011 | 终端组合面板加载宏失败必须 toast，并保留面板错误。 | done |


## 2026-07-23 商用硬化波次（失败 toast 模板统一）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SERIAL-013 | 串口信号设置/Break 失败 toast 必须使用明确失败模板。 | done |
| UX-SERIAL-014 | 串口配置复制/删除/批量删除失败 toast 必须使用明确失败模板。 | done |
| UX-ASSET-016 | 资产排序失败 toast 必须使用明确失败模板。 | done |
| UX-ASSET-017 | 设置默认分组失败 toast 必须使用明确失败模板。 | done |
| UX-MACRO-012 | 宏执行失败 toast 必须使用 i18n 模板（含撰写面板/工作区）。 | done |
| UX-AI-015 | AI 只读命令自动执行失败 toast 不得双重包装文案。 | done |


## 2026-07-23 商用硬化波次（隧道操作 Promise 拒绝收口）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TUNNEL-014 | 隧道列表启动/停止/删除点击产生的 Promise 拒绝不得未处理；错误 toast 由 manager 负责。 | done |


## 2026-07-23 商用硬化波次（英文失败文案粘连修复）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-I18N-020 | en.json 失败/成功类文案不得出现单词粘连（如 Executefailed）。 | done |


## 2026-07-23 商用硬化波次（录制删除 Promise 收口）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-LOG-012 | 会话录制删除确认按钮触发的 Promise 拒绝不得未处理。 | done |


## 2026-07-23 商用硬化波次（宏删除确认）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-MACRO-013 | 删除宏前必须弹出确认框，取消时不调用删除。 | done |
| UX-FILE-011 | 文件删除确认动作的 Promise 拒绝不得未处理。 | done |


## 2026-07-23 商用硬化波次（命令历史清空一致性）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-HIST-011 | 清空命令历史前必须确认。 | done |
| UX-HIST-012 | 会话 id>0 清空时必须同步后端 Clear，并清理本地缓存。 | done |
| UX-HIST-013 | 清空失败必须 toast，且保留本地历史。 | done |


## 2026-07-23 商用硬化波次（SFTP 重命名/建目录 Promise 收口）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-FILE-012 | 文件重命名/新建目录确认动作的 Promise 拒绝不得未处理。 | done |
| UX-THEME-015 | 标题栏切换浅深色模式失败不得产生未处理 Promise。 | done |

## 2026-07-23 商用硬化波次（SFTP 面板 Promise 收口）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-FILE-013 | SFTP 面板目录加载、拖拽上传、上传/下载对话框失败不得产生未处理 Promise，并 toast 明确失败文案。 | done |

## 2026-07-23 商用硬化波次（主题导入对话框 + 英文连接文案）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-THEME-016 | 导入 iTerm2 主题时文件选择对话框失败不得产生未处理 Promise，并 toast 明确失败文案。 | done |
| UX-I18N-021 | 连接相关英文文案不得出现单词粘连（Cancelconnect / successconnectsession 等）。 | done |

## 2026-07-23 商用硬化波次（英文词条粘连清理）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-I18N-022 | en.json 中中文多词 UI 文案的英文翻译不得出现无空格粘连词（如 Executemacro / Commandhistory）。 | done |

## 2026-07-23 商用硬化波次（英文进度文案 medium 粘连）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-I18N-023 | en.json 进度/中态文案不得出现 medium 粘连（如 Importmedium... / Executemedium...）。 | done |

## 2026-07-23 商用硬化波次（英文粘连词条二次清理）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-I18N-024 | en.json 中剩余粘连词条（Importkey/Executemacro/Searchsession 等）必须拆分，并有回归测试看护。 | done |

## 2026-07-23 商用硬化波次（AI 提供商删除确认）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-AI-016 | 删除 AI 提供商前必须弹出确认框，取消时不调用删除。 | done |

## 2026-07-23 商用硬化波次（AI 提供商 Promise 收口）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-AI-017 | AI 提供商保存/测试/删除/优先级切换产生的 Promise 拒绝不得未处理；错误 toast 由 controller 负责。 | done |

## 2026-07-23 商用硬化波次（AI Agent / 密钥编辑 Promise 收口）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-AI-018 | AI Agent 检测按钮与初始加载的 Promise 拒绝不得未处理。 | done |
| UX-KEY-011 | 密钥编辑对话框保存动作的 Promise 拒绝不得未处理。 | done |

## 2026-07-23 商用硬化波次（密钥读取 / 快捷键重置 Promise）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-KEY-012 | 查看/编辑密钥时若材料加载失败或为空，必须 toast 明确失败文案，且 Promise 拒绝不得未处理。 | done |
| UX-SHORTCUT-011 | 恢复默认快捷键触发的持久化 Promise 拒绝不得未处理。 | done |
| UX-AI-019 | AI 终端面板加载/发送/历史/审批执行的 Promise 拒绝不得未处理。 | done |


## 2026-07-23 商用硬化波次（SSH 连接对话框 Promise 收口）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-CONN-011 | SSH 连接对话框中信任主机密钥/拒绝/取消连接的 Promise 拒绝不得未处理；失败时已由 store toast 明确文案。 | done |


## 2026-07-23 商用硬化波次（本地备份导入导出 Promise 收口）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SYNC-021 | 导出/导入本地加密备份按钮触发的 Promise 拒绝不得未处理；失败 toast 由 transfer hook 负责。 | done |


## 2026-07-23 商用硬化波次（默认分组失败提示去重）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SESSION-022 | 设置默认分组失败时仅 toast 一次（workspace 层负责），UI 包装不得重复提示，且 Promise 拒绝不得未处理。 | done |


## 2026-07-23 商用硬化波次（宏执行路径统一）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-MACRO-021 | 侧边栏与宏工作区执行宏时，无活动终端/未连接必须 toast；成功/失败 toast 文案一致。 | done |
| UX-MACRO-022 | 分屏场景必须向 activePane（若属于当前标签）发送宏，不得总是落到主终端。 | done |


## 2026-07-23 商用硬化波次（会话保存失败提示去重）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SESSION-023 | 新建/编辑会话保存失败时，workspace 层 toast 一次；对话框仅展示 inline error，不重复 toast。 | done |
| UX-SESSION-024 | 会话保存成功后必须关闭对话框，输入失败时保留表单内容便于重试。 | done |


## 2026-07-23 商用硬化波次（会话移动 promise 安全）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SESSION-025 | 资产中心会话「移动到分组」失败时，hook toast 一次；菜单 onClick 不得产生 unhandled rejection。 | done |
| UX-SESSION-026 | SessionTree 上下文「移动到」同样吞掉 rejection（toast 由上层 hook 负责）。 | done |


## 2026-07-23 商用硬化波次（资产刷新与删除反馈）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-ASSET-027 | mutation 后的 refreshAssets 失败不得重复 toast；仅独立刷新默认 toast。 | done |
| UX-SESSION-028 | 会话/分组删除失败时 hook toast 一次，对话框仅 inline error，且对话框保持打开可重试。 | done |
| UX-CSV-029 | CSV 导入后的 refresh 使用 silent 模式，导入对话框 toast 单一入口。 | done |


## 2026-07-23 商用硬化波次（会话保存与资产刷新解耦）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SESSION-030 | 会话创建/更新成功后若资产分类刷新失败，不得回退为“创建/更新失败”；会话列表仍应包含新/更新项。 | done |
| UX-SESSION-031 | 编辑会话密码输入框提示“留空则保留原密码”，避免用户误以为必须重填。 | done |


## 2026-07-23 商用硬化波次（主题/串口刷新与会话密钥校验）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-THEME-032 | 主题 mutation 后的 catalog 强制刷新失败不得再 toast「加载主题失败」；由 UI 操作失败 toast 负责。 | done |
| UX-SERIAL-033 | 串口 mutation 后的 refresh 不得对设备发现/占用状态失败重复 toast；独立加载仍提示。 | done |
| UX-SESSION-034 | 认证方式为密钥时，未选择密钥不得提交保存，对话框展示明确 inline error。 | done |


## 2026-07-24 商用硬化波次（连接成功与分组输入反馈）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-CONN-035 | SSH 连接成功后，会话列表/最近连接刷新失败不得把连接对话框置为 failed；终端标签保持已连接。 | done |
| UX-FOLDER-036 | 侧边栏新建/编辑分组时名称为空必须提示用户，不得静默无反馈。 | done |

## 2026-07-24 商用硬化波次（批量/资产/主题/串口/CSV 后刷新隔离）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-BATCH-037 | 批量连接/宏执行/删除成功后，资产静默刷新失败不得中断结果对话框，也不得冒充为「批量操作失败」。 | done |
| UX-ASSET-038 | 环境/项目/标签更新删除/重排/批量写会话后，静默 refresh 失败不得冒充 mutation 失败；独立 refresh 仍 toast。 | done |
| UX-THEME-039 | 主题配置/配置档 mutation 成功后，catalog 静默重载失败不得拒绝 mutation Promise 或 toast 加载失败。 | done |
| UX-SERIAL-040 | 串口 mutation 后的 silent refresh 对主列表失败也不得 toast；独立加载仍提示。 | done |
| UX-TUNNEL-041 | 隧道启动成功后的列表重载失败不得 toast「加载隧道失败」。 | done |
| UX-CSV-042 | CSV 导入成功后的 folders/assets 刷新失败不得拒绝 import Promise。 | done |

| UX-SERIAL-043 | 串口连接成功后的列表刷新必须 silent，避免连接成功 toast 叠加「加载串口配置失败」。 | done |
| UX-CSV-044 | CSV 导入后的 listFolders 刷新必须 silent，避免叠加「加载分组失败」。 | done |

## 2026-07-24 商用硬化波次（嵌套 list 加载 silent 统一）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-CONN-045 | 连接成功后的 listSessions/listRecentSessions 必须 silent，不得 toast「加载会话失败/加载最近会话失败」。 | done |
| UX-SESSION-046 | 创建/更新会话后的 listAssetCatalogs 必须 silent，不得 toast「加载资产分类失败」。 | done |
| UX-SYNC-047 | 云同步热刷新调用的 folders/sessions/recent/catalogs/tunnels 列表必须 silent，由热刷新路径统一失败 toast。 | done |
| UX-LIST-048 | 独立手动/初始加载仍 toast 列表失败；silent 模式失败需 rethrow 以便外层处理。 | done |

| UX-SESSION-049 | 会话更新成功后 GetSession 失败不得 toast「更新会话失败」；本地列表至少反映用户提交的字段。 | done |

## 2026-07-24 商用硬化波次（删除会话收口终端标签）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SESSION-050 | 删除会话成功后必须关闭该会话的 SSH 终端标签并释放后端终端；最近列表同步移除。 | done |
| UX-BATCH-051 | 批量删除成功的会话必须同样关闭对应终端标签。 | done |
| UX-MACRO-052 | 宏工作区删除成功后，列表重载失败不得冒充删除失败 toast。 | done |

## 2026-07-24 商用硬化波次（删除会话停止运行中隧道）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TUNNEL-053 | 删除/批量删除会话前必须停止该会话仍在运行的隧道（关闭监听并释放底层连接），再删除隧道 DB 行。 | done |
| UX-TUNNEL-054 | 停止后应发出 tunnel stopped 事件，前端隧道状态可收敛为 stopped，不得留下悬空运行态。 | done |

## 2026-07-24 商用硬化波次（串口/SFTP 后刷新 residual）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SERIAL-055 | 串口 mutation/连接成功后，silent refresh 失败不得写入页面 error banner 或 toast「加载串口配置失败」。 | done |
| UX-SFTP-056 | 删除/重命名/新建目录成功后的目录重载失败不得 toast「加载文件列表失败」。 | done |

## 2026-07-24 商用硬化波次（删除会话取消进行中传输）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TRANSFER-057 | 删除/批量删除会话前必须取消该会话仍在进行中的 SFTP 上传/下载（取消 context），并释放相关连接。 | done |
| UX-TRANSFER-058 | 对应 transfer_jobs 中 queued/running 任务标记为 cancelled（原因：会话已删除），前端传输中心可通过 complete 事件收敛为 cancelled。 | done |
| UX-TRANSFER-059 | 会话删除影响分析需统计进行中传输数量，并在删除确认文案中展示。 | done |

## 2026-07-24 商用硬化波次（删除会话关闭后端终端）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TERM-060 | 删除/批量删除会话前，后端必须关闭该会话仍在运行的 SSH 终端 PTY，并释放对应 SSH 连接。 | done |
| UX-TERM-061 | 关闭后应发出 terminal closed 事件；即使前端未先关标签，后端也不得留下悬空 PTY/连接。 | done |
| UX-TERM-062 | 删除会话时对无终端映射的残余 session 连接也必须 disconnect 清理。 | done |

## 2026-07-24 商用硬化波次（删除会话取消进行中连接）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-CONN-063 | 删除/批量删除会话前，必须取消该会话仍在进行中的 SSH 连接 attempt（含 host key 等待）。 | done |

## 2026-07-24 商用硬化波次（传输取消 UI 收敛）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TRANSFER-064 | 会话删除取消传输时，传输中心应收敛为 cancelled，不得被后续 I/O 错误事件改写为 failed。 | done |
| UX-TRANSFER-065 | worker 在 ctx 已取消时，OpenSFTP/上传/下载/收尾错误统一按 cancelled 处理并 emit cancelled。 | done |

## 2026-07-24 商用硬化波次（删除会话收敛连接对话框）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-CONN-066 | 连接对话框需绑定 sessionId；删除/批量删除该会话后对话框必须关闭并回到 idle，不得残留 connecting/host-key/failed。 | done |
| UX-CONN-067 | dismiss 仅影响匹配 sessionId 的对话框，不误关其他会话连接流程。 | done |

## 2026-07-24 商用硬化波次（传输事件终态保护）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TRANSFER-068 | 传输任务进入 cancelled/completed/failed 后，后续 progress 事件不得把状态改回 running。 | done |
| UX-TRANSFER-069 | cancelled 任务不得被后续 completed 事件覆盖。 | done |

## 2026-07-24 商用硬化波次（删除会话收敛传输中心）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TRANSFER-070 | 删除/批量删除会话后，前端传输中心对应会话的 queued/running 任务立即收敛为 cancelled（原因：会话已删除）。 | done |
| UX-TRANSFER-071 | 因会话删除而取消的传输不得提供重试；重试 API 必须拒绝。 | done |

## 2026-07-24 商用硬化波次（删除会话清理录制文件）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-LOG-072 | 删除/批量删除会话时，除删除 session_logs 行外，必须删除对应 data_path 录制文件，避免磁盘残留。 | done |

## 2026-07-24 商用硬化波次（串口删除关标签 + 隧道表单错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SERIAL-073 | 删除/批量删除串口配置后，必须关闭关联 serial 终端标签并释放后端终端；不得留下悬空串口标签。 | done |
| UX-TUNNEL-074 | 隧道创建表单失败时仅展示 inline error，不得叠加 toast「启动隧道失败」；列表内启动按钮失败仍 toast 一次。 | done |

## 2026-07-24 商用硬化波次（可见面板/表单错误单归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-AI-075 | AI 终端面板加载/发送/历史/审批执行失败时仅展示面板内 inline error，不得叠加 toast。 | done |
| UX-FORM-076 | 串口配置对话框、资产分类编辑/删除对话框、资产快速创建对话框失败时仅 inline error，不得叠加 toast。 | done |
| UX-FORM-077 | 会话删除影响分析、Vault 门禁加载/安全操作、CSV 导入预览/导入失败、CSV 导出失败时仅 inline/表单 error，不得叠加 toast；成功反馈仍可 toast。 | done |
| UX-AUDIT-078 | 审计面板设置加载/切换/日志加载失败时仅页面 inline error，不得叠加 toast。 | done |
| UX-LOG-079 | 会话录制列表加载/删除失败时仅面板/对话框 inline error，不得叠加 toast。 | done |
| UX-CONN-080 | 连接对话框主机密钥确认/拒绝/取消失败时仅对话框 failed 状态与 error 文案，不得叠加 toast。 | done |
| UX-MACRO-081 | 宏工作区加载失败时仅页面错误态，不得叠加 toast；删除宏失败仍 toast。 | done |
| UX-BULK-082 | 批量资产更新对话框失败时仅 dialog alert，不得叠加 toast；成功可 toast。 | done |

| UX-SYNC-083 | 云同步 dashboard 加载失败仅页面 error banner；动作失败仅 toast，不再写入 page error。 | done |
| UX-SERIAL-084 | 串口配置列表加载失败仅页面 error banner，不得叠加 toast；设备/占用探测失败仍 toast（无 banner）。 | done |
| UX-SESSION-085 | 会话/分组/最近会话加载失败仅 workspace error banner，不得叠加 toast。 | done |
| UX-SFTP-086 | SFTP 目录加载失败仅 FilePanel error，不得叠加 toast。 | done |
| UX-COMPOSE-087 | 终端撰写面板宏列表加载失败仅面板内错误态，不得叠加 toast。 | done |
| UX-RECONN-088 | 重连最终失败仅连接对话框 failed+error，不得叠加 toast。 | done |
| UX-ASSET-089 | 资产分类 list/refresh 失败仅 workspace error banner，不得叠加 toast。 | done |

| UX-AISET-090 | AI 设置 dashboard 加载失败仅页面 error 文案；动作失败仅 toast，不写 controller.error。 | done |

## 2026-07-24 商用硬化波次（加载失败不得伪装空列表）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TUNNEL-091 | 隧道列表加载失败时必须展示错误与重试，不得显示「无隧道/当前会话暂无隧道」空态误导。 | done |
| UX-HIST-092 | 命令历史远端加载失败时仅面板 inline error，不得 toast；不得静默显示为空。 | done |
| UX-ABOUT-093 | 关于页信息加载/检查更新失败仅面板 message，不得叠加 toast；打开外链失败仍 toast。 | done |

## 2026-07-24 商用硬化波次（安全/批量删除/密钥加载失败）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SEC-094 | 安全设置/主机指纹加载失败时必须展示错误与重试，不得显示「尚未信任任何主机」空态；不得 toast 叠加。 | done |
| UX-BATCH-095 | 批量删除影响分析失败时确认框必须声明影响范围未知，不得写入 0 隧道/历史等假零值。 | done |
| UX-BATCH-096 | 批量操作宏列表加载失败时仅 bar 内 inline error，不得 toast；执行宏按钮因无宏保持禁用。 | done |
| UX-SESSION-097 | 会话对话框密钥列表加载失败时仅密钥字段 inline error，不得伪装「暂无可用密钥」。 | done |

## 2026-07-24 商用硬化波次（密钥/快捷键/侧边栏宏加载）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-KEY-098 | 密钥列表加载失败时展示错误与重试，不得显示「无密钥」空态；不得 toast 叠加。 | done |
| UX-SHORTCUT-099 | 快捷键设置加载失败时展示页面 error 与重试，可回退默认绑定；不得 toast。 | done |
| UX-MACRO-100 | 侧边栏宏列表加载失败时展示 inline error 与重试，不得 toast 伪装空列表。 | done |

## 2026-07-24 商用硬化波次（设置页加载失败错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SET-101 | 通用/终端设置加载失败时仅页面 error banner + 重试，不得 toast；不得把默认值伪装成已加载成功。 | done |
| UX-SFTPSET-102 | SFTP 设置加载失败时仅页面 error banner + 重试，不得 toast。 | done |
| UX-THEME-103 | 主题目录加载失败时仅终端设置页 error banner + 重试，不得 toast 叠加 store error。 | done |

## 2026-07-24 商用硬化波次（终端工具栏隧道加载失败）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TUNNEL-104 | 终端工具栏打开隧道对话框时，必须透传 list 错误与重试；不得把加载失败伪装成「无隧道」空态。 | done |

## 2026-07-24 商用硬化波次（回放/AI 历史错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-PLAY-105 | 会话回放加载失败时仅在回放终端内展示错误，不得 toast 叠加。 | done |
| UX-AI-106 | AI 面板加载失败时，打开对话历史不得显示「暂无对话」空态；须展示错误与重试。 | done |

## 2026-07-24 商用硬化波次（传输恢复/文件树展开错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TRANSFER-107 | 启动恢复传输列表失败时不得 toast 后伪装为空列表；传输中心须展示错误与重试，状态栏可进入错误态入口。 | done |
| UX-SFTP-TREE-108 | SFTP 树节点展开加载失败时仅节点 inline error，不得 toast；折叠后可再次展开重试。 | done |

## 2026-07-24 商用硬化波次（Go 生产源码行数门禁）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-ENG-109 | 生产 Go 源文件必须满足 ≤300 行门禁；`log.go`/`security_reencrypt.go` 超标文件完成拆分且测试通过。 | done |

## 2026-07-24 商用硬化波次（前端源码行数门禁与隧道死路径）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-ENG-110 | 前端生产源文件必须满足 ≤300 行门禁；`useSession.ts`/`useTerminal.ts` 超标完成拆分。 | done |
| UX-TUNNEL-111 | 移除无 UI 消费的 `useSession.listTunnels` 死状态与 toast 路径；隧道列表仅由 `useTunnelManager` 承载。 | done |

## 2026-07-24 商用硬化波次（串口探测错误归属与设置模型拆分）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SERIAL-112 | 串口设备/占用探测失败不得 toast 刷屏（含 5s 轮询）；须在串口中心以非破坏性 banner + 重试展示。 | done |
| UX-ENG-113 | `useGeneralSettings` 拆分模型层以满足前端 ≤300 行门禁并降低超标风险。 | done |

## 2026-07-24 商用硬化波次（分屏/工作区恢复错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SPLIT-114 | 分屏布局恢复失败时仅在终端分屏区域展示 error banner + 重试，不得 toast；失败时不得覆盖已持久化的多窗格布局。 | done |
| UX-WS-115 | 启动工作区恢复失败时仅主内容区 banner + 重试，不得 toast；串口列表失败/部分标签失败以非破坏 notice 展示，可关闭。 | done |

## 2026-07-24 商用硬化波次（测试门禁与系统监控重试）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TEST-116 | 测试文件中的 `it` 必须位于 `describe` 内；修复遗漏的孤儿用例（SystemPanel/TransferCenter/SessionTree/CSV/Proxy/CloudSync/Tabs/Coalescer）。 | done |
| UX-SYS-117 | 系统监控概览/进程采集失败时仅面板 inline error + 重试，不得 toast；重试后可恢复展示。 | done |

## 2026-07-24 商用硬化波次（终端挂载/写入错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TERM-118 | 终端 Attach 失败时仅通过连接状态进入 pane overlay（error）并支持重连，不得 toast 叠加。 | done |
| UX-TERM-119 | 终端 Write 失败时仅将连接状态置为 disconnected 并由 pane overlay 承接，不得 toast 叠加；仅记录一次日志。 | done |

## 2026-07-24 商用硬化波次（分屏 reparent 恢复与连接对话框错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SPLIT-120 | 分屏 reparent 后非活动窗格也必须多帧 fit/refresh/resize 恢复，避免旧 Shell 空白不可操作。 | done |
| UX-CONN-121 | 主机指纹接受/拒绝与取消连接失败仅连接对话框 failed+error 展示，不得 toast。 | done |
| UX-MACRO-122 | 宏工作区列表加载失败仅工作区内 error+重试，不得 toast；测试与实现一致。 | done |

## 2026-07-24 商用硬化波次（SFTP 列表错误单一归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SFTP-123 | SFTP 目录 list 失败仅 FilePanel inline error + 重试；TerminalLayers 不得再 toast 叠加。 | done |
| UX-SFTP-124 | 拖拽上传失败仅由 transfer 动作 toast 一次；Layers 不得二次包装。 | done |

## 2026-07-24 商用硬化波次（分屏重连错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SPLIT-125 | 分屏窗格手动重连失败时仅 connectionStatus=error + pane overlay，不得 toast 叠加。 | done |

## 2026-07-24 商用硬化波次（分屏组件行数防超标）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-ENG-126 | `TerminalSplit.tsx` 通过提取 `terminalSplitActions.ts` 保持 ≤300 行；行为回归测试通过。 | done |


## 2026-07-24 商用硬化波次（回放组件行数与 i18n）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-ENG-127 | `PlaybackTab.tsx` 通过提取 `playbackPlayerRuntime.ts` 保持 ≤300 行；行为回归测试通过。 | done |
| UX-PLAY-128 | 回放加载失败/空数据/就绪文案使用中文源串 + en.json 翻译，终端内展示跟随语言；测试断言中文源串。 | done |

## 2026-07-24 商用硬化波次（安全面板错误归属与 i18n 缺口）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SEC-129 | 安全设置面板内密码校验/设置/轮转/删除主机指纹失败仅面板 inline alert 展示，不得 error toast 叠加；成功反馈可 toast。 | done |
| UX-I18N-130 | 会话编辑「留空则保留原密码」、密钥认证「请选择 SSH 密钥」、侧栏新建分组「请输入分组名称」必须具备 en.json 翻译。 | done |

## 2026-07-24 商用硬化波次（宏工作区/密钥管理错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-MACRO-131 | 宏工作区删除失败仅工作区 inline alert 展示且保留列表，不得 toast；加载失败仍全页 error+重试。 | done |
| UX-KEY-132 | 密钥查看/编辑加载失败与删除前影响分析失败仅 KeyManager 面板 inline alert，不得 error toast。 | done |

## 2026-07-24 商用硬化波次（命令历史错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-HIST-133 | 命令历史面板复制/清空失败仅面板 inline alert，不得 error toast；成功反馈可 toast。 | done |

## 2026-07-24 商用硬化波次（主题管理错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-THEME-134 | 主题导入/选择/重命名/复制/删除失败仅 ThemeManager 面板 inline alert，不得 error toast。 | done |

## 2026-07-24 商用硬化波次（密钥列表复制错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-KEY-135 | 密钥列表复制公钥失败仅 KeyManager 面板 inline alert，不得 error toast；成功可 toast。 | done |

## 2026-07-24 商用硬化波次（工作区保存错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-WS-136 | 工作区布局自动保存失败时仅主内容区 banner 展示（可关闭），不得 toast；与恢复失败 banner 同一固定表面。 | done |

## 2026-07-24 商用硬化波次（appStore 状态动作拆分）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-ENG-137 | `appStoreActions.ts` 提取 `appStoreStatusActions.ts` 保持 ≤300 行，并为 workspaceSaveError 提供空间。 | done |

## 2026-07-24 商用硬化波次（传输中心动作错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TRANSFER-138 | 传输中心取消/重试失败仅 Sheet 内 inline alert 展示，不得 error toast；加载失败仍走既有 banner+重试。 | done |

## 2026-07-24 商用硬化波次（云同步动作错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SYNC-139 | 云同步设置页动作失败（保存/测试/同步/推拉/冲突/版本/重置）仅页面 banner（controller.error）展示，不得 error toast；成功可 toast。 | done |

## 2026-07-24 商用硬化波次（串口中心动作错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SERIAL-140 | 串口中心复制/删除/批量删除失败仅中心 banner 展示，不得 error toast；连接失败由 useSerial error banner 承接，不得 toast。 | done |

## 2026-07-24 商用硬化波次（密钥材料对话框复制错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-KEY-141 | 密钥查看/编辑对话框内复制公钥/私钥失败仅对话框 inline alert 展示，不得 error toast；成功可 toast。 | done |

## 2026-07-24 商用硬化波次（AI 设置错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-AI-142 | AI 设置动作失败（提供商/设置/Agent 检测）仅设置页 error banner 展示，不得 error toast；成功可 toast。 | done |

## 2026-07-24 商用硬化波次（主题删除对话框拆分）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-ENG-143 | `ThemeManager.tsx` 提取 `ThemeDeleteDialog.tsx` 保持 ≤300 行余量；主题行为回归测试通过。 | done |

## 2026-07-24 商用硬化波次（设置自动保存错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SET-144 | 通用/终端设置 quiet autosave 失败仅由 AutoSaveStatusIndicator 展示，不得 error toast；非 quiet 失败仍可 toast。 | done |
| UX-SFTP-145 | SFTP 设置 quiet autosave 失败仅由 AutoSaveStatusIndicator 展示，不得 error toast。 | done |
| UX-SHORTCUT-146 | 快捷键 quiet 保存失败仅由 AutoSaveStatusIndicator 展示，不得 error toast；加载失败仍走 banner。 | done |
| UX-ABOUT-147 | 关于页打开外链失败仅 panel message/Alert 展示，不得 error toast。 | done |

## 2026-07-24 商用硬化波次（密钥与备份动作错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-KEY-148 | 密钥生成/导入/更新失败仅对应对话框 inline alert 展示，不得 error toast。 | done |
| UX-KEY-149 | 密钥删除/复制公钥失败仅 KeyManager 面板 banner 展示，不得 error toast。 | done |
| UX-SYNC-150 | 本地备份导出/导入失败仅同步页 transfer banner 展示，不得 error toast；成功可 toast。 | done |

## 2026-07-24 商用硬化波次（日志选择/撰写面板/主题重置错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-LOG-151 | 通用设置日志目录选择失败仅卡片 inline alert 展示，不得 error toast。 | done |
| UX-COMPOSE-152 | 终端撰写面板执行/宏执行/粘贴失败仅面板 Alert 展示，不得 error toast。 | done |
| UX-THEME-153 | 重置内置主题失败仅重置确认对话框 inline alert 展示，不得 error toast；成功可 toast。 | done |

## 2026-07-24 商用硬化波次（SFTP 面板与传输取消错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TRANSFER-154 | 传输取消失败仅 TransferCenter Sheet banner 展示，`useFileTransfer.cancelTransfer` 不得再 error toast（避免双 owner）。 | done |
| UX-SFTP-155 | SFTP 删除/重命名/新建目录失败仅 FilePanel inline alert 展示，不得 error toast。 | done |
| UX-SFTP-156 | 同步当前目录失败与选择上传/下载路径失败仅 FilePanel actionError banner 展示，不得 error toast；同步成功可 toast。 | done |

## 2026-07-24 商用硬化波次（侧栏宏创建/删除错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-MACRO-157 | 侧栏宏创建失败仅侧栏 banner 展示（创建宏失败），不得 error toast；表单保持打开可重试。 | done |
| UX-MACRO-158 | 侧栏宏删除失败仅侧栏 banner 展示（删除宏失败），不得 error toast；列表项保留。 | done |

## 2026-07-24 商用硬化波次（隧道对话框动作错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-TUNNEL-159 | 隧道新建启动失败仅表单 inline alert，不得 error toast。 | done |
| UX-TUNNEL-160 | 隧道列表启动/停止/删除失败仅对话框 action banner 展示，不得 error toast；删除成功可 toast。 | done |

## 2026-07-24 商用硬化波次（主题/串口信号/录制/批量/资产排序错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-THEME-161 | 标题栏切换颜色模式失败仅标题栏下方 banner（colorModeError）展示，不得 error toast；回滚原主题。 | done |
| UX-SERIAL-162 | 串口信号栏 DTR/RTS/Break 失败仅工具栏 inline alert 展示，不得 error toast；Break 成功可 toast。 | done |
| UX-REC-163 | 终端开始/停止录制失败仅终端工具栏 inline alert 展示，不得 error toast。 | done |
| UX-BATCH-164 | 会话批量操作执行失败仅确认对话框 inline alert 展示，不得 error toast；对话框保持打开可重试。 | done |
| UX-ASSET-165 | 资产分类排序失败仅分类表上方 inline alert 展示，不得 error toast。 | done |

## 2026-07-24 商用硬化波次（会话/分组 CRUD 错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SESSION-166 | 会话新建/编辑失败仅 SessionDialog inline alert 展示，`useSession` 不得 error toast。 | done |
| UX-SESSION-167 | 会话/分组删除失败仅删除确认对话框 inline alert 展示，不得 error toast。 | done |
| UX-SESSION-168 | 侧栏分组新建/编辑失败与空名称校验仅分组对话框 inline alert 展示，不得 toast。 | done |
| UX-SESSION-169 | 会话资产中心设为默认/移动会话失败仅中心 banner 展示，不得 error toast。 | done |

## 2026-07-24 商用硬化波次（分屏创建/关闭错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SPLIT-170 | 创建/关闭分屏失败仅 TerminalSplit 顶栏 banner 展示，不得 error toast；串口/上限仍可用 warning toast。 | done |

## 2026-07-24 商用硬化波次（SFTP 传输启动与宏执行错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SFTP-171 | 上传/下载启动失败（含拖放）仅 FilePanel actionError banner 展示，`useFileTransfer` 不得 error toast。 | done |
| UX-MACRO-172 | 侧栏/宏工作区执行宏失败仅对应固定 banner 展示，`executeMacroOnActiveTerminal` 不得 error toast；前置条件 info/warning 与成功 toast 可保留。 | done |

## 2026-07-24 商用硬化波次（工具栏剪贴板与关标签确认错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-CLIP-173 | 终端工具栏复制/粘贴失败仅工具栏 banner 展示，不得 error toast；不得产生未处理 rejection。 | done |
| UX-TAB-174 | 已确认关闭活动连接时 closeTab 失败仅确认对话框 inline alert 展示，不得 error toast；对话框保持打开可重试。无确认表面的关闭仍可 toast。 | done |

## 2026-07-24 商用硬化波次（删除确认失败保持对话框）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-DEL-175 | 串口单删/批删失败时确认对话框保持打开，仅 dialog inline alert 展示错误，不得 error toast，不得关闭后仅面板 banner。 | done |
| UX-DEL-176 | 密钥删除失败时确认对话框保持打开，仅 dialog inline alert 展示错误，不得 error toast。 | done |
| UX-DEL-177 | SFTP 删除文件失败时确认对话框保持打开，仅 dialog inline alert 展示错误，不得 error toast。 | done |
| UX-DEL-178 | 主题 Profile 删除失败时确认对话框保持打开，仅 dialog inline alert 展示错误，不得 error toast。 | done |

## 2026-07-24 商用硬化波次（终端剪贴板错误单一归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-CLIP-179 | 终端快捷键复制/粘贴失败仅路由到工具栏 banner（经 `mssh:terminal-clipboard-error`），不得 error toast。 | done |
| UX-CLIP-180 | 终端右键菜单复制/粘贴失败仅路由到工具栏 banner，不得 error toast。 | done |
| UX-CLIP-181 | 工具栏复制/粘贴失败继续仅工具栏 banner 展示；同一失败不得出现 toast + banner 双 owner。 | done |

## 2026-07-24 商用硬化波次（应用壳动作错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SHELL-182 | 打开本地终端失败仅应用壳 `WorkspaceRestoreBanner`/shellActionError 展示，不得 error toast。 | done |
| UX-SHELL-183 | 同步后刷新/热更新失败仅应用壳 shellActionError banner 展示，不得 error toast；成功仍可 success toast。 | done |
| UX-CONN-184 | `disconnect` API 失败向上抛错且不得 error toast（关闭路径由 tab close 归属）。 | done |

## 2026-07-24 商用硬化波次（设置保存与无确认关标签错误归属）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-SET-185 | 通用/SFTP/快捷键保存失败永不 error toast；调用方（AutoSaveStatusIndicator 或显式 await）承接错误。 | done |
| UX-TAB-186 | 无确认对话框的关标签失败（快捷键/批量）仅应用壳 shellActionError banner 展示，不得 error toast。 | done |

## 2026-07-24 商用硬化波次（AI 提供商选择 quiet 保存）

| ID | 验收条件 | 状态 |
|---|---|---|
| UX-AI-187 | 默认/回退提供商下拉变更以 quiet 保存，失败由 AI 面板 error banner 承接，不得 success/error toast 干扰。 | done |

## 2026-07-24 商用硬化波次（coverpkg 覆盖率门禁）

| ID | 验收条件 | 状态 |
|---|---|---|
| QA-COV-188 | `go test -race -coverpkg=./internal/...,./pkg/...` total ≥90%；补齐 serial PortSession/OpenPort、secureDial、terminal_serial、proxy/AI/reencrypt 等关键路径测试；串口 open 竞态用 live fake port 稳定。 | done |

## 2026-07-25 商用硬化波次（race 覆盖率闭环）

| ID | 验收条件 | 状态 |
|---|---|---|
| QA-COV-189 | `TestOpenSerialSuccessAndControl` 在 `-race` 下稳定：live fake port 保持设备占用，控制 API 成功路径可测。 | done |
| QA-COV-190 | `go test -race -coverpkg=./internal/...,./pkg/... ./internal/... ./pkg/...` EXIT 0 且 total ≥90.0%。 | done |

## 2026-07-25 商用硬化波次（并发、同步认证、关闭生命周期与前端竞态）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| DESKTOP-191 | 当应用退出时，系统必须先阻止新的文件传输，取消并等待已有传输 worker，随后关闭终端资源；重复关闭不得死锁。 | done |
| SYNC-192 | 当同步 artifact 的版本元数据、父链或嵌入式 Vault 被篡改时，系统必须通过 AES-GCM AAD 校验并拒绝回滚、分叉和非连续版本。 | done |
| SEC-193 | 当 AI 请求发生跨主机重定向或上下文脱敏时，系统必须剥离 API 密钥并隐藏环境变量密钥、认证 URI 和请求头凭证。 | done |
| TERM-194 | 当终端池执行 LRU 淘汰、PTY 退出或并发打开时，系统必须避免锁内回调死锁、统一保护系统采样并清理 reservation。 | done |
| UX-195 | 当语言切换、设置卸载或快速连续输入发生时，系统不得重挂终端树、丢失最后一次草稿或让旧响应覆盖新值。 | done |
| QA-COV-196 | 新增同步元数据、传输关闭/失败、终端并发回收测试；CI 同款 Go race 覆盖率必须达到 ≥90%，golangci-lint 必须无问题。 | done |

## 2026-07-25 商用硬化波次（关闭闸门、上下文取消与同步状态原子性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| DESKTOP-203 | 当临时执行 `CloseAll`/`CloseAllTerminals` 时，系统必须阻止新的连接或终端打开，取消并等待已有操作，再释放闸门以支持同步后的正常重连。 | done |
| DESKTOP-204 | 当应用执行最终 shutdown 时，Session/Terminal 服务必须永久拒绝新操作，重复 shutdown 不得死锁或遗留连接、PTY。 | done |
| TERM-205 | 当本地 Shell、串口或远程终端的调用上下文取消时，系统必须停止启动流程并关闭已创建的底层资源。 | done |
| SYNC-206 | 当同步成功状态的版本保护或 baseline 写入任一步失败时，系统必须通过同一数据库事务回滚全部元数据变更。 | done |
| QA-COV-207 | 生命周期闸门、上下文取消和同步事务必须有 race 回归用例；CI 同款 Go 覆盖率必须保持 ≥90%，golangci-lint 必须无问题。 | done |

### 当前验证快照

本轮已完成的定向证据：

- `golangci-lint run --timeout 5m ./...`：0 issues
- `go test -race -coverprofile=... -coverpkg=./internal/...,./pkg/... ./internal/... ./pkg/...`：全绿，total **90.0%**
- 新增 `validateRemoteArtifactMetadata`、传输 worker 关闭/失败、无主任务清理测试，并通过定向 race
- 新增 Session/Terminal 临时关闭闸门、最终 shutdown、Local Shell/串口 context 取消和同步 baseline 事务回滚测试
- 已使用 `gofmt` 与 `goimports-reviser` 整理本轮 Go 改动

### 发布与架构收口

以下项目已完成仓库内实现与可本地复现的门禁；依赖 GitHub OIDC 或 Flathub 审核的外部执行证据保持 `partial`，不以本地模拟冒充平台结果：

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| RELEASE-197 | 当任一 Linux/Windows/macOS 发布包生成失败时，Release 工作流必须失败并阻止发布；不得使用 Flatpak/NSIS 的 soft-fail 或无条件 `|| true`。 | done |
| RELEASE-198 | 当发布产物上传前，工作流必须生成并校验 SHA-256、SBOM、构建来源证明和签名；Release 页面必须同时发布校验文件。 | partial |
| RELEASE-199 | 当 CI 与 Release 构建 Wails、Go、Node 和前端依赖时，必须使用锁定版本/锁文件并在构建前验证版本，避免 `latest` 漂移。 | done |
| FLATHUB-200 | 当提交 Flathub 时，项目必须提供可审查的应用 ID、manifest、metainfo、图标、权限说明和自动化验证，并以 Flathub 审核结果作为发布门禁。 | partial |
| QA-E2E-201 | 当执行合并门禁时，真实 SSH/tmux/SFTP/串口集成测试与性能预算必须有可复现的 CI 任务或明确的独立发布门禁。 | done |
| ARCH-202 | 当并发规模和数据库读写增长时，系统必须以指标证明事件总线、SQLite 连接策略和跨平台系统探针满足定义的性能预算。 | done |

本轮新增证据：

- Release 工作流通过 `actionlint`、`scripts/release/validate-workflow.sh` 与 metadata smoke test；Cosign v3 使用 Sigstore bundle 并在工作流内执行 `verify-blob`。下一次 tag 的 GitHub OIDC 实签是 `RELEASE-198` 的最终外部证据。
- CI 新增 `commercial-performance` 三次 benchmark artifact、Flatpak/Flathub manifest 校验任务，以及 Linux PTY 串口数据链路集成测试。
- 本地与 Flathub manifest 均通过 AppStream、`flatpak-builder --show-manifest`、权限/图标检查；Flathub tag/commit 远程一致。商店审核结果是 `FLATHUB-200` 的最终外部证据。
- SQLite 固定单连接并有断言；Wails event bus、终端输出、系统探针和数据库路径均有预算测试或 allocation benchmark。

## 2026-07-25 商用硬化波次（跨平台文件替换与同步退出收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| FS-208 | 当应用在 Windows 覆盖已有本地文件时，系统必须使用可替换且写穿的原子移动；Unix 保持原子重命名语义。 | done |
| SEC-209 | 当 Vault 被保存或轮转时，系统必须使用同目录唯一临时文件、0600 权限和写入同步，避免并发调用互相覆盖。 | done |
| DESKTOP-210 | 当应用退出且同步 catch-up 正在运行时，系统必须先取消并等待同步，再关闭终端、连接和数据库；重复退出不得死锁。 | done |
| QA-COV-211 | 跨平台替换、Vault 覆盖、scheduler context 取消和 shutdown 顺序必须有回归测试；Linux race 与 Windows 目标编译必须通过。 | done |
| RELEASE-212 | 当 Release 工作流选择 macOS amd64 runner 时，必须使用 GitHub 当前有效的 x64 hosted label，并通过 `actionlint` 校验。 | done |

本波次验证证据：`go vet ./...`、`govulncheck ./...`、Windows `amd64` 目标编译、定向 `go test -race` 压力运行和应用 shutdown 顺序回归均通过。

## 2026-07-26 商用硬化波次（前端异步代际与动态 i18n 收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UX-ASYNC-213 | 当用户快速重复提交会话、隧道、宏或录制删除操作时，系统必须保持单飞，禁止同一动作产生重复后端调用。 | done |
| UX-ASYNC-214 | 当对话框关闭、重开或切换目标时，旧的异步响应不得重置新表单、覆盖新错误或改变当前目标。 | done |
| UX-ASYNC-215 | 当会话资产中心执行删除、移动或默认分组操作时，系统必须按动作键去重，并由当前确认目标/动作承接错误。 | done |
| UX-AI-216 | 当 AI 提供商保存响应晚到或设置刷新发生时，系统不得覆盖用户尚未提交的草稿，也不得切回已离开的提供商。 | done |
| UX-I18N-217 | 当运行时切换中英文时，组件必须重新计算翻译；禁止模块初始化阶段冻结 `t()` 结果或用 `useState(t())` 固化文案。 | done |
| QA-FE-218 | 当提交前端硬化改动时，必须通过异步竞态回归、动态 i18n AST 守卫、TypeScript、源码行数、bundle budget 和完整 Vitest 门禁。 | done |

## 2026-07-26 商用硬化波次（CI 门禁收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| QA-CI-219 | 当提交本轮 Go/前端改动时，必须通过与 CI 一致的 lint、race 覆盖率、源码行数、前端测试和生产构建门禁。 | done |

本轮门禁收口证据：`SyncFromCloud` 已拆分下载与恢复职责并通过 `golangci-lint v2.12.2`；`security.go` 已拆分自动解锁逻辑并满足 Go 生产文件 ≤300 行；`wails3 task ci` EXIT 0，Go race coverpkg total **90.0%**，前端 **186** 个测试文件 / **1148** 个用例通过，生产构建通过。

## 2026-07-26 商用硬化波次（终端输出无损背压与路径 fail-closed）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TERM-220 | 当单个终端输出持续超过前端解析能力时，系统必须按高/低水位暂停和恢复对应 PTY read，保持字节、序列和 ANSI 边界完整，不得以丢弃输出换取降载。 | done |
| SEC-221 | 当数据库录制路径指向数据目录外、符号链接目标外或非普通文件时，读取和删除操作必须 fail-closed，并保留原始文件与数据库事务状态。 | done |
| SEC-222 | 当应用 Vault 未解锁、keychain 不可用或解锁回调重入时，受保护数据必须拒绝明文回退，自动解锁偏好必须降级关闭，回调不得在状态锁内执行。 | done |
| QA-COV-223 | 当提交本轮终端流控、Vault、录制路径和绑定生成改动时，必须通过 race、覆盖率 ≥90%、golangci-lint、TypeScript、全量 Vitest 和生产构建。 | done |

本波次证据：`terminalOutputFlow`/`TerminalOutputFlowControl` 高低水位与关闭唤醒测试通过；录制目录、缺失文件、符号链接父目录和删除幂等测试通过；Wails wiring-only `SetSerialService` 使用 `//wails:ignore` 后重新生成绑定；`wails3 task ci` 通过。

## 2026-07-26 商用硬化波次（Vault 导入事务与绑定暴露面收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-224 | 当密码保护备份导入或新设备加入时，系统必须从 Vault 暂存开始到数据库恢复完成持续独占加密操作闸门；应用密码轮转不得插入并造成密文与活动 DEK 不一致。 | done |
| SEC-225 | 当 Vault 暂存、数据库恢复或事务提交失败时，系统必须回滚 Vault 文件、运行时 DEK、安全偏好与 keychain；同步服务不得保留非事务 Vault 安装回退。 | done |
| AUDIT-226 | 当密码保护备份导入成功或失败且审计已启用时，系统必须记录固定摘要与结果，且不得写入密码或本地备份路径。 | done |
| API-227 | 当重新生成 Wails bindings 时，系统不得向前端暴露 Vault 安装、恢复协调或后端 wiring 方法。 | done |
| QA-COV-228 | Vault 导入并发、提交回滚、审计结果和 bindings 暴露面必须有回归测试，并通过与 CI 对齐的完整门禁。 | done |

本波次定向证据：Vault 安装事务持有 `CryptoRuntime` 操作闸门直至 `Commit`/`Rollback`；密码导入 race、审计成功/失败、提交失败回滚和 bindings 守卫测试通过；`golangci-lint v2.12.2` 为 0 issues；完整 `wails3 task ci` 通过工具链、Lint、Go race 覆盖率（90.1%）、前端源码限制、bundle budget、Vitest（186 个文件 / 1152 个用例）和生产构建。

## 2026-07-26 商用硬化波次（发布工作流与前端依赖安全）

| ID | 验收条件 | 状态 |
|---|---|---|
| RELEASE-229 | 当发布工作流使用 GitHub-hosted runner 时，所有标签必须通过 `actionlint` 校验并匹配当前有效平台；无效标签不得进入发布分支。 | done |
| FE-SEC-230 | 当前端依赖存在已知高危漏洞时，系统必须移除未使用的运行时脚手架依赖、锁定修复后的传递依赖，并在本地/CI 门禁执行官方 registry 的 `npm audit`。 | done |

本波次证据：macOS amd64 runner 从无效的 `macos-15-intel` 修正为有效的 `macos-15`，`actionlint` 与发布校验脚本通过；移除未被源码引用的 `shadcn` 运行时依赖，`npm ci` 后 `npm audit --audit-level=high --registry=https://registry.npmjs.org` 报告 0 vulnerabilities。

## 2026-07-26 商用硬化波次（SOCKS 代理与 Vault 状态原子性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| NET-PROXY-231 | 当应用代理配置为 `socks5` 或 `socks5h` 时，系统必须执行真实 SOCKS5 握手与可选用户名密码认证，不得将 SOCKS URL 交给 HTTP Proxy 处理。 | done |
| NET-PROXY-232 | 当 SOCKS 代理启用时，系统必须动态应用最新代理配置、遵守 `NoProxy`，并在连接代理端点或目标前阻断元数据、链路本地、未指定与组播地址。 | done |
| SEC-VAULT-233 | 当首次设置或解锁应用密码后写入安全偏好失败时，系统必须回滚 Vault 文件、运行时 DEK、安全偏好与 keychain，不得返回失败却保留半完成解锁状态。 | done |
| SEC-VAULT-234 | 当解锁、自动解锁、同步密钥派生、运行时加解密或密码轮转结束时，系统必须主动清零临时 DEK 副本，不得仅依赖 GC 回收。 | done |
| QA-COV-235 | SOCKS 认证、`socks5h` 域名、`NoProxy`、危险目标、DNS 过滤、失败回滚和安全拨号必须有 race 回归测试；新增 `netproxy` 代码覆盖率必须达到 ≥90%。 | done |

本波次证据：本地 fake SOCKS5 服务验证真实 HTTP 转发、认证成功/失败、动态配置与 `socks5h` 域名请求；`internal/netproxy` race 压力测试稳定且覆盖率 **91.7%**；SQLite 触发器验证 `Setup`/`Unlock` 偏好写入失败后完整回滚；完整 `wails3 task ci` 通过，Go race coverpkg total **90.1%**、前端 **186** 个测试文件 / **1152** 个用例、官方 npm audit 0 vulnerabilities、生产构建成功。

## 2026-07-26 商用硬化波次（录制、PTY 与串口整数边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SEC-236 | 当回放文件声明超大终端类型、条目数据或超出 JSON 有符号范围的时间戳时，系统必须在分配内存或生成数据前拒绝；截断条目不得被当作正常 EOF。 | done |
| SEC-237 | 当录制器写入终端尺寸、类型或输出条目时，系统必须拒绝负值、格式不可表示值和超过 1 MiB 的单条数据。 | done |
| SEC-238 | 当本地 Shell 启动或调整 PTY 尺寸时，系统必须在转换为平台 `uint16` 前执行上限校验；串口平台句柄必须拒绝负值、零值和 `uintptr` 溢出。 | done |
| QA-COV-239 | 当提交录制、Local Shell 或串口边界修复时，必须有恶意文件、溢出尺寸、句柄范围和 race 回归用例，并通过 Go lint 与相关包测试。 | done |

本波次证据：`internal/ssh`、`internal/localshell`、`internal/serial` 包测试与 race 测试通过；`golangci-lint v2.12.2` 全量扫描为 0 issues；完整 `wails3 task ci` 通过，Go race coverpkg total **90.1%**、前端 **186** 个测试文件 / **1152** 个用例、官方 npm audit 0 vulnerabilities、生产构建成功。gosec 剩余报告仅包含已有的用户路径/允许 shell、平台反射适配等需人工审查项，不再包含本波次的整数边界问题。

## 2026-07-26 商用硬化波次（工作区写回门禁与敏感缓冲清零）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| WORKSPACE-240 | 当工作区恢复失败时，系统必须保持持久化写入关闭；用户在错误期间切换页面也不得覆盖原快照，只有重试成功后的真实布局变化才允许保存。 | done |
| WORKSPACE-241 | 当启动时关闭标签恢复或不存在历史快照时，系统不得用初始空布局覆盖旧数据，同时必须保存后续第一次真实布局变化。 | done |
| SEC-242 | 当密码保护同步包解锁、主密码轮转、会话/代理/同步凭据加解密结束时，系统必须主动清零临时 DEK 与可变明文缓冲。 | done |
| UX-THEME-243 | 当删除主题配置后清理颜色定义时，仅“仍被其他配置引用”冲突可静默保留；其他清理失败必须在主题卡片内展示非阻塞错误，不得伪装为完整成功。 | done |
| QA-COV-244 | 工作区恢复失败/重试、关闭恢复、无历史快照、主题定义清理和明文缓冲清零必须有回归测试，并通过与 CI 对齐的完整门禁。 | done |

本波次证据：`internal/service` 完整 race 回归通过；工作区与主题定向 Vitest 通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，前端 **186** 个测试文件 / **1155** 个用例通过，官方 npm audit 0 vulnerabilities，生产构建成功。

## 2026-07-26 商用硬化波次（终端流控自愈与池配置启动一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TERM-245 | 当前端暂停/恢复调用全部失败、渲染器退出或终端关闭时，前端必须停止新增输出排队并进入可重试错误态；后端必须通过暂停租约、关闭或重新 Attach 唤醒对应 PTY reader，不得永久卡住。 | done |
| TERM-246 | 当应用启动且数据库存在合法终端池配置时，后端必须在首个终端打开前应用该上限；配置缺失或非法时必须回退到统一默认值 `10`，前端保存必须先持久化再更新运行时池。 | done |
| QA-COV-247 | 当提交终端流控与池配置改动时，必须覆盖暂停租约过期、关闭唤醒、恢复重试耗尽、非法配置回退和启动加载，并通过 race、Lint、前端全量测试与生产构建门禁。 | done |

本波次证据：新增后端暂停租约、重新 Attach 释放旧暂停、启动配置读取、前端恢复重试耗尽与队列 fail-closed 回归用例；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，前端 **186** 个测试文件 / **1162** 个用例通过，官方 npm audit 0 vulnerabilities，生产构建成功。

## 2026-07-26 商用硬化波次（分屏恢复、串口草稿与批量目标一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| WORKSPACE-248 | 当工作区包含缺失、重复或超量角色的分屏快照时，系统必须在打开额外终端前拒绝恢复；SSH 与本地终端快照不得绕过同一结构校验。 | done |
| TERM-249 | 当分屏恢复被取消、部分打开失败或结果被丢弃时，系统必须关闭额外后端终端并同步清理连接状态与池 reservation，不得遗留幽灵终端。 | done |
| UX-SERIAL-250 | 当串口设备轮询在新建或编辑配置期间刷新时，系统必须保留用户尚未保存的名称、设备和通信参数，不得重置当前草稿。 | done |
| UX-ASSET-251 | 当会话批量资产选择被清空时，系统必须关闭并重置旧确认目标；后续重新选择不得自动复用已取消的批量动作。 | done |
| QA-FE-252 | 分屏快照校验、恢复清理、串口设备刷新和批量选择清空必须有回归测试，并通过与 CI 对齐的完整门禁。 | done |

本波次证据：相关终端、串口和会话组合测试 **9** 个文件 / **76** 个用例通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，前端 **186** 个测试文件 / **1169** 个用例通过，官方 npm audit 0 vulnerabilities，生产构建成功。

## 2026-07-26 商用硬化波次（设置与同步失败竞态收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UX-SETTINGS-253 | 当通用设置收到跨窗口提交事件时，旧加载请求不得覆盖新设置；终端池运行时上限必须按最新值串行收敛。 | done |
| UX-AUTOSAVE-254 | 当自动保存失败后用户回退到已保存值时，界面必须清除陈旧错误；旧的飞行中保存结果不得再次污染当前状态。 | done |
| UX-SYNC-255 | 当云同步操作失败且较早的 Dashboard 刷新晚到时，失败信息必须保留；初次 Dashboard 加载失败必须展示可重试页面错误。 | done |
| QA-FE-256 | 设置自动保存、跨窗口运行时上限、云同步错误竞态和 Dashboard 重试必须有回归测试，并通过前端类型、源码限制、全量测试及生产构建。 | done |

本波次验证证据：相关定向测试 **47** 个用例通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，前端 **186** 个测试文件 / **1175** 个用例通过，官方 npm audit 0 vulnerabilities，生产构建成功；生成的 `frontend/dist`、`bin/mssh` 与 coverage 文件已清理。

## 2026-07-26 商用硬化波次（Vault 跨窗口状态与密钥列表收敛）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SEC-VAULT-257 | 当 `security:vault-changed`、`security:vault-locked` 或状态请求乱序到达时，所有窗口必须重新读取后端权威状态后才允许进入已解锁界面；旧解锁事件和旧状态响应不得覆盖较新的锁定状态。 | done |
| UX-SECURITY-258 | 当其他窗口设置、解锁、锁定、轮转应用密码或修改安全偏好时，安全设置卡片必须自动重新加载状态，不得长期展示陈旧配置。 | done |
| UX-KEYS-259 | 当密钥列表仍在加载时生成、导入、更新或删除密钥，系统必须作废旧列表响应并重新拉取权威列表，既不得回滚本次变更，也不得丢失此前已有密钥；成功变更必须清除陈旧列表错误。 | done |
| QA-FE-260 | Vault 事件乱序、双窗口首次设置、安全卡片跨窗口刷新、密钥列表与变更竞态必须有回归用例，并通过完整 CI 对齐门禁。 | done |

本波次验证证据：相关定向测试 **6** 个文件 / **66** 个用例通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，前端 **186** 个测试文件 / **1180** 个用例通过，官方 npm audit 0 vulnerabilities，源码限制、bundle budget、TypeScript 与生产构建均通过；生成的 `frontend/dist`、`bin/mssh` 与 coverage 文件已清理。

## 2026-07-26 商用硬化波次（安全偏好权威收敛与 Vault 事件去重）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UX-SECURITY-261 | 当已配置 Vault 的安全偏好保存失败时，界面必须保持最后一次持久化值并展示内联错误；保存成功前不得乐观漂移，成功后必须以重新加载的权威状态更新。 | done |
| SEC-VAULT-262 | 当本窗口执行 Vault 操作并同时收到对应广播事件时，安全设置必须合并为一次串行状态刷新；锁定操作只能广播专用锁定事件，不得再叠加同义状态变更事件。 | done |
| QA-SEC-263 | 安全偏好失败/成功收敛、本地操作事件合并和锁定事件唯一性必须有前后端回归测试，并通过与 CI 对齐的完整门禁。 | done |

本波次验证证据：安全设置与 Vault 定向测试 **4** 个文件 / **47** 个前端用例及 Go race 回归通过；`wails3 task ci` 完成全部阶段，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，前端 **186** 个测试文件 / **1183** 个用例通过，官方 npm audit 0 vulnerabilities，源码限制、bundle budget、TypeScript 与生产二进制构建均通过。

## 2026-07-26 商用硬化波次（自动保存最终值收敛）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UX-AUTOSAVE-264 | 当自动保存请求仍在途且用户继续编辑或回退到原持久化值时，系统必须串行补写最新值；旧请求成功或失败均不得覆盖当前状态，最终补写完成前必须持续显示保存中。 | done |
| QA-FE-265 | 自动保存必须覆盖基线回退、最新非基线值合并、最终补写失败、活动快照回切、禁用期间取消排队及 `flush()` 等待完整队列，并通过设置面板回归与完整 CI 对齐门禁。 | done |

本波次验证证据：自动保存定向测试 **12** 个用例及相关设置面板 **39** 个用例通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，前端 **186** 个测试文件 / **1188** 个用例通过，官方 npm audit 0 vulnerabilities，源码限制、bundle budget、TypeScript 与生产构建均通过。

## 2026-07-26 商用硬化波次（设置草稿初始化与外部刷新保护）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UX-AUTOSAVE-266 | 当设置数据从未就绪切换为已就绪且草稿同步同时发生时，自动保存必须先以最新权威草稿建立基线；旧默认值不得被写回。 | done |
| UX-SYNC-267 | 当云同步 Dashboard 刷新到达且用户存在未保存配置时，面板必须保留当前草稿；保存成功后才承接权威状态，不得清空用户输入或凭据草稿。 | done |
| QA-FE-268 | 就绪切换、草稿初始化、云同步陈旧 Dashboard 覆盖和自动保存回归必须有测试，并通过 TypeScript、源码限制、全量前端测试与完整 CI 门禁。 | done |

本波次验证证据：就绪切换与草稿同步定向测试 **32** 个用例通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，前端 **186** 个测试文件 / **1190** 个用例通过，官方 npm audit 0 vulnerabilities，源码限制、bundle budget、TypeScript 与生产构建均通过。

## 2026-07-26 商用硬化波次（会话突变代际缓存有界化）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| PERF-SESSION-269 | 当会话被反复创建、更新、移动或删除时，前端突变代际缓存只能保留仍有活动响应的会话；完成或失效后必须释放，且不得因释放后复用代际而接受旧响应。 | done |
| QA-FE-270 | 会话代际 tracker 必须覆盖新旧代际、旧完成、显式失效、重复突变不留存，以及更新后删除时旧刷新不得恢复会话，并通过完整 CI 门禁。 | done |

本波次验证证据：`sessionMutationTracker` 与 `useSession` 定向测试 **22** 个用例通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，前端 **187** 个测试文件 / **1199** 个用例通过，官方 npm audit 0 vulnerabilities，源码限制、bundle budget、TypeScript 与生产构建均通过。

## 2026-07-26 商用硬化波次（AI 提供商保存收敛与全量测试稳定性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UX-AI-271 | 当 AI 提供商保存成功且保存期间没有更新编辑或切换目标时，编辑器必须接纳服务端返回的规范化结果并清除脏状态；旧保存或删除响应不得覆盖新的提供商目标或较新草稿。 | done |
| QA-FE-272 | AI 提供商编辑、连接测试、删除确认、优先级调整和终端设置自动保存必须使用相互隔离且完整等待异步边界的测试，不得在全量并发运行时超时或跨用例泄漏操作。 | done |

本波次验证证据：AI 提供商与设置视图定向测试 **2** 个文件 / **20** 个用例无警告通过；完整 `wails3 task ci` EXIT 0，前端全量 **187** 个测试文件 / **1199** 个用例通过，其余 lint、Go race 覆盖率、npm audit、TypeScript 与生产构建门禁全部通过。

## 2026-07-26 商用硬化波次（设置草稿历史有界化与跨页写入隔离）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| PERF-SETTINGS-273 | 当设置草稿长期自动保存时，历史修订缓存必须固定为最多 **32** 条 LRU 指纹，不得无界增长，也不得长期保留代理密码等历史序列化明文；重复值只保留最高修订。 | done |
| UX-SETTINGS-274 | 当通用页与终端页在前一次保存未完成时继续产生保存请求，系统必须按调用顺序串行落库；每个页面只能覆盖自身负责的字段，旧全量快照不得回滚另一页面的新值，且前一次失败不得阻塞后续最新写入。 | done |
| QA-FE-275 | 草稿历史必须覆盖重复值、LRU 淘汰、指纹脱敏和非法容量；设置保存必须覆盖跨作用域并发、最终值收敛和失败后继续，并通过完整 CI 对齐门禁。 | done |

本波次验证证据：设置 Hook、设置视图与设置窗口定向测试 **7** 个文件 / **72** 个用例通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，前端 **188** 个测试文件 / **1205** 个用例通过，官方 npm audit 0 vulnerabilities，源码限制、bundle budget、TypeScript 与生产构建均通过。

## 2026-07-26 商用硬化波次（自动重连并发调度与取消收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TERM-RECONNECT-276 | 当多个 SSH 主标签或分屏窗格同时异常断线时，系统必须按 FIFO 串行执行自动重连；全局连接弹框或分屏操作繁忙不得导致后续请求被静默丢弃。 | done |
| TERM-RECONNECT-277 | 自动重连队列必须按 terminal 去重、保持固定上限，并在标签关闭、主动断开、关闭自动重连或目标失效时释放排队任务；不得使用无限轮询或遗留定时器。 | done |
| TERM-RECONNECT-278 | 当用户取消正在进行的 SSH 握手时，系统必须取消 Wails 调用、停止退避重试并恢复 disconnected 状态；串口和已退出的本地 Shell 不得被自动重启。 | done |
| QA-FE-279 | 自动重连必须覆盖主标签/分屏并发、弹框阻塞、重复事件、队列容量、目标关闭、配置关闭、用户取消和事件桥接，并通过完整 CI 对齐门禁。 | done |

本波次验证证据：自动重连调度、执行器、事件桥与分屏定向测试 **7** 个文件 / **63** 个用例通过；前端全量 **191** 个测试文件 / **1221** 个用例通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，官方 npm audit 0 vulnerabilities，源码限制、bundle budget、TypeScript 与生产构建均通过。门禁生成的 coverage、二进制与 `frontend/dist` 已清理。

## 2026-07-26 商用硬化波次（全局主机指纹确认与安全重连）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SEC-HOSTKEY-280 | 当 SSH、SFTP、隧道或批量连接遇到首次主机指纹时，系统必须使用独立的全局安全确认层串行展示；后台连接不得覆盖、阻塞或污染前台连接进度弹框。 | done |
| SEC-HOSTKEY-281 | 当多个连接并发校验未知主机时，首次确认、重新读取 `known_hosts` 与最终落盘必须在 SSH 层线性化；同一主机同一密钥只能提示一次，确认期间出现不同密钥必须 fail-closed，写入、Sync 与 Close 错误必须完整返回。 | done |
| TERM-RECONNECT-282 | 当用户明确拒绝主机指纹时，自动重连必须将其视为不可重试安全错误并在第一次失败后停止；普通瞬时网络错误仍必须保持三次退避尝试。 | done |
| QA-FE-283 | 主机指纹并发去重、跨协调器出队、停止清理、独立弹框和拒绝后停止重试必须有回归测试，并通过与 CI 对齐的完整门禁。 | done |

本波次验证证据：主机指纹与重连定向测试 **5** 个前端文件 / **41** 个用例及 `internal/ssh`、`internal/service` 后端测试通过；`goimports-reviser v3.12.6` 已格式化新增 Go 文件；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，前端 **194** 个测试文件 / **1231** 个用例通过，官方 npm audit 0 vulnerabilities，源码限制、bundle budget、TypeScript 与生产构建均通过。

## 2026-07-26 商用硬化波次（云同步 ETag fail-closed）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-SEC-284 | 当本地 `sync.etag` 不存在时，首次上传必须使用 `If-None-Match: *`；当该设置损坏、类型错误或数据库读取失败时，上传必须在发出网络请求前 fail-closed，不得降级为首次上传。 | done |
| SYNC-SEC-285 | 当本地存在有效 ETag 时，云端上传必须携带原始 `If-Match` 值；远端前置条件失败必须继续作为同步冲突返回，不得覆盖远端配置。 | superseded by SYNC-ARCH-702 for Gist |
| QA-COV-286 | 损坏 ETag、缺失 ETag、有效 ETag、数据库关闭和远端冲突必须有回归测试，并通过 Go race、完整覆盖率与 CI 对齐门禁。 | done |

本波次验证证据：新增损坏 ETag 测试证明修复前会继续请求并误报成功，修复后在网络调用前返回 `decode cloud ETag`；同步云端上传/下载/冲突与关闭数据库定向测试通过，`internal/service` race 测试通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，前端 **194** 个测试文件 / **1231** 个用例、官方 npm audit、源码限制、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（更新检查版本与链接信任边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UPDATE-SEC-287 | 当 GitHub Release 或当前构建版本不符合严格 SemVer 时，检查更新必须返回错误，不得把非法字段静默解析为 `0.0.0`；稳定版、预发布版、数字标识符和 build metadata 必须按 SemVer 优先级比较。 | done |
| UPDATE-SEC-288 | 当更新接口返回发布链接时，系统只允许 `https://github.com/xuthus5/mssh/releases/tag/<对应版本>`，并拒绝凭据、端口、查询参数、片段、其他域名、其他仓库或不匹配 tag。 | done |
| QA-COV-289 | 核心版本、预发布、build metadata、非法版本、缺失版本、非可信链接和成功更新检查必须有回归测试，并通过 Go race 与完整 CI 门禁。 | done |

本波次验证证据：严格 SemVer 与更新接口定向测试通过，修复覆盖稳定版高于 RC、数字预发布顺序、build metadata 忽略、非法核心/前导零以及非可信 Release URL；`internal/service` race 测试通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，前端 **194** 个测试文件 / **1231** 个用例、官方 npm audit、源码限制、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（i18n 错误状态与交互语义解耦）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| FE-I18N-290 | 当关于页在中文或英文环境中发生信息加载、更新检查或外链打开失败时，错误样式必须由结构化消息级别决定；不得通过匹配翻译文本判断 destructive 状态。 | done |
| FE-I18N-291 | 当宏列表加载或创建、删除、执行动作失败时，侧栏必须使用稳定的 `load` / `action` 类型区分错误；只有加载失败可以展示重新加载按钮，动作错误不得被二次包装为加载错误。 | done |
| FE-I18N-292 | 当文件传输因会话删除等稳定业务原因结束时，前后端共享模型必须携带与语言无关的失败原因码，并在渲染层翻译；不得继续依赖持久化错误文案识别是否可重试。该项涉及共享类型与持久化协议，等待明确授权后实施。 | partial |
| QA-FE-293 | 关于页英文 destructive 样式与宏英文动作失败分类必须有回归测试，并通过源码限制、前端全量测试、TypeScript、Go race 覆盖率和生产构建门禁。 | done |

本波次验证证据：新增英文更新失败样式和英文宏创建失败分类回归，修复前分别错误使用默认 Alert 样式、显示 `Failed to load macros` 与 `Retry`，修复后定向 **3** 个文件 / **16** 个用例通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，前端 **194** 个测试文件 / **1233** 个用例通过，官方 npm audit 0 vulnerabilities，源码限制、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（i18n 目录完整性与英文质量门禁）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| FE-I18N-294 | 当生产代码新增任何中文字符串字面量或静态 `t(...)` 键时，英文目录必须同时提供对应词条；条件表达式、配置数组、错误模板和其他 `t(variable)` 动态路径不得绕过覆盖检查。 | done |
| UX-I18N-295 | 当界面切换为英文时，状态必须使用正确时态，操作与表头必须使用自然英文；不得出现粘连词、机器直译、错误单复数、错误业务含义或误写入目录的 JSX 源码片段。 | done |
| QA-FE-296 | i18n 必须自动拒绝中文残留、缺失静态/动态目录项、已知粘连模式和源码片段，并对关键连接、筛选、分屏、同步、串口与标签文案建立精确回归断言。 | done |

本波次验证证据：新增“所有生产中文字符串必须入英文目录”的 AST 守卫，补齐 **14** 个缺失英文键（含本地备份动态错误模板），清理 **2** 个 JSX 污染键，并修正连接状态、串口参数、分屏、同步保留、筛选、密钥与恢复流程中的高置信英文质量问题；i18n 与相关交互定向 **4** 个文件 / **26** 个用例通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，前端 **194** 个测试文件 / **1236** 个用例通过，官方 npm audit 0 vulnerabilities，源码限制、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（前端结构复杂度门禁）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| FE-ENG-297 | 当前端生产 TypeScript/TSX 代码增长时，任一函数必须不超过 **50** 行、任一生产文件必须不超过 **300** 行、任一函数位置参数必须不超过 **3** 个；复杂页面和 Hook 必须按状态、动作、运行时与视图职责拆分，不得通过等价压缩规避门禁。 | done |
| FE-ENG-298 | 当执行 `check:source-limits` 时，系统必须使用 TypeScript AST 检查函数行数和位置参数，并检查所有测试辅助函数；仅 `describe`、`it`、`test` 及其 `each` 注册回调可按声明式测试结构豁免。 | done |
| QA-FE-299 | 当提交前端结构加固时，必须覆盖设置、会话、串口、终端、SFTP、文件与工作区回归，并通过源码限制、bundle budget、全量 Vitest、TypeScript、Go race 覆盖率、依赖审计和生产构建门禁。 | done |

本波次将前端生产函数超限从 **78** 处清零、位置参数超限从 **22** 处清零；`check:source-limits` 验证 **310** 个生产文件和 **507** 个 TypeScript 源文件均满足限制。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，前端 **194** 个测试文件 / **1236** 个用例通过，官方 npm audit 0 vulnerabilities，bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（分屏拖拽监听生命周期）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UX-SPLIT-300 | 当用户拖动分屏分隔条并发生 `pointercancel`、开始新的拖拽或组件卸载时，系统必须立即移除全局 `pointermove` / `pointerup` / `pointercancel` 监听；取消后的指针移动不得继续改变分屏比例。 | done |
| QA-FE-301 | 分屏拖拽必须覆盖正常移动、取消后停止更新和卸载后停止更新，并通过分屏回归、TypeScript、源码复杂度与完整 CI 门禁。 | done |

本波次新增取消与卸载回归，修复前两个用例均可复现遗留监听，修复后分屏定向 **2** 个文件 / **23** 个用例通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **310** 个生产文件和 **508** 个 TypeScript 源文件均满足限制，前端 **195** 个测试文件 / **1238** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（异步轮询单飞与背压）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| PERF-POLL-302 | 当串口目录、串口信号、状态栏系统信息或系统监控采集超过轮询周期时，同一轮询器最多只能存在一个在途请求；下一次采集必须在当前请求完成后重新计时，焦点刷新和动作回读必须合并，不得形成并发请求堆积。 | done |
| QA-FE-303 | 单飞轮询器必须覆盖慢任务、合并触发和停止清理；四条业务链路必须覆盖慢请求不重叠、终端消失停止及完成后恢复轮询，并通过源码限制、TypeScript、前端全量测试和完整 CI 对齐门禁。 | done |

本波次新增通用 `AsyncPoller`，将四类异步 `setInterval` 改为完成后调度；修复前状态栏与系统面板在 **9 秒** 内分别堆积 **4** 个请求，串口信号在 **5 秒** 内堆积 **6** 个请求，修复后定向 **5** 个文件 / **32** 个用例通过。`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1242** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（系统监控终端快照隔离）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UX-MONITOR-304 | 当系统监控面板保持挂载但活动终端发生切换时，概览指标、进程列表和采集失败状态必须立即与新终端隔离；新请求完成前不得继续展示上一主机的数据。 | done |
| QA-FE-305 | 系统监控必须覆盖概览与进程切换竞态、Wails 返回空系统信息、采集失败重试和终端消失停轮询；空响应不得写入快照，必须以可重试采集失败处理。 | done |

本波次将概览和进程状态改为携带 `terminalID` 的快照，并将失败状态绑定到对应终端；Wails 可空 `SystemInfo` 返回按采集失败处理，避免空值污染当前视图。`SystemPanel` 定向 **12** 个用例通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1245** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（AI 终端目标隔离）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-SEC-306 | 当同一会话内的活动分屏终端发生切换时，AI 面板必须立即清空旧终端的消息、命令建议和未发送草稿，并使旧目标的对话加载、消息发送与命令自动执行请求全部失效；旧上下文生成的命令不得显示或执行到新终端。 | done |
| QA-FE-307 | AI 面板必须覆盖已完成命令建议在终端切换后清理，以及未完成 Chat 在切换后不得展示响应或触发只读命令自动执行；同时必须通过源码限制、TypeScript、全量前端测试和完整 CI 对齐门禁。 | done |

本波次将 AI 面板异步代际从仅绑定 `sessionID` 收紧为绑定 `sessionID + terminalID`，并在目标切换时清理对话、命令建议和草稿。修复前两条回归分别复现旧命令建议继续显示、旧 Chat 返回后继续自动执行；修复后 `AITerminalPanel` 定向 **12** 个用例通过。`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（隧道半关闭数据完整性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TUNNEL-NET-308 | 当本地、远程或动态端口转发的一侧结束写入但仍等待反向数据时，隧道必须仅半关闭目标写方向并继续转发反向响应；不得因单侧 EOF 全关闭连接而截断协议响应。真实复制错误仍必须关闭双方连接并回收复制协程。 | done |
| QA-BE-309 | 隧道复制必须使用真实 TCP 连接覆盖“客户端半关闭请求写入后服务端继续返回响应”的场景，并通过 `internal/ssh` race 回归、Go 源码限制和完整 CI 对齐门禁。 | done |

本波次将双向复制从单侧 EOF 后直接 `Close` 改为正常 EOF 时调用 `CloseWrite`，等待反向复制结束后再统一关闭；任一方向发生真实复制或半关闭错误时立即关闭双方以解除另一协程。修复前真实 TCP 回归收到的响应为空字符串，修复后请求与响应均完整传输，`internal/ssh` 全量 race 测试通过。`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（AI 会话目标隔离与历史原子落库）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-SEC-310 | 当 AI 对话或命令执行携带既有对话 ID 与终端 ID 时，对话和终端必须同时属于请求中的会话；跨会话、已失效或非 SSH 目标必须在调用 AI 提供商或写入终端前拒绝，不得产生网络费用、命令副作用或历史污染。 | done |
| AI-DATA-311 | 当 AI 回答写入历史时，对话创建、用户消息、助手消息、更新时间与保留策略清理必须处于同一数据库事务；任一步失败必须完整回滚，不得遗留单边消息、空对话或已提交但前端收到失败的中间状态。 | done |
| QA-BE-312 | AI 目标隔离必须覆盖跨会话对话、跨会话终端、失效终端和数据库校验失败；历史事务必须覆盖新建、追加、用户/助手写入、更新时间、按日期/数量清理、目标不存在、提交失败与关闭数据库，并通过 race、覆盖率和完整 CI 对齐门禁。 | done |

本波次新增服务层会话/终端双重归属校验，并将 AI 问答历史改为单事务提交；修复前跨会话请求会继续调用提供商并污染其他会话历史，助手消息写入失败时会遗留已提交的用户消息，修复后两类场景均在副作用前拒绝或完整回滚。目标隔离和事务错误阶段定向 race 回归通过，新增目标校验函数与终端归属解析覆盖率均为 **100%**，Go coverpkg total **90.1%**，`golangci-lint v2.12.2` 为 0 issues。

## 2026-07-26 商用硬化波次（SFTP 元数据请求 deadline）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SFTP-NET-313 | 当 SFTP 子系统握手或目录列表、删除、建目录、重命名请求无响应时，系统必须在固定 deadline 内终止底层 SSH 传输、返回明确超时并释放临时连接；不得让文件面板或操作弹框永久等待。 | done |
| QA-BE-314 | SFTP deadline 必须使用真实 SSH/SFTP 服务覆盖已完成握手但服务端处理器永久阻塞的列表与三类变更请求，同时覆盖正常集成流程、底层 deadline 超时类型、无传输错误和连接回收。 | done |

本波次在 SSH 包装器中保留底层 TCP 传输并提供 deadline，将 **15 秒** 总时限应用于四类同步 SFTP 元数据操作；由于 `x/crypto/ssh` 会把传输 deadline 折叠为 EOF，服务层会根据真实截止时间还原为可识别的超时错误。真实阻塞处理器下四类请求均在测试时限内返回，连接计数恢复为零，正常 SFTP 集成回归与 race 测试通过。

## 2026-07-26 商用硬化波次（AI 只读自动执行防绕过）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-SEC-315 | 当 AI 命令包含换行、管道/控制符、重定向、反引号、命令替换，或使用 `find` / `journalctl` 的变更选项时，系统不得将其作为内置只读命令自动执行；命令仍可在用户明确确认后按变更命令执行。 | done |
| AI-SEC-316 | 自定义允许规则必须覆盖完整命令后才能授予只读自动执行资格；仅匹配前缀或子串的规则不得允许攻击者在后方拼接额外 shell 命令。 | done |
| QA-BE-317 | AI 命令策略必须覆盖多行、输出重定向、反引号、`$()`、`find -delete/-exec`、`journalctl --vacuum-*`、自定义允许规则前缀拼接与完整管道匹配，并验证服务层不会向终端写入误判命令。 | done |

本波次修复前可稳定复现 `ls` 后拼接换行命令、重定向或命令替换仍被标记为 `read_only` 并自动写入终端，自定义 `kubectl get` 规则也会接受后缀命令；修复后内置只读判定先排除 shell 副作用语法与变更型参数，自定义允许规则改为完整匹配。策略与命令执行定向 race 回归通过，`golangci-lint v2.12.2` 为 0 issues。

## 2026-07-26 商用硬化波次（AI/宏命令写入超时终止语义）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-REL-318 | 当 AI 或宏向终端写入命令超过配置的写入时限时，系统必须关闭并摘除目标终端，并在写入协程退出后才向调用方返回；不得让已报告超时的命令在后台迟到写入仍可用终端。 | done |
| UX-AI-319 | 当用户配置 AI 安全参数时，界面必须明确该时限仅约束“命令写入”，并告知写入超时会关闭目标终端且命令结果需要人工确认，不得误导为远端命令执行时限。 | done |
| QA-BE-320 | 命令写入超时必须覆盖 AI 与宏服务、关闭后写入失败、关闭失败错误组合、关闭竞态下迟到成功的结果未知语义、失败审计，以及接口 typed-nil 不得绕过空终端判断；相关 Go race、前端文案与 i18n 回归必须通过。 | done |

本波次将 AI/宏共享的终端写入依赖收窄为最小接口；超时路径先二次确认写入状态，再关闭目标终端并等待写入退出。新增回归覆盖关闭失败、迟到成功、AI/宏失败审计及 typed-nil 构造器边界。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（终端关闭错误可观测性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TERM-REL-321 | 当终端关闭过程中 PTY、本地 Shell 或串口句柄关闭失败，系统仍必须先从终端池摘除目标、释放关联状态并发出关闭事件，同时向调用方返回带根因的错误；不得静默报告关闭成功。 | done |
| SSH-REL-322 | 当单个 SSH 连接断开时，系统必须在移除连接并按需发出 disconnected 事件后返回底层 client close 错误；其行为必须与批量连接关闭的错误传播保持一致。 | done |
| QA-BE-323 | 关闭错误回归必须覆盖 PTY close 与 SSH disconnect 同时失败后的组合错误、终端状态已摘除、SSH client close 错误、断开事件仍发出，以及真实 SSH 正常关闭不得误报失败。 | done |

本波次修复前 `TerminalService.Close` 与 `SessionService.disconnect` 会分别吞掉终端 I/O 和 SSH client 的关闭错误，使超时保护与用户关闭操作误判成功；修复后所有清理步骤继续执行并聚合返回错误。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（Gist raw URL 凭据隔离与更新响应上限）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-SEC-324 | 当 GitHub Gist API 返回截断文件的 `raw_url` 时，系统必须仅允许与配置 API 同源的地址，或官方 `api.github.com` 对应的精确 `gist.githubusercontent.com` HTTPS 主机；任意其他主机、伪造后缀、凭据 URL 或受限网络目标必须在发起请求前拒绝。 | done |
| SYNC-SEC-325 | 当下载 Gist raw 文件时，系统仅可向自定义 API 的精确同源地址发送 GitHub token；官方 raw 主机不得携带 token，且每次 HTTP 重定向必须重新执行同一可信源校验，跨源跳转不得到达目标服务器。 | done |
| UPD-NET-326 | 当检查 GitHub Release 更新时，响应正文必须受 **1 MiB** 上限约束并在完整读取后解析 JSON；超限响应必须返回明确错误，不得因未知大字段造成无界内存增长。 | done |
| QA-BE-327 | 网络信任边界回归必须覆盖恶意 raw URL 零请求、同源 token、官方 raw 不带 token、伪造官方后缀、跨源重定向零请求、正常/错误 raw 下载和超大更新响应拒绝。 | done |

本波次修复前，受控 Gist API 响应可把 `raw_url` 指向任意 HTTPS 主机或本机端点，客户端会主动携带 GitHub token 请求该地址；更新检查也会接受超过 1 MiB 的未知 JSON 字段。修复后 raw 下载按精确源信任模型发送凭据并逐跳校验重定向，更新响应改为有界完整读取。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（首次 Gist 创建配置合并）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-DATA-328 | 当首次推送自动创建 Gist 且用户在网络请求期间保存了新的同步策略、保留期、启用状态或凭据状态时，系统必须以当前持久化配置为基准仅合并新 Gist ID；不得用同步开始时的旧配置覆盖用户的新设置。 | done |
| SYNC-CON-329 | 当自动创建 Gist 返回时，Gist ID 回写必须与配置保存使用同一互斥锁，并确认当前 provider 及原 Gist ID 与操作起点一致；用户已切换 provider 或手工指定其他 Gist ID 时必须拒绝陈旧回写。 | done |
| QA-BE-330 | Gist ID 回写回归必须覆盖并发策略/保留期变更仍被保留、手工 Gist ID 不被覆盖、配置身份变化返回明确错误，以及既有正常 Gist ID 更新流程。 | done |

本波次修复前，`saveGistID` 会把同步开始时读取的整份旧配置直接写回数据库，稳定覆盖同步期间新保存的策略和保留期，也会替换用户手工填写的 Gist ID；修复后回写在配置锁内读取最新状态、校验 provider 身份并仅合并服务器创建的 ID。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁、前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（云端下载原子提交与保留清理语义）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-DATA-331 | 当采用云端版本时，系统必须把业务数据恢复、同步基线更新及新旧版本保护状态切换放在同一个数据库事务中；任一步失败时必须保留下载前的本地业务数据与原基线。 | done |
| SYNC-REL-332 | 当云端上传、下载或无变化同步已经完成核心状态提交，但本地历史版本保留清理失败时，系统必须保留成功结果并记录可观测警告；不得向用户误报整个同步失败或留下错误运行状态。 | done |
| QA-BE-333 | 下载提交回归必须通过数据库触发器覆盖基线更新失败后的业务数据回滚和基线不变；保留清理回归必须覆盖删除失败后同步仍成功、基线已更新、运行状态准确且待清理版本仍可重试。 | done |

本波次修复前，云端数据会先独立提交，随后基线写入失败时调用方虽然收到错误，本地会话却已经被不可见地替换；历史保留删除失败也会把已提交的同步误报为失败。修复后远端版本先安全落盘，业务恢复与同步状态在单一事务中原子提交，保留清理降级为记录警告的成功后维护任务。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（同步快照跨表一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-DATA-334 | 当同步、导出、恢复点或版本历史读取多张业务表时，系统必须在单个数据库快照中读取全部表；并发创建、更新或删除资产时不得生成悬空外键、缺失父记录或混合两个时间点的数据。 | done |
| SYNC-PERF-335 | 当 SQLite 使用 WAL 且生成同步快照时，系统必须使用只读事务保持一致性，并允许其他数据库连接继续提交写入；不得为了快照一致性升级为阻塞写入的 immediate 事务。 | done |
| QA-BE-336 | 快照一致性回归必须在读取 `sessions` 期间并发提交新会话、标签和关联，验证产物中的所有关联均有父记录，同时验证读取任一备份表失败后事务释放且数据库连接可继续使用。 | done |

本波次修复前，每张表通过独立查询读取；稳定复现 `sessions` 仍是旧版本、`session_tags` 已包含并发新增关系的撕裂快照，该产物后续恢复会因外键约束失败。修复后全部备份表在 SQLite deferred read-only transaction 中共享同一 WAL 快照，并发写入仍可在读取暂停期间提交。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（同步历史文件删除一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-FS-337 | 当删除同步历史版本时，系统必须拒绝目录、符号链接及其他非普通文件路径；路径检查或暂存失败时不得删除数据库记录。 | done |
| SYNC-DATA-338 | 当历史版本文件已原子暂存但数据库记录删除失败时，系统必须把文件恢复到原路径并返回组合错误；数据库提交成功后才可清理暂存文件，清理失败必须记录维护告警而不得把逻辑删除误报为可重试失败。 | done |
| QA-BE-339 | 历史删除回归必须覆盖损坏为非普通文件的版本路径仍保留记录，以及数据库触发器拒绝删除时原文件内容、版本记录和暂存文件集合均恢复到操作前状态。 | done |

本波次修复前，版本记录先从数据库删除，随后磁盘路径删除失败会留下无记录可追踪的孤儿文件，用户收到失败却无法重试。修复后普通文件先在同目录原子重命名为唯一暂存名，数据库失败时原位回滚，路径类型异常则在任何持久化变更前拒绝。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（去重历史文件自愈）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-REL-340 | 当相同快照指纹的历史记录已存在但对应文件缺失时，系统必须使用当前已验证的加密内容以 0600 权限原子重建原文件，然后才可返回去重记录；不得留下可列出但无法恢复的历史版本。 | done |
| SYNC-FS-341 | 当去重历史记录指向目录、符号链接或其他非普通文件时，系统必须拒绝复用并返回明确错误；不得覆盖或跟随异常路径。 | done |
| QA-BE-342 | 去重自愈回归必须覆盖版本文件被删除后再次保存相同快照、记录 ID 保持稳定、文件恢复为普通文件，并验证该记录能够完成真实数据恢复。 | done |

本波次修复前，`saveVersion` 只依据数据库指纹去重，文件被外部清理后仍返回成功，直到用户恢复时才暴露永久缺失。修复后去重路径先验证磁盘对象，缺失时通过私有原子写重建，异常文件类型则失败关闭。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（密码导入跨存储补偿与配置串行化）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-REL-343 | 当密码导入或新设备加入在业务数据提交后无法提交 vault 时，系统必须自动恢复导入前的业务快照；加入流程还必须恢复全部 `sync` 命名空间设置。主失败、数据补偿失败与 vault 回滚失败必须同时返回，不得静默丢弃任一错误。 | done |
| SYNC-CON-344 | 当 `JoinWithPassword` 正在安装 vault、恢复数据和保存同步配置时，普通 `SaveConfig` 必须通过同一配置锁串行执行；后发用户保存不得被加入流程的旧状态覆盖。 | done |
| QA-BE-345 | 密码导入回归必须覆盖恢复失败、vault 提交失败、vault 回滚失败、补偿数据库不可用、同步设置恢复失败，以及加入期间并发保存配置被阻塞且最终以后发配置为准。 | done |

本波次修复前，导入和加入的 defer 会吞掉 vault 回滚错误；vault 提交失败时数据库已保留远端数据，加入流程还会遗留远端同步配置，并发 `SaveConfig` 也可在加入恢复期间被反向覆盖。修复后导入前快照同时服务恢复点和失败补偿，业务表与同步设置在单一补偿事务中恢复，所有错误通过 `errors.Join` 返回，加入配置变更与普通保存共用互斥锁。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（去重历史文件加密完整性自愈）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-REL-346 | 当去重历史文件存在但内容与当前候选不同、密文损坏、快照指纹不匹配或文件超过支持上限时，系统必须验证 AEAD 与快照指纹并用当前已验证内容原子重建；不得继续返回不可恢复版本。 | done |
| SYNC-FS-347 | 当历史文件被复用或重建时，系统必须强制 0600 权限并使数据库 `size_bytes` 与实际文件一致；目录、符号链接和其他非普通对象必须拒绝，超过 **32 MiB** 的候选版本不得写入历史。 | done |
| QA-BE-348 | 历史自愈必须覆盖同尺寸密文篡改、稀疏超大文件、缺失文件、非普通对象、权限漂移、大小回写失败、保护标记更新失败，并验证修复后的版本可完成真实数据恢复。 | done |

本波次修复前，只要历史路径存在就会直接复用；同尺寸密文损坏、错误权限和数据库大小漂移均会潜伏到用户点击恢复时才失败。修复后相同字节走快速路径，不同字节执行解密认证与指纹校验，损坏或超大文件以私有原子写重建，同时修复权限和大小元数据；异常对象和超限候选失败关闭。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（原子替换与 SFTP 传输耐久性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| FS-REL-349 | 当 Unix 平台原子替换文件成功时，系统必须在返回成功前同步目标父目录并检查目录关闭错误；macOS 必须使用普通 `fsync` 同步目录，不得因 `os.File.Sync` 的 `F_FULLFSYNC` 目录语义误报替换失败。 | done |
| SFTP-DATA-350 | 当 SFTP 上传完成复制时，系统必须检查远端写句柄关闭结果；当下载完成复制时，系统必须在返回成功前同步并关闭本地文件。复制、同步与关闭同时失败时必须保留全部错误根因，不得误报传输成功。 | done |
| QA-BE-351 | 文件耐久性回归必须覆盖替换失败不执行目录同步、目录同步失败、真实目录同步、缺失目录、下载同步与关闭组合错误，以及真实 SFTP 服务端在上传句柄关闭时拒绝提交；同时必须通过 Darwin 交叉编译、race 与完整 CI 对齐门禁。 | done |

本波次修复前，Unix 原子替换只执行 `rename`，掉电后可能丢失已成功返回的目录项；SFTP 上传会吞掉远端提交阶段的关闭错误，下载也会在本地数据同步前报告成功。修复后替换流程在目标父目录完成持久化后返回，Darwin 使用普通目录 `fsync`；上传和下载均把最终提交错误纳入返回链。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，Darwin arm64 交叉编译通过，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（vault 资源消耗与文件边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| VAULT-SEC-352 | 当应用读取本地主 vault 时，只允许读取不超过 **64 KiB** 的普通文件；目录、符号链接和其他非普通对象必须在 JSON 解析及 Argon2 运算前拒绝，超限文件不得被完整载入内存。 | done |
| VAULT-SEC-353 | 当 vault 声明 Argon2 参数时，格式版本 1 必须严格匹配应用支持的 time、memory 与 threads 参数；salt、nonce 和 wrapped DEK 长度必须在 Argon2 前校验。篡改文件不得诱发任意内存或 CPU 成本。 | done |
| QA-BE-354 | vault 回归必须覆盖正常保存读取、缺失文件、目录路径、稀疏超限文件、非法 JSON、不支持 KDF 参数和错误字段长度，并通过 crypto race、覆盖率与完整 CI 对齐门禁。 | done |

本波次修复前，`LoadVaultFile` 会无界读取磁盘对象，且只要求 Argon2 参数非零；本地文件损坏或篡改可在启动、自动解锁、手工解锁和密码轮转时制造高内存/CPU 消耗。修复后 vault 先执行普通文件与 **64 KiB** 上限检查，格式版本 1 的 KDF 参数固定校验，密文字段长度在 Argon2 前失败。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（主题导入与同步历史读取边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| THEME-SEC-355 | 当用户导入终端主题时，系统必须只接受不超过 **2 MiB** 的普通文件；目录、符号链接及其他非普通对象必须在格式识别和 XML 解析前拒绝，超限文件不得被完整载入内存。 | done |
| SYNC-SEC-356 | 当用户恢复同步历史版本时，系统必须只读取不超过 **32 MiB** 的普通版本文件；目录、符号链接、外部替换对象及超限文件必须在密文解析、快照校验和破坏性恢复准备前拒绝。 | done |
| QA-BE-357 | 文件读取边界回归必须覆盖正常主题导入、稀疏超限主题、主题目录与符号链接、稀疏超限历史文件、历史目录与符号链接，并验证拒绝路径不会调用同步生命周期准备。 | done |

本波次修复前，主题导入先 `os.ReadFile` 再检查大小，符号链接可被透明跟随；历史恢复则完全绕过已有的 **32 MiB** 云备份上限，超限文件会被完整读入后才在 JSON 解码阶段失败，符号链接还能进入破坏性恢复流程。修复后两条路径共用普通文件和有界读取策略，在解析前执行路径类型、静态大小与读取期上限校验，并检查关闭错误。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（主机指纹与字体扫描资源边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| HOSTKEY-SEC-358 | 当应用创建、读取、解析、追加或删除 `known_hosts` 时，系统必须只接受不超过 **8 MiB** 的普通文件，并强制现有文件权限为 0600；目录、符号链接、打开期间被替换的对象及追加后将越界的文件必须在解析或写入前拒绝。 | done |
| FONT-PERF-359 | 当应用扫描系统或用户字体目录时，系统必须跳过非普通对象及超过 **64 MiB** 的字体文件，并通过 `io.ReaderAt` 解析 TTF、OTF 与 TTC；不得为每个候选字体复制完整文件内容到内存。 | done |
| QA-BE-360 | 主机指纹回归必须覆盖超限文件的列表与删除、符号链接列表与删除、目录路径、现有权限漂移、SSH 回调解析超限及追加越界；字体回归必须覆盖有效字体、损坏字体、缓存、无字体回退和超限字体旁路。 | done |

本波次修复前，设置页删除指纹会用 `os.ReadFile` 和 `strings.Split` 无界载入整个文件，8 MiB 以上的损坏文件甚至可被一次删除操作直接清空；列表、SSH 校验与 TOFU 追加均接受符号链接，现有文件权限也不会收紧。字体扫描则对每个字体执行整文件读取。修复后 `known_hosts` 的服务管理和 SSH 连接路径共享同一普通文件与总量策略，追加前按实际打开句柄二次校验容量，权限通过已验证句柄修复；字体改用 `sfnt.ParseCollectionReaderAt` 并在打开前后校验 **64 MiB** 上限。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（网络 JSON 响应严格有界解析）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| NET-SEC-361 | 当 AI 提供商或联网搜索返回 JSON 时，系统必须分别在 **4 MiB** 与 **2 MiB** 上限内读取完整响应，并且只接受恰好一个合法 JSON 值；合法 JSON 前缀后的超限尾部、第二个 JSON 值或非法字节必须拒绝。 | done |
| SYNC-SEC-362 | 当读取或更新 GitHub Gist 时，系统必须分别在 **32 MiB** 与 **1 MiB** 上限内读取完整 JSON 响应；不得因解码器在首个合法值后停止而接受超限尾部或隐藏的附加内容。 | done |
| QA-BE-363 | 严格有界 JSON 回归必须覆盖精确命中上限、非法 JSON、多个顶层值、底层读取错误，以及 AI、搜索、Gist 读取和 Gist 更新四个真实 HTTP 调用入口的超限尾部。 | done |

本波次修复前，上述入口对 `io.LimitReader` 直接使用流式 `json.Decoder`；解码器读取到首个合法 JSON 值后即可成功返回，因此“合法前缀 + 超限尾部”不会触发容量限制。修复后入口共用 `decodeBoundedJSON`，先按 `max+1` 完整有界读取并拒绝超限，再通过 `json.Unmarshal` 校验整个响应仅包含一个合法 JSON 值。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（系统探针输出流式限额）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TERM-PERF-364 | 当系统信息或进程探针执行远端命令时，stdout 与 stderr 必须共享 **4 MiB** 总配额并在写入内存时执行限制；不得先通过 `CombinedOutput` 无界收集全部内容后再检查长度。 | done |
| TERM-REL-365 | 当系统探针输出超过配额时，系统必须立即关闭对应 SSH session、停止继续接收远端输出并返回明确超限错误；关闭失败必须保留在错误链中，精确命中上限仍必须成功。 | done |
| QA-BE-366 | 系统探针回归必须覆盖精确命中上限、单次超大写入、stdout/stderr 并发写入共享配额、命令错误、关闭错误、非法上限和真实 SSH 服务端持续输出；真实服务端必须在发送完整载荷前观察到客户端关闭。 | done |

本波次修复前，`maxSystemProbeOutput` 仅在 `ssh.Session.CombinedOutput` 返回后检查，恶意或异常远端可以先迫使客户端分配任意大小的缓冲区，4 MiB 限制无法防止内存耗尽。修复后 SSH session 的 stdout/stderr 指向线程安全的共享有界收集器，超限写入只保留剩余配额并立即关闭通道；真实 SSH 回归验证服务端在 **16 MiB** 测试载荷发送完成前即被终止。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（会话录像删除一致性与崩溃恢复）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| LOG-DATA-367 | 当删除带录像文件的会话日志时，系统必须先在同目录耐久原子暂存文件，再删除数据库记录；数据库删除失败时必须恢复原文件并保留记录。数据库提交后的暂存清理失败不得把已完成的逻辑删除误报为可重试失败。 | done |
| LOG-REL-368 | 当应用在录像文件暂存后异常退出时，下次启动必须按数据库状态对账：记录仍引用原路径时恢复暂存文件，记录已删除时清理残留文件；不得盲目删除仍有数据库索引的录像。 | done |
| LOG-SEC-369 | 录像删除必须只允许真实数据目录下的普通 `recordings` 目录和普通录像文件；文件符号链接、目录符号链接、目录逃逸及打开期间对象替换必须在数据库变更前拒绝。 | done |
| QA-BE-370 | 录像删除回归必须覆盖磁盘清理失败、数据库触发器拒绝删除、启动时提交后残留清理、启动时提交前文件恢复、内部文件符号链接、外部文件符号链接及整个录像目录指向外部路径。 | done |

本波次修复前，`LogService.Delete` 先提交数据库删除再调用 `os.Remove`；移除失败时用户收到错误，但日志记录已经消失，孤儿录像无法再次通过界面清理。`recordings` 根目录被替换为外部符号链接时，旧校验还会把外部目标当成可信目录并真实删除文件。修复后录像先通过带目录同步的原子替换进入唯一暂存态，数据库失败时恢复原文件，提交后清理降级为维护告警；启动时依据 `session_logs.data_path` 对账恢复或清理崩溃残留，并拒绝所有非普通目录与非普通录像对象。录像删除事务、安全与恢复定向 race 测试及 `internal/service` 全量 race 测试通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（会话批量删除录像一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SESSION-DATA-371 | 当单个或批量删除带录像的会话时，系统必须先将全部现存录像耐久原子暂存，再在单一事务中删除会话及依赖记录；任一数据库删除失败时必须回滚事务并按逆序恢复全部已暂存录像。 | done |
| SESSION-REL-372 | 当数据库删除已提交时，系统必须按剩余 `session_logs.data_path` 引用决定恢复或清理暂存录像；被其他日志共享的录像必须恢复，清理失败必须保留可由启动对账处理的暂存文件。 | done |
| SESSION-UX-373 | 当会话数据库删除已经提交但录像清理需要延迟维护时，服务层必须记录告警并向用户报告删除成功；不得返回可重试失败导致用户重复执行已经完成的会话删除。 | done |
| SESSION-SEC-374 | 会话删除不得暂存或删除符号链接、目录及其他非普通录像对象；当后续录像暂存失败时，之前已暂存的普通录像必须完整恢复。 | done |
| QA-BE-375 | 会话删除回归必须覆盖提交后清理失败、数据库触发器拒绝删除、默认清理器、多录像阶段失败、内部符号链接、共享录像引用、关闭数据库查询、幂等清理及已完成事务回滚。 | done |

本波次修复前，`DeleteSessionsWithRecordingDirectory` 在数据库提交后直接删除原录像路径；磁盘清理失败会把已经完成的会话删除返回为失败，并留下无法从数据库追踪的孤儿录像。修复后批量录像先进入同目录唯一暂存态，事务失败时逆序补偿，提交后按数据库剩余引用恢复共享文件或清理无引用文件；维护性清理错误由服务层降级为成功告警，暂存残留继续复用日志服务的启动对账机制。相关 store/service 定向与全量 race 回归通过；`wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.1%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（隧道生命周期与会话删除并发一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TUNNEL-REL-376 | 当停止或删除运行中隧道时，系统必须检查监听器关闭与 SSH 连接断开错误；清理失败时必须保留可重试运行态及隧道配置，且仅在全部清理成功后发出 stopped 事件。正在启动的 reservation 必须等待启动清理完成或在 10 秒后明确超时。 | done |
| TUNNEL-DATA-377 | 当单个或批量删除会话时，系统必须按内存中的 `sessionID` 归属停止全部活动隧道，不得依赖可能失败或已漂移的数据库查询；任一隧道清理失败时必须保留会话数据库记录。 | done |
| TUNNEL-CONC-378 | 当会话删除正在清理运行态并提交数据库删除时，系统必须使用引用计数闸门阻止该会话创建新的隧道 reservation；删除成功或失败返回后才可释放对应闸门，不得让并发启动绕过清理并遗留已删除会话的后台隧道。 | done |
| QA-BE-379 | 隧道可靠性回归必须覆盖数据库不可用时的内存归属清理、关闭失败后的重试、启动中停止等待与失败保留、重复清理、无效运行态、启动取消辅助路径、关闭连接错误、会话删除闸门及引用计数，并通过 service 全量 race、lint、覆盖率和完整 CI 对齐门禁。 | done |

本波次修复前，会话删除通过重新查询数据库寻找运行隧道，查询失败、配置漂移或并发启动都可能让后台转发跨越会话删除继续存活；监听器与 SSH 连接关闭错误也会被吞掉并提前移除运行态。修复后运行态记录所属 `sessionID`，停止流程等待启动 reservation 收口、聚合资源关闭错误并仅在成功后发出 stopped；会话删除期间使用引用计数闸门阻止新的 reservation，失败时保留会话记录并允许重试。`internal/service` 全量 race 与 `golangci-lint v2.12.2` 通过；`wails3 task ci` EXIT 0，Go race coverpkg total **90.2%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（系统探针跨平台降级）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYS-COMPAT-380 | 当远端系统为 Linux、macOS 或其他 POSIX 系统时，系统信息探针必须在单次受限 SSH exec 中选择平台分支并输出统一字段；Linux 必须兼容无 `nproc`、无 GNU `df -B1` 和缺少 `MemAvailable` 的环境，macOS 必须使用 `sysctl`、`vm_stat`、`netstat`、`df -Pk` 与 `sw_vers` 采集。 | done |
| PROC-COMPAT-381 | 当远端 `ps` 不支持 GNU `--sort` 或 `%cpu` 字段时，进程探针必须依次降级到 BSD、BusyBox RSS、BusyBox VSZ 和 POSIX `ps -ef` 格式；降级行必须保持统一解析结构，缺失指标以 0 表示而不是让整个面板失败。 | done |
| SYS-DATA-382 | 当平台只能提供瞬时 CPU 百分比而不能提供累计 CPU tick 时，解析器必须接受 0 到 100 的有限 `CPUPERCENT` 并保留该值；负数、超范围、NaN 和 Inf 必须拒绝，不得覆盖为无意义的 0。 | done |
| QA-BE-383 | 跨平台探针回归必须覆盖本机 Linux 命令、模拟 Darwin 命令集、BusyBox `ps -o`、POSIX `ps -ef`、shell 语法、直接 CPU 百分比和非法浮点边界，并通过探针 race、lint、覆盖率与完整 CI 对齐门禁。 | done |

本波次修复前，系统概览硬编码 Linux `/proc`、GNU `df -B1` 和 `nproc`，进程列表依赖 GNU `ps --sort`；macOS 会直接采集失败，BusyBox 也可能无法展示进程。修复后单次远端命令按 `uname` 选择 Linux、Darwin 或通用 POSIX 分支，磁盘统一使用 `df -Pk`，CPU 核数与内存可用量提供降级计算；进程列表逐级降低字段要求，解析器同时拒绝非有限浮点。探针定向与 `internal/service` 全量 race、`golangci-lint v2.12.2` 均通过；`wails3 task ci` EXIT 0，Go race coverpkg total **90.2%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、官方 npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-26 商用硬化波次（WebDAV 与 S3 重定向边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-SEC-384 | 当 WebDAV 的连接测试、下载或上传收到 HTTP 重定向时，客户端必须逐跳执行共享 URL 安全策略，并且只允许与用户配置端点同源且保持原方法的 `307/308`；跨源目标不得接收 Basic Auth 或加密备份请求体，`301/302/303` 不得把 PUT 改写为 GET 后误报成功。 | done |
| SYNC-COMPAT-385 | 当 AWS SDK 使用应用自定义 HTTP 客户端时，客户端不得跟随 `301/302/303`，必须把原始响应交还 SDK 处理；不得把 S3 PUT 改写为跨源 GET 并将错误响应误判为上传成功。 | done |
| SYNC-SEC-386 | 当自定义 S3 兼容端点返回 `307/308` 时，只允许同源跳转；使用 AWS 默认端点进行合法跨区域临时跳转时，必须剥离跨源 `X-Amz-Security-Token` 并继续执行共享 URL、凭据与跳数策略。 | done |
| QA-BE-387 | 重定向回归必须覆盖 WebDAV 跨源上传零请求、同源 `307` 保留认证与正文、同源 `301` 零跟随且返回失败、S3 `301` 零跟随且返回失败、自定义端点跨源 `307` 零请求、同源 `307` 成功、默认 AWS 跨源 token 剥离、非法端点及缺失响应边界。 | done |

本波次修复前，WebDAV `307/308` 会在剥离认证头后继续把加密备份正文发送到跨源目标，同源 `301` 还会把 PUT 改写为 GET 并把目标 200 响应误判为上传成功；S3 因注入普通 `http.Client` 绕过 AWS 默认有限重定向策略，也存在相同的 `301` 假成功。修复后 WebDAV 使用不修改共享实例的同源客户端副本并仅跟随 `307/308`，S3 客户端对齐 AWS SDK 重定向契约并对自定义端点执行精确同源限制。WebDAV/S3 定向 race 回归通过；完整 CI 证据见本轮最终门禁记录。

## 2026-07-27 商用硬化波次（遗留云 API 重定向与提交语义）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-SEC-388 | 当 Wails 绑定仍可调用 `TestCloudConnection`、`SyncToCloud` 或 `SyncFromCloud` 时，遗留接口必须与新 provider 使用相同的逐跳 URL 安全、精确同源和仅 `307/308` 策略；不得形成可跨源发送 Basic Auth、加密备份正文或访问第二个服务的旁路。 | done |
| SYNC-REL-389 | 当 WebDAV provider 或遗留云 PUT 返回响应时，只有 `200 OK`、`201 Created` 和 `204 No Content` 可视为远端写入已完成；`202 Accepted`、`207 Multi-Status` 及其他 2xx 不得提前提交本地 ETag、基线或成功审计。 | done |
| QA-BE-390 | 遗留云回归必须覆盖跨源 `307` 上传正文零请求、同源 `301` 零跟随且返回失败、连接测试跨源零请求、同源 `307` 上传成功，以及 WebDAV/遗留云 `202` 拒绝和完成状态白名单。 | done |

本波次修复前，旧版 Wails 云同步方法仍直接使用共享客户端，可绕过新 WebDAV provider 的同源限制：跨源 `307` 能收到加密快照，同源 `301` 会把 PUT 改写为 GET 并误报成功，连接测试也可访问跳转后的第二个服务；两条上传路径还会把仅表示“已受理”的 `202` 当成完成。修复后遗留方法通过端点绑定的客户端副本执行，所有上传共享严格完成状态白名单。定向 race 回归通过；完整 CI 证据见本轮最终门禁记录。

## 2026-07-27 商用硬化波次（AI、联网搜索与更新元数据重定向边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-SEC-391 | 当 AI 提供商请求收到 HTTP 重定向时，客户端必须逐跳执行共享 URL 安全策略，并且只允许与原始端点同源且保持 POST 方法的 `307/308`；跨源目标不得接收 API Key、提示词或终端上下文，`301/302/303` 不得改写方法后误报成功。 | done |
| SEARCH-SEC-392 | 当 Tavily、Serper 或 Brave 搜索请求收到重定向时，只允许精确同源的 `307/308`；Tavily 正文中的 API Key、Serper 的查询正文与 Header Key、Brave 的查询参数与订阅 Token 均不得发送到第二个源。 | done |
| UPDATE-SEC-393 | 当检查 GitHub Release 更新时，更新元数据只能从初始 API 端点的同源 `307/308` 跳转结果读取；跨源或会改变请求语义的跳转必须失败关闭，不得由第二个服务伪造可用版本。 | done |
| SYNC-SEC-394 | 当 GitHub Gist API 的连接测试、读取或写入请求收到重定向时，只允许与配置 API 端点精确同源的 `307/308`；跨源目标不得接收 Token 或加密备份正文，`301/302/303` 不得把 POST/PATCH 改写为 GET 后误报写入成功。 | done |
| QA-BE-395 | 重定向回归必须覆盖 AI POST 跨源 `307` 零请求、同源 `301` 零跟随、同源 `307` 保留正文与 API Key，三种搜索提供商跨源零请求，更新检查跨源与 `301` 拒绝、同源 `307` 成功，以及 Gist 上传跨源零请求、`301` 拒绝和同源 `307` 保留认证与正文。 | done |

本波次修复前，共享 HTTP 客户端只会在跨主机跳转时剥离认证 Header；AI 提示词、终端上下文、Tavily 正文 API Key 和 Gist 加密备份仍会随 `307/308` 发送到跨源目标，`301/302/303` 还可能把 POST 改写为 GET 并接受目标端的成功响应。更新检查虽然最终校验 Release URL，但仍允许第二个服务提供版本元数据。修复后这些请求均通过不修改共享实例的端点绑定客户端执行，逐跳校验精确 scheme、hostname 与有效端口，并仅跟随保持方法的同源 `307/308`。定向 race 回归通过；完整 CI 证据见本轮最终门禁记录。

## 2026-07-27 商用硬化波次（隧道建连资源边界与 SOCKS5 协议合规）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TUNNEL-REL-396 | 当 Local、Remote 或 Dynamic 隧道为已接受连接拨号目标时，SSH `direct-tcpip` 与本地 TCP 拨号都必须在 **10 秒**内成功或失败；不可达目标不得长期占用每监听器 **256** 个并发槽位。拨号完成后的双向长连接不得继承建连 deadline。 | done |
| TUNNEL-SEC-397 | 当 Dynamic 隧道接收 SOCKS5 客户端时，认证与请求握手必须在 **10 秒**内完成，并且仅在客户端明确提供 no-auth 方法时选择该方式；零方法、仅密码认证、非 CONNECT 命令、非法 reserved byte、非法地址类型、空域名和零端口必须按协议失败关闭，不得被慢连接或认证降级耗尽转发槽位。 | done |
| QA-BE-398 | 隧道回归必须覆盖 context 拨号超时及非法参数、SOCKS5 零方法与仅密码方法拒绝、命令不支持和非法 reserved 的标准回复、握手 deadline 设置与建连前清除，并通过 Local、Remote、Dynamic、IPv4、IPv6、域名、半关闭和 `internal/ssh` 全量 race 测试。 | done |

本波次修复前，Remote 隧道使用无 timeout 的 `net.Dial`，Local/Dynamic 隧道使用无 context 的 SSH `Dial`；不可达目标可长期占住并发 gate。SOCKS5 连接也没有握手 deadline，且服务端无条件选择 no-auth，即使客户端只声明用户名密码认证或方法数为零。修复后所有目标拨号统一通过 context deadline，握手阶段设置独立 deadline 并在进入长期转发前清除；协议协商验证客户端方法、命令、reserved 与目标地址并返回标准失败码。`internal/ssh` 全量 race 回归通过；完整 CI 证据见本轮最终门禁记录。

## 2026-07-27 商用硬化波次（本地 Shell 进程树退出收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SHELL-REL-399 | 当本地 Shell 主进程自然退出或 PTY 读取异常结束时，系统必须幂等关闭 PTY/ConPTY 并清理其会话进程树；Unix 子进程即使忽略 `SIGHUP`、`SIGTERM` 等常规信号，也必须在 **400 毫秒**宽限期后由整个 process group 的 `SIGKILL` 收口，不得成为后台孤儿进程。 | done |
| SHELL-CONC-400 | 当 read loop、process wait loop 与用户主动关闭并发发生时，资源清理必须共用单一 `closeOnce`，进程等待仍只能由 wait loop 执行；自然退出事件必须在清理完成后发布，主动关闭仍保持幂等且不得 double wait、double close 或泄漏 Windows ConPTY 句柄。 | done |
| QA-BE-401 | 本地 Shell 回归必须覆盖主 shell 退出后仍有已完成 signal trap 握手、忽略终止信号并持续持有 PTY 的后台进程，按 `/proc` process group 验证整组消失；同时覆盖离线 Session 在退出回调前已关闭资源、Linux race，以及 Windows amd64 与 Darwin arm64 交叉编译。 | done |

本波次修复前，`waitLoop` 在主 shell 退出后只调用退出回调，不会关闭 PTY 或清理同会话后台进程；`signalLocalProcessGroup` 也只探测已经退出的 shell PID，一旦 shell 被 `Wait` 回收就提前返回，忽略 `SIGHUP` 的子进程可持续运行并持有终端资源。修复后 read/wait/Close 共用幂等资源收口，Unix 存活探测绑定整个 process group，宽限期后强制终止仍存活成员；自然退出在清理完成后再通知上层。Linux 集成与全量 localshell race、Windows 交叉编译通过；完整 CI 证据见本轮最终门禁记录。

## 2026-07-27 商用硬化波次（串口异常退出资源收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SERIAL-REL-402 | 当串口设备返回 EOF 或读取错误时，系统必须在发布终端退出事件前幂等关闭底层串口句柄并清空会话持有的端口引用；设备断开不得仅释放界面占用而遗留无法再次打开的系统句柄。 | done |
| SERIAL-ERR-403 | 当串口读取失败且底层句柄关闭也失败时，退出错误必须同时保留读取与关闭根因；EOF 路径在关闭成功时仍保持正常退出语义，不得因资源收口制造伪错误。 | done |
| QA-BE-404 | 串口回归必须覆盖 EOF 与非 EOF 读取退出、退出回调前句柄已关闭、读取和关闭组合错误、主动关闭幂等、空端口启动及晚注册退出回调，并通过 `internal/serial` 与终端串口服务 race 测试。 | done |

本波次修复前，串口 `readLoop` 在设备拔出或驱动返回读取错误时只触发退出回调，终端服务随后删除内存映射并释放设备 reservation，但底层 `goserial.Port` 永远不会关闭，用户重连可能持续遇到设备占用且只能重启应用恢复。修复后读取退出与主动关闭共用 `closeOnce` 资源收口，先清空端口引用并关闭句柄，再发布退出事件；读取和关闭同时失败时通过错误链保留两者。`internal/serial` 全量 race 与终端串口服务定向 race 回归通过；完整 CI 证据见本轮最终门禁记录。

## 2026-07-27 商用硬化波次（录像回放资源与格式边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| RECORD-SEC-405 | 当打开终端录像时，系统必须只接受真实 `recordings` 数据目录下不超过 **32 MiB** 的普通文件；录像目录或文件符号链接、目录对象、打开期间身份替换及权限漂移必须在解析前拒绝或修复，文件权限必须收紧为 0600。 | done |
| RECORD-PERF-406 | 当解析录像时，系统必须通过受限 reader 在读取期维持 **32 MiB** 总边界，并限制最多 **100,000** 条记录；稀疏超限文件、文件增长和大量零长度条目不得迫使后端或 Wails IPC 无界分配内存。 | done |
| RECORD-DATA-407 | 当录像记录包含未知类型、逆序时间戳或超过 JavaScript 安全整数范围的时间戳时，系统必须失败关闭；精确命中条目上限与最大安全时间戳仍必须可回放。解析完成后必须在返回 Wails 前关闭文件句柄，重复关闭保持幂等。 | done |
| RECORD-UX-408 | 当回放因容量、路径或格式边界失败时，回放终端必须显示后端返回的具体失败原因，同时保留结构化错误日志；不得只显示无法行动的通用“加载失败”。 | done |
| QA-FULL-409 | 录像回归必须覆盖超限稀疏文件、目录、文件与录像根目录符号链接、权限修复、自动关闭、最大与超量条目、最大与超量 JS 安全时间戳、逆序时间戳、未知记录类型及前端错误展示，并通过 SSH、日志服务和回放组件定向测试及完整 CI。 | done |

本波次修复前，`NewPlayer` 会跟随符号链接并把整个录像解析为内存对象，文件总大小和记录数量均无上限；返回给 Wails 后底层文件句柄仍保持打开，前端失败时只显示通用文案。长时间高输出录像或本地损坏文件可造成内存峰值、IPC 卡顿和文件描述符累积。修复后回放入口统一验证普通文件身份、容量、权限和录像根目录，解析阶段限制总字节与条目数并校验记录类型、顺序及 JSON 数值范围，成功或失败均在返回前幂等关闭文件；前端同步展示具体原因。SSH、日志服务与回放组件定向 race/单测通过；完整 CI 证据见本轮最终门禁记录。

## 2026-07-27 商用硬化波次（同步配置与凭据并发一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-SEC-410 | 当云同步正在使用 Provider 配置和加密凭据时，配置自动保存必须等待该同步操作完成后再提交；远端端点、用户名、Access Key 与对应秘密必须来自同一份已提交配置，不得把新凭据发送到旧端点。 | done |
| SYNC-CONC-411 | 当连接测试与任一同步、导入、恢复、重置或版本维护操作重叠时，连接测试必须立即返回“同步操作正在运行”，且不得创建 Provider 或发起网络请求；首次创建 Gist 与配置自动保存不得因 `operation/config/crypto` 反向锁序互相等待。 | done |
| QA-BE-412 | 同步并发回归必须覆盖占用操作闸门时连接测试零调用、配置保存等待并在释放后成功、Join 与配置保存串行化、调度启停及同步模块全量 race，并通过完整 CI 对齐门禁。 | done |

本波次修复前，`SaveConfig` 只持有配置锁，而同步流程持有同步操作锁和加密操作锁：同步可先读取旧 Provider 端点，再并发读取刚保存的新秘密，形成旧端点接收新凭据的泄漏窗口；首次自动创建 Gist 时，同步还会按 `crypto -> config` 获取锁，而保存按 `config -> crypto` 获取锁，存在永久死锁。修复后配置保存进入同步操作闸门并按既有自动保存语义排队，连接测试则在闸门被占用时失败关闭，从根源上统一写入和联网读取的并发边界。`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.3%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（Windows 本地 Shell 参数边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SHELL-COMPAT-413 | 当 Windows 本地 Shell 参数包含盘符路径、UNC/普通反斜杠、空参数、空格或嵌入双引号时，参数解析必须遵循 Windows CRT/CreateProcess 约定并保持原始 argv 边界；不得把 `C:\Users\...` 解析成丢失反斜杠的字符串。 | done |
| SHELL-SEC-414 | 当启动 ConPTY Shell 时，程序路径与每个参数必须通过 `windows.ComposeCommandLine` 组合；带空格路径、末尾反斜杠、嵌入引号和空字符串不得越过参数边界或改变后续参数含义。 | done |
| QA-BE-415 | Windows 参数回归必须在 Linux 上覆盖可移植解析语义，在 Windows build tag 下覆盖 Compose/Decompose argv 往返，并通过 localshell race、Windows amd64 测试二进制交叉编译、lint 与完整 CI 对齐门禁。 | done |

本波次首先核对了 Windows ConPTY 退出链：微软官方明确说明 `ClosePseudoConsole` 会终止附属客户端及 Shell 创建的关联进程树，因此现有独立读取 goroutine 加幂等关闭已满足进程树收口要求。继续审计发现真正的兼容性缺陷位于参数链：通用解析器会把 Windows 路径中的反斜杠当作转义符吞掉，自制命令行引用也没有正确处理引号前和结尾反斜杠，可能导致路径失真或参数边界改变。修复后 Windows 解析采用 Go 标准库同源的 CRT 规则，ConPTY 命令行交由 x/sys 官方组合器生成。Windows amd64 测试二进制交叉编译与 localshell 全量 race 通过；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.3%**，前端 **196** 个测试文件 / **1247** 个用例、npm audit、源码与 bundle budget、TypeScript 和生产构建全部通过。

## 2026-07-27 商用硬化波次（应用日志原子切换与退出收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| LOG-REL-416 | 当启动加载持久化日志目录或用户在同一天修改目录时，日志管理器必须真实关闭旧文件并切换到新目录；目标目录或文件打开失败时必须保留原目录、保留天数和可写文件，不得出现“设置保存成功但仍写旧目录”或失败配置污染运行态。 | done |
| LOG-SEC-417 | 当日志目录已存在时，应用不得擅自改写该目录权限；仅新建目录使用 0700。每日文件必须是打开前后身份一致的普通文件并收紧为 0600，符号链接、目录及打开期间被替换的路径必须失败关闭。 | done |
| LOG-OPS-418 | 当读取日志目录或删除过期日志失败时，维护错误必须直接写入 stderr，不能因日志处理器递归而丢失，也不得静默忽略。 | done |
| APP-REL-419 | 当 Wails 启动失败、运行失败、正常返回或触发关闭回调时，应用必须先幂等停止业务资源再关闭日志文件；日志关闭失败必须回退输出到 stderr，异常返回不得通过 `os.Exit` 跳过资源收口。 | done |
| QA-BE-420 | 日志回归必须覆盖同日目录切换、打开失败与旧文件关闭失败回滚、既有/新建目录权限、符号链接拒绝、维护错误可见性、并发写入与重配置、启动加载持久化目录及主程序关闭顺序，并通过定向 race、lint 与完整 CI 对齐门禁。 | done |

本波次修复前，`Configure` 会先覆盖 `m.dir` 再判断当前文件是否已对应目标目录，导致启动加载持久化目录和同日手动切换都被误判为无需重开；不可写目标也可能返回成功并污染运行态。日志初始化还会把用户选中的既有目录强制改为 0700，并跟随每日文件符号链接；过期清理错误被静默忽略。主程序在 Wails `Run` 失败时直接 `os.Exit`，不会统一停止业务资源和关闭日志。修复后目标文件先完成普通文件身份与打开后同一性校验，再在互斥区内原子替换；失败保持原配置可写，新建目录与文件分别使用 0700/0600，既有目录权限保持不变，维护错误直达 stderr。启动失败、关闭回调、正常返回和运行失败共用“先业务、后日志”的幂等收口。`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.3%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（应用网络代理连接池分代）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| NET-REL-421 | 当应用网络代理的模式、地址、绕过规则或凭据发生变化时，所有既有长期 HTTP 客户端的后续请求必须使用新配置对应的 Transport generation；旧 generation 的空闲连接必须立即关闭，已在途请求可完成但其连接不得重新进入可复用池。 | done |
| NET-PERF-422 | 当多个联网服务或多个 HTTP 客户端使用同一代理管理器时，它们必须共享当前 generation 的连接池；重复保存规范化后相同的配置或提交无效配置时不得替换连接池。应用停机必须关闭当前 generation 的空闲连接。 | done |
| NET-SEC-423 | 当 HTTP 客户端通过系统、直连、HTTP(S) 或 SOCKS5 代理访问网络时，每个 Transport generation 都必须保留元数据地址、链路本地地址、非法拨号网络和 DNS 重绑定防护；动态切换代理不得绕过共享出站安全策略。 | done |
| APP-REL-424 | 当调用方未注入代理管理器时，应用必须创建默认共享实例并注入云同步、AI、更新检查和设置服务；停机资源收口必须幂等关闭该实例的空闲连接，不得依赖单个服务自行释放连接池。 | done |
| QA-BE-425 | 代理生命周期回归必须覆盖旧客户端在直连切换 SOCKS5 后不再复用直连空闲连接、多个客户端共享连接池、相同及无效配置保持连接池、显式关闭后重新建连、零值与 nil 边界、并发重配置访问、代理管理器下的受限地址拨号，以及应用默认注入与停机关闭，并通过相关包全量 race、覆盖率、lint 和完整 CI 对齐门禁。 | done |

本波次修复前，每个服务在创建时取得一份固定 `http.Transport`；代理设置保存后，已存在的 AI、云同步和更新检查客户端仍可继续复用旧直连或旧代理的空闲连接，只有重启应用或连接自然失效后才会应用新配置。修复后代理管理器自身实现共享 `RoundTripper`，配置变化以原子 generation 替换当前 Transport，并关闭旧 generation 的空闲连接；相同或无效配置保持既有连接池，所有长期客户端自动跟随新 generation。安全拨号策略下沉到每个 generation，应用默认创建并统一持有代理管理器，停机时集中关闭空闲连接。`internal/netproxy`、`internal/service` 与 `internal/app` 全量 race 通过，代理包覆盖率 **94.5%**；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.4%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（同步操作停机取消与资源关闭顺序）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-REL-426 | 当应用开始退出时，同步服务必须先停止接收新的同步、导入、导出、恢复、冲突处理、版本维护、配置保存和连接测试操作；正在执行的联网操作必须收到取消信号，非联网操作必须允许完成并被等待，不得在操作仍访问密钥或数据库时继续关闭依赖。 | done |
| SYNC-CONC-427 | 当配置保存已经排队等待同步操作锁且应用随后进入停机时，该保存必须在取得锁后返回“同步服务正在关闭”，不得提交陈旧配置或重启调度器。新旧 Provider 连接测试和遗留云连接测试必须与其他同步操作共用同一串行闸门。 | done |
| APP-REL-428 | 当 `App.Shutdown` 执行时，系统必须先完成同步服务的“停止接入、取消联网、停止调度、等待在途操作”协议，再清除主密钥、关闭终端与 SSH 资源并关闭数据库；同步完成审计不得写入已关闭数据库。重复停机必须幂等。 | done |
| QA-BE-429 | 停机回归必须覆盖手工同步阻塞在密钥读取时应用不得提前关闭数据库、在途 Provider 请求被取消、遗留云测试/上传/下载被取消、全部同步写操作在停机后拒绝、排队配置保存不落库、nil 与重复停机边界，以及同步服务和应用包全量 race、lint 与完整 CI 对齐门禁。 | done |

本波次修复前，`App.Shutdown` 只调用 `StopScheduler`；它会等待调度器和解锁补偿任务，却完全不感知正在执行的手工同步、遗留云上传下载、冲突处理或设备加入。稳定回归中，应用先返回停机并关闭数据库，手工同步随后记录失败审计时直接出现 `sql: database is closed`。修复后同步服务维护独立 stopped 状态和当前操作取消句柄：停机先禁止新操作并取消联网上下文，再停止调度器并等待串行操作锁释放；阻塞中的配置保存取得锁后重新检查 stopped 状态并失败关闭。App 只有在该协议完成后才清除主密钥和关闭数据库。`internal/service` 与 `internal/app` 全量 race 通过；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.4%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（AI 操作停机取消与依赖关闭顺序）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-REL-430 | 当应用开始退出时，AI 服务必须停止接收新的对话、连接测试、命令执行、配置、Provider、会话历史和本地 Agent CLI 探测操作；正在执行的 Provider、联网搜索、CLI 探测和终端命令必须收到取消信号，无法由 context 中断的密钥链或数据库操作必须允许完成并被等待。 | done |
| AI-DATA-431 | 当 AI 操作因停机取消或正常完成时，失败审计、对话持久化和命令执行记录必须在数据库关闭前完成；停机完成后必须清除 session-only AI 凭据，重复停机保持幂等，且不得继续访问已关闭数据库、终端或密钥状态。 | done |
| APP-REL-432 | 当 `App.Shutdown` 执行时，系统必须在清除主密钥、关闭终端、释放代理连接池和关闭数据库前完成 AI 服务的“停止接入、取消可取消工作、等待在途操作、清除易失凭据”协议。 | done |
| QA-BE-433 | AI 停机回归必须覆盖阻塞密钥链操作期间应用不得提前关闭数据库、Provider 请求 context 取消、阻塞终端命令关闭与等待、全部绑定操作在停机后拒绝、本地 CLI 探测返回空结果、易失凭据清除、nil 与重复停机边界，以及 AI、service 和 app 包 race、lint 与完整 CI 对齐门禁。 | done |

本波次修复前，AI 服务没有任何生命周期状态：45 秒 Provider 对话、联网搜索、20 秒连接测试、最长配置时限的终端命令以及阻塞中的密钥链调用都可能跨越 `App.Shutdown`；应用会先关闭数据库和终端，随后 AI 失败审计、对话保存或命令记录可能访问已关闭依赖。修复后所有 Wails AI 操作统一进入生命周期闸门，根 context 在停机时取消 Provider、搜索、CLI 和命令执行，非 context 操作由 WaitGroup 等待；应用仅在 AI 完成并清除 session-only 凭据后继续关闭安全、终端、代理与数据库资源。AI 定向与 `internal/service`、`internal/app` 全量 race 回归通过，生命周期初始化和 Shutdown 覆盖率均为 **100%**；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.5%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（安全服务停机一致性与 Vault 事务生命周期）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SEC-REL-434 | 当应用开始退出时，安全服务必须停止接收新的状态读取、密码验证、初始化、解锁、锁定、轮转、偏好保存、自动解锁、轮转恢复、同步密钥、Vault 导入导出和解锁状态检查；已经进入的操作必须连同解锁回调、审计与事件发送完整结束后才允许停机继续。 | done |
| SEC-DATA-435 | 当同步恢复通过 `PrepareVaultFromExport` 持有 Vault 安装事务时，安全服务停机必须等待事务 Commit 或 Rollback 真正释放加密操作锁、状态锁和回滚快照；不得在事务未关闭时清除 DEK 或关闭数据库。Commit 失败后的 Rollback 仍必须完成生命周期释放。 | done |
| APP-REL-436 | 当 `App.Shutdown` 执行时，系统必须在关闭终端、SSH、代理连接池和数据库前调用安全服务 Shutdown；该协议必须先拒绝新操作、等待全部在途调用和 Vault 事务，再仅清除进程内 DEK，不得改变“记住解锁”的安全存储偏好。 | done |
| QA-BE-437 | 安全停机回归必须覆盖 Setup 已释放状态锁但仍阻塞在 after-unlock 回调时应用不得提前关闭数据库、Vault 安装事务未提交时停机等待、事务回滚后完成、全部安全入口在停机后拒绝、DEK 清除、nil 与重复停机，以及安全测试簇、service/app 全量 race、lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，`ClearMemory` 只能等待仍持有 `stateMu` 的加密突变；Setup、Unlock、Rotate 和 Vault Commit 在释放状态锁后执行的 after-unlock 回调、审计与事件不再受保护，应用可在这些尾部动作尚未结束时清除 DEK 并关闭数据库。安全服务也没有 stopped 状态，新调用可在 `ClearMemory` 返回后重新进入。修复后所有安全入口统一持有完整方法生命周期计数，停机先原子拒绝新操作并等待回调、审计和本地 I/O；Vault 安装事务把生命周期释放绑定到成功 Commit 或完成 Rollback，最后才清除进程内 DEK。安全定向测试簇与 `internal/service`、`internal/app` 全量 race 回归通过；`security_lifecycle.go` 的 `beginOperation`、`Shutdown`、`ClearMemory` 覆盖率分别为 **88.9%**、**100.0%**、**80.0%**。`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.6%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（更新检查停机取消与等待）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UPDATE-REL-438 | 当应用开始退出时，更新检查服务必须立即拒绝新的检查并取消所有已进入的 HTTP 请求；调用方 context 与服务停机 context 任一取消都必须终止请求，不得让 GitHub API、代理或 DNS 操作继续占用退出进程。 | done |
| APP-REL-439 | 当 `App.Shutdown` 执行时，系统必须在关闭共享代理连接池、数据库和其他基础设施前等待全部更新检查返回；重复停机与 nil 服务必须幂等，不得出现退出后重新发起更新请求。 | done |
| QA-BE-440 | 更新检查停机回归必须覆盖在途请求收到取消、底层 RoundTripper 未返回时 Shutdown 持续等待、释放后完成、停机后零网络调用、nil 服务、缺失 context，以及应用退出真实调用该协议，并通过 About/App race、lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，`AboutService.CheckUpdate` 只依赖单次 Wails 调用传入的 context，服务本身没有 stopped 状态或在途计数；`App.Shutdown` 关闭共享代理时也只清理空闲连接，活动更新请求可以跨越退出边界继续运行。修复后更新检查同时绑定调用方与服务生命周期，停机先拒绝新请求、取消活动 HTTP 操作并等待完整返回，应用在进入同步、AI、安全和基础设施收口前优先执行该协议。About 生命周期的 `initialize`、`beginOperation`、`Shutdown` 覆盖率均为 **100.0%**；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.6%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（宏操作停机取消与审计一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| MACRO-REL-441 | 当应用开始退出时，宏服务必须拒绝新的列表、创建、更新、删除和执行操作，并等待已经进入的数据库与日志操作完成；停机后不得以 `sql: database is closed` 代替明确的服务关闭错误。 | done |
| MACRO-CONC-442 | 当宏命令阻塞在终端写入时，停机必须取消写入、关闭对应终端以解除不可中断的底层调用，并持续等待写 goroutine 返回；命令结果未知、关闭错误和晚到写错误必须沿既有错误链返回。 | done |
| MACRO-DATA-443 | 当宏执行因停机取消时，系统必须在服务生命周期释放和数据库关闭前写入 `macro_execute` 失败审计；不得出现命令已部分发送但退出流程先关闭数据库、导致审计缺失的窗口。 | done |
| APP-REL-444 | 当 `App.Shutdown` 执行时，系统必须在关闭终端和数据库前完成宏服务的“停止接入、取消执行、等待尾部审计”协议；nil 与重复停机必须幂等。 | done |
| QA-BE-445 | 宏停机回归必须覆盖活动终端写收到取消、底层写未返回时 Shutdown 等待、释放后失败审计完整、全部宏入口停机后拒绝、nil 与重复停机，以及应用被阻塞宏操作占用时数据库保持可用，并通过 Macro/App 全量 race、lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，`MacroService.Execute` 使用 `context.Background()` 启动最长可达配置时限的终端写入，宏 CRUD 与执行均没有 stopped 状态；`App.Shutdown` 可先关闭终端和数据库，宏调用随后才记录失败审计，产生部分命令结果不可追踪或直接命中已关闭数据库。修复后全部宏入口统一进入生命周期计数，执行路径绑定服务取消 context，停机关闭阻塞终端并等待写入、错误整合和审计完成；应用只有在宏服务完全静默后才继续其他业务与基础设施收口。定向及 `internal/service`、`internal/app` 全量 race 回归通过，宏生命周期的 `initialize`、`beginOperation`、`Shutdown` 覆盖率均为 **100.0%**；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.6%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（设置自动保存停机一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SETTING-REL-446 | 当应用开始退出时，设置服务必须拒绝新的 Get、GetMany、List、Set、SetMany、Delete 及持久化配置应用操作，并等待已经进入的读取、自动保存、回滚和运行态配置应用完整结束。 | done |
| SETTING-DATA-447 | 当设置写入已持久化但日志目录或网络代理应用仍在进行时，停机不得关闭数据库、代理连接池或日志基础设施；成功路径必须完成运行态收敛，失败路径必须完成数据库与运行态补偿后才能释放生命周期。 | done |
| SETTING-CONC-448 | 当设置操作使用主密钥加解密代理凭据时，应用必须先等待设置服务静默，再允许安全服务清除 DEK；停机不得依赖偶然的 `CryptoRuntime` 锁竞争来维持正确关闭顺序。 | done |
| APP-REL-449 | 当 `App.Shutdown` 执行时，系统必须在同步、AI、安全服务及基础设施关闭前完成设置服务 Shutdown；活动自动保存阻塞时数据库和 DEK 必须继续可用，nil 与重复停机保持幂等。 | done |
| QA-BE-450 | 设置停机回归必须覆盖运行态日志应用阻塞时 Shutdown 等待、数据库保持可用、释放后设置真实落库、全部设置入口停机后拒绝、nil 与重复停机，以及应用退出期间数据库与 DEK 均在设置完成前保持可用，并通过 Setting/App 全量 race、lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，`SettingService` 的自动保存可能先写数据库、再阻塞于日志或代理运行态应用，而服务本身没有 stopped 状态；`App.Shutdown` 也不会等待设置读写，可先清除主密钥、关闭代理和数据库，导致“持久化值、运行态值、回滚状态”跨退出边界分裂。修复后所有公开与启动期设置入口共用完整方法生命周期计数，停机先原子拒绝新调用并等待持久化、补偿及运行态应用结束；应用明确在安全服务和基础设施前收口设置服务，不再依赖加密互斥锁的间接保护。定向及 `internal/service`、`internal/app` 全量 race 回归通过，设置生命周期的 `beginOperation` 与 `Shutdown` 覆盖率均为 **100.0%**；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.6%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（SSH 密钥停机一致性与敏感缓冲清理）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| KEY-REL-451 | 当应用开始退出时，密钥服务必须拒绝新的列表、生成、导入、删除、使用计数、公钥导出、私钥查看、更新和导入文件选择操作，并等待已经进入的随机密钥生成、文件读取、加解密、数据库写入及尾部审计完整结束。 | done |
| KEY-DATA-452 | 当密钥操作已经读取或生成私钥材料时，停机不得在其加密、解密、持久化或 `key_view` / `delete` 审计完成前清除 DEK 或关闭数据库；已经进入的操作必须得到确定结果，不得退化为 `sql: database is closed`。 | done |
| KEY-SEC-453 | 当生成、导入、查看或更新私钥时，完成必要的返回值或密文复制后必须及时清零可变明文字节缓冲；文件选择器依赖的设置与读取必须并发安全，不得产生数据竞争或读取部分更新状态。 | done |
| APP-REL-454 | 当 `App.Shutdown` 执行时，系统必须在安全服务清除 DEK 和基础设施关闭数据库前完成密钥服务 Shutdown；nil 与重复停机必须幂等。 | done |
| QA-BE-455 | 密钥停机回归必须覆盖阻塞私钥解密期间 Shutdown 等待、数据库与 DEK 保持可用、释放后私钥读取成功、全部绑定入口停机后拒绝、nil 与重复停机、文件选择器并发访问，以及应用关闭顺序，并通过 Key/Setting/App race、lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，`KeyService` 没有 stopped 状态或在途计数；稳定回归可在私钥解密仍阻塞时让 `App.Shutdown` 先清除 DEK 并关闭数据库，方法返回前执行的 `key_view` 审计随后出现 `sql: database is closed`，停机完成后新的列表等调用仍会继续访问已关闭数据库。修复后全部 Wails 密钥入口共用可复用生命周期门闩，应用先等待密钥生成、文件读取、加解密、持久化与审计完整收口，再停止安全服务和数据库；设置服务同步复用该门闩以消除重复实现。私钥处理中可控制的明文字节副本在完成字符串或密文复制后立即清零，文件选择器引用通过读写锁发布。密钥生命周期 `beginOperation`、`Shutdown`，共享门闩 `begin`、`stopAndWait`，以及文件选择器设置与读取覆盖率均为 **100.0%**；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.7%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（终端主题停机一致性与并发导入收敛）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| THEME-REL-456 | 当应用开始退出时，主题服务必须拒绝新的定义/配置列表、配置读取、主题创建更新删除、分配与全局样式读取保存、默认初始化、内置样式重置和文件导入操作，并等待已经进入的文件解析、数据库读取及事务完整结束。 | done |
| THEME-CONC-457 | 当多个调用并发导入相同指纹的主题文件时，重复判定与定义/配置创建必须位于同一写事务；最终必须且只能创建一套定义与配置，其余调用返回 duplicate，不得因唯一约束竞争误报 failed。 | done |
| THEME-DATA-458 | 当读取分配、全局样式或重置内置样式需要补齐默认主题时，公开方法必须只持有一次生命周期租约并调用内部初始化流程；停机开始后已经进入的初始化与配置事务可完成，新的嵌套调用不得因 stopped 状态造成半途失败或部分写入。 | done |
| APP-REL-459 | 当 `App.Shutdown` 执行时，系统必须在关闭数据库前完成主题服务 Shutdown；活动主题查询或导入被数据库连接阻塞时，应用不得提前关闭数据库，nil 与重复停机必须幂等。 | done |
| QA-BE-460 | 主题回归必须覆盖数据库读取阻塞时 Shutdown 等待、释放后读取成功、全部绑定入口停机后拒绝、nil 与重复停机、并发同指纹导入一次成功其余重复、应用关闭顺序，以及 Theme/Store/App 全量 race、lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，`ThemeService` 没有 stopped 状态或在途计数；应用可在主题查询仍等待数据库连接时直接关闭数据库，使调用以 `sql: database is closed` 结束。主题导入还会先在事务外查询指纹，再另起事务创建记录；稳定并发回归中，多个已经完成预检的调用会竞争唯一约束，除首个成功外其余被错误标记为 failed，而不是 duplicate。修复后所有公开主题入口统一持有生命周期租约，默认初始化拆为不重复入闸的内部流程，应用在数据库前等待主题服务静默；导入事务先获取写事务，再在同一快照内判重并创建定义与配置，八路并发稳定收敛为一次 imported、七次 duplicate。主题生命周期 `beginOperation` 与 `Shutdown`、公开 `ImportFiles` 覆盖率均为 **100.0%**，指纹查询覆盖率 **85.7%**；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.7%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（资产目录停机一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| ASSET-REL-461 | 当应用开始退出时，资产目录服务必须拒绝新的环境、项目、标签列表与创建更新、删除影响查询、删除、批量归属、批量标签、排序及会话资产详情操作，并等待已经进入的数据库读取、写事务和尾部审计完整结束。 | done |
| ASSET-DATA-462 | 当资产目录变更已经进入创建、更新、迁移删除、批量分配或排序事务时，停机不得提前关闭数据库；事务必须得到确定的提交或回滚结果，成功后的详情回读和审计也必须在生命周期释放前完成。 | done |
| ASSET-CONC-463 | 当服务停机与资产操作并发时，公开入口必须只获取一次共享生命周期租约，私有查询与事务助手不得重复入闸；停机开始前进入的调用可完成，停机开始后的调用必须稳定返回服务关闭错误。 | done |
| APP-REL-464 | 当 `App.Shutdown` 执行时，系统必须在关闭数据库前完成资产目录服务 Shutdown；活动资产写入等待数据库连接时应用不得提前返回，nil 与重复停机必须幂等。 | done |
| QA-BE-465 | 资产目录回归必须覆盖数据库连接阻塞时 Shutdown 等待、释放后创建和详情回读成功、全部 21 个公开业务入口停机后拒绝、nil 与重复停机、应用关闭顺序，以及 Asset/App/Testutil 全量 race、lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，`AssetCatalogService` 没有 stopped 状态或在途计数；稳定回归可让标签创建阻塞在数据库连接等待时调用 `App.Shutdown`，应用会直接关闭数据库并提前返回，资产事务随后只能以依赖关闭错误结束。修复后 21 个公开资产业务入口统一复用生命周期门闩，存储回读和事务助手保持内部调用，避免嵌套租约；应用在关闭数据库前显式等待资产目录服务静默。资产生命周期 `beginOperation` 与 `Shutdown` 覆盖率均为 **100.0%**；定向及 `internal/service`、`internal/app`、`internal/service/testutil` 全量 race 回归通过，`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.8%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（会话资产与连接停机一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SESSION-REL-466 | 当应用开始退出时，会话服务必须拒绝新的分组与会话 CRUD、删除影响查询、批量删除、CSV 预览导入导出、known_hosts 管理、连接创建与连接决策操作，并等待已经进入的数据库、文件、加密、审计和连接尝试完整结束。 | done |
| SESSION-DATA-467 | 当会话创建更新、CSV 密码导入导出或连接认证已经开始使用 DEK 时，应用不得提前清除 Vault 或关闭数据库；操作必须得到确定的成功或失败结果，删除审计、原子文件写入和数据库事务必须在生命周期释放前结束。 | done |
| SESSION-CONC-468 | 当会话停机与终端、SFTP、隧道或同步收口并发时，系统必须先停止新会话操作并取消连接尝试，再等待在途操作；已建立连接只能在 File、Terminal、Tunnel 停止后关闭，避免依赖反向关闭与五分钟主机密钥等待。 | done |
| APP-REL-469 | 当 `App.Shutdown` 执行时，系统必须在同步与 AI 静默后、Security 清除 DEK 前调用会话操作静默协议；随后按 File、Terminal、Tunnel、Session 顺序关闭运行资源，最后关闭数据库。nil 与重复停机必须幂等。 | done |
| QA-BE-470 | 会话回归必须覆盖数据库连接阻塞时 Shutdown 等待、独立 KeyCrypto 阻塞时 DEK 保持可用、全部 26 个可失败入口停机后拒绝、连接尝试取消、CloseAll 临时与永久语义、nil 与重复停机、应用关闭顺序，以及 Session/HostKey/App 全量 race、lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，`SessionService.Shutdown` 只取消连接尝试并关闭已建立 SSH 连接；分组与会话 CRUD、CSV、known_hosts、删除审计和连接辅助入口既不会被拒绝，也不计入停机等待。应用还会先执行 `Security.Shutdown`，再进入 File、Terminal、Tunnel 和 Session 收口；自定义或未实现 `WithCryptoOperation` 的会话加密适配器可在 DEK 已清除后继续持久化，数据库操作也可能跨越 `DB.Close`。修复后 26 个可失败入口统一持有共享生命周期租约，会话停机拆为“停止接入、取消尝试、等待业务操作”和“关闭已建立连接”两个阶段；应用在清除 DEK 前完成第一阶段，在上层运行资源停止后完成第二阶段。共享门闩 `stopAndWait`、`stop`、`wait`，会话 `beginOperation`、`StopOperationsAndWait`、`Shutdown`、`GetClientWrapper`、`ConnectionCount`、`CloseAll` 覆盖率均为 **100.0%**；定向及 `internal/service`、`internal/app`、`internal/service/testutil` 全量 race 回归通过，`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.9%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（命令历史与审计停机一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| HISTORY-REL-471 | 当应用开始退出时，命令历史服务必须拒绝新的添加、列表、单条删除和会话清空操作，并等待已经进入的数据库读取或写入完整结束；停机后不得继续访问已关闭数据库。 | done |
| AUDIT-REL-472 | 当应用开始退出时，审计服务必须拒绝新的启用状态读取、状态设置、事件列表和批量审计写入，并等待已经进入的查询与逐条审计持久化完整结束。 | done |
| AUX-DATA-473 | 当命令历史或审计操作已进入数据库等待时，应用不得提前关闭数据库；停机前进入的调用必须得到确定结果，停机后进入的调用必须稳定返回对应服务关闭错误，不得退化为 `sql: database is closed`。 | done |
| APP-REL-474 | 当 `App.Shutdown` 执行时，系统必须在关闭数据库前依次完成命令历史与审计服务 Shutdown；nil 服务、nil 接收者和重复停机必须幂等。 | done |
| QA-BE-475 | 辅助数据服务回归必须覆盖数据库连接阻塞时 Shutdown 等待、释放后调用成功、全部 8 个公开入口停机后拒绝、nil 接收者，以及应用关闭顺序，并通过 Service/App 全量 race、lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，`CommandHistoryService` 与 `AuditService` 没有 stopped 状态或在途计数；应用可在历史查询或审计读取仍等待数据库连接时直接执行 `DB.Close`，使调用结果依赖关闭竞态，退出完成后新的调用也会继续命中已关闭数据库。修复后两项服务的 8 个公开入口统一持有共享生命周期租约，停机先原子拒绝新操作并等待数据库读取、写入和批量审计尾部动作结束；应用在基础设施收口前显式等待两项服务静默。命令历史与审计生命周期的 `beginOperation`、`Shutdown` 覆盖率均为 **100.0%**；定向及 `internal/service`、`internal/app` 全量 race 回归通过，`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.9%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（串口配置停机与占用一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SERIAL-REL-476 | 当应用开始退出时，串口服务必须拒绝新的配置列表、详情、创建、更新、单删、批删、设备枚举和终端设备预留，并等待已经进入的数据库或系统设备枚举调用完整结束。 | done |
| SERIAL-CONC-477 | 当串口配置更新或删除与终端打开并发时，配置占用检查、数据库变更、配置快照复核和设备预留必须由同一串行化边界保护；活动配置不得被修改或删除，已删除或连接参数已变化的陈旧快照不得继续打开物理端口。 | done |
| SERIAL-DATA-478 | 当串口配置操作已进入数据库等待时，应用不得提前关闭数据库；停机前进入的调用必须得到确定结果，停机后进入的调用必须返回串口服务关闭错误，不得退化为 `sql: database is closed`。 | done |
| APP-REL-479 | 当 `App.Shutdown` 执行时，系统必须先停止串口配置与新设备预留，再关闭终端资源和数据库；已打开串口的设备占用登记必须仍允许由终端关闭路径释放，nil 与重复停机必须幂等。 | done |
| QA-BE-480 | 串口回归必须覆盖数据库连接阻塞时 Shutdown 等待、7 个可失败绑定入口与设备预留在停机后拒绝、nil 接收者、活动配置更新拒绝、删除及修改后的陈旧快照拒绝、停机后占用释放和应用关闭顺序，并通过 Serial/Terminal/App 全量 race、lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，`SerialService` 没有生命周期门闩且未接入 `App.Shutdown`，配置查询可跨越 `DB.Close`；终端打开还会先读取配置、随后独立登记设备占用，更新或删除可插入两步之间，使已经失效的配置继续打开物理端口。修复后全部可失败绑定入口与生产设备预留统一持有生命周期租约，配置更新、删除和预留在同一占用锁内复核数据库状态与连接参数；活动配置禁止修改，陈旧快照稳定失败，而终端关闭仍可在服务停止后释放占用。串口生命周期 `beginOperation`、`Shutdown`，配置比较与底层预留覆盖率均为 **100.0%**，`reserveProfile` 为 **91.7%**、`verifyProfileSnapshotLocked` 为 **87.5%**；定向及 `internal/service`、`internal/app` 全量 race 回归通过，`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.9%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（终端录制两阶段停机与尾部完整性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| LOG-REL-481 | 当应用开始退出时，录制服务必须拒绝新的日志列表、录制启动、显式停止、回放打开和日志删除，并等待已经进入的数据库、文件创建、文件校验、回滚及终止器完整结束。 | done |
| LOG-DATA-482 | 当录制服务停止公开操作后且终端尚未关闭时，内部输出处理与终端关闭回调必须继续可用；系统必须记录终端关闭前的尾部输出，再关闭 recorder 并持久化 `ended_at`，不得因先清空录制映射而静默丢弃退出间隙数据。 | done |
| LOG-CONC-483 | 当日志仍在录制或正在执行 recorder 关闭与数据库终止器时，删除操作必须稳定拒绝；活动映射移除到终止器完成之间必须保留按日志 ID 的 finalizing 状态，避免删除记录后终止器命中不存在行。 | done |
| APP-REL-484 | 当 `App.Shutdown` 执行时，系统必须先停止录制公开操作，再停止文件传输并关闭终端，随后收口剩余录制与聚合终止错误，最后才关闭数据库；nil、重复停机及孤立录制必须幂等处理。 | done |
| QA-BE-485 | 录制回归必须覆盖数据库读取阻塞时操作静默等待、5 个公开绑定入口停机后拒绝、停机期间内部尾部输出与关闭回调、活动和 finalizing 日志删除拒绝、并发 Start/Stop/Shutdown 错误共享、终端先于录制终止器关闭及应用关库顺序，并通过 Log/Terminal/App 全量 race、lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，`CloseAllActiveRecordings` 只保护录制启动与终止器，日志列表、删除和回放仍可跨越 `DB.Close`；应用还会先关闭全部 recorder、再关闭终端，期间到达的终端尾部输出因录制映射已清空而被丢弃。停止操作并发删除时，活动映射会在数据库终止器完成前移除，删除可抢先移除日志行，使 `EndSessionLog` 失败。修复后录制服务采用“停止公开操作”和“终端关闭后最终收口”两阶段协议，内部输出与关闭回调在第一阶段继续工作；活动和 finalizing 日志统一禁止删除，所有终止错误在最终 Shutdown 聚合。录制生命周期 `beginOperation`、`StopOperationsAndWait`、`Shutdown`、`CloseAllActiveRecordings`，关闭全部录制、内部输出、占用判定和终止器跟踪覆盖率均为 **100.0%**；定向及 `internal/service`、`internal/app` 全量 race 回归通过，`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.9%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（隧道启动取消与双模式收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TUNNEL-REL-486 | 当应用开始退出时，隧道服务必须拒绝新的列表、创建、更新、删除、启动和停止，并等待已经进入的数据库、SSH 连接、监听器创建、清理与事件尾部动作完整结束；停机后不得重新建立隧道。 | done |
| TUNNEL-CONC-487 | 当临时 `StopAll` 与 Start/Stop/Delete 并发时，系统必须先关闭运行时接入屏障、取消已预留启动并等待全部运行时操作退出，再对稳定快照执行清理；临时收口完成后必须恢复可用，永久 Shutdown 则保持拒绝。 | done |
| TUNNEL-CANCEL-488 | 当隧道启动阻塞于 SSH 连接、客户端获取或远程监听创建时，停止操作必须取消启动 context，并在客户端已经建立时关闭该 SSH 客户端以解除阻塞；失败连接清理必须同步清空 reservation，避免重复断开或残留运行态。 | done |
| TUNNEL-DATA-489 | 当隧道启动与配置更新或删除并发时，配置读取与运行态预留、活动状态检查及配置变更必须位于同一配置串行化边界；活动配置不得更新，删除不得在读取与预留之间制造陈旧配置启动。 | done |
| APP-REL-490 | 当 `App.Shutdown` 执行时，系统必须先停止隧道公开操作，再让会话服务取消连接尝试并等待，随后等待隧道启动清理完成；运行资源阶段必须先关闭终端与录制，再关闭隧道，最后关闭 SSH 会话和数据库。 | done |
| QA-BE-491 | 隧道回归必须覆盖数据库读取阻塞时 Shutdown 等待、6 个公开入口停机后拒绝、nil 与重复停机、临时 StopAll 等待未完成 Start、启动 context 取消、typed-nil 客户端安全、活动配置更新拒绝、失败连接与取消清理状态同步、会话删除协作和应用关库顺序，并通过 Tunnel/Session/App 全量 race、lint、源码限制和完整 CI 对齐门禁。 | done |

## 2026-07-27 商用硬化波次（绑定只读与终端资源停机一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-REL-492 | 当应用开始退出时，同步服务的配置读取、Dashboard、版本列表和事件列表必须拒绝新的调用，并等待已经进入的数据库查询、Vault 状态读取和快照计算完整结束；停机后不得访问已关闭数据库。 | done |
| SYNC-DATA-493 | 当同步写操作在停机开始前已经进入并需要嵌套读取配置或 Dashboard 时，内部流程必须使用不重复入闸的私有查询，确保在途操作不会因 stopped 状态半途失败；调度器不得在退出期间被重新启动。 | done |
| FONT-REL-494 | 当应用开始退出时，字体目录扫描必须停止接收新的列表请求，取消正在进行的目录遍历并等待文件读取、字体解析和缓存写入结束；停机后的列表调用必须安全返回回退字体，不得 panic。 | done |
| TERM-REL-495 | 当应用或同步开始收口终端时，终端服务必须拒绝新的打开、写入、调整大小、关闭、附加、系统/进程探测、串口控制、输出暂停和池配置操作，并等待已进入的调用结束后再关闭 PTY、串口设备和连接。 | done |
| TERM-CONC-496 | 当临时 `CloseAllTerminals` 与写入、探测或其他终端操作并发时，系统必须先建立关闭屏障、等待全部在途操作完成，再执行内部关闭；临时收口完成后必须恢复可用，永久 Shutdown 则保持拒绝。 | done |
| FILE-REL-497 | 当应用开始退出或同步执行破坏性收口时，文件服务必须拒绝新的 SFTP 列表、删除、创建目录、重命名、传输启动、传输取消和传输列表操作，并等待元数据请求与传输启动阶段完整结束。 | done |
| FILE-DATA-498 | 当文件元数据操作正在等待数据库或 SFTP 连接时，`StopAndWait` 不得提前返回或关闭依赖连接；停机前进入的操作必须得到确定结果，暂停收口完成后必须恢复新传输能力。 | done |
| APP-REL-499 | 当 `App.Shutdown` 执行时，应用必须在关闭数据库前等待同步只读、文件元数据、终端公开操作和字体扫描全部静默；停机阶段拆分后的辅助/核心操作不得超过认知复杂度门禁，nil 与重复 Shutdown 必须幂等。 | done |
| QA-BE-500 | 本波次必须覆盖同步只读数据库阻塞、字体扫描取消与等待、终端临时/永久写入收口、文件元数据数据库阻塞与停机拒绝、应用关库顺序，并通过相关服务/App race、golangci-lint v2.12.2、Go 源码体量门禁和完整 `wails3 task ci`。 | done |

本波次审计发现四类绑定入口曾绕过已有运行资源收口：同步的只读查询不计入 `Shutdown`，字体扫描没有生命周期协议，终端只有打开流程计数而写入/探测/控制可与 PTY 关闭并发，文件服务只等待异步 worker 而 SFTP 元数据与传输启动仍可穿透停机。修复后同步采用与 stopped 状态同锁保护的只读计数和私有嵌套查询；字体扫描使用可取消 context、受控目录遍历和生命周期等待；终端以可恢复的操作计数屏障覆盖临时与永久收口，内部关闭路径绕过公开拒绝；文件服务以可恢复的操作计数覆盖 SFTP 元数据、传输启动与取消，并在 worker 和元数据操作都静默后完成暂停/停止。应用停机阶段拆分为辅助与核心两组以保持复杂度门禁，新增应用级数据库关闭顺序回归。`goimports-reviser v3.12.6` 已应用于本波次 Go 文件；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **91.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。`coverage.out`、`coverage.func.txt`、`bin/mssh` 与 `frontend/dist` 已清理，`git diff --check` 通过。

本波次修复前，`TunnelService` 没有 stopped 状态，`StopAll` 只快照当时已经进入 `tunnels` 映射的状态；Start 若仍阻塞在配置读取即可被漏过，并在收口后继续连接。远程监听启动期间也没有独立取消 context 或已建立客户端引用，应用可能等待十秒超时后继续关闭会话和数据库。配置更新可插入 Start 的读取与预留之间，使旧参数建立新隧道。修复后六个公开入口统一持有生命周期租约，Start/Stop/Delete 额外进入可临时关闭的运行时屏障；启动 reservation 持有 cancel context 与阶段性 SSH 客户端，临时 StopAll 可恢复、永久 Shutdown 不可恢复。配置锁把读取与预留、活动检查、更新和删除串行化，失败清理同步 reservation。隧道生命周期 `beginOperation`、`runtimeClosingErrorLocked`、`WaitOperations`、`Shutdown`、`stopAllRuntime`、运行时快照与清理均为 **100.0%**，`beginRuntimeOperation` 为 **91.7%**，失败连接清理与取消状态同步均为 **100.0%**；定向及 `internal/service`、`internal/app` 全量 race 回归通过，`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **90.9%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（后台探测与 SSH 保活退出所有权）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYS-REL-501 | 当系统信息探测达到超时时限时，系统必须先关闭探测会话并等待执行协程退出，再向调用方返回；超时、关闭失败和执行退出错误必须保留在同一错误链中，不得留下迟到写入或后台 goroutine。 | done |
| SSH-REL-502 | 当 SSH 客户端被显式关闭时，系统必须取消 keepalive、关闭底层连接并等待 keepalive worker 退出；当 keepalive 自身达到失败阈值时，必须使用不等待自身的内部关闭路径，避免自锁。 | done |
| QA-BE-503 | 探测与 keepalive 回归必须覆盖取消后延迟退出、关闭错误与执行错误组合、真实 SSH 服务端不结束命令、公开关闭等待 worker、并发幂等关闭和 keepalive 自关闭防死锁，并通过 race、lint、覆盖率及完整 CI 对齐门禁。 | done |

本波次修复前，`waitSystemProbe` 在超时后只调用 `Close` 便立即返回，执行 `runner.Run` 的 goroutine 仍可能访问输出缓冲或在关闭依赖后迟到结束；`ClientWrapper.Close` 也只发送取消并关闭 SSH client，没有等待 keepalive worker，而直接在 worker 内改为等待会造成自身 WaitGroup 自锁。修复后探测超时路径在取消后同步 join 执行结果并聚合全部错误；SSH 客户端将“触发连接关闭”与“公开关闭等待”拆分，外部调用等待 worker，worker 达阈值仅触发内部幂等关闭后退出。stub、真实阻塞 SSH 会话、并发关闭及自关闭定向 race 回归通过；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **91.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（终端会话读循环退出所有权）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| PTY-REL-504 | 当 SSH PTY 被关闭时，系统必须先阻止尚未启动的读循环、关闭 SSH session，并等待读循环停止读取和投递输出后再返回；关闭后的 `Start` 不得创建新 goroutine。 | done |
| LOCAL-REL-505 | 当本地 Shell 被关闭时，系统必须阻止关闭后的 read/process worker 启动，终止 PTY/ConPTY 及关联进程，并等待读取与进程等待 worker 全部退出；关闭错误必须继续返回。 | done |
| SERIAL-REL-506 | 当串口会话被关闭时，系统必须关闭物理端口并等待读循环退出后再返回；空句柄启动仍必须保持既有退出通知语义，但不得为已关闭会话创建后台 worker。 | done |
| TERM-CONC-507 | 当 PTY、本地 Shell 或串口的退出回调同步调用自身 `Close` 时，系统不得让 worker 等待自身形成死锁；资源读取计数必须在执行退出回调前释放。 | done |
| QA-BE-508 | 会话 worker 回归必须覆盖关闭提前返回、关闭后启动、读取与进程等待双 worker、关闭错误、空串口退出、回调自关闭、50 次 race 压力、TerminalService 集成及 Windows amd64 交叉编译，并通过完整 CI 对齐门禁。 | done |

本波次修复前，`PTYSession.Close`、`localshell.Session.Close` 和 `PortSession.Close` 只触发底层关闭便立即返回，读循环以及本地 Shell 的 `processWait` 仍可能在后台运行；PTY 与本地 Shell 还允许 `Close` 后首次调用 `Start` 创建新 worker。直接在 worker 尾部 `Done` 会让退出回调调用 `Close` 时等待自身。修复后 Start 与 Close 在同一状态锁内完成“检查并登记 worker”或“标记关闭”，公开 Close 在底层资源关闭后 join 读/等待 worker；worker 在通知退出回调前释放计数，保留同步自关闭能力。本轮三包全量 race、50 次生命周期压力、TerminalService 集成回归及 Windows `amd64` 测试二进制交叉编译均通过；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **91.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（隧道活动连接托管与停止边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TUNNEL-REL-509 | 当本地、远程或动态转发监听器关闭时，系统必须取消尚未完成的目标拨号，关闭全部已接收入站连接和已建立目标连接，并等待双向复制及连接 handler 全部退出后才允许 `Close` 返回；停止后不得继续传输历史连接数据。 | done |
| TUNNEL-CONC-510 | 当监听器关闭与 Accept、连接登记、handler 启动或 accept-exit 回调并发时，系统必须在同一关闭屏障内禁止新的 WaitGroup Add，幂等关闭受管连接，并允许 accept-exit 回调同步再次调用 `Close`，不得出现 Add/Wait 竞态或 accept goroutine 自锁。 | done |
| QA-BE-511 | 隧道连接生命周期回归必须覆盖本地、远程和动态转发活动连接立即断开、Close 等待阻塞 handler、拨号 context 取消、回调重入关闭、TCP half-close 响应保留及 SSH 测试服务 half-close，并通过 SSH/Tunnel race、lint、覆盖率和完整 CI 对齐门禁。 | done |

本波次修复前，`StartLocalForward`、`StartRemoteForward` 与 `StartDynamicForward` 返回原始 listener；关闭 listener 只能终止 Accept loop，已接收连接、目标拨号和双向复制 goroutine 不受托管，`TunnelService.Stop` 可在旧连接仍传输或等待十秒拨号超时期间返回。修复后受管 listener 在关闭屏障内跟踪连接与 handler，取消上下文同时覆盖目标拨号和双向复制，关闭全部活动流并 join handler；连接包装继续透传 `CloseWrite`，保留请求 half-close 后读取响应的能力。`goimports-reviser v3.12.6` 已应用于本波次 Go 文件；SSH 全量 race、服务层 Tunnel race 与 `golangci-lint v2.12.2` 均通过；`wails3 task ci` EXIT 0，Go race coverpkg total **91.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（终端退出回调与停机代际门禁）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TERM-REL-512 | 当 SSH PTY、本地 Shell 或串口发生自主退出时，终端服务必须把状态摘除、录制停止、串口释放、SSH 断连、事件发送和日志尾部视为同一个受管退出回调；永久 Shutdown 与临时 CloseAll 必须等待已经进入的回调完整结束。 | done |
| TERM-CONC-513 | 当终端退出与 Shutdown、CloseAll 或 LRU 清理并发时，系统必须先封闭退出回调接入并等待已进入回调，再基于稳定终端快照执行关闭；WaitGroup Add 与 Wait 必须由同一门禁串行化，不得返回“terminal not found”竞态错误。 | done |
| TERM-REL-514 | 当临时 CloseAll 完成后，系统必须恢复退出回调能力并推进代际编号；旧代际迟到回调不得删除、断连或发送属于后续终端实例的状态，永久 Shutdown 后则不得重新放行。 | done |
| QA-BE-515 | 终端退出生命周期回归必须覆盖 Shutdown 等待阻塞 close handler、临时关闭后新终端退出、旧代际迟到回调隔离、50 次退出与 CloseAll race 压力、同步退出型 PTY 和应用关库顺序，并通过 Terminal/Service/App race、lint、覆盖率和完整 CI 对齐门禁。 | done |

本波次修复前，底层会话 worker 为避免回调同步调用自身 `Close` 而在退出回调前释放自己的 WaitGroup；但 `TerminalService` 没有接管回调生命周期。远端退出一旦先从 `ptys` 摘除，Shutdown 快照即可漏过该终端并在录制停止、SSH 断连和事件发送仍阻塞时返回。修复后终端服务使用独立的退出回调代际门禁：回调进入与停机 Wait 在同一锁内串行，停机先失效旧代际并等待已进入回调，再关闭稳定快照；临时 CloseAll 仅重新开放新代际。定向回归、50 次 race 压力及 `internal/service`、`internal/app` 全量 race 通过；`golangci-lint v2.12.2` 为 0 issues；`wails3 task ci` EXIT 0，Go race coverpkg total **91.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（终端 pending 输出定时器收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TERM-REL-516 | 当远端终端在前端 Attach 前退出并保留 pending 输出时，临时 CloseAll 与永久 Shutdown 必须把 detached buffer 视为待关闭终端，立即释放最多 1 MiB 缓冲并发出关闭事件；不得等待一分钟 TTL 后才清理。 | done |
| TERM-CONC-517 | 当 pending 输出 TTL 回调已经开始或与 Attach、Close、CloseAll、Shutdown 并发时，系统必须取消尚未开始的 timer，并等待已开始的回调完成；停机返回后不得仍有回调持有 TerminalService 或重建输出状态。 | done |
| TERM-CONC-518 | 当终端输出 pause lease 与终端关闭并发时，关闭必须停止 timer、唤醒等待中的 PTY 输出，并使迟到 expiry 回调保持 no-op；不得重新打开已关闭 flow。 | done |
| QA-BE-519 | pending 输出生命周期回归必须覆盖 CloseAll 清理 detached buffer、Shutdown 停止 timer、Shutdown 等待已开始 callback、TTL 正常过期及 pause timer 迟到回调，并通过终端定向、Service 全量 race、lint 与完整 CI 对齐门禁。 | done |

本波次修复前，CloseAll/Shutdown 的快照只遍历活动 `ptys`；已经自主退出但仍等待前端 Attach 的终端最多保留 1 MiB 输出和一分钟 `time.AfterFunc`，停机返回后 timer 仍持有整个服务实例。修复后 pending buffer 与活动 PTY 共同进入关闭快照，expiry timer 具备可取消、可等待的完成屏障；Attach、单终端 Close、临时 CloseAll 与永久 Shutdown 均在返回前收口对应 timer。`terminalOutputFlow` 的 pause timer 经复核只访问 flow 局部状态，关闭后迟到回调由 `closed` 门禁安全拒绝。完整 `wails3 task ci` EXIT 0：`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **91.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit **0 vulnerabilities**、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（会话删除清理错误与迟到注册门禁）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SESSION-REL-520 | 当删除或批量删除会话时，活动终端 PTY、远端退出后仍保留的 pending 输出、运行中隧道和残余 SSH 连接必须全部清理；清理错误必须执行后聚合返回，任一关键资源关闭失败时必须保留会话数据库行，不得把部分清理误报为删除成功。 | done |
| SESSION-CONC-521 | 当会话删除与 SSH 连接建立并发时，系统必须先建立按会话引用计数的删除门禁，再取消既有 attempt；删除期间的新连接必须拒绝，删除前启动但迟到完成的连接必须因代际变化被拒绝并同步关闭客户端。 | done |
| TERM-CONC-522 | 当会话删除与终端打开并发时，终端打开必须捕获会话代际；删除期间不得接受新打开，删除前启动但在快照后迟到的 PTY 注册必须被拒绝，并聚合关闭 PTY 与 SSH 连接的清理错误。 | done |
| QA-BE-523 | 会话删除生命周期回归必须覆盖 PTY 关闭失败保留数据库行、残余 SSH 关闭失败保留数据库行、detached pending 输出立即清理、新连接阻断、迟到连接与迟到终端注册拒绝、嵌套删除门禁引用计数，并通过 service 全量、定向 race、lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，`SessionTerminalCloser.CloseForSessions` 与 `DisconnectForSessions` 均无错误返回，删除准备阶段即使 PTY 或 SSH client 关闭失败仍会继续删除数据库行；远端已退出但仍保留 pending 输出的终端还会丢失会话归属，只能等待 TTL；同时删除只取消当时已登记的连接 attempt，没有阻止新连接，也没有拒绝取消后迟到完成的连接或 PTY 注册。修复后删除先建立 Session、Terminal 与 Tunnel 三层门禁，再执行全部资源清理并用 `errors.Join` 聚合失败；detached buffer 保留独立会话归属并纳入按会话关闭；Session 与 Terminal 分别使用按会话引用计数的代际状态，使删除窗口内的新操作和删除前启动的迟到注册稳定失败，拒绝后的底层资源同步收口。`goimports-reviser v3.12.6` 检查通过；`golangci-lint v2.12.2` 为 0 issues；service 全量及删除生命周期定向 race 通过；`wails3 task ci` 完整通过，Go race coverpkg total **91.0%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1247** 个用例、npm audit **0 vulnerabilities**、bundle budget、TypeScript 与生产构建全部通过。

## 2026-07-27 商用硬化波次（设置草稿与自动保存竞态收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UI-DATA-524 | 当设置草稿仍有未保存修改且后端权威配置发生变化时，界面必须按草稿 revision 记录待应用 source；只有对应草稿成功保存后才能应用该权威回显，旧保存响应、旧排队请求和较早 source 不得覆盖用户后续输入。 | done |
| UI-CONC-525 | 当 AI Provider 保存/删除/检测、云同步连接测试/同步操作或快捷键恢复默认与配置自动保存重叠时，非保存操作必须暂停对应自动保存队列并在结束后续写最新草稿；默认/回退 Provider 引用必须与删除结果原子收敛，单次用户操作不得重复落库。 | done |
| UI-SEC-526 | 当代理密码、Gist/WebDAV/S3 凭据或 AI 搜索 API Key 保存成功时，前端必须立即清除输入框和内存草稿中的明文，并更新保存基线；权威回显不得触发第二次密文写入，也不得把已保存秘密重新填回界面。 | done |
| UI-REL-527 | 当用户首次打开设置分类时，面板必须按需挂载；访问后的面板在分类切换期间必须保持挂载，使隐藏面板继续完成自动保存，并在保存失败后保留草稿与错误状态。页面隐藏、销毁或 owner 卸载时必须在事件返回前启动最新草稿保存。 | done |
| QA-FE-528 | 前端回归必须覆盖最新值合并、基线回退、过期失败隔离、权威 source 延迟应用、敏感字段清理、AI/同步操作暂停、快捷键单写、未访问面板懒挂载、访问后保活、切页失败恢复及 `pagehide` 同步启动保存，并通过 TypeScript、源码限制、全量测试、bundle budget 与完整 `wails3 task ci`。 | done |

本波次修复前，多个设置面板各自通过 debounce 保存，但缺少统一的保存代际：较早请求完成后可能覆盖更新草稿，dirty 期间到达的后端权威 source 会被永久忽略，Provider 或同步操作还会与自动保存抢占同一控制器请求。敏感凭据保存成功后也可能继续留在 React 草稿中并被后续回显再次写入。设置外层 Tab 默认卸载非活动面板，切页保存失败时草稿和错误状态会同时销毁。修复后自动保存协调器只串行执行当前快照并合并最新排队值，草稿同步以 revision 保存待应用 source 与基线；AI、同步和快捷键操作共享暂停边界，敏感字段在成功确认后立即归零。设置分类采用“首次访问挂载、访问后保活”，退出钩子在 `pagehide` 和卸载处理期间同步进入保存调用。自动保存、草稿同步、AI、同步、快捷键和设置分类组合回归 **64/64** 通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **311** 个生产文件和 **510** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1262** 个用例、npm audit **0 vulnerabilities**、bundle budget、TypeScript 与生产构建全部通过。`coverage.out`、`coverage.func.txt`、`bin/mssh`、`frontend/dist` 与 `frontend/tsconfig.tsbuildinfo` 已清理，`git diff --check` 通过。

## 2026-07-27 商用硬化波次（设置窗口隐藏与敏感状态清理）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UI-SEC-529 | 当原生设置窗口关闭动作实际执行隐藏而非销毁时，安全页面必须立即清空应用密码创建与轮转表单、校验及操作错误，并关闭仍打开的密码轮转或主机指纹确认框；再次显示窗口不得恢复旧明文。 | done |
| AI-SEC-530 | 当设置窗口隐藏时，AI Provider 编辑器必须丢弃未保存名称、端点、模型和 API Key，恢复当前已持久化 Provider 或空白新增表单，并使隐藏前启动的保存或删除目标代际失效；迟到响应不得复活旧草稿或执行陈旧删除。 | done |
| UI-REL-531 | 当设置窗口隐藏事件到达时，所有待保存设置必须在事件返回前启动最新草稿保存；设置窗口 VaultGate 必须清空密码、确认密码、恢复模式和陈旧错误并作废在途敏感操作，但不得作废仍在加载的安全状态请求，也不得影响主窗口 VaultGate。 | done |
| QA-FE-532 | 前端回归必须覆盖安全表单与确认框清理、Provider 草稿/API Key 恢复、Provider 迟到保存隔离、设置窗口 VaultGate opt-in 边界、主窗口不受影响、Vault 状态加载保留、迟到操作失败隔离、原生隐藏自动保存，以及快捷键 fake timer 的稳定 React 更新边界。 | done |

本波次修复前，设置窗口关闭会由后端拦截并执行 `Hide()`，访问后的设置面板又会持续保活，因此 SecurityPanel 的当前/新密码、AI Provider API Key 与未保存草稿、以及设置窗口 VaultGate 的初始化或解锁密码都会跨“关闭后重开”继续驻留。浏览器 `pagehide` 也不能稳定代表 Wails 原生窗口隐藏，短 debounce 保存只能依赖后台计时器。修复后统一的 `useSettingsWindowHide` 生命周期钩子消费 `settings:preview-cancelled`：安全页清理瞬态表单并关闭确认框，Provider 编辑器恢复持久化快照并推进目标代际，只有设置窗口 VaultGate 开启密码清理和操作失效，主窗口保持原行为；自动保存则在原生隐藏回调内立即进入协调器。定向安全与自动保存回归 **53/53** 通过；完整前端门禁验证 **312** 个生产文件和 **511** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1270** 个用例、bundle budget、TypeScript 与生产构建全部通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**。

## 2026-07-27 商用硬化波次（设置窗口剩余敏感草稿收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UI-SEC-533 | 当原生设置窗口隐藏时，通用设置中的应用网络代理密码和 AI 设置中的搜索 API Key 必须立即从输入框及 React 草稿中清除；若隐藏前保存已经开始或排队，持久化请求仍必须携带隐藏前的原始凭据，成功后不得追加空凭据写入。 | done |
| SYNC-SEC-534 | 当设置窗口隐藏时，Gist Token、WebDAV 密码、S3 Secret Access Key 及对应清除标志必须立即归零；三类凭据输入必须始终使用密码遮罩，不得存在不可达或未受测试保护的明文显示状态。 | done |
| KEY-SEC-535 | 当设置窗口隐藏时，密钥管理必须关闭生成、导入和私钥材料弹框，清除生成密码、导入密码、私钥正文及已加载材料，并推进读取与影响分析代际；隐藏前启动的迟到读取或分析结果不得重新打开弹框或恢复私钥数据。 | done |
| UI-DATA-536 | 当敏感草稿因窗口隐藏而脱敏时，自动保存协调器必须把脱敏序列注册为当前 active 或 pending 请求的成功别名；请求成功后脱敏草稿视为已保存，请求失败后脱敏草稿仍保持未保存并允许后续重试，不得因清空 UI 而丢失失败状态。 | done |
| QA-FE-537 | 回归必须覆盖 active、pending、失败重试三类自动保存脱敏，代理、AI 搜索、Gist、WebDAV、S3 凭据隐藏清理，三类同步输入持续遮罩，私钥导入与材料弹框清理、迟到材料读取和影响分析隔离，并通过源码限制、全量测试、npm audit、TypeScript、生产构建及完整 CI 对齐门禁。 | done |

本波次修复前，代理密码、AI 搜索 API Key、三类云同步凭据以及密钥管理中的生成/导入密码和私钥材料仍会因设置面板保活而跨窗口隐藏驻留。直接清空自动保存草稿还会与已启动请求形成语义冲突：成功后可能再写一次空凭据，失败后也可能错误地把已脱敏草稿视为已保存。修复后自动保存协调器支持为 active/pending 快照登记脱敏成功别名，隐藏时 UI 立即清除明文，但原保存请求继续使用不可变快照；成功只推进一次保存基线，失败仍保留可重试状态。同步凭据固定为密码输入，密钥管理关闭全部敏感弹框并隔离迟到异步结果。相关定向回归 **5** 个测试文件 / **81** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **312** 个生产文件和 **511** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1282** 个用例、npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（设置窗口瞬态交互与迟到选择收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| UI-REL-538 | 当原生设置窗口隐藏时，快捷键设置必须立即退出录制模式并移除捕获阶段的 `keydown` 监听；再次显示时不得保持“按下组合键”状态，也不得因隐藏期间的键盘事件修改绑定或触发保存。 | done |
| UI-REL-539 | 当原生设置窗口隐藏时，云同步的本地重置确认、版本恢复/删除确认和终端主题内置重置确认必须关闭；尚未确认的动作不得在窗口重开后自动执行，已经确认且正在进行的后端操作仍必须正常收尾。 | done |
| UI-CONC-540 | 当日志目录或 iTerm2 主题原生文件选择器仍在等待结果时窗口隐藏，迟到的路径结果必须被当前窗口代际拒绝，不得改写草稿、触发自动保存或启动陈旧主题导入；每个选择器同一时刻最多允许一个请求。 | done |
| UI-DATA-541 | 当设置窗口隐藏时，主题管理器必须丢弃未提交的行内重命名草稿并恢复权威名称；外部 Profile 名称变化后再次编辑必须从最新权威名称开始，不得复用旧行状态。 | done |
| QA-FE-542 | 回归必须覆盖快捷键录制取消、三类确认框关闭、日志/主题文件选择迟到结果隔离、单请求门禁、主题行草稿恢复和已确认操作收尾，并通过源码限制、全量测试、npm audit、TypeScript、bundle budget 与完整 `wails3 task ci`。 | done |

本波次修复前，设置窗口采用“首次访问后保活”，快捷键录制的捕获监听、破坏性确认框、主题行未提交名称和原生文件选择器请求都可能跨隐藏继续存在；文件选择结果还会在窗口重开后修改当前草稿，主题行外部更新后也可能继续使用旧名称。修复后所有相关入口消费 `settings:preview-cancelled`：录制立即停止，确认框关闭，主题管理使用窗口代际隔离迟到导入与操作反馈，并以 reset revision 重置行编辑状态；日志目录选择器增加单请求门禁和迟到结果拒绝。定向回归 **5** 个测试文件 / **55** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **312** 个生产文件和 **511** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1293** 个用例、npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（原生传输选择器单飞与窗口代际）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SFTP-CONC-543 | 当 SFTP 文件面板的上传文件选择、下载目标选择或传输任务创建仍在进行时，上传与下载入口必须共享单飞门禁并显示处理中状态；连续点击或交叉点击不得打开第二个原生选择器，也不得重复创建传输任务。 | done |
| SFTP-REL-544 | 当 SFTP 文件面板关闭、目标终端切换或组件销毁时，仍在等待的原生选择结果必须因面板代际变化而失效；迟到路径不得启动上传、下载或写入错误反馈，重新打开面板后必须能够发起新的独立请求。 | done |
| SYNC-CONC-545 | 当本地加密备份导出或导入正在选择文件时，两类动作必须共享单飞门禁；设置窗口隐藏只能使尚未确认的路径结果失效，不能在旧选择器返回前放行第二个原生请求。后端导入导出已经开始后，窗口隐藏不得释放门禁或启动并发传输，既有操作必须正常收尾。 | done |
| QA-FE-546 | 回归必须覆盖 SFTP 上传/下载交叉连点、处理中禁用、面板关闭后的迟到选择、重新打开后的新请求、备份导入导出互斥、隐藏后的陈旧路径拒绝和已确认传输继续收尾，并通过源码限制、全量前端测试、官方 npm audit、Go race 覆盖率及完整 `wails3 task ci`。 | done |

本波次修复前，SFTP 上传和下载分别直接调用原生文件对话框，快速连点可同时打开多个选择器并重复创建传输任务；本地加密备份导出与导入也只依赖外层按钮状态，Hook 本身没有跨动作单飞或设置窗口代际，隐藏后返回的旧路径仍可启动导入导出。修复后 SFTP 文件面板以共享请求租约串行上传、下载和任务创建，并把 pending 状态传递到操作栏；面板身份变化或卸载会使旧选择结果失效。备份导入导出使用同一运行时门禁，选择阶段绑定设置窗口代际，已确认的后端传输则保留租约直到完成。新增 **5** 条回归后，前端 **196** 个测试文件 / **1298** 个用例全部通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **312** 个生产文件和 **511** 个 TypeScript 源文件均满足限制，官方 npm audit 为 **0 vulnerabilities**，bundle budget、TypeScript 与 Wails 生产构建全部通过。`coverage.out`、`coverage.func.txt`、`bin/mssh`、`frontend/dist` 与 `frontend/tsconfig.tsbuildinfo` 已清理。

## 2026-07-27 商用硬化波次（会话资产移动单飞与处理中反馈）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SESSION-CONC-547 | 当同一会话的移动请求尚未完成时，所有其他目标分组必须共享按会话维度的单飞门禁；连续选择不同目标不得并发调用后端，也不得因响应乱序让旧目标覆盖用户后续意图。不同会话的移动不得被全局串行化。 | done |
| UI-REL-548 | 当会话移动正在进行时，资产表必须把该会话的移动入口和全部目标显示为处理中并禁用；请求成功或失败后必须恢复入口，失败信息由资产中心统一展示，其他编辑、连接和删除动作保持可用。 | done |
| QA-FE-549 | 回归必须覆盖同一会话跨目标连点、处理中禁用、完成后恢复和移动失败可见，并通过会话资产定向测试、源码限制、全量前端测试、npm audit、Go race 覆盖率及完整 `wails3 task ci`。 | done |

本波次修复前，资产中心的动作门禁把移动键定义为“会话 + 目标分组”，因此同一会话可同时向两个不同分组发起请求；底层按响应完成顺序更新本地状态，旧请求迟到时可能覆盖用户后一次选择。修复后移动门禁按会话标识串行化，并把 pending 会话集合传递给资产表，移动子菜单和目标项在请求期间显示“移动中”并禁用，完成后恢复。会话资产相关定向回归 **4** 个测试文件 / **38** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **312** 个生产文件和 **511** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1299** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（会话 CSV 跨实例传输租约）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| CSV-CONC-550 | 当会话 CSV 导入文件选择、导入预览、已确认导入、导出位置选择或后端导出仍在进行时，导入与导出必须共享应用级单飞租约；任何入口、快速连点或重新挂载的资产页都不得打开第二个原生选择器或启动并发 CSV 传输。 | done |
| CSV-REL-551 | 当资产页在原生选择器或已确认导入期间卸载时，组件生命周期必须只作废迟到结果和界面反馈，不得提前释放全局租约；旧选择器返回的路径不得触发导出，已开始的后端导入必须正常收尾并在结束后放行新操作。 | done |
| QA-FE-552 | 回归必须覆盖导入/导出共享禁用、导出选择器跨卸载持有租约、旧路径隔离和已确认导入跨卸载收尾，并通过会话资产定向测试、源码限制、全量前端测试、npm audit、Go race 覆盖率及完整 `wails3 task ci`。 | done |

本波次修复前，CSV 导入与导出各自使用组件内 `pendingRef`；资产页卸载会立即清除此标志，但操作系统原生选择器并未结束，重新进入资产页即可再打开第二个选择器。导入和导出之间也没有共享门禁，已确认导入在旧组件卸载后可与新实例操作重叠。修复后新增可订阅的模块级 CSV 传输租约，租约所有权独立于 React 组件生命周期并覆盖选择、预览和实际传输；资产页入口根据全局状态统一禁用，旧组件只负责隔离迟到结果，真正的异步操作结束后才释放租约。相关定向回归 **7** 个测试文件 / **50** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **313** 个生产文件和 **512** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1302** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（资产分类排序刷新代际）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| ASSET-CONC-553 | 当环境或项目排序请求仍在进行时，外部刷新、创建、编辑或同步导致可见分类列表变化，不得提前释放排序操作租约；新列表的全部排序入口必须继续禁用，直到旧后端请求真正结束后才能发起下一次排序。 | done |
| ASSET-REL-554 | 当排序请求对应的旧分类列表已被新数据替换时，旧成功或失败结果不得写入新列表的错误状态；操作完成后当前列表必须恢复可用，组件卸载后不得产生迟到状态写入。 | done |
| QA-FE-555 | 回归必须覆盖同一列表快速连点、刷新后继续持有排序租约、旧错误隔离和收尾恢复，并通过分类管理定向测试、源码限制、全量前端测试、npm audit、Go race 覆盖率及完整 `wails3 task ci`。 | done |

本波次修复前，分类表使用同一个 `requestID` 同时表示可见列表代际和在途排序操作；`items` 变化的 effect 会直接把 `reorderActive` 清零并恢复按钮，因此旧请求尚未返回时，新列表即可启动第二个排序，响应乱序后可能让旧顺序覆盖新意图。修复后视图 generation 只负责拒绝旧错误和旧反馈，operation ID 与 active 租约则保持到真实请求结束；外部刷新时新列表继承处理中状态，旧请求收尾后统一恢复。分类管理定向回归 **4** 个测试文件 / **33** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **313** 个生产文件和 **512** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1303** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（批量操作部分成功选择收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| BATCH-DATA-556 | 当批量连接、宏执行或删除返回混合成功与失败结果时，系统必须只从当前选择集中移除成功会话；失败会话必须继续保持选中，以便用户查看结果并重试，不能因批量操作结束而清空全部选择。 | done |
| BATCH-CONC-557 | 当批量操作确认框已经打开或请求正在执行时，执行目标必须固定为打开确认时的原始会话快照；后续选择变化、重复确认或迟到响应不得改变本次后端调用的目标，也不得触发第二次调用。 | done |
| QA-FE-558 | 回归必须覆盖部分成功选择保留、原始选择快照、重复确认单飞、手动清除选择及资产中心复选框状态，并通过批量操作定向测试、源码限制、全量前端测试、npm audit、Go race 覆盖率及完整 `wails3 task ci`。 | done |

本波次修复前，批量动作完成回调没有携带结果，资产中心只能无条件清空全部选择；混合结果下失败会话因此丢失重试入口。修复后批量执行根据结果生成成功会话 ID 集合，资产中心按集合增量移除选择；确认阶段继续使用不可变的原始会话快照，执行租约拒绝重复确认，手动“清除选择”按钮也显式传递当前选择以避免 DOM 事件与业务回调签名混用。批量操作与资产中心定向回归 **2** 个测试文件 / **12** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **313** 个生产文件和 **512** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1303** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（会话删除目标租约与影响反馈）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SESSION-CONC-559 | 当单会话或分组删除已经提交且后端请求尚未结束时，删除目标必须被操作租约锁定；外部事件、底层列表交互或异常重渲染不得切换到第二个目标、提前恢复确认按钮或启动并发破坏性操作。 | done |
| UI-DATA-560 | 当删除确认从一个会话目标切换到另一个目标时，旧目标的关联隧道、历史、录制和传输统计必须立即清空，迟到结果不得写入新目标；当影响分析失败时，界面必须明确声明影响范围未知且仍可继续删除，不得永久显示“正在分析”。 | done |
| QA-FE-561 | 回归必须覆盖删除目标租约、重复确认拒绝、目标变化后的旧失败隔离、旧影响数据清空、影响分析失败说明及操作结束后恢复，并通过会话资产与 i18n 定向测试、源码限制、全量前端测试、npm audit、Go race 覆盖率及完整 `wails3 task ci`。 | done |

本波次修复前，删除影响加载 effect 同时修改删除请求编号、活动标志和 pending 状态；目标变化会立即释放正在执行的删除租约，使第二个会话或分组可以在旧请求结束前并发删除。会话目标切换时旧影响统计也会继续显示，分析失败后描述仍永久停留在“正在分析”。修复后影响请求代际只管理展示数据，删除请求拥有独立且持续到 Promise 真正结束的操作租约；资产中心在活动删除期间拒绝新目标，旧请求只能释放自己的租约，不能写入新目标错误。目标变化立即清空旧统计，失败状态明确提示影响范围未知。会话资产与 i18n 扩展回归 **6** 个测试文件 / **38** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **313** 个生产文件和 **512** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1304** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（资产分类弹框操作租约与恢复）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| ASSET-CONC-562 | 当环境、项目或标签正在保存或删除时，目标变化、重复点击、Escape、遮罩关闭或外部重渲染不得释放 mutation 租约、启动第二次写操作或让旧结果关闭新的目标；租约只能在原 Promise 真正结束后释放。 | done |
| ASSET-REL-563 | 当分类保存或删除成功时，内部成功路径必须关闭对应弹框；用户在操作进行中请求关闭时必须被拒绝。保存期间名称、代号、描述和颜色输入必须禁用，删除期间关联处理方式与迁移目标必须禁用。 | done |
| ASSET-DATA-564 | 当分类删除影响分析失败时，界面必须明确提示失败、隐藏带有虚假 0 会话数量的确认文案并提供原位重试；重试期间不得重复请求，成功后必须恢复真实关联数量与删除确认能力。删除执行失败不得误判为影响分析失败，必须保留真实统计和原删除重试入口。 | done |
| QA-FE-565 | 回归必须覆盖保存关闭拦截、保存目标变化单飞、删除成功自动关闭、删除目标变化单飞、影响分析失败重试及 i18n，并通过分类管理定向测试、源码限制、全量前端测试、npm audit、Go race 覆盖率及完整 `wails3 task ci`。 | done |

本波次修复前，分类编辑器和删除框都在目标变化时递增 mutation 请求编号并清空活动标志，因此旧请求未完成时新目标会立即恢复可操作；分类删除的内部成功关闭又会被“执行中禁止关闭”守卫拦截，导致已删除目标仍停留在弹框中。影响分析失败后确认按钮永久禁用，只能关闭重开，并显示“确认处理 0 个会话”的误导文案。修复后目标代际只隔离展示结果，最新请求编号独立维持保存与删除租约；用户关闭与内部成功关闭通过显式权限区分，只有成功路径可以强制收口。表单与迁移配置在操作期间锁定，影响分析提供单飞重试并在成功后恢复真实计数；删除执行错误则继续显示真实关联数量和原确认入口，不会被误标为分析失败。分类弹框、分类管理与 i18n 定向回归 **4** 个测试文件 / **27** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **313** 个生产文件和 **512** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1305** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（会话编辑与嵌套快速创建租约）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SESSION-CONC-566 | 当会话新增或编辑请求已经提交且后端 Promise 尚未结束时，弹框目标变化、外部重渲染、重复提交、Escape、遮罩或右上角关闭不得释放保存租约或启动第二次写操作；旧结果不得写入或关闭后续目标。 | done |
| SESSION-REL-567 | 当会话保存进行中时，全部表单字段和用户关闭入口必须锁定，主操作必须持续显示保存中状态；保存成功后仅内部成功路径可以关闭弹框，失败时必须保留当前目标和错误以便修正重试。切换到新会话目标时必须刷新全部字段，不得残留旧目标数据。 | done |
| ASSET-CONC-568 | 当会话编辑器内的环境、项目或标签快速创建请求正在进行时，创建目标、名称、项目代号和颜色必须保持锁定，Escape、遮罩、取消或右上角关闭不得提前释放创建租约；请求完成后只能把结果应用到原创建目标并关闭对应弹框。 | done |
| QA-FE-569 | 回归必须覆盖会话目标变化后的字段刷新、保存租约跨目标变化持续、保存中重复提交和关闭拒绝、快速创建单飞与成功选择，并通过会话弹框、资产字段、资产中心、侧栏行为及 i18n 定向测试、源码限制、全量前端测试、npm audit、Go race 覆盖率及完整 `wails3 task ci`。 | done |

本波次修复前，会话编辑器在 `open` 或 `sessionID` 变化时直接清空保存活动标志和请求编号，旧保存尚未结束即可恢复按钮并启动第二次提交；保存期间表单仍可编辑，也可通过 Escape、遮罩或关闭按钮退出。目标切换时部分字段不会重置，可能把旧会话数据带入新目标。嵌套快速创建弹框同样在创建类型变化或关闭时提前释放活动请求，允许旧创建与新目标并发。修复后生命周期、目标 generation 与操作 request ID 分离：generation 只隔离迟到结果，活动租约持续到原 Promise 真正结束；用户关闭在操作期间统一拒绝，成功路径通过显式内部权限收口。会话字段按目标完整刷新，保存与快速创建期间所有可变输入均锁定。扩展定向回归 **6** 个测试文件 / **50** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **313** 个生产文件和 **512** 个 TypeScript 源文件均满足限制，前端 **196** 个测试文件 / **1305** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（批量资产与隧道操作租约）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| BATCH-CONC-570 | 当批量环境、项目或标签更新已经提交且原 Promise 尚未结束时，选择集变化、目标类型变化、外部重渲染或重复确认不得释放事务租约或启动第二次更新；旧结果不得清空、关闭或提示后续选择集。 | done |
| BATCH-REL-571 | 当批量资产事务进行中时，目标选择、标签操作、标签集合、取消、Escape、遮罩和右上角关闭必须锁定，界面必须持续显示处理中状态；旧事务结束后新选择集才可恢复操作。 | done |
| TUNNEL-CONC-572 | 当隧道新增、启动、停止或删除确认已经开始时，会话目标变化、窗口开关变化、重复点击或其他隧道 mutation 不得提前释放对应操作租约；同一管理窗口内的 mutation 必须单飞，迟到结果不得重置或写入新会话目标。 | done |
| TUNNEL-REL-573 | 当任一隧道 mutation 进行中时，新增表单、列表操作、删除、重试、用户取消和窗口关闭入口必须锁定并隐藏右上角关闭按钮；新增成功后仅内部成功路径可以重置表单，失败时必须保留真实错误与重试入口。 | done |
| QA-FE-574 | 回归必须覆盖批量选择变化后的租约持续、旧结果隔离、隧道新增/列表动作/删除确认跨会话变化持续、用户关闭拒绝与内部成功重置，并通过资产中心、隧道 manager、侧栏行为及 i18n 定向测试、源码限制、全量前端测试、npm audit、Go race 覆盖率及完整 `wails3 task ci`。 | done |

本波次修复前，批量资产 hook 在 `kind` 或选择集变化时同时递增 operation request ID、清空 active 标志并恢复 pending，旧事务未完成即可对新选择再次提交。隧道控制器也在 `open` 或 `sessionId` 变化时统一清空新增、列表动作和删除确认的活动标志；新增期间还可通过表单取消或通用关闭按钮提前释放租约。修复后视图 generation 只负责隔离迟到结果，各 operation ID 与 active 标志保持到原 Promise 真正结束；`isLatest` 负责可靠收尾，`isCurrent` 只允许当前目标接收结果。批量字段和关闭入口在事务期间锁定；隧道 mutation 统一单飞，新增表单、列表按钮、删除、重试及窗口关闭均随 busy 状态锁定，新增成功使用显式内部权限重置。扩展定向回归 **8** 个测试文件 / **58** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **313** 个生产文件和 **513** 个 TypeScript 源文件均满足限制，前端 **197** 个测试文件 / **1308** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（文件、录制与历史破坏性操作租约）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SFTP-CONC-575 | 当远程目录创建、文件重命名或文件删除请求已经提交且原 Promise 尚未结束时，面板开关、目录变化、选中目标变化、重复提交或重新打开弹框不得释放 mutation 租约或启动第二次同类操作；迟到结果不得关闭、清空或写入新目录和新目标。 | done |
| SFTP-REL-576 | 当 SFTP mutation 进行中时，对应名称输入、确认、取消、Escape、遮罩、右上角关闭和新建文件夹切换入口必须锁定；文件弹框运行时必须在面板隐藏期间持续挂载，重新打开后继续显示真实 pending，直到原请求结束。 | done |
| RECORDING-CONC-577 | 当录制删除正在执行时，切换会话必须关闭旧确认框但继续持有删除租约；新会话的全部录制删除入口必须保持禁用，旧成功或失败不得修改新列表或展示旧错误，原 Promise 结束后才可恢复操作。 | done |
| HISTORY-CONC-578 | 当命令历史清空从确认阶段开始后，切换会话、重复点击或关闭面板不得释放清空租约；新会话清空按钮必须保持禁用，旧清空结果不得清空新会话列表或产生成功提示，原确认或后端 Promise 结束后才可恢复。 | done |
| QA-FE-579 | 回归必须覆盖目录和面板变化后的 mkdir 租约、重命名关闭拦截与稳定挂载、录制删除跨会话持续、历史清空跨会话持续，并通过文件传输、终端标签、录制、历史及 i18n 定向测试、源码限制、全量前端测试、npm audit、Go race 覆盖率及完整 `wails3 task ci`。 | done |

本波次修复前，文件面板在路径或开关变化时直接清空 mkdir active；重命名和删除弹框又随侧栏隐藏被卸载，新的弹框实例会丢失旧请求租约。录制删除和命令历史清空也在会话变化时递增 operation request 并清空 active，使新会话可在旧破坏性操作结束前再次提交。修复后各链路使用独立 request ID，并拆分 `isLatest` 与 `isCurrent`：目标 generation 只隔离迟到结果，最新请求负责最终释放 pending。文件弹框固定在稳定 React 节点持续挂载，隐藏面板仅隐藏界面而不销毁运行时；录制删除切换会话时关闭旧弹框但保持全局删除禁用；历史清空从确认阶段即进入 busy，并锁定关闭入口。扩展定向回归 **7** 个测试文件 / **62** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **313** 个生产文件和 **513** 个 TypeScript 源文件均满足限制，前端 **197** 个测试文件 / **1308** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（剩余前端操作租约与目标代际收口）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| MACRO-CONC-580 | 当快捷命令新增请求已经提交时，名称、命令、取消、顶部新增入口和确认按钮必须保持锁定；快速重复提交、关闭后重开或列表刷新不得启动第二次新增，原 Promise 结束后才可恢复操作。 | done |
| SFTP-CONC-581 | 当 SFTP 上传或下载原生选择器尚未返回时，切换活动终端不得释放共享选择器租约或打开第二个选择器；旧路径结果不得应用到新终端，真实请求结束后新终端才可发起独立选择。 | done |
| KEY-CONC-582 | 当密钥生成、导入文件选择、导入提交或材料编辑保存正在进行时，弹框目标变化、重复点击、Escape、遮罩、取消和右上角关闭不得释放操作租约或启动第二次请求；迟到结果不得关闭或改写后续目标。 | done |
| KEY-SEC-583 | 当密钥 mutation 进行中时，名称、算法、位数、密码、私钥正文和其他可变字段必须全部锁定，避免界面显示值与已提交不可变快照不一致；操作失败后必须恢复原草稿供用户修正重试。 | done |
| SYNC-CONC-584 | 当同步版本恢复或删除已经确认并执行时，历史列表刷新、设置窗口隐藏或确认框关闭不得释放版本操作租约；新列表的全部版本动作必须保持禁用，旧结果不得写入新的列表代次。 | done |
| THEME-CONC-585 | 当主题删除或内置主题重置已经执行时，设置窗口隐藏、绑定 Profile 变化或外部刷新不得释放 mutation 租约；未确认弹框可以关闭，已确认操作必须继续收尾，迟到结果不得提示或覆盖新目标。 | done |
| VAULT-CONC-586 | 当 Vault 恢复文件选择或导入正在进行时，设置窗口隐藏必须立即清空密码和恢复草稿，但不得释放原生选择器租约；恢复入口、应用密码和安全偏好字段必须保持锁定，迟到路径不得启动陈旧导入。 | done |
| SERIAL-CONC-587 | 当串口配置保存正在进行时，串口目标或窗口开关变化不得释放保存租约；全部字段、取消、Escape、遮罩和右上角关闭必须锁定，旧结果不得关闭新目标，原 Promise 结束后才可再次保存。 | done |
| TERM-CONC-588 | 当终端撰写面板正在向某一终端写入时，面板关闭并重新打开同一终端不得释放写入租约或重复发送；关闭入口和输入必须保持禁用。终端身份变化必须隔离旧结果，只有原终端写入成功且身份仍有效时才能记录命令。 | done |
| QA-FE-589 | 回归必须覆盖上述入口的快速连点、目标变化、窗口隐藏、关闭拦截、字段锁定、迟到结果隔离和真实请求收尾，并通过组合前端测试、源码限制、全量测试、npm audit、bundle budget、TypeScript、生产构建及完整 CI 对齐门禁。 | done |

本波次继续清理前端中“视图代次变化同时释放真实异步操作”的剩余链路。修复后目标 generation 只负责隔离旧结果，独立 request ID 与同步 active ref 持有真实操作租约，`isLatest` 负责最终恢复 busy，`isCurrent` 只允许当前目标接收成功、错误和关闭反馈。所有涉及秘密、可变连接参数或破坏性动作的表单和关闭入口在操作期间统一锁定；设置窗口隐藏只清理瞬态界面，不再取消已经确认的后端操作或尚未返回的原生选择器。组合回归 **10** 个测试文件 / **127** 个用例通过；完整 `wails3 task ci` 验证中 `golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **313** 个生产文件和 **513** 个 TypeScript 源文件均满足限制，前端 **197** 个测试文件 / **1313** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（导航保活与终端工具操作租约）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-CONC-590 | 当 AI Chat 请求尚未完成时，活动分屏变化不得清除真实发送租约或放行第二次模型请求；旧目标响应和自动执行必须被隔离，原请求结束后新目标才可发送。AI 面板关闭只能隐藏已访问面板，不得销毁在途请求、消息或操作状态。 | done |
| SERIAL-CONC-591 | 当串口 DTR、RTS 或 Break mutation 尚未完成时，切换活动串口终端不得释放 mutation 租约；新终端全部信号控制必须保持禁用，旧成功或失败不得覆盖新终端信号与错误，原 Promise 结束后才可恢复。 | done |
| UI-REL-592 | 当用户首次访问总览子页或 AI 工具面板后，页面必须在导航切换期间保持挂载并使用 `hidden`、`inert` 与 `aria-hidden` 隔离交互；未访问页面不得预加载，在途操作、草稿和局部状态不得因切页销毁。 | done |
| MACRO-CONC-593 | 当快捷命令删除从确认阶段开始后，切换到其他工作区或终端再返回不得释放删除租约、重新挂载列表或重复调用后端；全部删除入口必须显式禁用，取消、失败或真实删除结束后才可恢复。 | done |
| QA-FE-594 | 回归必须覆盖 AI 请求跨分屏与隐藏持续、串口信号跨终端持续、AI/总览/宏页面首次访问懒挂载与访问后保活、宏删除导航单飞和显式 busy，并通过组合前端测试、源码限制、全量测试、npm audit、bundle budget、TypeScript、生产构建及完整 CI 对齐门禁。 | done |

本波次修复前，AI 面板和串口信号工具栏都在终端身份变化时递增操作请求号并清空 pending，旧请求仍在后端运行时新终端已可再次提交；AI 工具面板、宏工作区和总览子页还会随导航条件直接卸载，使组件内操作租约、确认状态和草稿全部丢失。修复后 AI 与串口信号操作均拆分当前目标判定和最新请求收尾，旧结果只能被拒绝，真实 Promise 才能释放 busy。工作区和总览采用首次访问挂载、访问后保活，隐藏层使用原生可访问性属性隔离且不会预加载未访问页面；快捷命令删除从确认开始统一锁定全部删除入口。跨波次组合回归 **15** 个测试文件 / **174** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **314** 个生产文件和 **514** 个 TypeScript 源文件均满足限制，前端 **197** 个测试文件 / **1319** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（主机指纹拒绝恢复与传输任务单飞）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SSH-SEC-595 | 当主机指纹信任、拒绝或关闭请求失败时，提示框必须保持可见并恢复可操作状态，展示真实错误且继续绑定原连接尝试；拒绝与取消都失败时不得静默关闭、遗失待决连接或隐式接受主机指纹。 | done |
| SFTP-CONC-596 | 当传输中心正在取消或重试某一任务时，该任务的取消、重试和移除入口必须共享按任务维度的单飞租约与处理中反馈；快速重复点击不得重复调用后端，不同任务仍可并发操作。传输记录恢复必须独立单飞，旧请求结束前不得重复加载。 | done |
| QA-FE-597 | 回归必须覆盖主机指纹关闭失败后的原目标保留、错误恢复与再次拒绝能力，传输取消/重试快速连点、不同任务并发、恢复请求单飞和按钮 busy 状态，并通过 Host Key、事件桥、状态栏与传输中心组合测试及完整 CI 对齐门禁。 | done |

本波次修复前，主机指纹提示在后端拒绝和取消均失败时仍会无条件清空全局对话框，用户失去对待决连接的控制权；传输中心取消、重试和记录恢复也只处理错误代际，没有真实操作租约，快速连点会重复调用后端，其中重复重试可能创建多个替代传输。修复后主机指纹关闭仅在 fail-closed 请求成功后收口，失败时保留原 prompt、清除 pending 并展示错误；传输中心以任务 ID 持有 mutation 租约，同一任务全部操作入口统一禁用并显示旋转状态，不同任务保持并行，记录恢复使用独立租约。组合回归 **6** 个测试文件 / **32** 个用例通过；完整 `wails3 task ci` 验证要求 `golangci-lint v2.12.2` 0 issues、Go race coverpkg total 不低于 **90%**、前端源码限制、全量测试、npm audit、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（终端录制与密钥行操作租约）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TERM-CONC-598 | 当终端录制启动或停止请求尚未结束时，活动分屏变化不得释放录制操作租约或允许第二次请求；录制入口必须持续禁用并显示处理中状态。迟到结果只能更新仍存在的原终端，旧目标错误不得展示到当前分屏。 | done |
| KEY-CONC-599 | 当某一密钥正在加载材料、复制公钥或分析删除影响时，同一密钥行的查看、编辑、复制和删除入口必须共享单飞租约并统一禁用；设置窗口隐藏只能清理敏感展示，不得提前释放在途租约。不同密钥的迟到结果不得覆盖最新操作目标或重新打开已关闭弹框。 | done |
| QA-FE-600 | 回归必须覆盖录制请求快速连点、活动分屏变化后的 busy 持续与错误隔离，以及同一密钥行全操作锁定、窗口隐藏后的租约持续和迟到结果隔离，并通过组合前端测试、源码限制及完整 CI 对齐门禁。 | done |

本波次修复前，终端录制状态只依赖当前活动分屏的 store 状态；切换分屏后新目标可能恢复可点击，而原请求仍在执行。密钥管理也只对材料加载按钮做局部禁用，查看、编辑、复制和删除影响分析之间可以对同一密钥并发执行，设置窗口隐藏还可能让敏感请求丢失可见租约。修复后录制控制使用独立 operation busy 持续到真实 Promise 收尾，并将结果限定到原终端；密钥管理按密钥 ID 维护行级租约，同一行全部入口共享禁用状态，窗口隐藏只销毁敏感草稿和展示代次。组合回归 **5** 个测试文件 / **63** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **314** 个生产文件和 **514** 个 TypeScript 源文件均满足限制，前端 **197** 个测试文件 / **1325** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（设置草稿快照与主题行级租约）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| LOG-CONC-601 | 当日志目录原生选择器尚未返回时，日志路径输入必须锁定且已提交路径快照不得被界面修改；日志保留天数等不参与本次选择的设置仍可独立编辑。 | done |
| CSV-CONC-602 | 当 CSV 导出选择器或导入请求尚未结束时，导出范围、应用密码确认、来源模板、字段映射、默认值与冲突策略必须保持锁定；后端只能接收操作开始时的不可变草稿快照，快速重复点击不得启动第二次传输。 | done |
| THEME-CONC-603 | 当某一主题 Profile 正在重命名、复制或删除时，同一 Profile 的全部 mutation 必须共享行级租约并统一禁用，导入不得与该行 mutation 并发；不同 Profile 的非破坏性操作仍可独立并行。 | done |
| QA-FE-604 | 回归必须覆盖日志选择器期间路径锁定与无关字段可编辑、CSV 导入导出草稿锁定、同一主题行单飞和不同主题并行，并通过组合前端测试、源码限制及完整 CI 对齐门禁。 | done |

本波次修复前，日志目录选择器运行期间路径输入仍可编辑；CSV 导出与导入在原生选择器或后端请求进行时仍允许修改范围、密码、模板、字段映射和冲突策略，界面草稿可能与实际提交快照不一致。主题管理的重命名、复制和删除也只维护各自局部状态，同一 Profile 可以并发 mutation。修复后日志与 CSV 操作明确锁定参与本次请求的草稿，同时保留无关配置的可编辑性；主题管理按 Profile ID 持有共享行级租约，行操作期间阻止冲突导入和删除，不同 Profile 的安全操作仍可并行。组合回归 **3** 个测试文件 / **34** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **314** 个生产文件和 **514** 个 TypeScript 源文件均满足限制，前端 **197** 个测试文件 / **1329** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（AI 与云同步控制器共享操作租约）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-CONC-605 | 当任一 AI 设置操作已经获得控制器租约时，提供商保存、删除、测试、AI 配置保存与 Agent 检测不得并发调用第二个后端动作；被拒绝的重复 Agent 检测不得递增结果代次或吞掉首个有效检测结果。 | done |
| SYNC-CONC-606 | 当任一云同步控制器操作正在执行时，配置保存、连接测试、同步、推送、拉取、冲突处理、版本恢复、版本删除与本地数据重置不得并发调用第二个后端动作；当前 pending 必须持续到真实请求结束。 | done |
| AI-REL-607 | 当提供商保存、测试或删除确认正在进行时，同一编辑器的三个动作必须共享同步租约，快速交叉点击不得弹出无效确认或触发竞争动作；Agent 页面首次挂载遇到租约冲突时必须在全局操作结束后自动补跑，真实检测失败仍保留手动重试。 | done |
| QA-FE-608 | 回归必须覆盖 AI 与同步控制器同帧重入拒绝、首个 Agent 结果保留、Provider 动作互斥、Agent 首次检测等待与 busy 补跑、英文文案覆盖，并通过组合前端测试、源码限制及完整 CI 对齐门禁。 | done |

本波次修复前，AI 与 Cloud Sync 控制器仅通过递增 request ID 隔离迟到结果，却没有真实操作租约；同一渲染帧内的第二次调用仍会进入后端，并把首个请求标记为陈旧。AI Agent 的重复检测还会在未获得操作资格前递增检测代次，导致首个有效结果被丢弃。Provider 面板的保存与删除分别持有局部状态，交叉连点可能先弹出确认框再被控制器拒绝。修复后两类控制器在调用后端前同步获取共享租约，冲突调用返回类型化 busy 错误且不改变当前请求代次；Provider 保存、测试和删除共享面板级同步 ref，Agent 首次检测在其他 AI 操作结束后补跑，并仅对租约冲突自动重试。组合回归 **5** 个测试文件 / **34** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **315** 个生产文件和 **515** 个 TypeScript 源文件均满足限制，前端 **197** 个测试文件 / **1336** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（串口配置行级共享租约）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SERIAL-CONC-609 | 当某一串口配置正在连接、更新、复制、单项删除或批量删除时，同一配置的全部动作必须共享按配置 ID 的同步租约；同帧交叉点击不得调用第二个后端动作、打开编辑器或弹出删除确认。 | done |
| SERIAL-UX-610 | 当串口配置持有行级租约时，该行选择、连接、编辑、复制和删除入口必须统一禁用，包含该行的批量删除必须禁用；其他未冲突配置仍可执行安全的独立动作，不得退化为全局串行。 | done |
| QA-FE-611 | 回归必须覆盖连接期间复制、编辑和删除拒绝、重复连接与重复复制单飞、不同配置跨动作并行、串口弹框回归与英文文案覆盖，并通过源码限制及完整 CI 对齐门禁。 | done |

本波次修复前，串口中心分别用 `connectActive`、`duplicateActive` 和 `deleteActive` 管理动作；同一配置可在连接尚未完成时同时复制、打开编辑器并进入删除确认，批量删除也可能包含正在执行其他动作的配置。修复后运行时维护 `activeRows` 与可观察的 `pendingRows`，连接、已有配置更新、复制、单删和批删在调用后端前原子获取目标 ID 租约，并在真实 Promise 收尾后释放；表格整行操作与选择入口随租约禁用，批量删除检查选择集交集。不同 ID 的连接与复制仍可并行。组合回归 **3** 个测试文件 / **15** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **315** 个生产文件和 **515** 个 TypeScript 源文件均满足限制，前端 **197** 个测试文件 / **1338** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（资产分类域与宏双面板共享租约）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| ASSET-CONC-612 | 当资产分类的新建、编辑、删除或排序任一 mutation 正在执行时，同一分类管理器的全部写入口、分类标签切换和行操作菜单必须共享同步租约并统一禁用；同帧交叉点击不得进入第二个后端动作。外层资产标签切换不得卸载分类管理器或释放在途租约，返回分类页时必须继续显示真实 busy，直到原 Promise 收尾。 | done |
| MACRO-CONC-613 | 当宏列表刷新正在执行时，同帧重复刷新必须复用同一请求；删除确认若遇到在途刷新，必须先占用宏 mutation 租约、等待刷新收尾，再执行删除并刷新最新目录，旧读取结果不得恢复已删除宏。 | done |
| MACRO-CONC-614 | 当侧边栏宏面板或宏工作区正在创建或删除宏时，两个可见面板必须共享应用级同步租约；双方新增、删除和刷新入口必须统一禁用，跨面板快速点击不得调用第二个后端 mutation。成功 mutation 必须携带来源标识通知其他面板刷新，发起面板不得重复处理自己的同步事件，执行宏动作仍可独立并行。 | done |
| QA-FE-615 | 回归必须覆盖资产排序期间新建、编辑和删除阻断、外层资产标签切换后的租约持续、宏刷新同帧单飞、刷新后排队删除、共享 busy 状态、侧边栏与工作区跨面板删除单飞、来源事件隔离和英文文案，并通过源码限制、TypeScript 与生产构建。 | done |

本波次修复前，资产分类仅在各自弹框或排序按钮内部持有局部 pending，排序进行中仍可打开新建、编辑和删除入口；外层资产标签切换还会卸载分类管理器并释放本地租约。宏工作区的刷新按钮只依赖 React loading 状态，同一事件循环内可重复发起读取；侧边栏宏与宏工作区又分别维护删除锁，同一宏可从两个同时可见的面板重复删除。修复后资产分类管理器使用统一 mutation lease 包装新建、更新、删除和排序，并通过 `keepMounted` 在外层资产标签切换时保留运行时。宏加载维护真实 `loadTask`，删除在确认后立即获取应用级租约并等待在途刷新；新增和删除通过全局协调器共享 busy，快捷命令组件支持外部 mutation 禁用，成功操作使用来源 token 通知另一面板刷新。组合回归 **9** 个测试文件 / **75** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **316** 个生产文件和 **517** 个 TypeScript 源文件满足限制，前端 **198** 个测试文件 / **1346** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（隧道跨入口共享租约与目录同步）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TUNNEL-CONC-616 | 当总览隧道管理或任一终端工具栏正在创建、启动、停止或删除某会话的隧道时，同一会话的全部隧道写操作必须共享应用级同步租约；跨入口同帧操作不得进入第二个后端动作。不同会话的隧道操作仍必须允许独立并行。 | done |
| TUNNEL-UX-617 | 当其他入口持有当前会话的隧道租约时，隧道弹框的新建、启动、停止、删除和重试写入口必须统一禁用；该弹框没有本地操作时仍允许关闭，不得因另一个入口的后台操作把用户困在弹框中。 | done |
| TUNNEL-DATA-618 | 当任一隧道 mutation 成功时，除发起者外的同会话管理实例必须自动静默刷新；来源实例不得处理自己的同步事件，其他会话不得触发无关读取。 | done |
| QA-FE-619 | 回归必须覆盖同会话跨管理器互斥、不同会话并行、跨入口 busy 与关闭能力、来源和会话事件隔离、成功后目录刷新，并通过隧道入口组合测试、源码限制、TypeScript、生产构建及完整 CI 对齐门禁。 | done |

本波次修复前，总览页和每个终端工具栏各自创建独立 `useTunnelManager`，同一会话可以从多个入口并发启动、停止或删除隧道；创建出的新隧道和删除结果也不会主动同步到其他已挂载管理实例。修复后新增按会话分区的应用级 mutation coordinator，后端调用前同步获取租约，同会话冲突返回类型化 busy 错误，不同会话保持并行；成功操作携带来源标识广播目录变化，其他同会话管理器静默刷新。弹框订阅共享 busy 状态并禁用全部写入口，但只有本地操作才阻止关闭。组合回归 **7** 个测试文件 / **49** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **317** 个生产文件和 **519** 个 TypeScript 源文件满足限制，前端 **199** 个测试文件 / **1351** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（录制删除跨分屏租约与列表同步）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| RECORDING-CONC-620 | 当任一终端分屏正在删除某条录制时，所有其他分屏中的同一录制必须共享按录制 ID 的应用级同步租约；同帧重复确认不得调用第二次删除。不同录制仍必须允许独立并行。 | done |
| RECORDING-UX-621 | 当某条录制持有删除租约时，所有列表中的该录制播放与删除入口、已打开删除框的确认入口必须统一禁用；其他录制不得被外部租约无谓锁定，外部删除不得阻止用户关闭自己的确认框。 | done |
| RECORDING-DATA-622 | 当录制删除成功时，发起列表必须立即移除该记录，其他同会话录制列表必须自动重新加载；来源实例不得处理自己的同步事件，其他会话不得触发无关读取。 | done |
| QA-FE-623 | 回归必须覆盖同录制跨分屏互斥、不同录制并行、播放与删除禁用、成功后的同会话列表刷新、来源及会话事件隔离，并通过录制与终端工具栏组合测试、源码限制、TypeScript、生产构建及完整 CI 对齐门禁。 | done |

本波次修复前，每个终端工具栏中的录制列表独立维护删除 ref 和本地数组；同一会话的多个分屏可对同一录制重复提交删除，删除期间其他分屏仍可尝试播放正在移除的录制文件，成功后其余列表继续显示已删除记录。修复后新增按录制 ID 分区的应用级 mutation coordinator，删除前同步获取租约并向全部列表发布 busy 集合；同一录制的播放、删除和确认入口统一禁用，不同录制保持并行。成功删除携带来源标识广播会话录制目录变化，其他同会话列表自动刷新。组合回归 **5** 个测试文件 / **31** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **318** 个生产文件和 **521** 个 TypeScript 源文件满足限制，前端 **200** 个测试文件 / **1354** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（命令历史跨分屏租约与数据同步）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| HISTORY-CONC-624 | 当任一终端分屏正在清空某会话的命令历史时，同一会话的全部命令历史面板必须共享应用级同步租约；同帧重复确认不得调用第二次后端清空。不同会话仍必须允许独立并行。 | done |
| HISTORY-UX-625 | 当其他分屏持有当前会话的清空租约时，清空入口与已打开确认框的确认入口必须统一禁用；外部清空不得阻止用户关闭自己的命令历史面板或取消确认框。 | done |
| HISTORY-DATA-626 | 当命令远端持久化成功、本地历史写入或清空完成时，除发起者外的同会话面板必须重新读取权威历史；来源实例不得重复处理自己的事件，会话切换期间不得短暂显示上一会话历史。 | done |
| QA-FE-627 | 回归必须覆盖同会话跨分屏清空单飞、不同会话并行、外部 busy 与关闭能力、来源及会话事件隔离、写入和清空后的目录刷新，并通过源码限制、TypeScript、生产构建及完整 CI 对齐门禁。 | done |

本波次修复前，每个命令历史面板独立维护清空状态，多个分屏可对同一会话重复确认并发出重复清空；命令写入或清空后其他已打开面板不会自动刷新，切换会话时还可能在远端读取返回前短暂显示上一会话历史。修复后新增按会话分区的应用级 mutation coordinator，清空前同步获取租约并发布共享 busy；命令远端持久化成功、本地 bucket 写入和清空完成后广播变更，其他同会话面板重新读取权威历史，来源与其他会话事件保持隔离。定向回归 **6** 个测试文件 / **53** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **319** 个生产文件和 **523** 个 TypeScript 源文件满足限制，前端 **201** 个测试文件 / **1358** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（SFTP 跨分屏目录租约与结构同步）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SFTP-CONC-628 | 当任一 SFTP 面板正在删除、重命名或新建某远端目录中的条目时，同一会话、同一目录的文件 mutation 必须共享应用级同步租约；目录删除或重命名必须同时锁定其子树，不得与子目录 mutation 并发。不同会话或无层级重叠的目录仍必须允许独立并行。 | done |
| SFTP-UX-629 | 当当前目录或选中路径被其他面板的租约覆盖时，上传、新建、下载、重命名、删除、树展开与双击激活入口必须统一禁用；外部租约不得阻止关闭文件面板、取消本地确认框或执行只读刷新。 | done |
| SFTP-DATA-630 | 当远端删除、重命名或新建成功时，其他同会话面板必须刷新受影响目录并清除旧树缓存；位于已删除目录中的面板必须退回父目录，位于已重命名目录中的面板必须迁移到对应新路径，来源与其他会话事件必须隔离。 | done |
| QA-FE-631 | 回归必须覆盖同目录跨面板单飞、不同目录并行、目录子树冲突、传输启动阻断、列表与树视图 busy、外部取消能力、目录刷新、路径迁移/退出、POSIX 路径边界，并通过源码限制、TypeScript、生产构建及完整 CI 对齐门禁。 | done |

本波次修复前，每个终端分屏的 SFTP 面板独立维护文件 mutation 与目录缓存；同一目录可以重复删除或交叉执行删除、重命名、新建，其他分屏继续显示已删除条目和陈旧树节点，目录被删除或重命名后子目录面板仍停留在失效路径。修复后新增会话内目录级层级租约，目录 mutation 在后端调用前同步抢占父目录与可选子树范围，同目录串行而独立目录保持并行；成功操作广播结构化目录变更，其他面板按需刷新、清空树缓存，并对删除与重命名执行路径退出或迁移。定向回归 **6** 个测试文件 / **58** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **322** 个生产文件和 **528** 个 TypeScript 源文件满足限制，前端 **203** 个测试文件 / **1373** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（AI 对话跨分屏租约与消息同步）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-CONC-632 | 当任一 AI 面板正在向已有对话发送消息时，所有其他面板中的同一对话必须共享按对话 ID 的应用级同步租约；同帧重复发送不得调用第二次模型请求，不同已有对话和尚未取得 ID 的新对话仍必须允许独立并行。 | done |
| AI-DATA-633 | 当 AI Chat 成功时，其他同会话面板必须并行刷新对话目录与当前对话消息并分别应用可用结果；任一读取失败不得阻断另一读取。切换会话、终端或历史对话后，迟到的目录、消息、回答、错误和自动命令执行不得覆盖当前目标。 | done |
| AI-UX-634 | 当当前对话被其他面板占用时，发送入口必须显式禁用、展示占用原因并保留用户草稿；AI 面板隐藏不得卸载在途请求。目录或消息同步失败必须展示可本地化的真实错误，且不得用旧请求错误污染新目标。 | done |
| QA-FE-635 | 回归必须覆盖同对话跨面板单飞与 busy 说明、不同对话与新对话并行、目录失败时消息仍刷新、成功后的目录和消息同步、历史选择乱序、目标切换后的迟到回答隔离、自动执行取消、重复审批阻断、英文文案，并通过源码限制、TypeScript、生产构建及完整 CI 对齐门禁。 | done |

本波次修复前，每个 AI 终端面板只维护本地 pending；两个分屏打开同一历史对话时可以并发调用 Chat，成功回答也不会同步到另一面板。发送期间切换历史、会话或活动终端后，迟到的回答、目录读取或消息读取还可能覆盖新目标并触发旧终端的自动命令；背景同步又先读目录再读消息，目录失败会直接阻断当前对话刷新。修复后已有对话按 conversation ID 获取应用级同步租约，同帧重入在后端调用前被拒绝，新对话仍可独立创建；占用方在其他面板中显示明确原因。成功 Chat 携带会话、对话和来源标识广播变更，其他面板并行刷新目录与当前消息并独立应用成功结果。面板、目录、历史、发送和生命周期分别维护 generation/request 代次，旧结果、旧错误和自动执行只能被隔离。定向回归 **5** 个测试文件 / **32** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **325** 个生产文件和 **533** 个 TypeScript 源文件满足限制，前端 **205** 个测试文件 / **1379** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（AI 引用外链安全）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-SEC-636 | 当模型返回引用链接时，客户端只允许长度不超过 4096 字符、无用户名密码且具有有效主机名的绝对 `http/https` URL；`javascript`、`data`、`file`、`mailto`、相对地址、无效地址和超长地址必须在进入导航能力前被拒绝。 | done |
| AI-UX-637 | 当引用链接通过安全校验时，界面必须展示规范化 URL 的真实主机名，并通过系统默认浏览器打开规范化地址；打开期间必须阻止重复请求，打开失败必须在原引用下展示本地化错误。引用变化或组件卸载后，迟到失败不得污染新引用。被阻止的引用仍须展示标题和明确的安全策略说明，但不得提供可点击入口。 | done |
| QA-FE-638 | 回归必须覆盖 URL 规范化、危险协议与凭据拒绝、超长地址拒绝、系统浏览器调用、真实主机名展示、重复点击单飞、打开失败反馈和迟到错误隔离，并通过 i18n、源码限制、bundle budget、全量前端测试、TypeScript、生产构建及完整 CI 对齐门禁。 | done |

本波次修复前，AI 回答中的模型提供 URL 被直接写入带 `target="_blank"` 的原生链接，未限制协议、凭据或长度，也未确保导航离开应用 WebView；模型输出可触发不受控协议处理，标题还可能掩盖真实目标。修复后新增统一外链规范化边界，只有安全的绝对 HTTP(S) 地址可以进入 Wails 系统浏览器能力；引用行独立展示解析后的真实主机名，危险地址降级为不可点击状态。打开操作持有同步单飞租约，并以生命周期和请求代次隔离迟到结果。定向回归 **4** 个测试文件 / **36** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **326** 个生产文件和 **536** 个 TypeScript 源文件满足限制，前端 **207** 个测试文件 / **1392** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（AI 消息自动滚动配置闭环）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-UX-639 | 当 AI 交互配置启用自动滚动时，新用户消息、处理中状态、历史消息和模型回答进入当前可见面板后，消息列表必须对齐到末尾；面板隐藏期间不得驱动不可见 DOM 滚动，重新显示后必须一次性追上最新内容。当自动滚动关闭时，任何消息变化都不得主动改变用户滚动位置。 | done |
| AI-COMPAT-640 | 当宿主 WebView 或测试环境不提供 `scrollIntoView` 时，AI 消息渲染不得抛出异常、卸载面板或中断对话；滚动能力必须按可用性降级。 | done |
| QA-FE-641 | 回归必须覆盖自动滚动开启、关闭、隐藏期间抑制、重新显示追赶和缺少滚动 API 的兼容路径，并通过 AI 对话竞态组合测试、源码限制、全量前端测试、TypeScript、生产构建及完整 CI 对齐门禁。 | done |

本波次修复前，设置页持久化了 `auto_scroll`，AI 终端面板却从未读取该值，开关对消息列表没有任何影响。修复后面板控制器从权威 dashboard 读取配置，消息列表通过末尾锚点跟随内容版本；可见性参与滚动判定，隐藏面板保留消息和请求状态但不触发滚动，重新显示时再追上末尾。滚动 API 使用能力检测，兼容不支持该方法的宿主。定向回归 **3** 个测试文件 / **24** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **327** 个生产文件和 **537** 个 TypeScript 源文件满足限制，前端 **207** 个测试文件 / **1395** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（AI 网络搜索能力门控）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-FUNC-642 | 当 AI 搜索总开关关闭或搜索模式为 `disabled` 时，终端 AI 面板的网络搜索开关必须禁用并保持关闭，发送请求必须强制携带 `use_search=false`；界面不得允许用户选择后端必然忽略的无效状态。 | done |
| AI-STATE-643 | 当面板刷新后的权威搜索能力从可用变为不可用时，先前已开启的本地搜索状态必须立即清除；后续能力重新启用时不得恢复陈旧开启状态。UI 禁用、显示状态和请求参数必须使用同一能力判定。 | done |
| QA-FE-644 | 回归必须覆盖搜索总开关关闭、模式禁用、可用能力正常开启、刷新后能力降级与请求参数防御性门控，并通过 AI 对话与跨面板竞态测试、源码限制、全量前端测试、TypeScript、生产构建及完整 CI 对齐门禁。 | done |

本波次修复前，终端 AI 面板始终提供可操作的网络搜索 Switch，即使后台搜索未启用或模式已禁用；用户可以看到开启状态并发送 `use_search=true`，但后端会静默忽略，形成误导性的无效配置。修复后 dashboard 成为能力权威源：总开关与模式共同决定可用性，加载和刷新会清除失效本地状态，Switch 使用 Base UI 的禁用语义，最终请求再次与能力取交集以防陈旧状态绕过。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **327** 个生产文件和 **537** 个 TypeScript 源文件满足限制，前端 **207** 个测试文件 / **1398** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（AI 引用要求策略闭环）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-FUNC-645 | 当用户启用网络搜索并要求回答提供引用时，独立搜索必须至少返回一条结构化来源，模型回答必须包含位于实际来源编号范围内的引用标记；无来源、仅有越界编号或完全无引用的回答不得作为成功结果返回。关闭引用要求时，未带编号的回答仍必须保持可用。 | done |
| AI-REL-646 | 当主 AI Provider 返回不满足引用策略的回答时，系统必须把该响应视为不可用并尝试已配置的备用 Provider；只有通过引用校验的回答才能写入对话历史。全部 Provider 均失败或搜索无来源时，不得留下半条用户消息或助手消息。 | done |
| AI-COMPAT-647 | 当搜索模式为 `disabled` 时，即使请求携带陈旧的 `use_search=true`，后端也不得读取搜索凭据或应用引用要求；当模式为当前无法提供可验证结构化来源的原生搜索且引用要求开启时，系统必须返回明确错误，不得伪造或静默省略引用。 | done |
| QA-BE-648 | 回归必须覆盖引用策略启停、无搜索结果、有效与越界编号、失败不持久化、主 Provider 无引用时的备用 Provider 回退，并通过 service race、golangci-lint、Go 源码限制及完整 CI 对齐门禁。 | done |

本波次修复前，`require_citations` 仅被保存到数据库，搜索有无结果、模型是否引用来源以及引用编号是否有效都不会影响请求成功；主 Provider 即使返回无引用回答也会直接入库，备用 Provider 没有机会接管。修复后后端在调用模型前建立引用策略：独立搜索无结构化来源时立即失败，原生搜索在暂不具备可验证来源解析能力时给出明确错误；搜索结果数量写入系统约束，模型回答在 Provider 回退循环内校验，主 Provider 的无引用回答可触发备用 Provider，只有含有效来源编号的最终回答才允许持久化。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **91.0%**，Go 与前端源码限制通过，前端 **207** 个测试文件 / **1398** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（AI 配置完整性与原子保存）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-CONFIG-649 | 当保存 AI 配置时，搜索模式与搜索提供商必须属于受支持枚举；默认和备用 Provider 必须引用真实、已启用且彼此不同的配置。非法值不得依赖后续聊天请求才暴露，也不得以数据库外键原始错误替代可操作的业务错误。 | done |
| AI-DATA-650 | 当 AI 配置保存同时触发历史保留策略裁剪时，配置写入与按时间、数量裁剪必须处于同一数据库事务；任一步失败必须整体回滚。数据库事务成功前不得更新搜索密钥，失败返回后原密钥必须保持不变。 | done |
| AI-CONC-651 | 当保存 Provider、删除 Provider 或保存 AI 配置并发发生时，同一 AIService 实例必须串行化配置 mutation；正在被默认或备用优先级引用的 Provider 不得直接停用，失败后其启用状态必须保持不变。 | done |
| AI-UX-652 | 当设置页选择默认或备用 Provider 时，未启用的 Provider 以及已被另一个优先级占用的 Provider 必须显示但不可选择；AI 面板宽度设置、后端校验与拖拽控件必须统一为 300 到 720 像素，界面不得接受运行时必然被截断的值。 | done |
| QA-FULL-653 | 回归必须覆盖非法搜索枚举、缺失/停用/重复 Provider、失败时密钥不变、引用 Provider 停用阻断、配置与裁剪事务回滚、前端不可选状态和 AI 宽度下限，并通过 service/store race、前端定向测试、源码限制、golangci-lint 及完整 CI 对齐门禁。 | done |

本波次修复前，AI 设置可以保存未知搜索枚举、停用 Provider 或相同的默认/备用 Provider，前端也允许直接选出这些运行时必然失败的组合；搜索密钥先于数据库写入，外键或裁剪失败会留下半成功状态，配置写入与历史裁剪也不具备事务原子性。AI 面板宽度还允许保存到 900 像素，而实际面板最多只能渲染 720 像素。修复后服务层在持久化前验证全部枚举和 Provider 引用，配置 mutation 使用统一互斥，引用中的 Provider 不可停用；设置与历史裁剪在同一事务提交，搜索密钥只在数据库成功后更新。设置页禁用无效优先级选项，宽度约束统一为 300 到 720 像素。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **91.0%**，源码门禁验证 **327** 个生产文件和 **537** 个 TypeScript 源文件满足限制，前端 **207** 个测试文件 / **1400** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（AI Provider 凭据生命周期一致性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-CRED-654 | 当系统 Keychain 曾不可用而 API Key 暂存于内存，后续 Keychain 恢复并成功保存新密钥时，旧内存副本必须立即安全清除；后续读取必须返回最新持久化密钥，不得因内存优先级继续使用旧凭据。 | done |
| AI-DATA-655 | 当删除 AI Provider 时，系统必须先确认 Provider 存在并读取其凭据，再删除 Keychain/内存密钥，最后删除数据库记录。Keychain 删除失败时数据库不得变化；数据库删除失败时必须补偿恢复原密钥，Provider 记录和凭据不得出现单边删除。 | done |
| AI-API-656 | 当删除不存在的 AI Provider 时，服务与 Store 必须返回明确的 `not found` 错误，并且不得删除相同派生账号下的孤立或测试密钥；删除成功仍必须同时移除 Provider 和凭据。 | done |
| QA-BE-657 | 回归必须覆盖 Keychain 恢复后的旧内存密钥清除、密钥删除失败时 Provider 保留、数据库删除失败时密钥恢复、不存在 Provider 的密钥隔离及正常删除路径，并通过 service/store race、golangci-lint、源码限制和完整 CI 对齐门禁。 | done |

本波次修复前，Provider 删除先移除数据库记录，再删除 Keychain；Keychain 失败会返回错误但 Provider 已消失。删除不存在的 Provider 被当成成功并仍会清理派生密钥账号，数据库删除失败也没有凭据补偿。另一个隐蔽问题是 Keychain 恢复后保存新 API Key 时不会清除旧内存副本，读取路径会继续返回旧密钥。修复后删除流程按存在性检查、凭据快照、密钥删除、数据库删除执行，数据库失败会恢复密钥；Store 对零影响行返回明确错误。内存密钥替换统一先清除旧字节，Keychain 写入成功后移除会遮蔽持久化值的临时副本。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **91.0%**，源码门禁验证 **327** 个生产文件和 **537** 个 TypeScript 源文件满足限制，前端 **207** 个测试文件 / **1400** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（SSH 握手、终端宿主与 AI 运行时完整性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SSH-REL-658 | 当 TCP 已连接但远端未完成 SSH 握手时，连接必须同时受调用方 context 与固定握手超时约束；取消或超时必须主动关闭底层连接并返回 context 原因，成功握手后必须清除临时 I/O deadline，不得影响后续长连接。 | done |
| TERM-REL-659 | 当分屏树因活动窗格或普通状态变化重新渲染时，终端宿主 callback ref 必须保持稳定，不得先传入 `null` 并将 xterm/WebGL DOM 搬回暂存容器。分隔条拖拽在 `pointercancel` 或组件卸载后必须移除全局监听，不得继续修改比例。 | done |
| SFTP-CONC-660 | 当旧终端的当前目录同步尚未完成而面板已切换到新终端并发起新同步时，旧请求的完成清理不得释放新终端持有的同步租约；面板关闭后迟到结果不得发布成功提示或更新已失效界面。 | done |
| AI-CONC-661 | 当 AI Provider 配置与聊天请求并发发生时，Provider profile 与对应凭据必须在同一配置读锁快照内读取；配置保存、删除与设置更新必须持有互斥写锁，聊天不得组合旧路由与新凭据或新路由与旧凭据。 | done |
| AI-CRED-662 | 当非 Ollama Provider 的类型或 Base URL 改变时，系统必须要求重新输入 API Key；缺少新凭据时 profile 与旧密钥必须保持不变。当独立外部搜索被启用时，保存前必须确认存在非空搜索凭据。 | done |
| AI-REL-663 | 当主 Provider 缺少凭据、返回空白内容或返回畸形 JSON 时，系统必须将其分类为可故障切换的不可用或协议错误并尝试备用 Provider；无效回答不得写入对话历史。 | done |
| AI-SEC-664 | 当 AI 自动执行只读命令启用时，只有固定、低泄露面的系统诊断命令可以免确认执行；`env`、`printenv`、`ls`、`find`、`cat`、`journalctl`、`ps`、`top` 等敏感读取以及复合或可变异读取命令必须要求用户批准。 | done |
| AI-DATA-665 | 当搜索来源进入 AI 上下文或回答引用校验时，只允许无凭据、主机有效、长度不超过 4096 字节的绝对 HTTP(S) URL，并按规范化地址去重；回答中的任意越界引用编号都必须使该 Provider 回答失效，不得因同时存在一个有效编号而放行。 | done |
| QA-FULL-666 | 回归必须覆盖 SSH 握手取消、分屏宿主稳定性与拖拽清理、SFTP 跨终端同步租约、AI 配置快照、路由换钥、搜索凭据、Provider 协议回退、敏感只读审批和引用边界，并通过 service race、前端定向测试、goimports-reviser、golangci-lint 及完整 CI 对齐门禁。 | done |

本波次修复前，TCP 连接成功后的 SSH 握手不响应 context，恶意或故障服务端可长期占住连接；分屏普通重渲染会因不稳定 callback ref 短暂卸载终端宿主，拖拽取消与卸载也会遗留窗口监听。SFTP 旧同步请求的 `finally` 可错误释放新终端同步锁。AI 运行时还可能在配置并发更新时读取不一致的 profile/凭据快照，路由变更复用旧密钥，外部搜索无凭据仍可保存，空白或畸形主 Provider 响应阻断备用 Provider，并把高泄露面的读取命令视为可自动执行。修复后这些边界全部使用 deadline、请求代次、稳定宿主引用、配置读写锁、凭据重录门控、协议错误分类和最小自动执行白名单闭环。定向 service race 与 **2** 个前端测试文件 / **16** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **327** 个生产文件和 **537** 个 TypeScript 源文件满足限制，前端 **207** 个测试文件 / **1402** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（主题并发反馈、文件树可访问性与本地 Shell 关闭）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| THEME-REL-667 | 当多个主题行并发执行重命名或复制时，每一行的失败必须独立保留；其他行开始或成功不得清除、覆盖或吞掉该失败。重试同一行时只能清理该行旧错误，设置窗口隐藏时必须统一清理瞬态反馈。 | done |
| SFTP-A11Y-668 | 当同一页面存在多个 SFTP 文件树，或远端路径包含空格、引号、斜杠及其他特殊字符时，`treeitem` ID 必须由组件实例命名空间和安全索引生成，不得直接暴露远端路径；每棵树的 `aria-activedescendant` 必须只引用自身节点。 | done |
| LOCAL-REL-669 | 当 Unix 本地 Shell 在宽限期后仍未退出时，系统必须先强杀完整进程组；进程组信号失败时必须尝试直接终止主进程并把进程组失败返回调用方，双路径失败必须聚合报告。`ESRCH` 与 `os.ErrProcessDone` 必须视为已停止，PTY 关闭错误不得被覆盖。 | done |
| QA-FULL-670 | 回归必须覆盖跨主题行并发失败、同路径多文件树 ARIA 隔离、特殊远端路径、本地进程组强杀成功/已退出/回退/双失败，并通过 localshell race、前端定向测试、源码限制、TypeScript 构建、goimports-reviser、golangci-lint 及完整 CI 对齐门禁。 | done |

本波次修复前，主题管理使用全局“最新请求号”决定是否展示错误，任意后发的其他行操作都会让先发失败静默消失；SFTP 文件树直接把远端路径拼入 DOM ID，多个分屏打开相同路径会产生重复 ID，特殊字符也会破坏 ARIA IDREF 语义。Unix 本地 Shell 在强制关闭阶段则忽略进程组与主进程终止错误，调用方只能看到 PTY 关闭结果。修复后主题错误按 profile 分区保存，文件树使用 React 实例 ID 与安全索引建立局部命名空间，本地 Shell 将强杀失败与 PTY 错误完整聚合返回。定向 localshell race 与 **3** 个前端测试文件 / **26** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **327** 个生产文件和 **538** 个 TypeScript 源文件满足限制，前端 **208** 个测试文件 / **1404** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（同步状态、AI 热更新、密钥轮转与录制恢复）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-DATA-671 | 当云同步成功拉取远端数据并广播 `sync:data-changed` 时，已打开设置窗口中的通用、终端、SFTP、快捷键、主题、SSH 密钥和安全状态必须从后端权威数据重新加载；自动保存草稿必须基于新基线继续工作，不得把同步前陈旧值再次写回。 | done |
| AI-STATE-672 | 当 AI Provider 或 AI 设置保存、删除成功时，所有已打开 AI 终端面板必须只刷新 Dashboard 能力与配置，不得清空当前消息、重新读取会话目录或接受旧请求迟到结果；搜索能力失效时本地搜索开关必须立即关闭。 | done |
| SEC-DATA-673 | 当主密码轮转事务的 `Commit` 返回错误时，系统必须通过事务内 pending marker 区分“已实际提交”“明确未提交”和“结果无法确认”；已提交时保留新 Vault 与新 DEK，未提交时恢复旧 Vault，无法确认时锁定运行时并保留可恢复状态，不得盲目回滚已提交数据。 | done |
| LOG-REL-674 | 当终端录制结束写入发生临时失败时，服务必须进行有界重试；当应用上次异常退出遗留 `ended_at IS NULL` 的录制记录时，新日志服务启动必须将其统一收尾，避免永久活动记录和错误统计。 | done |
| QA-FULL-675 | 回归必须覆盖同步后设置重载与草稿基线、AI 配置热更新及迟到响应隔离、SQLite 实际提交但返回错误的主密码轮转、录制结束重试与异常退出恢复，并通过定向 race、前端测试、goimports-reviser、golangci-lint 及完整 CI 对齐门禁。 | done |

本波次修复前，云同步仅刷新同步中心本身，其他已打开设置页仍持有同步前状态，后续自动保存可能覆盖刚拉取的数据；AI 配置变更也不会通知已打开终端面板，用户必须重新打开面板才能看到新 Provider 与搜索能力。主密码轮转把所有 `Commit` 错误都视为未提交，在 SQLite 已实际提交但驱动返回错误时会错误恢复旧 Vault；终端录制结束失败则没有重试，异常退出留下的活动记录也不会在下次启动恢复。修复后各设置域统一监听同步数据事件并从权威源重载，AI 配置使用独立 Dashboard 请求代次热更新，密码轮转通过 pending marker 判定真实事务结果，录制服务只对 SQLite busy/locked 与坏连接进行有界重试，并在启动时恢复异常退出记录。门禁期间还发现并修复了永久收尾错误被重复执行导致并发关闭测试 panic、AI 面板与虚拟列表源码超限，以及 AI 配置刷新错误缺少英文映射。定向 Go race、前端 **11** 个文件 / **176** 个用例、结构回归 **4** 个文件 / **40** 个用例与 i18n 静态守卫均通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **328** 个生产文件和 **540** 个 TypeScript 源文件满足限制，前端 **209** 个测试文件 / **1416** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（传输一致性、SSH 生命周期与运行态重载）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SFTP-DATA-676 | 当传输完成事件早于前端任务登记或恢复请求返回时，前端必须暂存并在任务出现后合并最终状态；旧恢复请求不得覆盖较新的任务目录。后端必须先持久化 completed/error 状态再广播完成事件，使事件后的权威查询始终可观察到最终结果。 | done |
| TERM-CONC-677 | 当终端写入、尺寸调整与终端池 LRU 淘汰并发发生时，PTY 获取与最近使用时间更新必须处于同一锁内；已移除终端不得被迟到活动重新登记。LRU 必须在排他锁内清理无真实 PTY 的孤儿时间戳，并只从当前真实终端中选择未附着优先、最久未使用的淘汰目标。 | done |
| SSH-REL-678 | 当 SSH transport 异常结束、显式关闭或 keepalive 请求超过固定上限时，客户端 `Done` 信号必须可靠关闭并终止保活；超时路径必须主动关闭连接，不得留下永久阻塞的请求或后台 goroutine。 | done |
| TUNNEL-REL-679 | 当承载本地、动态或远程隧道的 SSH transport 结束时，对应 listener 必须自动停止、释放本地端口并完成 handler 收尾；服务层必须清除运行态并发布 stopped 状态，不得要求用户手动停止失效隧道。 | done |
| SESSION-A11Y-680 | 当用户通过鼠标或键盘操作会话树时，组件必须使用单一可聚焦 tree 与 `aria-activedescendant` 表达活动节点；点击行后焦点必须回到 tree，后续方向键必须基于最新活动节点执行。节点目录缩短时活动索引必须钳制到现存节点，虚拟列表必须自动滚动到键盘活动项，不得产生多重 Tab 焦点或不可操作的陈旧活动节点。 | done |
| TUNNEL-DATA-681 | 当隧道管理器从一个会话切换到另一个会话时，旧会话目录必须立即隐藏，旧读取、事件和 mutation 结果必须失效；目录与同步事件必须按 session ID 隔离，迟到结果不得覆盖新会话或触发无关会话刷新。 | done |
| SYNC-RUNTIME-682 | 当云下载恢复、本地版本恢复、备份导入、旧云恢复、密码导入或 Join 写入同步数据后，应用必须重新加载并应用数据库中的网络代理设置；已持有 CryptoRuntime 操作锁的恢复路径必须使用非重入入口，避免嵌套加密锁死。 | done |
| QA-FULL-683 | 回归必须覆盖早到传输完成、陈旧恢复请求、终端 LRU 并发、keepalive 超时、SSH transport 丢失后的三类隧道释放、会话树单焦点键盘导航、跨会话隧道迟到结果和同步后代理热重载，并通过定向 race、前端测试、源码限制、TypeScript、goimports-reviser、golangci-lint 及完整 CI 对齐门禁。 | done |

本波次修复前，传输完成事件可能在任务进入前端目录前到达并被直接丢弃，后端也会先广播再持久化，导致事件后的查询仍返回 running；终端活动更新时间与 PTY 获取分离，使迟到写入可能复活已淘汰时间戳。SSH 客户端没有统一 transport 结束信号，保活请求可永久阻塞，三类隧道也不会因底层连接断开自动释放端口。会话树混用行级焦点与活动索引，隧道管理器在会话切换时会短暂暴露旧目录，数据恢复后进程内代理配置仍保持旧值。修复后传输目录、终端池、SSH transport、隧道 listener、会话树焦点、会话分区目录与同步运行态均建立明确的事件顺序和失效边界。门禁期间还修正了与新 LRU 语义冲突的旧测试夹具、将孤儿时间戳清理改为排他锁、钳制会话目录收缩后的活动索引、拆分 `RestoreVersion` 恢复事务以满足认知复杂度约束，并把 SettingService 构造职责移出超限的 `app.go`。前端定向回归 **5** 个测试文件 / **64** 个用例与 Go 三包 race 均通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **328** 个生产文件和 **540** 个 TypeScript 源文件满足限制，前端 **209** 个测试文件 / **1422** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-27 商用硬化波次（同步补偿、终端写入与传输终态收敛）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-CONC-684 | 当 Vault 解锁事件被连续或并发通知时，同步调度器必须把重复补偿合并为一次在途执行；执行结束前不得启动第二次补偿。服务停止必须能够取消或等待该补偿并可靠退出，不得因重复通知、停止竞态或锁重入产生死锁。 | done |
| TERM-CONC-685 | 当 AI 或宏命令正在写入一个终端而用户切换到另一个终端时，旧目标的迟到结果必须失效，但跨目标写入租约必须持续到真实写操作结束；在此之前新目标仍须保持 busy，界面不得向两个终端并发提交命令。 | done |
| SFTP-DATA-686 | 当传输已经完成、失败或取消但终态持久化暂时失败时，服务必须在广播事件前登记进程内终态覆盖，并在列表查询中优先返回该终态；暂停、关闭或后续生命周期操作必须重试回写。完成态必须同步最终字节数，取消态不得被迟到成功或错误覆盖。 | done |
| OPS-REL-687 | 当系统信息探测 runner 在 context 取消后仍不返回，或其取消函数本身不响应时，服务必须在固定 500 毫秒宽限期后返回明确的取消或超时错误；调用方不得被第三方 runner 永久阻塞。 | done |
| CSV-CONC-688 | 当会话 CSV 导出的原生文件选择器尚未结束而设置窗口被外部关闭并重新打开时，原导出租约必须继续有效直到原 Promise 真正完成；重开窗口不得启动第二个重叠选择器，迟到结果也不得污染新窗口状态。 | done |
| TERM-REL-689 | 当 AI 或宏终端写入因底层 `Write` 或并发 `Close` 不退出而无法正常收尾时，服务必须在固定 500 毫秒宽限期后返回包含原始写入与关闭信息的错误。终端池淘汰必须继续通过并发关闭中止在途 I/O，不得为等待写入而引入与 LRU 锁顺序相反的死锁。 | done |
| QA-FULL-690 | 回归必须覆盖重复解锁补偿单飞与停止、终端切换后的跨目标 busy、传输终态持久化失败及重试、系统探测和 AI/宏写入不响应、CSV 窗口重开竞态与 LRU 在途写入淘汰，并通过定向 race、前端测试、goimports-reviser、golangci-lint 及完整 CI 对齐门禁。 | done |

本波次修复前，Vault 解锁可重复启动同步补偿；终端撰写在切换目标后会过早释放 busy，使新旧终端写入重叠。SFTP 终态数据库写入失败时，事件、列表和最终字节数可能互相矛盾；系统探测、AI 与宏写入又默认依赖底层取消和关闭一定返回，异常实现可永久挂住调用。CSV 原生选择器在窗口关闭时会提前释放前端租约，重开窗口后可叠加第二个选择器。修复后重复解锁通过原子单飞合并，终端撰写租约跟随真实 I/O 生命周期；传输终态使用进程内覆盖维持权威结果并在后续生命周期重试持久化。所有不可控探测与终端写入都具有 500 毫秒有界中止，CSV 导出租约跨窗口生命周期保持到 Promise 收敛，同时保留通过并发关闭中止 LRU 在途 I/O 的无死锁合约。定向 Go race 与前端 **2** 个测试文件 / **24** 个用例通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.9%**，源码门禁验证 **328** 个生产文件和 **540** 个 TypeScript 源文件满足限制，前端 **209** 个测试文件 / **1423** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（传输终态持久日志）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SFTP-REL-691 | 当传输完成、失败或取消的数据库终态写入暂时失败，或应用在重试前退出时，系统必须把待收敛终态持久化到 DataDir journal；journal 必须原子替换、目录权限为 `0700`、文件权限为 `0600`，重启后按 `failed < completed < cancelled` 优先级恢复并重试。无效、超限、重复或结构未知的 journal 必须 fail-closed，且不得覆盖原文件。 | done |
| SFTP-UX-692 | 当数据库状态与待收敛终态不一致时，传输列表必须按终态优先级展示权威结果，包含 cancelled 覆盖 completed；完成态必须保留最终字节数。错误文本在首次入库与 journal 写入前必须移除 NUL、修复非法 UTF-8，并在字符边界截断到 4096 字节，避免重启前后显示不一致或前端序列化异常。 | done |
| QA-FULL-693 | 回归必须覆盖并发 journal 写入、跨重启恢复、终态优先级、清理失败重试、非法文件安全降级、既有文件权限收紧、超长非法错误净化、首次数据库持久化净化及应用 DataDir 接线，并通过定向 race、goimports-reviser、golangci-lint 与完整 CI 对齐门禁。 | done |

本波次修复前，SFTP 终态只保存在进程内覆盖中；若数据库持续失败后应用退出，重启会丢失真实 completed/cancelled 状态。错误文本也只在 journal 编码阶段处理，首次数据库写入仍可能保存超长、含 NUL 或非法 UTF-8 的内容。修复后终态使用受限、原子、私有权限 journal 跨进程恢复，并统一在进入数据库或 journal 前净化错误文本；合法旧 journal 在加载后立即收紧权限。定向 service/app race 与完整 `wails3 task ci` 均通过；`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.7%**，前端 **210** 个测试文件 / **1435** 个用例、官方 npm audit **0 vulnerabilities**、源码限制、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（资源生命周期、同步一致性与大列表体验）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| TERM-REL-694 | 当 PTY 首次关闭失败时，终端服务必须保留真实资源追踪并允许后续 Close、淘汰或 Shutdown 重试；终端池上限缩小时必须立即按 LRU 收敛，淘汰失败不得静默接受超限。Shutdown 必须维持“Close 解阻、等待在途操作、再次 Close”的顺序。 | done |
| SERIAL-REL-695 | 当已打开但尚未注册的串口在回滚关闭时失败，系统必须保留句柄与独占 lease，直到真实 Close 成功。再次打开只可重试目标 canonical device，不得让故障设备阻断其他设备；Shutdown 必须尝试全部待清理资源，单项失败不得阻断其他成功项，失败项仍须可再次重试。 | done |
| SESSION-REL-696 | 当 SSH 连接首次 Close 失败时，会话服务必须保留连接并允许 disconnect、CloseAll 与 Shutdown 后续真实重试；`net.ErrClosed` 必须视为底层 transport 已释放并立即移除逻辑连接。成功清理只能按连接指针所有权删除，迟到清理不得误删替换连接或重复发布断开事件。停止与连接尝试扫描不得产生竞态。 | done |
| TUNNEL-REL-697 | 当 Stop/Delete 超时后 Start 才迟到返回时，隧道不得重新进入运行态；批量停止必须传播各隧道关闭错误、保留失败运行态并允许重试。任何需要破坏本地运行态的同步恢复若无法关闭隧道，必须立即中止数据替换。 | done |
| SYNC-DATA-698 | 当同步 Provider 或远端端点发生变化时，旧 Conflict 与 RemoteVersion 必须清除并进入 pending；仅策略或保留期变化不得误清冲突。`transfer_jobs` 必须在 v3 快照结构中保持兼容但始终为空，不参与指纹或恢复，旧快照中的传输任务必须忽略并保留本机历史。 | done |
| ASSET-PERF-699 | 当会话资产超过 100 行时，表格必须使用虚拟化；2000 行数据时实际挂载行数必须少于 50。文件夹查询必须通过预构建索引达到 `O(sessions + folders)`，不得为每行重复扫描目录。 | done |
| UI-A11Y-700 | 当用户创建或编辑隧道、串口配置时，类型、地址、端口、名称、设备、备注与 Switch 必须具有可访问名称和标签关联；串口弹框必须使用标准 form，Enter 只能触发一次提交，错误提示必须通过 `role="alert"` 暴露。 | done |
| QA-FULL-701 | 回归必须覆盖终端、串口、会话、隧道与同步生命周期 race，资产 2000 行虚拟化与文件夹索引，以及隧道/串口表单无障碍；并通过前端定向测试、源码限制、TypeScript、goimports-reviser、golangci-lint 与完整 CI 对齐门禁。 | done |

本波次修复前，多个关闭失败路径会提前丢失资源所有权，迟到隧道启动可能复活已停止实例；同步配置身份变化会保留旧冲突，传输历史也会被错误纳入云快照。资产表格在大数据量下全量挂载并重复扫描文件夹，隧道和串口弹框存在未标记控件与非标准提交路径。修复后各资源以真实 Close 成功作为释放边界，同步快照排除设备本地历史，资产目录使用虚拟化和线性索引，表单补齐标准语义。完整门禁额外发现并修复了 SFTP 超时后 `net.ErrClosed` 被误判为可重试失败导致逻辑连接累积，以及 3 个 Go 文件超过 300 行的问题；相关职责已拆分到独立文件。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.7%**，源码门禁验证 **331** 个前端生产文件和 **544** 个 TypeScript 源文件满足限制，前端 **210** 个测试文件 / **1435** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 待决架构项（GitHub Gist 多写者原子性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-ARCH-702 | 当两个设备基于同一远端版本并发上传时，云端必须以服务端原子 compare-and-swap 拒绝陈旧写入，禁止 `GET ETag -> PATCH` 的 TOCTOU 静默覆盖。GitHub Gist PATCH 不支持可靠 `If-Match`，当前协议无法满足该验收；推荐迁移私有 GitHub Repository + Git Data API，并使用 `force=false` 原子更新 ref。 | decision required |

当前 Gist Provider 只能在 PATCH 前再次 GET 并比较 ETag；比较完成到 PATCH 写入之间仍存在竞态窗口。直接给官方 Gist PATCH 添加 `If-Match` 会返回 `400 Bad Request`，因此该风险不能通过局部补丁可靠消除。迁移远端存储协议会改变现有同步流程，必须在获得明确产品决策后实施。

## 2026-07-28 商用硬化波次（SSH Agent 信任边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SSH-SEC-703 | 当会话使用 SSH Agent 认证时，应用必须拒绝空白、相对、含控制字符、超长、缺失或非 Unix socket 的 `SSH_AUTH_SOCK`，并在连接前解析为 canonical socket。Agent 建连必须继承会话连接 context；每次 agent 读写必须具有固定 10 秒上限，连接取消必须立即关闭已连接但无响应的 agent socket。任何 dial、签名列表、空 signer 或取消错误都必须关闭 socket，不得泄漏句柄或永久阻塞连接流程。 | done |
| QA-FULL-704 | 回归必须覆盖不安全 agent 路径、socket 符号链接、dial 失败、空 signer、无响应超时、请求中取消、deadline 设置失败、cleanup 幂等与既有真实 `ssh-agent` 流程，并通过 service race、Windows 交叉编译、goimports-reviser、golangci-lint 与完整 CI 对齐门禁。 | done |

本波次修复前，`SSH_AUTH_SOCK` 会被直接交给无超时的 `net.Dial("unix", ...)`，没有路径类型校验；伪造普通文件、迟迟不响应的 agent 或连接中的取消都可能使认证准备阶段失败不清晰或长时间阻塞。修复后 agent endpoint 先解析并确认真实 socket，dial 与协议 I/O 均有界，连接 context 会主动中止 agent 请求；同时删除了两个会丢弃 cleanup、仅测试使用的认证 helper，避免未来生产误用造成 agent socket 泄漏。`internal/service` 全量 race、Windows amd64 无 CGO 交叉编译与 `goimports-reviser v3.12.6` 均通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.8%**，前端 **210** 个测试文件 / **1435** 个用例、官方 npm audit **0 vulnerabilities**、源码限制、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-28 新增待决架构项（串口、Windows Agent 与 Wails Runtime）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SERIAL-ARCH-705 | 当应用配置 XON/XOFF、RTS/CTS 或 DSR/DTR 串口流控时，生产实现必须只依赖公开、稳定、可测试的串口 API，不得通过 reflection 与 `unsafe` 读取第三方私有 `handle`。当前固定版本 `go.bug.st/serial v1.6.4` 及已核对的最新 `v1.8.0` 均未公开流控或 native handle API；推荐维护受控 fork，在驱动内部公开 `FlowControl` 配置并固定提交版本，而不是继续扩大私有字段耦合。 | decision required |
| SSH-ARCH-706 | 当 Windows 用户选择 SSH Agent 认证时，应用必须兼容系统 OpenSSH 默认 `\\.\pipe\openssh-ssh-agent` named pipe，并在 UI 中仅暴露实际可用能力。当前实现与 Go 标准库只覆盖 `SSH_AUTH_SOCK` 指向的 Unix socket，前端却跨平台无条件显示 `SSH Agent`；推荐引入经过审计的 named-pipe transport，并增加平台能力探测与端到端测试。 | decision required |
| DEP-ARCH-707 | 当 Wails 工具链、Go runtime 与前端 runtime 参与同一构建时，三者必须使用同一精确版本并由单一版本源校验。当前 CLI 与 Go 模块为 `v3.0.0-alpha2.117`，`@wailsio/runtime` 仍声明并锁定 `3.0.0-alpha.97`，`npm outdated` 已确认 wanted/latest 为 `3.0.0-alpha2.117`。推荐精确升级并锁定前端 runtime，重新生成 bindings 后执行全量交互与打包回归。 | decision required |

串口替代方案会改变核心依赖，Windows Agent 需要新增 named-pipe transport，Wails runtime 对齐会修改前端依赖与锁文件；三项均属于依赖或跨平台行为变更，必须获得明确授权后实施。本轮只完成审计、证据固化与不依赖新依赖的 SSH Agent 安全收口，不擅自升级或降级现有能力。

## 2026-07-28 商用硬化波次（SFTP 本地文件边界与 SSH 截止语义）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SFTP-SEC-708 | 当上传任务排队后才实际读取本地源文件时，系统必须重新解析用户选择的符号链接并打开最终目标，随后只接受普通文件；Unix 上 FIFO、目录、设备或被替换成符号链接的最终路径必须通过 `O_NONBLOCK`、`O_NOFOLLOW` 与打开后类型检查快速拒绝，不得因读取特殊文件永久阻塞传输 worker。正常指向普通文件的符号链接必须继续可用。 | done |
| SFTP-DATA-709 | 当下载任务创建本地 partial 文件时，目标必须以 `0600` 和独占创建模式打开；任何已存在的文件或符号链接都必须使任务失败且不得被截断。下载成功必须先同步并关闭 partial 文件，再执行原子替换；复制、同步或关闭错误必须完整传播并触发 partial 清理。 | done |
| SSH-REL-710 | 当调用方 context deadline 与 SSH 握手 socket deadline 在同一时刻到期时，即使网络栈先返回 `i/o timeout` 且 `ctx.Err()` 尚未可见，连接仍必须稳定返回 `context.DeadlineExceeded`；只有确由 context 提供的握手截止时间可以执行该归一化，内部 transport 超时不得被误分类。 | done |
| QA-FULL-711 | 回归必须覆盖 FIFO 非阻塞拒绝、目录拒绝、普通文件符号链接、下载既有文件与符号链接保护、私有文件权限、context/socket 截止竞态、内部超时保留，并通过 SSH 与文件传输 race、Windows/macOS 交叉编译、gosec、goimports-reviser、golangci-lint 及完整 CI 对齐门禁。 | done |

本波次修复前，上传源只在任务入队时做普通文件校验，执行阶段仍使用阻塞式 `os.Open`；排队期间若路径被替换为 FIFO 或设备文件，worker 可能永久阻塞且 context 无法中止打开。下载 partial 文件使用截断式创建，预置同名符号链接可将写入重定向到其他本地文件。SSH 握手还存在 deadline 定时器竞态，网络超时可能抢先于 context 状态发布，导致同一取消场景偶发返回不同错误。修复后上传执行阶段重新建立普通文件边界，下载 partial 使用随机任务 ID、独占私有创建及同步关闭，握手错误只在 context 实际拥有截止时间时归一化。定向 race 连续 **50** 轮、SSH 与文件传输整包 race、gosec、`goimports-reviser v3.12.6` 以及 Windows amd64/macOS arm64 交叉编译均通过；完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.8%**，源码限制验证 **331** 个前端生产文件和 **544** 个 TypeScript 源文件满足限制，前端 **210** 个测试文件 / **1435** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（终端录制文件独占创建）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| REC-SEC-712 | 当创建终端录制文件时，目标路径必须以 `0600` 和独占创建模式打开；任何既有普通文件、符号链接、FIFO、设备或其他特殊路径都必须立即失败，不得被截断、跟随或阻塞。录制头写入前必须再次收紧权限，初始化失败必须关闭句柄并删除仅由本次调用创建的半成品。 | done |
| LOG-SEC-713 | 当日志服务启动终端录制时，服务必须在私有 recordings 目录中生成不可预测的 UUID 文件名，并把尚未存在的路径交给独占创建入口；不得再通过“创建临时文件、关闭、以 `O_TRUNC` 重开”的窗口允许本地进程替换目标。碰撞或预置路径必须使启动失败，不得覆盖任何本地文件。 | done |
| QA-FULL-714 | 回归必须覆盖既有文件内容保留、符号链接目标内容保留、FIFO 非阻塞拒绝、私有权限、失败半成品清理、日志服务启动与关闭生命周期，并通过定向 race、gosec、goimports-reviser、Windows 交叉编译、macOS SSH 包交叉编译、golangci-lint 及完整 CI 对齐门禁。 | done |

本波次修复前，日志服务先用 `os.CreateTemp` 创建随机录制文件，关闭句柄后再由 `NewRecorder` 使用 `O_TRUNC` 重开；同用户恶意进程若在窗口内把路径替换为符号链接，可截断链接目标，替换为 FIFO 还会让录制启动永久阻塞。`NewRecorder` 本身也会无条件覆盖调用方传入的既有文件。修复后录制文件只允许一次性 `O_CREATE|O_EXCL` 创建，日志服务直接生成 UUID 路径，既有路径与所有特殊文件均 fail-closed；初始化失败会聚合关闭与删除错误。新增回归在修复前稳定复现覆盖、跟随与阻塞，修复后定向 race 连续 **50** 轮、日志服务 race、gosec、`goimports-reviser v3.12.6`、Windows amd64 的 SSH/service 编译及 macOS arm64 的 SSH 包编译均通过；Linux 主机无法链接依赖 Wails macOS CGO 桥接的 service 测试二进制，最终平台构建仍由对应 macOS CI runner 验证。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **90.8%**，源码限制验证 **331** 个前端生产文件和 **544** 个 TypeScript 源文件满足限制，前端 **210** 个测试文件 / **1435** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（安全普通文件读取边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| FS-SEC-715 | 当安全敏感链路打开既有本地文件时，共享读取原语必须在打开前后校验普通文件类型与文件身份；Unix 必须使用 `O_NOFOLLOW`、`O_NONBLOCK` 和 `O_CLOEXEC`，Windows 必须使用 `FILE_FLAG_OPEN_REPARSE_POINT`。路径被替换、最终组件为符号链接、FIFO、目录、设备或其他特殊文件时必须在读取任何内容前快速失败；返回普通文件前必须恢复阻塞模式。 | done |
| FILE-SEC-716 | 当加载 Vault、主题/字体/同步版本等有界文件、传输终态 journal、`known_hosts` 或终端录制时，系统必须统一使用严格普通文件读取原语并保留各自大小上限；这些内部文件不得跟随最终路径符号链接，特殊文件不得造成启动、恢复、主机校验或回放流程永久阻塞。 | done |
| IMPORT-COMPAT-717 | 当用户通过受信任文件选择器导入私钥、会话 CSV 或本地同步备份时，系统必须继续支持用户选择指向普通文件的符号链接；解析后的最终目标仍必须通过普通文件身份校验和既有大小、UTF-8、CSV 或备份格式限制，FIFO、目录与设备必须快速拒绝。 | done |
| QA-FULL-718 | 回归必须覆盖普通文件读取、严格拒绝与显式跟随符号链接、FIFO 非阻塞拒绝、用户选择文件兼容、Vault/有界文件/journal/`known_hosts`/录制调用链，并通过重复 race、gosec、goimports-reviser、Windows amd64 与 macOS arm64 交叉编译、golangci-lint 及完整 CI 对齐门禁。 | done |

本波次修复前，私钥、会话 CSV 与本地备份会直接使用阻塞式文件读取，若选择路径在读取前被替换为 FIFO，可永久挂住导入或同步调用；Vault、内部有界文件、传输终态 journal、`known_hosts` 与录制回放也各自维护重复的路径检查和打开逻辑，难以统一证明 TOCTOU 与特殊文件边界。修复后新增跨平台普通文件读取原语：Unix 使用 no-follow、non-blocking 打开，Windows 直接打开 reparse point，随后统一对比打开前后文件身份并只返回普通文件。用户显式选择的三类导入文件先解析符号链接，再对最终目标执行同一安全校验，从而同时保持兼容性与非阻塞安全边界。定向 race、连续 **50** 轮普通文件回归、连续 **20** 轮用户选择文件回归、专项 gosec、`goimports-reviser v3.12.6`、`golangci-lint v2.12.2`、Windows amd64 四包测试编译及 macOS arm64 的 fsutil/SSH 测试编译均通过；完整 `wails3 task ci` EXIT 0，Go race coverpkg total **90.8%**，源码限制验证 **331** 个前端生产文件和 **544** 个 TypeScript 源文件满足限制，前端 **210** 个测试文件 / **1435** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（追加写入竞态）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| FS-SEC-719 | 当系统需要向既有本地文件追加内容时，共享追加原语必须在打开前后校验普通文件类型与文件身份；Unix 必须使用 `O_APPEND`、`O_NOFOLLOW`、`O_NONBLOCK`、`O_CLOEXEC`，Windows 必须使用 `FILE_APPEND_DATA` 与 `FILE_FLAG_OPEN_REPARSE_POINT`。新文件必须独占创建，既有符号链接、FIFO、目录、设备或竞态替换不得被跟随、截断或阻塞。 | done |
| LOG-SEC-720 | 当应用创建或切换每日日志文件时，日志服务必须通过安全追加原语打开或独占创建目标，并在文件句柄上收紧 `0600` 权限；路径检查与打开之间被替换为符号链接或特殊文件时，日志配置必须失败且既有目标内容保持不变。 | done |
| SSH-SEC-721 | 当首次信任主机密钥或并发追加 `known_hosts` 时，系统必须通过安全追加原语写入，并基于已打开句柄重新校验文件大小上限与权限；预置或竞态替换的符号链接、FIFO、目录和设备必须快速拒绝，不得把主机密钥写入非目标文件。 | done |
| QA-FULL-722 | 回归必须覆盖既有文件追加、独占创建、符号链接与 FIFO 非阻塞拒绝、日志切换、`known_hosts` 并发追加、大小上限和权限，并通过重复 race、gosec、goimports-reviser、Windows amd64 与 macOS arm64 交叉编译、golangci-lint 及完整 CI 对齐门禁。 | done |

本波次修复前，日志与 `known_hosts` 都采用“先 `Lstat`、再普通 `O_APPEND` 打开”的两步流程；同一用户下的进程可在窗口内把普通文件替换为符号链接或 FIFO，导致追加写入被重定向或永久阻塞。修复后共享追加原语在 Unix 使用 no-follow/non-blocking/独占创建，在 Windows 使用原生 reparse-point 防跟随与 append handle，并统一执行打开后普通文件及身份校验；日志和 `known_hosts` 均移除重复的脆弱打开逻辑。定向 race、重复 FIFO 回归、专项 gosec、`goimports-reviser v3.12.6`、`golangci-lint v2.12.2`、Windows amd64 与 macOS arm64 核心包交叉编译均通过；完整 `wails3 task ci` EXIT 0，Go race coverpkg total **90.8%**，源码限制验证 **331** 个前端生产文件和 **544** 个 TypeScript 源文件满足限制，前端 **210** 个测试文件 / **1435** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（AI 输入与子进程资源边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AI-AVAIL-723 | 当 AI 对话请求进入后端时，系统必须在目标校验、正则脱敏、网络搜索和 Provider 请求前限制原始 Prompt 不超过 **64 KiB**、原始终端上下文不超过 **4 MiB**；超限请求必须明确失败，不得进入网络或数据库。 | done |
| AI-CONFIG-724 | 当保存 AI 安全设置时，搜索 API Key 必须限制为 **8 KiB**；允许、禁止和脱敏正则每类不得超过 **32** 条，总数不得超过 **64** 条，并继续执行单条长度、嵌套深度和语法校验。超限配置不得写入数据库或 Keychain。 | done |
| AI-PROC-725 | 当检测 Codex、Claude Code 或 OpenCode CLI 版本时，子进程 stdout 必须使用固定 **64 KiB** 缓冲上限并保留既有 **2 秒**超时；超限输出必须丢弃剩余内容并返回明确错误，不得由 `exec.Cmd.Output` 无界累积内存。 | done |
| QA-FULL-726 | 回归必须覆盖 Prompt、终端上下文、搜索凭据、正则分类/总数的上限与越界值，以及 CLI 正常、失败和分块超限输出；并通过 service race、Windows amd64 交叉编译、goimports-reviser、golangci-lint、govulncheck 与完整 CI 对齐门禁。 | done |

本波次修复前，Wails 调用可把任意大小的 Prompt 和终端上下文送入正则脱敏、JSON 编码与网络请求，搜索凭据和正则集合也没有总量边界；CLI 检测使用 `exec.Cmd.Output`，受 PATH 中异常程序控制的 stdout 可在 2 秒窗口内持续扩张内存。修复后所有原始 AI 输入先经过固定上限，正则集合与搜索凭据在持久化前统一验证，CLI 版本输出改为定长缓冲并在超限后继续丢弃数据直至进程退出或超时。定向回归、`internal/service` 全量 race（**118.584s**）、Windows amd64 无 CGO 测试交叉编译、`goimports-reviser v3.12.6`、`golangci-lint v2.12.2` 均通过；`govulncheck ./...` 确认 **0 个可达漏洞**。完整 `wails3 task ci` EXIT 0，Go race coverpkg total **90.9%**，源码限制验证 **331** 个前端生产文件和 **544** 个 TypeScript 源文件满足限制，前端 **210** 个测试文件 / **1435** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（SFTP Partial 所有权与清理收敛）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SFTP-SEC-727 | 当上传或下载任务使用 partial 路径时，底层传输必须明确返回该路径是否由当前调用创建。上传 partial 必须在远端独占创建，下载 partial 必须在本地以 `0600` 独占创建；既有普通文件、目录或符号链接必须使传输失败且内容保持不变。服务层仅可删除当前任务已拥有的 partial，不得因打开、校验或独占创建失败删除预置同名对象。 | done |
| SFTP-REL-728 | 当上传、下载、远端重命名或本地原子替换失败时，系统必须尝试清理当前任务拥有的 partial；清理失败必须与主错误通过 `errors.Join` 同时保留、记录并持久化，不得静默丢弃。清理时目标已不存在视为幂等成功。 | done |
| SFTP-UX-729 | 当用户取消已发布的传输时，系统必须立即且仅一次发布 `cancelled` 事件，同时阻止成功提交；worker 必须继续完成 owned partial 与 transport 清理，并把清理错误保存在 cancelled 终态。会话删除已写入的取消原因必须保留，后续清理错误必须去重追加，不得把 cancelled 回退为 failed。 | done |
| QA-FULL-730 | 回归必须覆盖上传/下载的预置 partial 保留、创建所有权、传输失败、取消、远端重命名失败、本地替换失败、双错误聚合、单次取消事件与既有取消原因追加，并通过 service/SSH/store race、Windows amd64 与 macOS arm64 交叉编译、goimports-reviser、golangci-lint 及完整 CI 对齐门禁。 | done |

本波次修复前，上传和下载 worker 在失败、取消或最终提交失败时都会忽略 partial 删除错误；下载独占创建失败后仍会无条件执行 `os.Remove`，可能删除并非当前任务创建的预置文件。上传临时路径也使用普通 `Create`，无法证明远端对象所有权。取消流程又会在 worker 清理前把运行时直接置为终态，导致后续 cleanup 结果无法进入权威状态。修复后 SSH 传输原语返回 partial 所有权，远端上传与本地下载均独占创建；服务使用实例级文件操作依赖，只清理 owned partial，并聚合主错误、partial 清理错误与 transport 关闭错误。已发布任务在取消请求时即时发送一次 cancelled，worker 收口后只补持久化结果；存储层对既有 cancelled 原因去重追加清理错误。定向回归在修复前稳定复现静默清理失败，并覆盖全部六类终态路径与预置对象保护；`internal/service`、`internal/ssh`、`internal/store` 全量 race 分别通过（**120.208s**、**10.265s**、**12.352s**），Windows amd64 与 macOS arm64 无 CGO 交叉编译、`goimports-reviser v3.12.6`、`golangci-lint v2.12.2` 0 issues。完整 `wails3 task ci` EXIT 0，Go race coverpkg total **90.9%**，Go 源文件与前端源码限制、前端 **210** 个测试文件 / **1435** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（共享私有原子写入）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| FS-DATA-731 | 当系统覆盖安全敏感本地文件时，共享写入原语必须在目标同目录创建临时文件，并在写入前把权限收紧为 `0600`；内容必须完整写入并通过短写检查，随后依次执行文件同步、关闭与原子替换。创建、权限、写入、同步、关闭、替换与失败清理错误必须完整传播；替换成功后不得再按旧临时路径执行陈旧清理。 | done |
| CRYPTO-DATA-732 | 当 Vault 持久化加密数据时，必须使用共享私有原子写入；任一提交前阶段失败时既有 Vault 必须保持可读取，临时文件必须尽力清理且清理错误不得覆盖主错误。 | done |
| SYNC-DATA-733 | 当同步服务写出本地导出文件或恢复点时，必须通过共享私有原子写入一次性提交 `0600` 文件；提交成功后不得再对目标执行二次 `Chmod`，以消除提交后 TOCTOU 与“数据已替换但接口返回失败”的窗口。主机密钥删除与传输终态 journal 必须复用同一原语。 | done |
| QA-FULL-734 | 回归必须覆盖临时文件创建、空路径、权限、写入、短写、同步、关闭、替换、清理失败与成功后无陈旧清理，并验证 Vault、同步快照、主机密钥和传输 journal 调用链；新增原子写入函数必须达到完整分支覆盖，并通过 race、跨平台编译、goimports-reviser、golangci-lint 与完整 CI 对齐门禁。 | done |

本波次修复前，Vault、同步快照、主机密钥删除与传输终态 journal 分别维护相似但不一致的“临时文件后重命名”流程：部分链路缺少短写检查或文件同步，部分错误被后续关闭或清理覆盖，同步导出还会在提交成功后再次 `Chmod`，形成数据已经替换但调用仍可能报错的状态歧义。修复后四条链路统一使用同目录私有临时文件，严格执行 `0600 -> Write -> Sync -> Close -> ReplaceFile`，并用 `errors.Join` 保留独立失败；替换成功后明确转移路径所有权，不再清理已提交的旧临时名称。定向 race 已通过，`private_atomic.go` 全部函数覆盖率达到 **100%**；Windows amd64 的 fsutil/crypto/service 与 macOS arm64 的 fsutil/crypto 测试交叉编译、`goimports-reviser v3.12.6`、`golangci-lint v2.12.2` 均通过。完整 `wails3 task ci` EXIT 0，Go race coverpkg total **91.1%**，Go 源文件与前端源码限制、前端 **210** 个测试文件 / **1435** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（私有文件权限与硬链接边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| FS-SEC-735 | 当内部文件已通过路径校验但权限过宽时，系统不得再对路径执行 `Chmod`；硬链接不得使应用修改路径外部同 inode 文件的权限。权限修复必须通过同目录 `0600` 临时文件和原子替换创建由应用独占的新 inode，同时保留原内容。已经是私有权限的文件不得无谓替换。 | done |
| SYNC-DATA-736 | 当校验或修复内部同步版本文件时，系统必须使用严格 no-follow 普通文件读取，不得复用允许用户导入符号链接的读取器。打开后的真实 inode、大小和权限必须参与健康判断；弱权限、损坏、缺失或超限文件必须通过私有原子写入重建，提交后不得再按路径修改权限。 | done |
| TRANSFER-DATA-737 | 当加载有效但权限过宽的传输终态 journal 时，系统必须在完成有界读取和结构校验后，用原始内容原子替换为新的 `0600` 文件；不得通过路径 `Chmod` 修改潜在硬链接源。符号链接、特殊文件、超限或无效 journal 必须继续 fail-closed，并阻止后续覆盖原始证据。 | done |
| QA-FULL-738 | 回归必须证明旧实现会修改同步版本和 journal 的外部硬链接权限，并覆盖修复后的源 inode 保留、目标私有替换、已私有文件身份稳定、符号链接目标不变、有界读取的读/关双错误与读取期间增长；同时通过 service race、Windows 交叉编译、goimports-reviser、golangci-lint 和完整 CI 对齐门禁。 | done |

本波次修复前，去重同步版本与传输终态 journal 在读取并校验文件后，会再次使用路径级 `os.Chmod(..., 0600)` 修复权限；如果目标是指向外部文件的硬链接，应用会直接改变外部 inode 权限。同步版本健康检查还调用了允许用户导入符号链接的 `readLocalBackup`，使内部 no-follow 边界依赖前置 `Lstat` 且存在竞态窗口。新增回归在旧实现上稳定显示两个外部 `0644` 源文件均被改成 `0600` 且目标仍共享同一 inode。修复后权限过宽的有效内容通过共享私有原子写入创建新 inode，私有文件保持原身份；同步版本改用返回真实 `fstat` 信息的严格有界读取。定向 race、`internal/service` 全量 race（**119.165s**，package coverage **91.0%**）、Windows amd64 测试交叉编译与 `golangci-lint v2.12.2` 已通过；新增 bounded read 编排和错误收口函数覆盖率达到 **100%**。完整 `wails3 task ci` EXIT 0，Go race coverpkg total **91.1%**，Go 源文件与前端源码限制、前端 **210** 个测试文件 / **1435** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。

## 2026-07-28 新增待决架构项（数据库文件身份与同步删除恢复）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| DB-ARCH-739 | 当应用打开主 SQLite 数据库及其 WAL/SHM sidecar 时，数据库驱动必须通过与已校验 inode/handle 绑定的可写 VFS 完成全部打开、创建、锁定与删除操作；不得在安全预打开后再次按普通路径打开。最终实现必须跨 Linux、Windows 与 macOS 拒绝符号链接、reparse point、硬链接和特殊文件，并证明路径替换竞态无法把 SQLite 写入重定向到外部文件。当前 `modernc.org/sqlite` 公开的 `vfs.New(fs.FS)` 仅为只读 VFS，现有 `sql.Open` 会重新按 DSN 路径打开，单纯增加一次 no-follow 预检查仍是 TOCTOU 弱实现。 | decision required |
| SYNC-ARCH-740 | 当同步版本删除在文件 staged、数据库删除和 staged 清理任一阶段发生进程崩溃时，重启后必须依据持久化删除意图恢复到唯一一致状态：数据库记录仍存在时原文件必须无覆盖恢复，记录已删除时 staged 文件必须安全清理。恢复协议必须支持 no-replace、重复执行、多个 staged 文件、恶意文件名与特殊文件拒绝；不得只依赖启动时 `Lstat -> Rename`。 | decision required |

数据库写入需要自定义可写 VFS 或等价的驱动级文件打开控制，版本删除恢复需要新增持久化协议和跨平台 no-replace 原语；两项都会改变核心持久化架构，不能通过局部路径检查伪装成完整修复，因此保留为明确待决项。

## 2026-07-28 商用硬化波次（SSH 密钥输入与缓冲区所有权）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| KEY-AVAIL-741 | 当 Wails 调用导入或更新 SSH 私钥时，原始私钥必须在 PEM 解析和密码学处理前限制为 **1 MiB**；用户提供的公钥必须在去空白和解析前限制为 **64 KiB**。数据库读取的加密私钥必须在转换为字节和调用 Decrypt 前限制为 **2 MiB**，解密明文必须再次限制为 **1 MiB**。 | done |
| KEY-DATA-742 | 当解析 PEM 私钥时，输入在去除首尾空白后必须且只能包含一个 PEM block；第二把私钥、尾随证书、非空文本或其他材料必须明确拒绝，不得静默忽略后半段并保存歧义输入。 | done |
| KEY-SEC-743 | 当 KeyCrypto 的 Encrypt 或 Decrypt 返回与输入共享底层数组的切片时，服务必须先取得独立所有权再清零临时缓冲；生成、更新、读取或存储的字符串不得因后续 `clear` 变成全零。加密输出超过 **2 MiB** 时必须在落库前拒绝并清零 owned ciphertext。 | done |
| QA-FULL-744 | 回归必须证明旧实现会接受超大私钥、超大公钥和尾随第二个 PEM，并会在 Crypto 返回别名切片时破坏已生成私钥；修复后必须覆盖输入上限、密文前置拒绝、解密后上限、超大加密输出不落库、有效 PEM/公钥注释兼容及 Windows 交叉编译，并通过 service race、goimports-reviser、golangci-lint 与完整 CI 对齐门禁。 | done |

本波次修复前，文件选择器路径虽然限制私钥为 **1 MiB**，但前端可以直接调用 `Import` 或 `Update` 绕过该限制；公钥没有大小上限，`pem.Decode` 的剩余数据也被丢弃。数据库中的超大密文会先转换并送入 Decrypt，且服务默认假设 Crypto 输出不与输入别名。新增回归在旧实现上稳定复现五类越界输入全部成功，并进一步发现 `noopCrypto.Encrypt` 返回输入切片时，密文清零会提前把生成中的私钥缓冲区清成全零。修复后服务入口、解析器、加密输出和解密出口均执行固定上限，PEM 必须唯一；Crypto 输出先复制为 owned buffer，字符串再显式克隆后才清零临时字节。密钥定向 race 与 Windows amd64 测试交叉编译已通过。完整 `wails3 task ci` EXIT 0，Go race coverpkg total **91.1%**，Go 源文件与前端源码限制、前端 **210** 个测试文件 / **1435** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（应用密码输入边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| AUTH-AVAIL-745 | 当创建、验证、解锁、轮转或导入应用 Vault 时，密码必须在进入 Argon2 前限制为 **1024 UTF-8 字节**；超限输入不得触发密钥派生。 | done |
| AUTH-SEC-746 | 当校验应用密码时，后端必须拒绝非法 UTF-8，并按 Unicode code point 验证至少 **12 个字符**；不得继续以字节长度冒充字符数，使 6 个中文字符绕过服务端最短长度。 | done |
| UX-AUTH-747 | 当用户在首次启动、设置页、解锁或加密备份恢复入口提交密码时，前端必须复用同一 UTF-8 字节与字符计数规则；超限输入必须显示中英文 inline 错误，且不得调用 Wails Setup、Unlock、Rotate 或 ImportWithPassword。 | done |
| QA-FULL-748 | 回归必须证明旧实现会接受 **1025** 字节密码、6 个中文字符和 6 个 astral 字符，并会把超限密码发送到设置页或 VaultGate 的 Wails 调用；修复后必须覆盖 ASCII/多字节边界、非法 UTF-8、最短长度、设置、解锁与恢复共享规则，并通过 crypto race、前端定向测试、源码限制、TypeScript、lint 与完整 CI 对齐门禁。 | done |

本波次修复前，`ValidateAppPassword` 只有最短 `len` 检查，没有最大值；任意大的 Wails 字符串都会继续转换为字节并进入 Argon2。该检查还把 UTF-8 字节数当作字符数，6 个中文字符即可绕过后端“至少 12 个字符”的约束，前端对 astral 字符使用 UTF-16 code unit 计数时也存在同类偏差。修复后密码学公共边界先拒绝超过 **1024 UTF-8 字节**和非法 UTF-8 的输入，再按 Unicode code point 验证最短长度；首次启动、设置、轮转、解锁与备份恢复共用前端校验器，在调用 Wails 或打开恢复文件选择器前 fail-fast。旧实现失败回归与修复后的定向测试均已验证；`ValidateAppPassword` 覆盖率达到 **100%**，crypto race、goimports-reviser 与 i18n 定向测试通过。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **91.1%**，源码限制验证 **332** 个前端生产文件和 **546** 个 TypeScript 源文件满足限制，前端 **211** 个测试文件 / **1446** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（设置与同步恢复资源边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SET-AVAIL-749 | 当通用设置 Get、GetMany、List、Set、SetMany 或 Delete 接收输入时，系统必须在数据库查询、加密锁、凭据加密和运行态应用前限制单批不超过 **256** 条、key 不超过 **256 UTF-8 字节**、namespace 不超过 **64 UTF-8 字节**；批量 key 必须唯一，非法 UTF-8、空白标识符与 NUL 必须明确拒绝。 | done |
| SET-DATA-750 | 当设置经服务层或 store 直接读写时，单个序列化 JSON value 必须为有效 UTF-8 且不超过 **64 KiB**，并继续满足 namespace 前缀、version 与 JSON 实际类型契约；重复 key 或任一非法条目必须使整批在事务前失败，不得部分落库。 | done |
| SYNC-DATA-751 | 当导入、拉取、加入或版本恢复校验同步快照时，`settings` 行必须在破坏性生命周期准备和恢复事务前验证必需字段类型、整数 version=1、`updated_at` 格式，并复用相同的批量、唯一性、key、namespace、UTF-8 与 JSON value 上限；畸形行不得进入动态 `insertRow`。 | done |
| QA-FULL-752 | 回归必须证明旧实现会放行超长 key、namespace、JSON value、超大/重复批量及畸形同步 setting 行，并覆盖精确边界、直接快照与 JSON 解码快照、字段缺失、类型错误、非法时间、NUL 和非法 UTF-8；最终通过 store/service race、goimports-reviser、golangci-lint 与完整 CI 对齐门禁。 | done |

本波次修复前，通用设置 API 会对任意长度的 key 列表逐项查询，SetMany 允许重复 key 以后写覆盖前写，store 对标识符和 JSON value 没有尺寸或 UTF-8 上限；同步恢复仅拒绝未知列，畸形 `settings` 行可绕过 SettingService 并直接进入动态插入。修复后 store 成为统一持久化契约来源，服务入口在分配有界条目数组、进入加密边界或访问数据库前 fail-fast；同步快照在分配解析数组前先限制行数，把直接 SQLite 数值和 JSON 解码数值归一为严格 version=1，并在任何破坏性恢复动作前验证完整 setting 行。旧实现失败回归、定向 race、`internal/store` 与 `internal/service` 全量 race（分别 **12.135s**、**122.451s**）均通过；新增设置校验函数除标准库 JSON decoder 的不可达防御分支外均达到 **100%** 覆盖。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **91.2%**，源码限制验证 **332** 个前端生产文件和 **546** 个 TypeScript 源文件满足限制，前端 **211** 个测试文件 / **1446** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（同步快照整数完整性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SYNC-DATA-753 | 当解码同步快照中的 SQLite 单元格数字时，系统必须保留完整 signed 64-bit integer 精度；大于 `2^53` 的 ID、外键、计数和排序值不得经 `float64` 舍入，解码后的值必须在指纹校验、业务验证和恢复写入前归一为 `int64`。 | done |
| SYNC-SEC-754 | 当快照单元格包含小数、指数记法或超出 signed 64-bit 范围的 JSON 数字时，系统必须在指纹校验与数据库事务前明确拒绝；不得依赖 SQLite 隐式类型转换或把越界值静默改写。 | done |
| SYNC-PERF-755 | 当解码最大尺寸同步明文时，系统必须直接从原始 byte slice 流式读取，不得先转换为 string 再产生一份等尺寸副本；数字无损策略不得引入整份快照的第二次复制。 | done |
| QA-FULL-756 | 回归必须证明旧实现会把 `2^53+1` 解码为 `float64` 并改变快照指纹，同时放行小数、指数与 int64 越界数字；修复后必须覆盖精确大整数、指纹稳定、三类非法数字，并通过 service race、goimports-reviser、golangci-lint 与完整 CI 对齐门禁。 | done |

本波次修复前，`ExportData.Tables` 的动态单元格由标准 JSON 解码器落为 `float64`；现代格式会因大 ID 在解密后指纹不一致而变成不可恢复备份，遗留格式则可能继续把舍入后的外键写入 SQLite。修复后解码器使用 `UseNumber`，随后只接受十进制 signed 64-bit 整数并原位替换为 `int64`；原始明文改由 `bytes.Reader` 消费，不再创建等尺寸 string 副本。旧实现失败回归、定向 race 与 `internal/service` 全量 race（**124.662s**）均通过。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **91.2%**，源码限制验证 **332** 个前端生产文件和 **546** 个 TypeScript 源文件满足限制，前端 **211** 个测试文件 / **1446** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（会话密码与 sessions 快照边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| SESSION-AVAIL-757 | 当创建、更新或 CSV 导入会话密码时，系统必须在转换字节和调用应用 Vault 加密前拒绝非法 UTF-8，并限制明文不超过 **64 KiB**；加密输出超过允许的 AES-GCM envelope 上限或不满足存储格式时必须失败，且不得写入数据库。 | done |
| SESSION-DATA-758 | 当读取数据库中的会话密码时，非空值必须使用 `enc1:` 前缀，并包含 canonical Base64 编码的 AES-GCM envelope；解码后长度必须至少包含 **28 字节** nonce/tag 开销且不得超过 **64 KiB + 28 字节**。畸形或超限密文必须在调用 Decrypt 前拒绝，解密明文必须再次满足 **64 KiB** 与 UTF-8 边界。 | done |
| SYNC-DATA-759 | 当导入、拉取、加入或版本恢复校验同步快照时，`sessions` 行必须在破坏性生命周期准备和恢复事务前验证全部必需字段及类型、正 ID 与唯一 ID、资产外键、文本 UTF-8/NUL/长度、端口、认证方式与密钥关系、keepalive、终端类型、排序值、连接计数、时间格式及加密密码契约；畸形行不得进入动态 `insertRow`。 | done |
| QA-FULL-760 | 回归必须证明旧实现会放行超限或非法 UTF-8 明文、非 Base64/过短/超限密文、解密后超限或非法 UTF-8 明文，以及明文密码、重复 ID 和畸形 `sessions` 快照行；修复后必须覆盖精确边界、真实加密导出恢复、Vault 锁定错误语义，并通过 service race、goimports-reviser、golangci-lint 与完整 CI 对齐门禁。 | done |

本波次修复前，会话密码可以把任意大小或非法 UTF-8 明文送入加密，数据库中的任意 `enc1:` 字符串也会直接进入 Decrypt；同步恢复对 `sessions` 只拒绝未知列，明文密码、重复 ID、非法端口、认证方式、外键、计数、排序与时间均可绕过业务入口后进入动态插入。修复后会话密码在加密前、加密输出、存储密文和解密输出四层执行固定边界，密文必须是 canonical Base64 的 AES-GCM envelope；`sessions` 快照在任何破坏性恢复动作前完成全字段解析和业务契约验证。旧实现失败回归、定向 race 与 `internal/service` 全量 race（**123.216s**）均通过；`goimports-reviser v3.12.6` 已应用，新增会话密码、会话输入与 sessions 行解析核心函数除仅在 32-bit `int` 平台可触发的转换溢出防御分支外均达到 **100%** 覆盖。完整 `wails3 task ci` EXIT 0，`golangci-lint v2.12.2` 为 0 issues，Go race coverpkg total **91.3%**，源码限制验证 **332** 个前端生产文件和 **546** 个 TypeScript 源文件满足限制，前端 **211** 个测试文件 / **1446** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（SSH 密钥同步恢复边界）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| KEY-SEC-761 | 当同步快照包含 SSH 私钥时，非空 `private_key` 必须是 canonical Base64 编码的 AES-GCM envelope；解码后必须至少包含 **28 字节** nonce/tag 开销且明文容量不得超过 **1 MiB**，编码值不得超过既有 **2 MiB** 存储上限。明文、畸形、过短、非 canonical 或超限值必须在恢复事务前拒绝。 | done |
| KEY-DATA-762 | 当同步快照包含 SSH 公钥时，`public_key` 必须为合法 UTF-8、不得包含 NUL、不得超过 **64 KiB**，并且必须且只能解析出一把 RSA、ED25519 或 ECDSA authorized key；实际算法必须与存储的 `type` 一致，不得恢复损坏、多把或类型错配的公钥。 | done |
| SYNC-DATA-763 | 当校验 `ssh_keys` 行时，系统必须在破坏性生命周期准备前验证全部必需字段及类型、正 ID 与唯一 ID、规范化名称、允许的 key type、`has_passphrase` 仅为整数 0/1 及 SQLite 时间格式；畸形行不得进入动态 `insertRow`。 | done |
| QA-FULL-764 | 回归必须证明旧实现会放行明文/超限私钥、损坏/多把/超限/类型错配公钥、非法名称、布尔值、时间、缺失字段与重复 ID；修复后必须覆盖直接快照与 JSON 解码快照、三类商用 SSH 公钥算法和共享 AES-GCM envelope 校验，并通过 service race、goimports-reviser、golangci-lint 与完整 CI 对齐门禁。 | done |

本波次修复前，`ssh_keys` 快照只受未知列检查和 SQLite 的 key type CHECK 约束；明文私钥、结构伪造密文、损坏或多把公钥、算法错配、超限字段、非法布尔值与重复 ID 都可越过 KeyService 后进入恢复。修复后会话密码与私钥共用有界 AES-GCM envelope 校验器，`ssh_keys` 在任何破坏性恢复动作前完成逐字段解析、名称规范、密文、公钥算法和唯一性验证；密钥名称入口同时补齐非法 UTF-8 拒绝。旧实现失败回归、定向 race、`golangci-lint v2.12.2` 与 `internal/service` 全量 race（**121.137s**）均通过；`goimports-reviser v3.12.6` 已应用，新增密钥快照核心函数覆盖率为 **94.1%～100%**。完整 `wails3 task ci` EXIT 0，Go race coverpkg total **91.3%**，源码限制验证 **332** 个前端生产文件和 **546** 个 TypeScript 源文件满足限制，前端 **211** 个测试文件 / **1446** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。

## 2026-07-28 商用硬化波次（会话目录同步恢复完整性）

| ID | EARS 验收条件 | 状态 |
|---|---|---|
| FOLDER-DATA-765 | 当同步快照包含 `session_folders` 行时，系统必须在恢复事务前验证全部必需字段及类型、正 ID 与唯一 ID、规范名称与 UTF-8/NUL/长度边界、可选正 parent ID、`is_default` 仅为整数 0/1、排序值范围及 SQLite 时间格式；畸形行不得进入动态 `insertRow`。 | done |
| FOLDER-REL-766 | 当校验会话目录层级时，快照必须非空且恰好包含一个无父节点的默认目录；每个非空 parent 必须引用快照内既有目录，目录不得自引用，完整层级不得包含任意长度的循环。孤儿、重复 ID、多默认、无默认或循环层级必须明确拒绝。 | done |
| SYNC-DATA-767 | 当导入、拉取、加入或版本恢复校验同步快照时，`session_folders` 的字段与层级契约必须在破坏性生命周期准备和数据库写入前执行；直接生成与 JSON 解码的合法目录树必须得到一致结果。 | done |
| QA-FULL-768 | 回归必须覆盖合法多层目录、直接快照与 JSON 解码快照、空目录、缺失字段、非法字段类型/边界、重复 ID、默认目录约束、孤儿、自引用与多节点循环，并通过 service race、goimports-reviser、golangci-lint 与完整 CI 对齐门禁。 | done |

本波次修复前，`session_folders` 快照只受未知列检查和 SQLite 外键约束；空目录、重复 ID、非法名称/布尔值/排序/时间、多默认、无默认及循环层级可绕过 SessionService 后进入恢复，部分关系错误直到删除旧数据后才由 SQLite 暴露。修复后快照预检先解析全部目录字段，再以非递归路径算法验证唯一默认根节点、父节点存在性和任意深度循环，避免深层恶意目录触发栈增长。旧 synthetic Vault 导入夹具已补入合法默认目录，普通 service 回归、`goimports-reviser v3.12.6`、`golangci-lint v2.12.2` 0 issues 与 `internal/service` 全量 race（**120.766s**）均已通过；新增目录快照函数与表级调度覆盖率均为 **100%**。完整 `wails3 task ci` EXIT 0，Go race coverpkg total **91.3%**，源码限制验证 **332** 个前端生产文件和 **546** 个 TypeScript 源文件满足限制，前端 **211** 个测试文件 / **1446** 个用例、官方 npm audit **0 vulnerabilities**、bundle budget、TypeScript 与 Linux Wails 生产构建全部通过。
