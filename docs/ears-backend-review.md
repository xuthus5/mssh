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
- **主密钥存储优先 Keychain**，文件降级时目录 `0700` / 文件 `0600`（`internal/app/master_key.go`、`store.OpenDB`）。
- **主机密钥 TOFU + 用户确认**：未知指纹走 `HostKeyFingerprint` 事件与 `DecideHostKey`，变更非空 `Want` 会阻断（`session_connect.go`、`ssh/client.go`）。
- **SQLite 工程化**：WAL + `busy_timeout(5000)` + `foreign_keys=1` + `MaxOpenConns(1)`，数据目录权限收紧。
- **终端输出有界**：pending 输出 `1 MiB` + `1m` TTL；池 LRU；输出 sequence 保证前端还原顺序。
- **SFTP 传输**：`.mssh-partial-*` 临时文件 + rename；下载本地 `0600`；进度可持久化；可取消。
- **AI 安全策略**：危险命令硬阻断、自定义 deny/allow、只读自动执行、密钥脱敏与审计记录。
- **系统探针有超时与输出上限**，避免监控拖死终端主路径。
- **性能预算测试存在**（会话列表 / 传输进度 / 终端分发 / 监控解析）。

### 0.2 主要风险（按严重度）

| 级别 | 主题 | 证据摘要 |
|---|---|---|
| **P0** | 会话密码明文落库 | `sessions.password TEXT` 直接写入；`session_crud` / `store` 无 Encrypt；CSV 可明文导出 |
| **P0** | SSH Agent 认证 socket 过早关闭 | `buildAgentAuth` 在返回前 `defer sock.Close()`，握手阶段 signer 可能失效 |
| **P0** | Schema 版本不一致时 drop 全表 | `initializeSchema`：`user_version != target` → `dropApplicationTables` 无用户备份门闩 |
| **P1** | 后端终端 LRU 可静默踢掉仍在用的连接 | `Open` 中 `len(ptys)>=maxSize` 直接 `evictLRU`，与前端 Tab 生命周期弱协调 |
| **P1** | 传输进度每块写 SQLite | `reportProgress` 每 32KiB 回调 `UpdateTransferProgress` + 单连接 DB → 高争用 |
| **P1** | `systemSamples` 终端关闭不清理 | 长期开关终端后 map 只增不减 |
| **P1** | PTY `pendingRead` 无上界 | 回调未挂上前持续 `append`，极端可放大内存 |
| **P1** | 隧道监听地址与并发无策略 | Local/Dynamic 可绑非 loopback；Accept 无连接上限 |
| **P1** | 宏执行无 AI 同级命令策略 | `MacroService.Execute` 直接 `Write`，可绕过 AI 审批矩阵 |
| **P1** | `file.go` 超 300 行门禁 | 427 行，违反 AGENTS 文件体量约定 |
| **P2** | 同步 API Base 允许 `http` | Gist/WebDAV URL scheme 未强制 HTTPS |
| **P2** | 用户自定义正则 ReDoS 面 | AI allow/deny/redact 编译用户输入 regexp |
| **P2** | 本地路径校验偏弱 | ListDir/Upload/Download 主要信任调用方路径 |
| **P2** | 进程/系统探针偏 Linux | `ps -eo ... --sort` 在 macOS/BusyBox 可能失败（已有局部降级，体验不一致） |

---

## 1. 安全与隐私（Security）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-SEC-001 | 当会话密码写入本地数据库时，系统必须使用与私钥相同强度的主密钥加密（AES-GCM）；读取连接前解密；列表/导出默认不得返回明文。 | **todo** | `sessions.password` 明文；`CreateSession`/`UpdateSession` 直写；私钥路径有 Encrypt |
| BE-SEC-002 | 当用户导出 CSV 且未显式确认「包含密码」时，系统不得写入密码列；包含密码时必须二次确认、审计、默认安全文件权限，并提示风险。 | **partial** | `IncludePasswords` + audit + `writePrivateFileAtomic` 已有；缺强确认契约与加密落库后的一致性 |
| BE-SEC-003 | 当使用 SSH Agent 认证时，系统必须在整个认证握手（及需要签名的生命周期）内保持 agent 连接可用，握手完成后再关闭 socket。 | **todo** | `session.go` `buildAgentAuth`：取 signers 后 defer Close，可能导致 agent auth 失败 |
| BE-SEC-004 | 当数据库格式版本升级时，系统不得在无备份/无用户确认的情况下 drop 全部业务表；必须迁移或拒绝启动并给出恢复指引。 | **todo** | `store/db.go` `initializeSchema` drop-all 路径 |
| BE-SEC-005 | 当首次未知主机密钥出现时，系统必须等待用户确认后才写入 known_hosts；指纹变更必须拒绝连接。 | **done** | `awaitHostKeyDecision` + knownhosts `KeyError.Want` |
| BE-SEC-006 | 当私钥材料生成/导入/查看时，系统必须加密存储、审计查看行为，并限制导入文件大小。 | **done** | `KeyService` Encrypt + `key_view` audit + `maxPrivateKeyFileSize` |
| BE-SEC-007 | 当 AI 或自动化路径执行远端命令时，系统必须应用阻断/审批策略并记录 outcome；宏执行不得成为策略旁路。 | **partial** | AI `ExecuteCommand` 有策略；`MacroService.Execute` 无策略 |
| BE-SEC-008 | 当配置云同步 provider 时，系统必须强制 HTTPS（或明确的本机例外白名单），并限制响应体大小。 | **partial** | Gist decode 有 `maxCloudBackupSize`；`http` scheme 仍允许 |
| BE-SEC-009 | 当记录日志/审计时，系统不得输出密码、私钥、主密钥、完整 Bearer/Token、同步 master key。 | **partial** | 商业化 SEC-003 标 done；仍需 spot-check 连接/CSV/密钥错误路径是否带敏感字段 |
| BE-SEC-010 | 当用户提供自定义正则（AI deny/allow/redact）时，系统必须限制复杂度/超时或预编译失败即拒，避免 ReDoS 拖垮事件循环。 | **todo** | `regexp.Compile` 用户输入无复杂度门禁 |
| BE-SEC-011 | 当 SFTP/本地文件 API 接收路径时，系统必须规范化并拒绝危险本地路径（如非常规 symlink 逃逸策略按产品定义），远程路径保持会话沙箱语义清晰。 | **partial** | 本地下载 `MkdirAll 0700`/`OpenFile 0600`；缺少统一 path policy |
| BE-SEC-012 | 当隧道 Local/Dynamic 启动时，默认监听地址必须是 loopback；绑定非 loopback 需要显式高级选项与风险提示。 | **todo** | 默认 `127.0.0.1` 有，但未禁止用户配置 `0.0.0.0` |
| BE-SEC-013 | 当进程退出时，系统应尽力清零内存中的主密钥缓冲（best-effort），并关闭 keychain 句柄与打开的密钥材料缓存。 | **todo** | master key 常驻进程；未见 shutdown zeroize |

---

## 2. 可用性与可靠性（Reliability / Availability）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-REL-001 | 当终端数量达到 `maxSize` 时，系统不得静默断开仍被 UI 引用的终端；必须与前端池回收策略对齐，或返回明确错误并要求用户关闭。 | **partial** | 后端 `evictLRU` + 前端 `ensureTerminalPoolCapacity` 双轨，仍可能竞态 |
| BE-REL-002 | 当远端 shell 退出时，系统必须清理 PTY、连接引用、pending 输出策略，并可靠发出 `disconnected`。 | **done** | `handlePTYExit` + 测试覆盖历史问题 |
| BE-REL-003 | 当连接 keep-alive 连续失败达到阈值时，系统必须关闭连接一次，且不与正常输入路径死锁。 | **done** | `startKeepAlive` failCount>=3 Close |
| BE-REL-004 | 当应用退出时，系统必须停止终端、隧道、传输、同步调度，并幂等。 | **partial** | lifecycle/Quit 路径存在；需核对 `CloseAll` 是否覆盖 FileService tasks / Sync scheduler |
| BE-REL-005 | 当传输取消或失败时，远端 partial 文件必须清理；本地下载失败不得破坏已有完整文件。 | **done** | upload partial remove；download 直写目标仍有风险点见 BE-REL-006 |
| BE-REL-006 | 当本地下载中断时，系统必须写入临时文件并在成功后原子 rename，避免半截覆盖用户文件。 | **todo** | `DownloadFileContext` 直接 `O_TRUNC` 目标路径（上传侧已 partial） |
| BE-REL-007 | 当 SSH Agent 不可用或签名失败时，系统必须返回可理解错误，不得因过早关 socket 产生 flaky 失败。 | **todo** | 依赖 BE-SEC-003 |
| BE-REL-008 | 当 schema 初始化失败时，系统必须保持旧库可恢复，不得静默清空用户数据。 | **todo** | 依赖 BE-SEC-004 |
| BE-REL-009 | 当终端关闭/驱逐时，系统必须删除对应 `systemSamples` 与 output 序列状态，避免跨会话串样。 | **todo** | 仅见写入 `systemSamples`，关闭路径未 delete |
| BE-REL-010 | 当隧道底层 Accept 循环退出时，系统必须释放 listener 与 connID，并向前端发布 stopped 状态。 | **partial** | Start/Stop 有状态事件；异常 Accept 返回路径需统一 cleanup 审计 |
| BE-REL-011 | 当并发连接同一 session 用于终端 + SFTP + 隧道时，断开语义必须明确（共享连接 vs 独立连接），避免误断其它消费者。 | **partial** | File/Tunnel/Terminal 各自 `connect` 新 connID；资源放大与误断风险需文档化/收敛 |

---

## 3. 性能与资源（Performance）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-PERF-001 | 当单终端输出洪峰时，后端 pending 缓冲必须有界；事件发射不得无限制复制放大导致 OOM。 | **partial** | pending 1MiB 有界；每次 Emit 仍 `append([]byte(nil), data...)` 复制 |
| BE-PERF-002 | 当 PTY 读循环在回调未注册时缓存数据，缓冲必须有上限并丢弃/背压，不得无限 `pendingRead`。 | **todo** | `pty.deliverRead` 无上限 append |
| BE-PERF-003 | 当多任务传输进度更新时，系统必须对 DB 持久化节流（例如 ≥200ms 或按百分比步进），事件可更频繁。 | **todo** | `reportProgress` 每块写库；SQLite 单连接 |
| BE-PERF-004 | 当 `SetMaxOpenConns(1)` 时，长事务（同步导入/CSV）不得阻塞传输进度与审计写入超过预算；或引入读写分离/队列。 | **partial** | 有 busy_timeout；缺任务级队列与预算 |
| BE-PERF-005 | 当系统监控轮询时，探针必须超时且输出截断；失败不得阻塞 PTY 读写。 | **done** | 5s timeout + 4MiB cap + 独立 session |
| BE-PERF-006 | 当列表 1000 会话 / 1e4 输出块 / 监控样本时，系统必须继续满足 `docs/performance-budgets.md`。 | **done** | 既有 budget tests；变更后需回归 |
| BE-PERF-007 | 当隧道并发连接激增时，系统必须限制同时转发连接数或读写缓冲，避免 goroutine 爆炸。 | **todo** | Accept 后无上限 `go handle` |
| BE-PERF-008 | 当终端池与连接 map 增长时，关闭路径必须 O(1) 清理附属缓存（samples/sequences/startsAt）。 | **partial** | sequences/pending 有删；samples/部分 map 不全 |
| BE-PERF-009 | 当同步拉取/推送时，网络必须有 context 超时，并限制解码体积。 | **done** | `syncNetworkTimeout` + limit reader |

---

## 4. 代码质量与架构（Quality）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-CQ-001 | 当生产 Go 文件超过 300 行时，必须拆分；当前 `internal/service/file.go`（427）必须拆为 transfer/progress/path 子模块。 | **todo** | wc 427 |
| BE-CQ-002 | 当函数超过 50 行或嵌套过深时，应抽取；`initializeSchema`、传输 goroutine、CSV import 等贴边函数优先。 | **partial** | 多文件已拆；file/sync/csv 仍重 |
| BE-CQ-003 | 当持有锁时，系统不得调用可能再次获取同锁或慢 IO 的路径；`handlePTYExit` 应缩短 `outputMu` 持有区间（emit/disconnect 移出临界区）。 | **todo** | exit 路径持 `outputMu` 期间 disconnect + Emit |
| BE-CQ-004 | 当错误无关紧要时必须 `_ = err` 显式忽略；禁止完全忽略 `Close`/`Unlock` 语义错误到无法诊断。 | **partial** | 多数 defer Close 已 `_ =`；关键路径需保持 logger |
| BE-CQ-005 | 当 for 循环中需要释放资源时，禁止 `defer` 进循环；隧道 Accept 已用子 goroutine，需保持门禁扫描。 | **done** | 当前未见 for+defer 反模式 |
| BE-CQ-006 | 当 Wails 绑定暴露 service 方法时，入参必须校验（ID>0、路径非空、端口范围、枚举合法）。 | **partial** | 多处有校验；File 路径/隧道端口边界需统一 |
| BE-CQ-007 | 当商业化 EARS 标记 done 时，必须有对应测试；Agent 认证与密码加密等缺口不得标 done。 | **todo** | 对照 `ears-commercial-hardening.md` 回写状态 |

---

## 5. 数据与同步（Data / Sync）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-DATA-001 | 当同步快照包含会话密钥材料时，必须整体加密；指纹校验失败必须拒绝导入。 | **done** | encrypt artifact + fingerprint |
| BE-DATA-002 | 当导入/拉同步前，系统必须写 recovery point；失败回滚到导入前状态。 | **partial** | `writeRecoveryPoint` 存在；需验证失败原子性 |
| BE-DATA-003 | 当密码改为加密存储后，同步导入导出必须兼容旧明文快照并一次性迁移。 | **todo** | 依赖 BE-SEC-001 |
| BE-DATA-004 | 当 CSV 导入超过行数/字节上限时，系统必须拒绝并保持 DB 不变。 | **done** | `maxSessionCSVBytes/Rows` |
| BE-DATA-005 | 当设置项 JSON 非法时，系统必须回退默认值并记录 warn，不得 panic。 | **done** | keep-alive 等路径有 warn 回退 |

---

## 6. 可观测性与运维（Ops）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-OPS-001 | 当关键操作失败时，日志必须带稳定字段（sessionID/terminalID/taskID），且无密钥。 | **partial** | slog 结构化较好；需脱敏回归测试 |
| BE-OPS-002 | 当审计开启时，连接/导出/密钥查看/AI 执行/批处理必须落库可查询。 | **partial** | 多点 `recordAudit`；宏执行审计弱 |
| BE-OPS-003 | 当性能预算测试在 CI 运行时，阈值应适配 runner 抖动（或使用相对基线），避免 flaky fail。 | **partial** | 历史有 store budget flaky；需稳健化 |

---

## 7. 工程与测试门禁

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| BE-QA-001 | 当修改终端/连接/传输热路径时，必须跑 `go test ./internal/...` 与相关 race 测试。 | **done** | CI 已有；本地变更需保持 |
| BE-QA-002 | 当引入密码加密迁移时，必须有升级/降级/旧数据兼容测试。 | **todo** | |
| BE-QA-003 | 当修复 Agent auth 时，必须有 fake agent 集成测试覆盖握手签名。 | **todo** | |
| BE-QA-004 | 当 schema 变更时，必须有「旧库不丢数据」测试；禁止仅 drop 重建。 | **todo** | |
| BE-QA-005 | 当文件体量门禁落地时，Go 生产文件应有类似前端的 300 行检查或 golangci 自定义。 | **todo** | 目前主要靠人工/AGENTS |

---

## 8. 建议执行顺序

### 第 1 波 — P0（数据与认证正确性）

1. **BE-SEC-001 / BE-DATA-003**：会话密码加密 at-rest + 迁移  
2. **BE-SEC-003 / BE-REL-007**：修复 SSH Agent socket 生命周期  
3. **BE-SEC-004 / BE-REL-008 / BE-QA-004**：废除静默 drop-all，改为迁移或安全失败  

### 第 2 波 — P1（可靠性与性能）

4. **BE-REL-001**：终端池驱逐与前端协商 / 禁止静默踢 Tab  
5. **BE-REL-006**：下载临时文件原子替换  
6. **BE-PERF-003 / BE-PERF-004**：传输进度 DB 节流  
7. **BE-REL-009 / BE-PERF-002 / BE-PERF-008**：samples / pendingRead 有界与清理  
8. **BE-SEC-007**：宏执行接入命令策略或独立风险确认  
9. **BE-SEC-012 / BE-PERF-007**：隧道绑定与并发限制  
10. **BE-CQ-001 / BE-CQ-003**：拆 `file.go`、缩短锁临界区  

### 第 3 波 — P2（加固与体验）

11. **BE-SEC-008/010/011/013**、**BE-OPS-***、探针跨平台、预算 flaky 治理  

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
