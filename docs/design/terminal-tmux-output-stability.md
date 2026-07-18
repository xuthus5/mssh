# tmux 下终端闪烁与 xterm.js 解析错误复盘

日期：2026-07-18  
状态：已修复并在真实 tmux 环境验证

## 触发信号

- 不进入 tmux 时终端基本稳定，进入 tmux 后运行 Codex、Claude Code 等高频原地刷新的 TUI 会持续闪烁。
- xterm.js 控制台出现 `Parsing error`，常见状态为 `currentState: 4`（`CSI_PARAM`），随后收到普通 Unicode 字符，例如 `code: 9472`（`U+2500 ─`）。
- tmux client 已包含 `sync` feature，同步输出标记也持续出现，但闪烁和解析错误仍未完全消失。
- 输出量越大、刷新频率越高，问题越容易复现。

## 根因与约束

### 第一阶段：tmux 未启用同步输出

AI Agent CLI 会通过 `DECRQM 2026` 探测 synchronized output。MSSH 能回答该探测，但 tmux 会消费 pane 内程序的 `DECSET/DECRST 2026`，并根据外层终端能力决定是否对 MSSH 输出同步帧。

xterm.js 不响应 tmux 的 `XTVERSION` 查询，标准 `xterm-256color` terminfo 也不声明 `sync`，因此 tmux 最初不会对外层输出 `2026` 同步帧。MSSH 后续通过应答 `XTVERSION` 让 tmux 识别同步输出能力，解决了裸整屏重绘问题。

### 最终根因：Wails 事件破坏 PTY 字节顺序

同步输出启用后仍然存在闪烁，最终确认问题位于 synchronized output writer 之前：

1. SSH PTY 使用 4096 字节缓冲读取，任意 ANSI/CSI 控制序列都可能跨读取块拆分。
2. 后端通过 Wails `Event.Emit` 逐块发送 `terminal:output`。
3. Wails 3 的事件处理器会为每次窗口分发启动独立 goroutine，不保证多个事件到达前端的先后顺序。
4. tmux 和 TUI 高频刷新会快速产生大量小块，使 goroutine 调度乱序更容易发生。
5. xterm.js 收到乱序字节后，会把普通文本或框线字符解释为未闭合 CSI 的一部分，从而产生解析错误并破坏重绘原子性。

典型控制流可能被拆成：

```text
chunk 1: ESC [ 49 ;
chunk 2: 2 m ─
```

如果 `chunk 2` 先于 `chunk 1` 到达，或者后续 chunk 插入两者之间，xterm.js 的解析器会停留在 `CSI_PARAM` 状态。之后收到 `─` 等 Unicode 字符时，就会记录 `Parsing error`。同步帧 writer 只能处理按序输入，无法修复其上游已经乱序的字节流。

## 排除过的错误假设

- 不是单纯的 UTF-8 分块问题。后端使用 `[]byte`，Wails 以 Base64 传输，前端解码为 `Uint8Array`，分块 UTF-8 字节可以无损交给 xterm.js。
- 不是仅靠增加 synchronized output 缓冲时间或大小就能解决。扩大缓冲只会延迟损坏字节进入解析器，并可能形成更大的异常帧。
- 不是继续补充 tmux feature profile 就能解决。`sync` 已经协商成功时，仍可能因为事件乱序破坏控制序列。
- 不应使用 xterm.js 私有的 `_core.writeSync`。该 API 未公开、已废弃且不能恢复上游丢失或乱序的字节。

## 正确做法

### 后端输出序号

- `TerminalOutputPayload` 增加 `sequence` 字段。
- `TerminalService` 在 `outputMu` 保护下，为每个 terminal ID 独立递增序号。
- attach 缓冲、实时输出、关闭、远端断开和 LRU 回收都维护相同的序号生命周期。

### 前端按序重组

- `TerminalOutputSequencer` 维护下一个期望序号和有界 pending map。
- 提前到达的块暂存，只有连续序号到齐后才交给 `SynchronizedOutputWriter`。
- 已处理块和重复块会被忽略，异常序号或超过上限的缺口会进入现有终端错误处理流程。
- SSH 重连切换 terminal ID 时重新创建 sequencer，避免旧连接状态污染新连接。

最终数据链路为：

```text
SSH PTY bytes
  -> terminal:output { terminal_id, sequence, data }
  -> TerminalOutputSequencer
  -> SynchronizedOutputWriter
  -> xterm.js
```

关键约束是：任何字节解析、同步帧识别和 xterm 写入都必须发生在输出顺序恢复之后。

## 验证方式

自动化回归覆盖：

- 模拟 `sequence=2` 先到达、`sequence=1` 后到达，确认最终按 `1, 2` 写入。
- 使用真实错误形态拆分 `ESC[49;` 与 `2m─`，确认框线字符不会进入未闭合 CSI。
- 覆盖重复块、已处理块、非法序号、过大序号缺口和 terminal ID 切换。
- 后端覆盖每个终端独立计数，以及 attach 缓冲早于实时输出的顺序。

完成修复时的质量门禁：

- 前端 561 个测试通过，行覆盖率 96.29%。
- `go test -race ./...` 通过。
- `golangci-lint run ./...` 为 0 issues。
- 前端生产构建和 `wails3 build` 通过。
- 用户在真实 SSH、tmux、Codex 工作负载下确认输出稳定，不再闪烁。

## 回归检查清单

1. 在 SSH 终端进入 tmux，确认 `client_termfeatures` 包含 `sync`。
2. 分别运行 Codex、Claude Code、OpenCode、Grok Build 等高频刷新的 TUI。
3. 持续观察整屏重绘、滚动、Unicode 框线和真彩色输出。
4. 确认控制台不再出现 xterm.js `Parsing error`。
5. 确认重连、分屏和 terminal ID 切换后旧序号不会阻塞新终端输出。

## 适用范围

该经验不仅适用于 tmux。任何通过异步事件总线传输的有序字节流，包括终端、日志流、文件分片和协议帧，都不能假设多次异步 emit 保持调用顺序。必须由传输层提供顺序保证，或者在应用协议中加入序号并在消费端重组。

## 关联实现与提交

- `internal/service/terminal_output.go`
- `pkg/event/event.go`
- `frontend/src/components/terminal/terminalOutputSequencer.ts`
- `frontend/src/components/terminal/terminalSynchronizedOutput.ts`
- `frontend/src/hooks/terminalOutputRuntime.ts`
- `cdd4a54 fix(terminal): answer XTVERSION probe to enable tmux sync`
- `6d13ddf fix(terminal): handle nested sync frames`
- `099465d fix(terminal): release nested sync updates`
- `e4cadd6 fix(terminal): preserve output event order`
