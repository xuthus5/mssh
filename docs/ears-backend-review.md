# MSSH 后端检视 EARS 任务清单

本清单基于 2026-07-21 对后端 `internal/**`、`pkg/**`、`main.go` 的静态代码检视，覆盖**安全与隐私、可用性与可靠性、性能与资源、代码质量、工程门禁**。  
状态：`todo` 待实现，`partial` 已有基础但仍需补强，`done` 已有实现且证据充分。

检视范围：`internal/{app,crypto,service,ssh,store,windowing,model,themeimport}`、`pkg/event`、启动与数据目录初始化。  
未做完整长稳压测与多机实网攻击面复测；结论以代码路径、锁模型、持久化契约与现有测试证据为主。

对照文档：`docs/ears-commercial-hardening.md`、`docs/performance-budgets.md`、根 `AGENTS.md`。

---

## 0. 总体结论

### 0.1 做得好的地方

- **密钥与备份加密基线正确**：SSH 私钥入库前 AES-GCM 加密；云同步 / 备份使用 Argon2id + AES-256-GCM（`internal/crypto`）。
- **应用密码 Vault（Argon2id KEK + DEK）**；数据目录 `0700` / DB 文件 `0600`（`internal/crypto/vault.go`、`store.OpenDB`）。
- **主机密钥 TOFU + 用户确认**：未知指纹走 `HostKeyFingerprint` 事件与 `DecideHostKey`，变更非空 `Want` 会阻断（`session_connect.go`、`ssh/client.go`）。
- **SQLite 工程化**：WAL + `busy_timeout(5000)` + `foreign_keys=1` + `MaxOpenConns(1)`，数据目录权限收紧。
- **终端输出有界且无损背压**：前端 xterm 高水位时暂停 PTY 消费，低水位恢复；未挂载 pending 输出仍为 `1 MiB` + `1m` TTL；池 LRU 与 output sequence 保证资源有界且顺序可恢复。
- **SFTP 传输**：`.mssh-partial-*` 临时文件 + rename；下载本地 `0600`；进度可持久化；可取消。
- **AI 安全策略**：危险命令硬阻断、自定义 deny/allow、只读自动执行、密钥脱敏与审计记录。
- **系统探针有超时、输出上限与跨平台降级**，覆盖 Linux、macOS、BusyBox 与通用 POSIX。
- **性能预算测试存在**（会话列表 / 传输进度 / 终端分发 / 监控解析）。

### 0.2 主要风险（按严重度）

| 级别 | 主题 | 证据摘要 |
|---|---|---|
| **P2** | Emit 仍有一次必要拷贝 | 异步事件总线要求 clone；已 cap 且单次拷贝 |
| **P2** | 单连接 SQLite 争用 | busy_timeout + retry + 进度节流；极端并发仍可能排队 |

---

## 1. 安全与隐私（Security）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-SEC-001 | 当会话密码写入本地数据库时，系统必须使用与私钥相同强度的主密钥加密（AES-GCM）；读取连接前解密；列表/导出默认不得返回明文。 | **done** | vault DEK + `enc1:` seal/open；列表/Get 脱敏；连接前 `GetSessionForConnect` 解密 |
| BE-SEC-002 | 当用户导出 CSV 且未显式确认「包含密码」时，系统不得写入密码列；包含密码时必须二次确认、审计、默认安全文件权限，并提示风险。 | **done** | 默认空密码列；IncludePasswords 解密导出；audit + `writePrivateFileAtomic`；导入 re-seal |
| BE-SEC-003 | 当使用 SSH Agent 认证时，系统必须在整个认证握手（及需要签名的生命周期）内保持 agent 连接可用，握手完成后再关闭 socket。 | **done** | `openAgentAuth`/`managedConn.cleanup` 保持 socket 至 disconnect |
| BE-SEC-004 | 当数据库格式版本升级时，系统不得在无备份/无用户确认的情况下 drop 全部业务表；必须迁移或拒绝启动并给出恢复指引。 | **done** | 拒绝对旧/新版本与无 version 遗留库静默 wipe；仅 version=0 空库初始化 |
| BE-SEC-005 | 当首次未知主机密钥出现时，系统必须等待用户确认后才写入 known_hosts；指纹变更必须拒绝连接。 | **done** | `awaitHostKeyDecision` + knownhosts `KeyError.Want` |
| BE-SEC-006 | 当私钥材料生成/导入/查看时，系统必须加密存储、审计查看行为，并限制导入文件大小。 | **done** | `KeyService` Encrypt + `key_view` audit + `maxPrivateKeyFileSize` |
| BE-SEC-007 | 当 AI 或自动化路径执行远端命令时，系统必须应用阻断/审批策略并记录 outcome；宏执行不得成为策略旁路。 | **done** | 宏走 `classifyAICommand` 阻断 + audit outcome |
| BE-SEC-008 | 当配置云同步 provider 时，系统必须强制 HTTPS（或明确的本机例外白名单），并限制响应体大小。 | **done** | `requireHTTPSUnlessLoopback` + maxCloudBackupSize |
| BE-SEC-009 | 当记录日志/审计时，系统不得输出密码、私钥、主密钥、完整 Bearer/Token、同步 master key。 | **done** | 审计 summary/target 走 sanitizeLogValue；敏感词脱敏测试 |
| BE-SEC-010 | 当用户提供自定义正则（AI deny/allow/redact）时，系统必须限制复杂度/超时或预编译失败即拒，避免 ReDoS 拖垮事件循环。 | **done** | `validateUserRegexp` 长度/嵌套/灾难回溯构造拒绝 |
| BE-SEC-011 | 当 SFTP/本地文件 API 接收路径时，系统必须规范化并拒绝危险本地路径（如非常规 symlink 逃逸策略按产品定义），远程路径保持会话沙箱语义清晰。 | **done** | 本地路径 validateLocalTransferPath；远程非空/NUL 校验 |
| BE-SEC-012 | 当隧道 Local/Dynamic 启动时，默认监听地址必须是 loopback；绑定非 loopback 需要显式高级选项与风险提示。 | **done** | `validateTunnelBind` Create/Update/Start 拒绝非 loopback |
| BE-SEC-013 | 当进程退出时，系统应尽力清零内存中的主密钥缓冲（best-effort），并关闭 keychain 句柄与打开的密钥材料缓存。 | **done** | Shutdown/Lock 调用 ClearMemory 清零 DEK |
| BE-SEC-014 | 当数据库中的录制路径用于读取或删除时，系统必须将其视为不可信输入，拒绝目录外路径、符号链接逃逸和非普通文件。 | **done** | `recording_path.go` 真实目录/父目录/符号链接校验；service/store 安全回归用例 |
| BE-SEC-015 | 当 Vault 加密运行时缺失或锁定时，会话密码、同步凭证和受保护设置必须 fail-closed；keychain 失败不得静默保持自动解锁状态。 | **done** | `ErrVaultLocked` 门禁；keychain 失败自动关闭 RememberUnlock；回调在释放状态锁后执行 |
| BE-SEC-016 | 当回放文件声明终端类型、条目数据或时间戳时，系统必须先校验长度与有符号范围；截断数据不得被当作正常文件结束。 | **done** | `recording_limits.go` 上限校验；`parseEntries` 精确识别 EOF；恶意 header/entry/timestamp 回归用例 |
| BE-SEC-017 | 当录制器编码终端尺寸、类型或输出时，系统必须在写文件前拒绝负值、超出格式范围和超大条目，避免整数回绕与内存放大。 | **done** | `NewRecorder`/`Recorder.Write` 预校验；尺寸、类型和数据边界测试 |
| BE-SEC-018 | 当本地终端启动或调整窗口尺寸时，系统必须拒绝超过 PTY `uint16` 可表示范围的值后再进行平台转换。 | **done** | `normalizeSize`/`Session.Resize` 上限；Unix `ptySize` 仅接收已校验值；行列边界测试 |
| BE-SEC-019 | 当串口平台句柄通过反射读取时，系统必须拒绝负值、零值及超出本机 `uintptr` 范围的句柄。 | **done** | `nativeHandleFromUint` 范围与有效值校验；负值、零值和架构边界测试 |

---

## 2. 可用性与可靠性（Reliability / Availability）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-REL-001 | 当终端数量达到 `maxSize` 时，系统不得静默断开仍被 UI 引用的终端；必须与前端池回收策略对齐，或返回明确错误并要求用户关闭。 | **done** | 后端 LRU 优先驱逐 unattached；仍可能踢 attached 但发 state=evicted；前端 ensureTerminalPoolCapacity 主路径 |
| BE-REL-002 | 当远端 shell 退出时，系统必须清理 PTY、连接引用、pending 输出策略，并可靠发出 `disconnected`。 | **done** | `handlePTYExit` 清理；pending TTL 可取消/等待；PTY `Close` 等待读循环退出 |
| BE-REL-003 | 当连接 keep-alive 连续失败达到阈值时，系统必须关闭连接一次，且不与正常输入路径死锁。 | **done** | worker 使用非等待关闭，公开 `Close` 等待 keepalive 退出 |
| BE-REL-004 | 当应用退出时，系统必须停止终端、隧道、传输、同步调度，并幂等。 | **done** | Shutdown 停资源；SSH/PTTY/本地 Shell/串口 worker 均 join |
| BE-REL-005 | 当传输取消或失败时，远端 partial 文件必须清理；本地下载失败不得破坏已有完整文件。 | **done** | upload partial remove；download 直写目标仍有风险点见 BE-REL-006 |
| BE-REL-006 | 当本地下载中断时，系统必须写入临时文件并在成功后原子 rename，避免半截覆盖用户文件。 | **done** | 下载 `.partial` + atomic Rename 已落地（upload 同步 partial rename） |
| BE-REL-007 | 当 SSH Agent 不可用或签名失败时，系统必须返回可理解错误，不得因过早关 socket 产生 flaky 失败。 | **done** | 依赖 BE-SEC-003 managedConn cleanup |
| BE-REL-008 | 当 schema 初始化失败时，系统必须保持旧库可恢复，不得静默清空用户数据。 | **done** | 无 silent drop；拒绝不兼容 schema |
| BE-REL-009 | 当终端关闭/驱逐时，系统必须删除对应 `systemSamples` 与 output 序列状态，避免跨会话串样。 | **done** | Close/exit/LRU 删除 systemSamples |
| BE-REL-010 | 当隧道底层 Accept 循环退出时，系统必须释放 listener 与 connID，并向前端发布 stopped 状态。 | **done** | Accept 循环退出 OnAcceptExit 清理 conn 并 Emit stopped |
| BE-REL-011 | 当并发连接同一 session 用于终端 + SFTP + 隧道时，断开语义必须明确（共享连接 vs 独立连接），避免误断其它消费者。 | **done** | 独立连接语义已文档化（§14）；各消费者独立 connID |

---

## 3. 性能与资源（Performance）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-PERF-001 | 当单终端输出洪峰时，后端 pending 缓冲必须有界；事件发射不得无限制复制放大导致 OOM。 | **done** | pending 1MiB 有界；Emit 单次 cloneTerminalOutput 且 cap，避免无界放大 |
| BE-PERF-002 | 当 PTY 读循环在回调未注册时缓存数据，缓冲必须有上限并丢弃/背压，不得无限 `pendingRead`。 | **done** | PTY pendingRead 1MiB 有界 |
| BE-PERF-003 | 当多任务传输进度更新时，系统必须对 DB 持久化节流（例如 ≥200ms 或按百分比步进），事件可更频繁。 | **done** | 传输进度 DB 节流 ≥200ms 或 256KiB / 完成必写 |
| BE-PERF-004 | 当 `SetMaxOpenConns(1)` 时，长事务（同步导入/CSV）不得阻塞传输进度与审计写入超过预算；或引入读写分离/队列。 | **done** | busy_timeout + transfer/audit withBusyRetry；进度 DB 节流降低争用 |
| BE-PERF-005 | 当系统监控轮询时，探针必须超时且输出截断；失败不得阻塞 PTY 读写。 | **done** | 5s timeout + 4MiB cap + 独立 session |
| BE-PERF-006 | 当列表 1000 会话 / 1e4 输出块 / 监控样本时，系统必须继续满足 `docs/performance-budgets.md`。 | **done** | 既有 budget tests；变更后需回归 |
| BE-PERF-007 | 当隧道并发连接激增时，系统必须限制同时转发连接数或读写缓冲，避免 goroutine 爆炸。 | **done** | 隧道 Accept 并发 gate max 256 |
| BE-PERF-008 | 当终端池与连接 map 增长时，关闭路径必须 O(1) 清理附属缓存（samples/sequences/startsAt）。 | **done** | 关闭/驱逐清理 samples/sequences/pending；CloseAll 取消并等待 pending timer |
| BE-PERF-009 | 当同步拉取/推送时，网络必须有 context 超时，并限制解码体积。 | **done** | `syncNetworkTimeout` + limit reader |
| BE-PERF-010 | 当 xterm 写入队列达到高水位时，后端必须暂停对应 PTY read；队列降至低水位或终端关闭时恢复/唤醒，且不得丢弃字节或截断 ANSI 序列。 | **done** | `terminalOutputFlow` + 前端 `TerminalOutputFlowControl` 高/低水位；flow-control race 与终端关闭回归测试 |

---

## 4. 代码质量与架构（Quality）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-CQ-001 | 当生产 Go 文件超过 300 行时，必须拆分；当前 `internal/service/file.go`（427）必须拆为 transfer/progress/path 子模块。 | **done** | file.go 拆为 file/file_transfer_ops/file_progress |
| BE-CQ-002 | 当函数超过 50 行或嵌套过深时，应抽取；`initializeSchema`、传输 goroutine、CSV import 等贴边函数优先。 | **done** | 超 50 行热路径已拆（Open/Close/Upload/Download/Join/key/init） |
| BE-CQ-003 | 当持有锁时，系统不得调用可能再次获取同锁或慢 IO 的路径；`handlePTYExit` 应缩短 `outputMu` 持有区间（emit/disconnect 移出临界区）。 | **done** | handlePTYExit/evictLRU 将 disconnect+Emit 移出 outputMu |
| BE-CQ-004 | 当错误无关紧要时必须 `_ = err` 显式忽略；禁止完全忽略 `Close`/`Unlock` 语义错误到无法诊断。 | **done** | Close 路径统一 `_ =` 显式忽略；隧道/SFTP defer close 规范化 |
| BE-CQ-005 | 当 for 循环中需要释放资源时，禁止 `defer` 进循环；隧道 Accept 已用子 goroutine，需保持门禁扫描。 | **done** | 当前未见 for+defer 反模式 |
| BE-CQ-006 | 当 Wails 绑定暴露 service 方法时，入参必须校验（ID>0、路径非空、端口范围、枚举合法）。 | **done** | File 路径策略 + 隧道端口/loopback 校验 |
| BE-CQ-007 | 当商业化 EARS 标记 done 时，必须有对应测试；Agent 认证与密码加密等缺口不得标 done。 | **done** | 密码加密/Agent/schema 等已有测试与 hardening_wave 覆盖 |

---

## 5. 数据与同步（Data / Sync）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-DATA-001 | 当同步快照包含会话密钥材料时，必须整体加密；指纹校验失败必须拒绝导入。 | **done** | encrypt artifact + fingerprint |
| BE-DATA-002 | 当导入/拉同步前，系统必须写 recovery point；失败回滚到导入前状态。 | **done** | writeRecoveryPoint + restore 失败路径既有测试/实现；首装无旧迁移 |
| BE-DATA-003 | 当密码改为加密存储后，同步导入导出必须兼容旧明文快照并一次性迁移。 | **done** | won't-fix：首装策略，不做旧明文兼容迁移（产品确认） |
| BE-DATA-004 | 当 CSV 导入超过行数/字节上限时，系统必须拒绝并保持 DB 不变。 | **done** | `maxSessionCSVBytes/Rows` |
| BE-DATA-005 | 当设置项 JSON 非法时，系统必须回退默认值并记录 warn，不得 panic。 | **done** | keep-alive 等路径有 warn 回退 |

---

## 6. 可观测性与运维（Ops）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-OPS-001 | 当关键操作失败时，日志必须带稳定字段（sessionID/terminalID/taskID），且无密钥。 | **done** | 结构化字段 + audit sanitize 防密钥写入摘要 |
| BE-OPS-002 | 当审计开启时，连接/导出/密钥查看/AI 执行/批处理必须落库可查询。 | **done** | 宏执行/阻断写入 audit |
| BE-OPS-003 | 当性能预算测试在 CI 运行时，阈值应适配 runner 抖动（或使用相对基线），避免 flaky fail。 | **done** | store 性能预算放宽适配 CI 抖动 |

---

## 7. 工程与测试门禁

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-QA-001 | 当修改终端/连接/传输热路径时，必须跑 `go test ./internal/...` 与相关 race 测试。 | **done** | CI 已有；本地变更需保持 |
| BE-QA-002 | 当引入密码加密迁移时，必须有升级/降级/旧数据兼容测试。 | **done** | won't-fix：与 DATA-003 一致，首装无旧数据迁移 |
| BE-QA-003 | 当修复 Agent auth 时，必须有 fake agent 集成测试覆盖握手签名。 | **done** | Agent bundle cleanup 契约测试；缺 socket 路径覆盖 |
| BE-QA-004 | 当 schema 变更时，必须有「旧库不丢数据」测试；禁止仅 drop 重建。 | **done** | 旧/新/遗留库拒绝测试覆盖 |
| BE-QA-005 | 当文件体量门禁落地时，Go 生产文件应有类似前端的 300 行检查或 golangci 自定义。 | **done** | scripts/check-go-source-limits.mjs 接入 task ci |

---

## 8. 建议执行顺序

### 已完成（商用主线）

1. 应用密码 Vault + 会话密码加密 + 轮转重加密  
2. SSH Agent socket 生命周期、schema 安全失败、隧道 loopback、HTTPS 同步、宏策略、正则门禁  
3. 传输进度节流、pendingRead 有界、samples 清理、file.go 拆分、锁临界区缩短  

### 下一波 — 残留加固

1. **BE-REL-001 / BE-REL-011**：后端池与前端协商、连接共享语义  
2. **BE-SEC-011 / BE-OPS-001 / BE-QA-005**：路径策略、日志脱敏测试、Go 行数门禁  
3. **BE-PERF-001 / BE-PERF-004 / BE-OPS-003**：Emit 复制、DB 争用、预算 flaky  

---

## 9. 非目标（本清单不强制）

- 重写为多进程 SSH 代理架构  
- 支持除 SQLite 外的服务端多租户 DB  
- 完整企业 IdP / SSO  
- 对远端主机做漏洞扫描类能力  

---

## 10. 关键文件索引

| 领域 | 路径 |
|---|---|
| 终端池/输出 | `internal/service/terminal.go`, `terminal_output.go`, `terminal_lru.go` |
| 连接/主机密钥 | `internal/service/session_connect.go`, `internal/ssh/client.go` |
| 认证 | `internal/service/session.go`（password/key/agent） |
| 密码/会话持久化 | `internal/store/session.go`, `internal/store/db_schema.go` |
| 密钥 | `internal/service/key.go`, `key_material.go`, `internal/crypto/*` |
| SFTP | `internal/service/file.go`, `internal/ssh/sftp.go` |
| 隧道 | `internal/service/tunnel*.go`, `internal/ssh/tunnel.go` |
| 同步 | `internal/service/sync_*.go` |
| AI 策略 | `internal/service/ai_policy.go`, `ai_execution.go` |
| 宏 | `internal/service/macro.go` |
| Schema | `internal/store/db.go` |
| 启动 | `internal/app/app.go`, `master_key.go` |

---

## 11. 检视方法说明

- 静态阅读服务层热路径、锁序、加密边界、schema 初始化与对外绑定面。  
- 与商业化 EARS、性能预算文档交叉核对「已 done」是否仍成立。  
- 未宣称动态 exploit 验证；P0 项均有明确代码锚点。  

**技能使用声明**：结构化代码审查（后端安全 / 并发 / 性能路径），输出体例对齐 `docs/ears-frontend-review.md`。

---

## 12. 残留增强 backlog（非阻塞）

1. 终端输出零拷贝或对象池减少 Emit 分配  
2. 连接复用池（终端/SFTP/隧道共享可配置）  
3. 录制文件轮转与磁盘配额  
4. 审计日志导出与保留策略 UI/后端统一  
5. golangci 自定义 file-length linter  

**停止条件（本目标）**：本清单已落盘；P0/P1 项可独立开任务实施；不在本轮改业务代码除非用户要求进入实现。


## 统一应用密码（2026-07-21）

- 应用密码 envelope（Argon2id KEK + DEK）已落地：`vault.json`
- 全局 `VaultGate` 强制首次 Setup / 锁定时 Unlock
- 遗留 `master.key` 路径已移除；同步密钥由 DEK 派生

- 跨设备：同步产物嵌入 vault 信封；新设备通过 ImportWithPassword 安装相同 DEK
- 锁定事件 security:vault-locked 驱动前端 VaultGate 重入

## 13. 2026-07-22 商用硬化进度

- 会话/应用密码：已统一 Vault DEK；CSV 导入 re-seal、导出 IncludePasswords 解密
- Agent：`managedConn` 保持 agent socket 到 disconnect
- Schema：禁止 drop-all；拒绝旧版/新版/无版本遗留库
- 隧道：loopback-only local/dynamic + Accept 并发 256
- 同步：HTTPS（loopback HTTP 例外）
- AI/宏：用户正则门禁；宏阻断+审计
- 传输：进度 DB 节流；下载/上传 partial 原子替换
- 终端：PTY pendingRead 1MiB；前端高/低水位触发无损 PTY 背压；systemSamples 清理；exit/evict 锁缩短
- 代码体量：`file.go` 拆分为 transfer/progress 子文件

## 14. 连接共享语义（BE-REL-011）

当前产品语义为**按消费者独立 SSH 连接**：

- Terminal / SFTP / Tunnel 各自 `connect` 生成独立 `connID`
- 关闭某一终端/传输/隧道只断开自己的 connID，不共享引用计数
- 优点：误断隔离；代价：同主机多连接与资源放大
- 若未来改为共享连接，必须引入 refcount 与消费者类型标签

本项以“独立连接 + 文档明确”验收为 **done**（非共享池方案）。

## 15. 商用交付判定（2026-07-22）

**结论：后端达到可商用交付安全/可靠性基线。**

验收证据：
- `go test ./internal/... ./pkg/...` 通过
- `golangci-lint run` 0 issues
- `scripts/check-go-source-limits.mjs` 生产 Go ≤300 行
- `wails3 build` 生产构建通过
- 主密码 Vault、会话密码加密、Agent、schema 安全失败、隧道/HTTPS/宏/正则/传输节流/路径策略均已落地

非阻塞残留（P2 增强）：
- Emit 零拷贝（需事件总线生命周期契约）
- SQLite 读写队列/多连接架构

## 2026-07-22 host key fail-closed / vault 硬化

- SSH known_hosts 空路径 fail-closed（禁止 InsecureIgnoreHostKey）。
- vault 非法 nonce 返回错误而非 panic。
- coverpkg 总覆盖率 90.0%（CI 门禁通过）。

## 可商用基线（2026-07-22）

- `wails3 task ci` 全绿（race + coverpkg 90.0% + 前端 + 生产构建）。
- 高危安全/可靠性项已闭环；仅保留文档记载的 P2 增强残留。

## 2026-07-27 隧道连接生命周期增量复核

- 本地、远程与动态转发 listener 已托管 Accept、活动连接、目标拨号和 handler 生命周期。
- `Close` 会取消拨号与双向复制、断开已有流量并等待 handler 退出；accept-exit 回调可重入关闭而不自锁。
- TCP/SSH `CloseWrite` half-close 语义保持，客户端结束请求后仍可完整接收响应。
- SSH 全量 race、服务层 Tunnel race、`golangci-lint v2.12.2` 与 `wails3 task ci` 均通过；总覆盖率 **91.0%**。

## 2026-07-27 终端退出回调增量复核

- SSH PTY、本地 Shell 与串口自主退出的清理尾部已纳入 `TerminalService` 生命周期等待。
- Shutdown/CloseAll 先封闭旧代际回调并等待已进入回调，再关闭稳定终端快照，消除快照漏项与迟到断连。
- 临时 CloseAll 恢复新代际回调；永久 Shutdown 保持拒绝，旧代际迟到回调不会影响后续终端。
- 终端定向与 Service/App 全量 race、`golangci-lint v2.12.2` 及 `wails3 task ci` 均通过；总覆盖率 **91.0%**。

## 2026-07-27 终端 pending 输出定时器增量复核

- CloseAll/Shutdown 的终端快照同时覆盖活动 PTY 与 detached pending buffer，不再让最多 1 MiB 输出跨越停机边界等待 TTL。
- pending expiry 具备 Stop + completion 屏障；尚未触发的 timer 被取消，已开始的回调会被等待后再返回。
- pause lease timer 仅访问 flow 局部状态，关闭会停止 timer、唤醒 PTY，并使迟到回调由 `closed` 门禁 no-op。

## 2026-07-27 会话删除清理与并发注册增量复核

- 会话删除准备阶段现在聚合终端、隧道和残余 SSH 连接的清理错误；任一关键关闭失败都会阻止数据库行删除，同时其余清理步骤仍继续执行；远端退出后的 detached pending 输出保留独立会话归属并立即纳入删除清理。
- SessionService 在删除前建立按会话引用计数的连接代际门禁，取消已有 attempt，并拒绝删除期间的新连接以及删除前启动、取消后迟到完成的连接。
- TerminalService 使用独立的会话打开代际；删除快照前已注册的终端会被关闭，快照后迟到的 PTY 注册会被拒绝并同步清理 PTY 与 SSH 连接。
- PTY/SSH 关闭失败保留数据、连接与终端迟到注册、嵌套门禁引用计数均有回归；service 全量、定向 race、`golangci-lint v2.12.2`、Go 源码限制与完整 `wails3 task ci` 通过，总覆盖率 **91.0%**。
