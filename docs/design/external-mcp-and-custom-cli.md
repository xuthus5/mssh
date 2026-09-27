# 外部 MCP 接入与自定义 CLI 设计

## 1. 背景与目标

当前 MSSH 只能通过内置的 Codex / Claude Code / OpenCode 三种 CLI 执行 `local_cli` Agent 任务，
CLI 列表、校验、适配器均为硬编码。用户希望：

1. **对外提供常驻 MCP 端点**：让任意外部 CLI（例如 `command-code` CLI）自行连接 MSSH 的 MCP
   服务，并通过 MSSH 的工具操作远程主机。
2. **支持手动录入 CLI**：在"本机 Agent CLI"中登记自定义 CLI（命令、参数模板、环境变量），
   由 MSSH 拉起并向其注入 MCP 端点。

### 目标

- 提供一个由用户显式开启、仅监听 `127.0.0.1`、带 Token 鉴权的常驻 MCP 端点。
- 端点绑定用户选定的会话；所有工具调用复用现有 `performAIAgentAction` 执行链与逐次审批。
- 支持登记自定义 CLI，并通过占位符模板注入 MCP url/token 与 prompt。
- 保持现有安全基线：写操作审批、高危命令硬阻断、步骤落库与审计、输出限流与脱敏。

### 非目标

- 不引入远程（非 loopback）监听，不支持跨机器访问。
- 不改变现有 `native` 引擎与三种内置 CLI 的既有行为。
- 不提供 MCP resources / prompts 能力，仅保留 tools。

## 2. 现状与约束

关键结论（来自源码核对）：

- MCP 服务按任务临时创建：`runLocalCLIAgent`（`internal/service/ai_agent_cli.go`）内
  `startAIAgentMCPServer` 监听 `127.0.0.1:0`，一次性 64 位十六进制 Token，CLI 子进程结束即销毁。
- `aiAgentMCPBridge`（`ai_agent_cli.go`）持有 `task`、`connection`、`execution`、`security`、
  `sequence`、`finished`、`callGate`，**与单个任务/会话强绑定，无法服务多个客户端**。
- 工具调用必须挂到已存在的 `ai_agent_tasks` 行：`performAIAgentAction` →
  `store.CreateAIAgentStep`/`UpdateAIAgentStepResult`（`ai_agent_engine.go`）。
- 审批依赖 `aiAgentExecution`（`ai_agent_runtime.go`）的 `cancel/done/approvals`，与
  Wails 的 `ApproveAgentStep` 联通。
- `AIAgentCLI` 为硬编码枚举（`internal/model/ai.go`）；`newAIAgentCLIAdapter`
  （`ai_agent_cli_adapters.go`）只识别 codex/claude/opencode；`validateAIAgentSettings`
  （`ai_policy.go`）同样硬编码。
- DB 约束：`ai_agent_tasks.engine CHECK(engine IN ('native','local_cli'))`、
  `cli CHECK(cli IN ('','codex','claude','opencode'))`（`internal/store/db_schema.go`）。
  项目仅用 `CREATE TABLE IF NOT EXISTS` + 手写 `ALTER TABLE ADD COLUMN`，**没有重建表以放宽
  CHECK 的迁移工具**。
- 设置整体存于 `ai_settings.interaction_json`（`store.SaveAISettings`），新增字段无需改表。
- Wails bindings 由 `wails3 generate bindings` 生成，`bindings_contract_test.go` 会校验一致性，
  模型变更必须重生成 bindings。

## 3. 总体方案

分两个独立但互补的能力，分阶段交付：

- **能力 A：常驻 MCP 端点**（面向"外部 CLI 自行连接"）。
- **能力 B：自定义 CLI 录入**（面向"由 MSSH 拉起并注入 MCP"）。

两者共用同一套 MCP 工具面与执行/审批链，区别只在 MCP 端点生命周期与调用方。

## 4. 能力 A：常驻 MCP 端点

### 4.1 数据模型

新增设置结构，挂在 `model.AIInteractionSettings` 下（随 `interaction_json` 持久化，无需改列）：

```go
type AIMCPServerSettings struct {
    SessionID int64 `json:"session_id"` // 绑定的会话
    Port      int   `json:"port"`       // 0 表示随机端口
}
```

> 实现说明：端点的运行状态是内存态，不持久化 `Enabled`；写操作审批沿用
> `prepareAIAgentToolRequest` 的风险规则（`ssh.write_file` 与 modify/high 命令需审批），
> 因此未引入 `RequireApproval`。`AIMCPServerInput`/`AIMCPServerStatus` 同形（后者额外含
> `running`/`url`/`token`/`session_name`）。

- 存储：随 `AISettings` 进入 `interaction_json`（或新增独立 `mcp_json` 列，见"迁移"）。
- Token：**不落 settings JSON**，存 OS 钥匙串，复用 `aiSecretStore`
  （`internal/service/ai_secrets.go`，account 形如 `agent-mcp`）。UI 仅通过状态接口读取。

### 4.2 运行时与生命周期

新增 `internal/service/ai_agent_mcp_server.go`：

- `StartAgentMCPServer() (*model.AIMCPServerStatus, error)`
  1. 校验 `Enabled`、`SessionID` 存在（`store.GetSession`）。
  2. 生成/加载 Token（钥匙串；`regenerate` 时覆盖）。
  3. 创建/复用一个"外部会话"执行上下文：注册 `aiAgentExecution`，仅用于 `done`/审批通道
     （不启动 `runAIAgentTask` 的 Agent 循环）。
  4. `net.Listen("tcp4", "127.0.0.1:<port>")`，记录实际地址。
  5. 启动 `http.Server`，Handler 复用 `serveHTTP`（路径 `/mcp`，同时对任意路径生效）。
- `StopAgentMCPServer() error`：`server.Shutdown` + 释放 execution + 关闭缓存连接。
- 应用关闭时（`ai_lifecycle.go` 的停止路径）一并停止，保证不残留监听。
- 绑定会话变更 / 关闭开关时自动重启端点。

### 4.3 会话绑定与请求路由

与现有 bridge 的关键差异：外部端点**没有预先创建的任务行**。处理方式：

- 端点持有 `sessionID`；首个工具调用时惰性 `store.CreateAIAgentTask`（`engine='external'`，
  `cli=''`，`status=running`）。**复用这单一任务**承载该端点会话的全部步骤，直到显式调用
  `task.finish`（或用户停止端点）——`task.finish` 将该任务置为 `completed`，下一个工具调用
  再创建新任务。
- SSH 连接：`openAIAgentSSH(ctx, sessionID)` 在端点生命周期内按需建立并缓存；连接失效时
  重建；停机时 `Close()`。
- 并发：采用**全局 FIFO 排队**。所有客户端共享一个串行队列，同一时刻只允许一个工具调用在途，
  其余请求按到达顺序排队执行（不返回忙、不并发）。队列长度设上限，超限返回 `-32003 overloaded`。
- 连接自愈：绑定的 SSH 连接失效时**自动重连**再执行当前调用；重连失败则返回错误并保持端点存活，
  等待下一次调用重试。
- `MaxPlanSteps` 仍按单个任务计数，与 Agent 语义一致。

### 4.4 审批与安全

- 写操作（`ssh.write_file`）与 `modify`/`high` 风险命令沿用 `authorizeAIAgentTool`：
  `request.Approval == pending` 时进入 `awaitAIAgentApproval`，任务状态置
  `waiting_approval`，前端"Agent 任务中心"可批准/拒绝（`ApproveAgentStep`）。
- `RequireApproval=false` 时仍保留 `Blocked` 硬阻断与高危模式匹配（`ai_policy.go`）。
- Token 鉴权：`Authorization: Bearer <token>`，使用常量时间比较（参考 unified IPC 的做法）。
- Token 展示：状态接口**直接返回明文**供本机设置窗口复制；Token 不落 settings JSON，仅存钥匙串；
  设置窗口隐藏时按现有约定清理明文；支持一键轮换（轮换后旧 Token 立即失效）。
- 仅 loopback 监听；请求体大小受 `MaxOutputBytes` 限制；步骤落库、输出脱敏与截断复用
  `sanitizeAIAgentText`。

### 4.5 对外 API（Wails bindings）

在 `AIService` 上新增：

```go
func (s *AIService) GetAgentMCPServerStatus() (model.AIMCPServerStatus, error)
func (s *AIService) StartAgentMCPServer(input model.AIMCPServerInput) (model.AIMCPServerStatus, error)
func (s *AIService) StopAgentMCPServer() error
func (s *AIService) RegenerateAgentMCPToken() (model.AIMCPServerStatus, error)
```

`AIMCPServerStatus` 返回：`enabled`、`running`、`url`、`token`（仅本机设置窗口可见）、
`session_id`、`session_name`、`connected`。

### 4.6 迁移

- **engine CHECK**：需允许 `'external'`。项目无重建表工具，需新增一次性迁移：
  创建新表（新 CHECK）→ `INSERT ... SELECT` → `DROP` 旧表 → `RENAME` → 重建索引/外键。
  迁移必须幂等且可回滚（先备份）。
- `aiAgentSteps.task_id` 外键仍指向 `ai_agent_tasks`，无需变更。
- 若选择把 MCP 设置放独立列，需 `ALTER TABLE ai_settings ADD COLUMN mcp_json TEXT`（本项目
  已有该模式），否则直接复用 `interaction_json`。

## 5. 能力 B：自定义 CLI 录入

### 5.1 数据模型

支持登记**多个**自定义 CLI，每个条目有稳定 `ID`，任务通过 `custom:<id>` 选择具体条目：

```go
type AICustomCLI struct {
    ID         string   `json:"id"`          // 稳定标识，选择值为 "custom:<id>"
    Name       string   `json:"name"`        // 展示名
    Command    string   `json:"command"`     // 可执行文件（名或绝对路径）
    Args       []string `json:"args"`        // 参数模板
    Env        []string `json:"env"`         // KEY=VALUE 模板
    PromptMode string   `json:"prompt_mode"` // "stdin" | "arg"
    VersionArg string   `json:"version_arg"` // 版本检测参数，默认 "--version"
}
```

- 挂在 `AIAgentSettings.CustomCLIs []AICustomCLI`，随 `interaction_json` 存储，无需改表。
- 占位符：`{workdir}`、`{prompt}`，在 `Args`、`Env`、`PromptMode=arg` 的 prompt 中展开；
  `PromptMode=stdin` 时 prompt 走 stdin。
- 自定义 CLI 只作为**启动器**：它必须先在自身配置里注册好 mssh MCP（即能力 B / 路线 B），
  MSSH 不注入任何 MCP 地址或 Token。
- 前端提供列表式管理：`添加自定义 CLI` 追加条目（前端生成随机 ID），每条可编辑并可删除。

### 5.2 适配器与事件校验

- `newAIAgentCLIAdapter` 增加 `case model.AIAgentCLICustom` → `customAIAgentAdapter`：
  - `exec.LookPath(Command)`；模板展开后构造 `exec.Cmd`；`Dir=workDir`。
  - `ManagesOwnMCP()` 声明"该 CLI 使用自己注册好的 MCP"，`runLocalCLIAgent` 据此**不启动**每次任务的
    临时 MCP 端点、不注入凭据，只拉起 CLI 并把 stdout 作为任务结果（`runAIAgentCLIWithOwnMCP`）。
  - `ValidateEvent`：仅要求每行是合法 JSON；不强制工具名（自定义 CLI 由用户显式登记，
    属于显式信任决策）。安全仍由 MCP 工具白名单 + 审批保证。
  - 内置 codex/claude/opencode 仍走"每次任务临时端点 + `task.finish`"的原路径，行为不变。
- 检测：`--version` 使用 `VersionArg`；无法检测时标记为"未验证"而非失败。

### 5.3 DB 迁移

`ai_agent_tasks.cli` 直接改为不受约束的文本列（`custom:<id>` 是动态值，无法用枚举 CHECK 表达）；
与能力 A 的不兼容 schema 变更一并生效，不做迁移。

### 5.4 UI

- "本机 Agent CLI"卡片新增"自定义 CLI"编辑区：名称、命令、参数（逐行）、环境变量（逐行）、
  prompt 传递方式；保存后进入检测列表，可设为默认 CLI。
- `AIAgentTaskViews.tsx` 的任务 CLI 下拉增加"自定义 CLI"选项（数据驱动）。
- 所有新中文字符串必须同步补充 `frontend/src/i18n/en.json`（i18n 静态守卫）。

### 5.5 Bindings

- 模型变更后执行 `wails3 generate bindings -ts` 重生成 `frontend/bindings/**`。

## 6. 安全与威胁模型

| 风险 | 缓解 |
| --- | --- |
| 外部进程越权操作远程主机 | 仅 loopback + Token 鉴权；工具白名单固定 6 个；写操作强制审批 |
| Token 泄漏 | 存 OS 钥匙串；UI 隐藏窗口时清理明文；支持一键轮换 |
| 绑定会话被误用 | 端点仅操作 `SessionID` 绑定的会话；工具不带 `sessionId` 参数 |
| 自定义 CLI 绕过事件校验 | 登记属显式信任；远端能力仍受 MCP 白名单与审批约束；UI 明示风险 |
| 资源耗尽 | 单飞门禁 + `MaxPlanSteps` + 请求体/输出限流 + 命令超时 |
| 迁移失败损坏数据 | 迁移幂等 + 迁移前备份 + 事务包裹 |

## 7. 测试计划（CI 门禁：覆盖率 ≥ 90%）

- 单元：模板展开（含缺占位符/注入转义）、`validateAIAgentSettings`、DB CHECK 迁移幂等性、
  Token 生成/轮换、`serveHTTP` 鉴权与 JSON-RPC 错误码。
- 集成：`StartAgentMCPServer` → `tools/list`、`tools/call`（只读立即返回、写操作进入审批、
  `task.finish` 结束任务）→ `StopAgentMCPServer`；并发请求的门禁行为。
- 前端：设置表单、空/错误状态、任务 CLI 下拉、i18n 静态守卫。
- e2e：用一个真实外部 CLI（或测试桩）连接端点并调用 `ssh.exec`。
- 门禁：`wails3 task ci`（lint + race + 覆盖率 + Windows 兼容 + 前端检查 + 生产构建）。

## 8. 分阶段实施计划

1. **阶段 1 —— 常驻 MCP 端点**：模型 `AIMCPServerSettings`、engine CHECK 迁移、服务生命周期、
   `AIService` API、bindings、设置 UI、测试。
2. **阶段 2 —— 自定义 CLI**：模型、cli CHECK 迁移、`customAIAgentAdapter`、检测、UI、bindings、测试。
3. **阶段 3 —— e2e 与文档**：真实 CLI 接入、README/本文件更新、`wails3 task ci` 全绿。

## 9. 已确认决策

1. 并发模型：**全局 FIFO 排队**（见 4.3）。
2. Token 展示：状态接口**直接返回明文**（见 4.4）。
3. 绑定会话断开：**自动重连**（见 4.3）。
4. 外部会话 `task.finish`：**复用单一任务直到结束**（见 4.3）。
5. 不支持同时绑定多个会话。
6. 自定义 CLI 事件校验：**宽松，仅要求 JSON 合法**（见 5.2）。

## 10. 阶段 1 改动清单（常驻 MCP 端点）

- 模型（`internal/model/ai.go`）：`AIAgentEngineExternal`、`AIMCPServerSettings`、
  `AIMCPServerInput`、`AIMCPServerStatus`。
- 存储（`internal/store`）：`ai_agent_tasks.engine` CHECK 迁移（表重建，幂等 + 迁移前备份）；
  MCP 设置随 `interaction_json` 持久化。
- 服务（新增 `internal/service/ai_agent_mcp_server.go`）：生命周期、全局 FIFO 队列、
  自动重连、单任务复用、钥匙串 Token、`AIService` 四个对外方法。
- 绑定：`wails3 generate bindings -ts` 重生成 `frontend/bindings/**`。
- 前端：AI 设置新增"MCP 服务"区块（开关 / 会话 / 端口 / Token 复制与轮换 / 启停）+ `en.json`。
- 测试：Go 单元与集成（队列、鉴权、审批、重连、迁移）、前端组件测试；`wails3 task ci`。

## 11. 阶段 1 实现状态（已完成）

- 模型/存储：`AIMCPServerSettings/Input/Status`（`internal/model/ai_mcp.go`）、
  `AIAgentEngineExternal`、`ai_agent_tasks.engine` CHECK 加入 `'external'`，并把
  `ai_agent_tasks_active_session_idx` 的 WHERE 排除 external，使端点任务可与普通 Agent
  任务在同一会话共存。
- 服务：`internal/service/ai_agent_mcp_server.go`（生命周期/状态/Token）与
  `ai_agent_mcp_server_transport.go`（HTTP、全局 FIFO 门禁、自动重连、单任务复用）。
  复用现有 `aiAgentMCPBridge` 与共享的 `serveAIAgentMCP` JSON-RPC 分发（`ai_agent_mcp.go`）。
- 绑定：已重生成 `frontend/bindings/**`（`bindings_contract_test.go` 通过）。
- 前端：`frontend/src/components/settings/MCPServerCard.tsx` 嵌入 Agent 标签页；任务列表对
  external 引擎显示"外部 MCP"，并隐藏恢复/重试。
- 测试：`internal/service/ai_agent_mcp_server_test.go` 覆盖状态/生命周期/Token 轮换/HTTP 握手/
  队列门禁/任务生命周期辅助函数。

## 12. 阶段 2 实现状态（已完成）

- 模型：`AICustomCLI`（`internal/model/ai_agent_cli.go`，含 `ID`，同时迁出 `AIAgentCLIStatus`
  以满足 300 行上限）、`AIAgentSettings.CustomCLIs []AICustomCLI`（支持多个）。
- 存储：`ai_agent_tasks.cli` 去掉 CHECK，直接存 `custom:<id>` 或内置枚举（无迁移，PoC 不兼容变更）。
- 适配器：`internal/service/ai_agent_cli_custom.go` —— `custom:<id>` 经 `resolveCustomAICLI` 解析到条目，
  由 `customAIAgentAdapter` 展开 `{mcp_url}/{token}/{workdir}/{prompt}`；`prompt_mode` 支持
  `stdin`（默认）或 `arg`；未配置/未引用 `{mcp_url}`/找不到可执行文件均 fail-closed；事件校验仅要求每行是合法 JSON。
- 检测：`DetectAgentCLIs` 为每个已配置且填了命令的自定义 CLI 追加一项（`command` 为 `custom:<id>`，
  展示名为条目 `name`，`path`/`version` 取自真实可执行文件，`version_arg` 可覆盖）。
- 校验：`validateAIAgentSettings`（含 ID 缺失/重复校验）、`newAIAgentCLIAdapter`、`validateInstalledAIAgentCLI` 均支持自定义条目。
- 绑定：已重生成；前端 `CustomCLICard.tsx` 改为列表式管理（添加多条/编辑/删除），
  `AIAgentTaskViews` 的任务 CLI 下拉与任务详情从 `AIService.Dashboard()` 拉取自定义 CLI 列并显示名称。
- 测试：`internal/service/ai_agent_cli_custom_test.go`（模板展开、失败关闭、事件校验、多条检测、
  ID 校验、可用性校验、`ManagesOwnMCP` 分派、own-MCP 运行返回 stdout）与前端
  `CustomCLICard.test.tsx`（空状态、添加、多条列表、删除、参数输入保留换行）。
- 补充：`resolveAIAgentSelection` 之前漏传 `CustomCLIs`，导致任务启动时 `custom:<id>` 被误判为
  `unsupported default AI agent CLI`，已修复并加回归用例。

后续（阶段 3）：真实外部 CLI 的 e2e、README 更新、`wails3 task ci` 全绿。

## 13. 阶段 3 状态

- e2e：新增 `e2e/external_mcp_test.go`（build tag `e2e`，复用 `startSSHD`/`newFixtureSession`）。
  它对真实 SSH 会话启动外部 MCP 端点，依次调用 `initialize` / `tools/list` / `ssh.exec` /
  `ssh.read_file` / `task.finish`，并断言任务变为 `completed`。Windows 无 `sshd` 时自动 SKIP，
  Linux/macOS 可运行；已确认可编译（`go test -tags e2e ./e2e` 通过并 SKIP）。
- README：中英文"AI 任务"章节补充外部 MCP 端点与自定义 CLI 两条。
- 门禁：本机已验证通过 `golangci-lint run ./...`（0 issues）、`check-go-source-limits`、
  Windows 兼容步骤（`test:windows` 的两项测试 + `go build ./internal/app`）、前端 `tsc -b`、
  生产前端构建（`tsc -b && vite build`）与全量前端用例。
  `wails3 task ci` 无法在本机跑完：`toolchain:check` 因本机 node 为 v24.21.0（仓库钉 24.18.1）失败；
  `task test` 的 race+覆盖率门禁与若干用例（权限/路径/ssh-agent/sshd）为 Linux 专用。需在 Linux/WSL 完成最终门禁。
