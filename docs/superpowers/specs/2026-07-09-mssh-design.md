# MSSH - SSH Client 设计文档

> 日期：2026-07-09
> 技术栈：Go + Wails v3 + React + shadcn/ui + Vite + xterm.js

---

## 1. 需求汇总

| 维度 | 决策 |
|------|------|
| 功能范围 | 会话管理、多标签+分屏终端、端口转发、SFTP、密钥管理、外观定制、日志回放、宏命令 |
| 数据存储 | 混合方案：AES 加密 SQLite（modernc.org/sqlite）+ 可选系统密钥链 |
| 目标平台 | Windows / macOS / Linux 全平台 |
| 数据同步 | 手动导入导出 + 云端同步 |

---

## 2. 架构概述：事件驱动流式架构

```
┌─────────────────────────────────────────────────┐
│  React Frontend                                 │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │
│  │ Session  │ │ Terminal │ │ SFTP/Settings  │   │
│  │ Tree     │ │ (xterm)  │ │ Panels         │   │
│  └──────────┘ └──────────┘ └────────────────┘   │
│       │             │              │            │
│  ┌────┴─────────────┴──────────────┴────────┐   │
│  │         Wails v3 Runtime (JS)            │   │
│  │   Bindings (call)  │  Events (subscribe) │   │
│  └────────────────────┼─────────────────────┘   │
├───────────────────────┼─────────────────────────┤
│  Go Backend           │                         │
│  ┌────────────────────┴──────────────────────┐  │
│  │         Service Layer                     │  │
│  │  SessionSvc │ TerminalSvc │ TunnelSvc     │  │
│  │  FileSvc    │ KeySvc      │ LogSvc        │  │
│  │  MacroSvc   │ SyncSvc     │ ThemeSvc      │  │
│  └──────┬──────┴──────┬──────┴───────┬───────┘  │
│  ┌──────┴─────────────┴──────────────┴───────┐  │
│  │         SSH Engine                       │  │
│  │  crypto/ssh │ PTY │ SFTP │ PortForward   │  │
│  └──────────────────┬───────────────────────┘  │
│  ┌──────────────────┴───────────────────────┐  │
│  │         Data Layer                       │  │
│  │  SQLite(modernc) │ AES │ Keychain Adapter│  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 通信模型

- **管理操作（CRUD）**：前端通过 Wails Bindings 调用 Go Service 方法（请求/响应）
- **终端 I/O**：Go 端 goroutine 持续读取 PTY stdout → Wails Events 推送至前端 xterm.js；用户输入通过 Bindings 发送到 Go → PTY stdin
- **文件传输进度**：通过 Events 推送进度事件
- **连接状态变更**：通过 Events 推送状态变更

### 终端 Tab 切换

- Go 层：SSH 连接建立后 PTY goroutine 持续运行，不暂停不缓冲不重放
- 前端层：每个活跃会话持有持久化 xterm.js Terminal 实例（存在 Terminal 池中），Tab 切换时仅移除 DOM 挂载不销毁实例
- 效果：切回 Tab 瞬间显示当前状态，零延迟无重放
- Terminal 实例池上限用户可配置（默认 32），超出时按 LRU 关闭最久未使用的连接

---

## 3. 模块拆分

### Go 后端

```
backend/
├── cmd/mssh/main.go                  # 应用入口
├── internal/
│   ├── app/app.go                    # Wails 应用初始化、生命周期
│   ├── service/                      # 服务层
│   │   ├── session.go               # 会话 CRUD、连接/断开管理
│   │   ├── terminal.go              # PTY I/O 流管理
│   │   ├── tunnel.go                # 端口转发配置与生命周期
│   │   ├── file.go                  # SFTP 操作
│   │   ├── key.go                   # SSH 密钥生成/导入/管理
│   │   ├── macro.go                 # 宏/快速命令
│   │   ├── log.go                   # 会话录制与回放
│   │   ├── theme.go                 # 终端外观配置
│   │   └── sync.go                  # 导入导出 + 云同步
│   ├── ssh/                          # SSH 引擎
│   │   ├── client.go                # SSH 连接管理
│   │   ├── pty.go                   # PTY 分配与 I/O
│   │   ├── sftp.go                  # SFTP 客户端封装
│   │   ├── tunnel.go                # 端口转发实现
│   │   └── key.go                   # 密钥解析与认证
│   ├── store/                        # 数据持久化
│   │   ├── db.go                    # SQLite 初始化与迁移
│   │   ├── session.go               # 会话存储
│   │   ├── key.go                   # 密钥存储
│   │   ├── macro.go                 # 宏存储
│   │   ├── log.go                   # 日志存储
│   │   └── setting.go              # 设置存储
│   ├── crypto/                       # 加密
│   │   ├── aes.go                   # AES 加解密
│   │   └── keychain.go              # 系统密钥链适配（跨平台）
│   └── model/                        # 数据模型
│       ├── session.go               # Session 结构体
│       ├── key.go                   # Key 结构体
│       ├── macro.go                 # Macro 结构体
│       ├── tunnel.go                # Tunnel 结构体
│       ├── theme.go                 # Theme 结构体
│       └── setting.go              # Setting 结构体
└── pkg/
    └── event.go                      # 事件名称常量
```

### React 前端

```
frontend/
├── src/
│   ├── main.tsx                     # React 入口
│   ├── App.tsx                      # 根组件
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx          # 侧边栏（会话树）
│   │   │   ├── TabBar.tsx           # 标签栏
│   │   │   ├── Toolbar.tsx          # 工具栏
│   │   │   └── StatusBar.tsx        # 状态栏
│   │   ├── session/
│   │   │   ├── SessionTree.tsx      # 会话树组件
│   │   │   ├── SessionDialog.tsx    # 新建/编辑会话对话框
│   │   │   └── SessionGroup.tsx     # 会话分组
│   │   ├── terminal/
│   │   │   ├── TerminalTab.tsx      # 单个终端标签页
│   │   │   ├── TerminalSplit.tsx    # 分屏容器
│   │   │   ├── TerminalEmulator.tsx # xterm.js 封装
│   │   │   └── SessionLog.tsx       # 日志回放
│   │   ├── file/
│   │   │   ├── FilePanel.tsx        # SFTP 文件管理面板
│   │   │   └── TransferProgress.tsx # 传输进度
│   │   ├── settings/
│   │   │   ├── SettingsDialog.tsx   # 设置对话框
│   │   │   ├── ThemeEditor.tsx      # 主题编辑器
│   │   │   └── KeyManager.tsx       # 密钥管理器
│   │   └── ui/                      # shadcn/ui 组件（自动生成）
│   ├── hooks/
│   │   ├── useSession.ts            # 会话操作 hook
│   │   ├── useTerminal.ts           # 终端 I/O hook
│   │   ├── useFileTransfer.ts       # 文件传输 hook
│   │   └── useSettings.ts           # 设置 hook
│   ├── store/
│   │   └── appStore.ts              # 全局状态（zustand）
│   ├── lib/
│   │   ├── wails.ts                 # Wails runtime 封装
│   │   └── eventBus.ts             # 前端事件总线
│   └── styles/
│       └── globals.css              # 全局样式
```

---

## 4. 数据库 Schema

```sql
CREATE TABLE session_folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    parent_id  INTEGER REFERENCES session_folders(id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id  INTEGER REFERENCES session_folders(id),
    name       TEXT NOT NULL,
    host       TEXT NOT NULL,
    port       INTEGER NOT NULL DEFAULT 22,
    username   TEXT NOT NULL,
    auth_method TEXT NOT NULL CHECK(auth_method IN ('password','key','agent','keyboard-interactive')),
    password   TEXT,                       -- AES 加密存储
    key_id     INTEGER REFERENCES ssh_keys(id),
    keep_alive INTEGER NOT NULL DEFAULT 30,
    term_type  TEXT NOT NULL DEFAULT 'xterm-256color',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ssh_keys (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL CHECK(type IN ('rsa','ed25519','ecdsa')),
    private_key    TEXT NOT NULL,          -- AES 加密存储
    public_key     TEXT,
    has_passphrase INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tunnels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES sessions(id),
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('local','remote','dynamic')),
    local_host  TEXT,
    local_port  INTEGER,
    remote_host TEXT,
    remote_port INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE macros (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    command    TEXT NOT NULL,
    shortcut   TEXT,
    delay_ms   INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE themes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    config     TEXT NOT NULL,              -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE session_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    started_at TEXT NOT NULL,
    ended_at   TEXT,
    data_path  TEXT NOT NULL               -- 录制文件路径
);
```

---

## 5. Wails v3 服务接口

### Bindings（前端调用 Go）

```go
// SessionService
ListFolders()                              ([]SessionFolder, error)
CreateFolder(name string, parentID int64)  (SessionFolder, error)
UpdateFolder(id int64, name string)        error
DeleteFolder(id int64)                     error
MoveFolder(id, newParentID int64)          error
ListSessions(folderID int64)               ([]Session, error)
CreateSession(s Session)                   (Session, error)
UpdateSession(s Session)                   error
DeleteSession(id int64)                    error
MoveSession(id, folderID int64)            error
Connect(sessionID int64)                   (string, error)   // 返回 terminalID
Disconnect(terminalID string)              error

// TerminalService
Write(terminalID string, data []byte)      error
Resize(terminalID string, cols, rows int)  error

// TunnelService
List(sessionID int64)                      ([]Tunnel, error)
Create(t Tunnel)                           (Tunnel, error)
Update(t Tunnel)                           error
Delete(id int64)                           error
Start(id int64)                            error
Stop(id int64)                             error

// FileService
ListDir(sessionID int64, path string)      ([]FileEntry, error)
Upload(sessionID int64, src, dst string)   (string, error)   // 返回 taskID
Download(sessionID int64, src, dst string) (string, error)
CancelTransfer(taskID string)              error
Delete(sessionID int64, path string)       error
Mkdir(sessionID int64, path string)        error
Rename(sessionID int64, old, new string)   error

// KeyService
List()                                     ([]SSHKey, error)
Generate(name, typ string, bits int)       (SSHKey, error)
Import(name string, privateKey []byte)     (SSHKey, error)
Delete(id int64)                           error
ExportPublicKey(id int64)                  (string, error)

// MacroService
List()                                     ([]Macro, error)
Create(m Macro)                           (Macro, error)
Update(m Macro)                           error
Delete(id int64)                          error
Execute(terminalID, command string)       error

// ThemeService
List()                                     ([]Theme, error)
Create(t Theme)                            (Theme, error)
Update(t Theme)                            error
Delete(id int64)                           error
GetActive()                                (Theme, error)
SetActive(id int64)                        error

// LogService
List(sessionID int64)                      ([]SessionLog, error)
StartRecording(terminalID string)          error
StopRecording(terminalID string)           error
GetRecording(logID int64)                  ([]byte, error)
Delete(id int64)                           error

// SyncService
Export(path string)                        error
Import(path string)                        error
SyncToCloud(provider, config map[string]string) error
SyncFromCloud(provider, config map[string]string) error
```

### Events（Go → 前端推送）

```go
EventTerminalOutput    = "terminal:output"     // {terminalID, data: []byte}
EventTerminalClosed    = "terminal:closed"     // {terminalID, reason}
EventTransferProgress  = "file:progress"       // {taskID, percent, speed, eta}
EventTransferComplete  = "file:complete"       // {taskID, path}
EventTransferError     = "file:error"          // {taskID, error}
EventConnectionState   = "session:state"       // {terminalID, state}
EventConnectionError   = "session:error"       // {terminalID, error}
EventTunnelState       = "tunnel:state"        // {tunnelID, state}
```

---

## 6. 加密与凭据安全

### 加密体系

用户主密码 → Argon2id → 主密钥（AES-256） → 加密 passwords、private_keys、导出数据

### 两种解锁模式

| 模式 | 密钥来源 | 体验 |
|------|----------|------|
| 主密码模式 | 用户输入主密码 → Argon2 派生 | 每次启动需输入主密码 |
| 系统密钥链模式 | /Win Credential Manager / macOS Keychain / Linux Secret Service | 启动自动解锁 |

### 运行时安全

- 敏感字段解密后仅在内存中，不落盘
- SSH 连接建立后密码立即从内存中清除
- 应用退出时不保存任何明文凭据

### 密钥链适配

```go
type KeychainAdapter interface {
    Get(service, account string) ([]byte, error)
    Set(service, account string, data []byte) error
    Delete(service, account string) error
    IsAvailable() bool
}
// 平台实现：keychain_windows.go / keychain_darwin.go / keychain_linux.go
```

---

## 7. SSH 引擎

### 连接池

`ConnPool` 管理所有活跃 SSH 连接，每个 `ManagedConn` 含 SSH Client + PTY 集合 + SFTP Client + Tunnel 集合。

### PTY 数据流

```
ssh.Session stdout → readLoop goroutine → EventTerminalOutput → xterm.js
                                                            → Recorder (可选)
用户输入 ← TerminalService.Write(id, data) ← xterm.onData
resize ← TerminalService.Resize(id, cols, rows) ← ResizeObserver
```

### 端口转发

支持 Local（-L）、Remote（-R）、Dynamic（-D SOCKS5）三类转发。

### SFTP

通过 `github.com/pkg/sftp` 实现，上传/下载带进度回调，进度通过 Events 推送前端。

### 保活机制

- 配置优先级：单会话 `keep_alive` > 全局 `defaults.keep_alive_interval`（默认 30s）> 硬编码兜底（10s）
- 保活 goroutine 独立运行，与 Tab 切换无关
- 连续 3 次失败判定连接断开
- 单会话可设 -1 关闭保活

---

## 8. 会话录制与回放

### 录制格式（二进制 .msshlog）

```
Header: 魔数(8B) + 版本(4B) + cols(4B) + rows(4B) + term_type
Entry: 时间戳ms(8B) + 类型(4B: 0=stdout,1=stdin) + 长度(4B) + 数据
```

### 回放

Go 端 Player 按时间戳定时推送 EventTerminalOutput 到独立 xterm.js 实例（只读），支持播放/暂停/倍速。

---

## 9. 前端架构

### 组件树

```
App
├── Sidebar (280px)
│   ├── SessionToolbar
│   ├── SessionTree → SessionFolder → SessionItem
│   └── QuickCommands
├── MainPanel
│   ├── TabBar → Tab × N
│   └── TabContent
│       ├── TerminalTab → TerminalSplitContainer → TerminalEmulator × N
│       ├── PlaybackTab → PlaybackControls + Terminal
│       └── SettingsTab
├── SFTP Drawer → FilePanel → FileList + TransferQueue
└── StatusBar
```

### 状态管理（zustand）

```typescript
interface AppStore {
  folders: SessionFolder[];
  sessions: Map<number, Session[]>;
  tabs: Tab[];
  activeTabId: string;
  terminalPool: Map<string, Terminal>;
  maxPoolSize: number;
  connections: Map<string, ConnState>;
  fileTransfers: TransferTask[];
}
```

### 关键依赖

- `@xterm/xterm` + addons（fit / webgl / search / unicode11）
- `zustand` 状态管理
- `shadcn/ui` + `tailwindcss` UI

---

## 10. 测试策略

### 分层

| Layer | 占比 | 内容 |
|-------|------|------|
| Unit - SSH/Store/Crypto | 30% | 纯逻辑、数据访问、加密算法 |
| Unit - Service | 40% | mock store + mock ssh |
| Integration | 20% | 内存 SSH Server + 内存 SQLite |
| E2E | 10% | Wails 桌面自动化（可选） |

### 工具

- `testing` + `testify/assert` 标准单元测试
- `mockery` 接口 mock 生成
- SQLite `:memory:` 模式
- 内存 SSH Server（`golang.org/x/crypto/ssh`）
- `go test -race` 竞态检测
- `go test -coverprofile` 覆盖率目标 ≥ 90%

### CI 质量门禁

1. `golangci-lint run --timeout 5m ./backend/...`
2. `go test -race -coverprofile=coverage.out ./backend/...`
3. 覆盖率 ≥ 90%
4. `wails build` 构建通过

---

## 11. 项目配置

### Go 依赖

- `github.com/wailsapp/wails/v3`
- `golang.org/x/crypto`（ssh / argon2）
- `modernc.org/sqlite`
- `github.com/pkg/sftp`
- `github.com/zalando/go-keyring`

### 前端依赖

- `react` ^19, `@xterm/xterm` ^5, `zustand` ^5
- `shadcn/ui`, `tailwindcss` ^4, `vite` ^6
