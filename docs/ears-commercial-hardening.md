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
| QA-005 | 当执行 CI 覆盖率门禁时，`go test -coverpkg=./internal/...,./pkg/...` 总覆盖率应 ≥90%。 | **done**（coverpkg total 90.0%） |

实现锚点：`internal/ssh/client.go`、`internal/service/session_connect.go`、`internal/crypto/vault.go`，以及 host key / vault / rotate / terminal exit 等测试。

## 19. 2026-07-22 可商用验收证据

本地完整门禁 `wails3 task ci` 已通过（`EXIT:0`），与 `.github/workflows/ci.yml` 对齐：

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

结论：在当前 EARS 清单、CI 门禁与安全锚点证据下，项目代码质量达到**可商用基线**。


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

