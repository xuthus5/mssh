# MSSH — Secure Shell 客户端与会话管理器

[![CI](https://github.com/xuthus5/mssh/actions/workflows/ci.yml/badge.svg)](https://github.com/xuthus5/mssh/actions/workflows/ci.yml)
[![Release](https://github.com/xuthus5/mssh/actions/workflows/release.yml/badge.svg)](https://github.com/xuthus5/mssh/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MSSH 是面向多主机、多终端、多重复操作场景的跨平台 SSH 工作台。它把会话管理、终端操作、文件传输、自动化、录制回放和 AI 辅助任务放在同一个桌面应用中，技术栈为 Go + Wails v3 + React。

> [English](README.md)

---

## 产品定位

MSSH 的设计前提是：一次 SSH 连接不只是一个 Shell。真正可用的 SSH 客户端还需要管理会话资产、保留终端上下文、处理断线恢复，并让重复操作更安全。

它覆盖完整工作链路：

1. 管理主机、分组、标签、环境、项目、隧道、密钥和宏
2. 打开 SSH、本地 Shell 或串口终端
3. 分屏、搜索、复制、重连和录制终端操作
4. 使用 SFTP 传输文件并跟踪传输进度
5. 通过宏和批量操作执行重复任务
6. 在需要远程操作代理时，使用原生 AI 任务或本地 CLI 桥接

### 适用场景

MSSH 适合需要在本地桌面集中管理远程机器的工作流：

- 开发者需要频繁切换项目主机、本地 Shell、隧道和文件传输
- SRE / 运维人员需要可搜索的会话、宏、审计记录和断线恢复
- 团队希望敏感数据本地加密保存，并在自动化或 AI 辅助修改前显式审批

MSSH 不是集群编排平台。它聚焦已保存 SSH 会话和终端中心化操作，每个任务绑定到具体会话，并拥有独立连接生命周期。

---

## 核心能力

### 终端工作台

- 持久化顶层终端标签页，支持右键重命名临时标题
- 递归分屏，分屏窗格可独立重连
- 终端标签右键关闭、关闭全部，可选关闭前确认
- 历史命令预测补全：输入前缀或整条命令时按最近执行排序给出候选
- 终端输出搜索，支持文本与正则模式
- 会话录制回放
- 本地 Shell 终端，覆盖本机操作流程

### 会话与资产管理

- 集中的会话目录，支持分组、环境、项目和标签
- 会话搜索、快速连接、资产详情面板
- 会话右键菜单：连接、编辑、复制会话、快速重命名、复制账号密码、删除
- CSV 导入/导出，支持 MSSH、PuTTY、SecureCRT、MobaXterm 格式
- 对选中会话执行批量更新、删除和宏操作

### 文件传输

- SFTP 文件浏览器，支持列表/树形视图
- 隐藏文件过滤和系统原生文件选择器
- OSC 7 目录跟随，可选安装 Bash/Zsh 启动脚本实现自动跟随
- 传输中心展示进度、预计剩余时间、重试、历史和取消

### 自动化

- 宏命令模板，用于重复命令序列
- SSH 密钥生成与管理
- 本地、远程和动态端口转发
- 会话录制与回放

### 云同步与备份

- 加密 `.msshbackup` 导出与导入
- GitHub Gist、WebDAV、AWS S3 同步提供商
- 支持 MinIO、Ceph 等 S3 兼容服务的 path-style 访问
- 本地版本历史与同步操作记录

### AI 任务

- 使用已配置 OpenAI 兼容提供商运行原生 Agent 任务
- 通过 MSSH MCP 桥接本地 Claude Code、OpenCode 或 Codex（Codex 需显式开启弱隔离选项）
- 对修改操作进行逐步审批，高危命令硬阻断
- 持久化任务状态，应用重启后可手动恢复

### 串口与桌面集成

- 串口终端支持 300 到 4,000,000 波特率
- 支持数据位、校验位、停止位、XON-XOFF、RTS-CTS、DSR-DTR 流程控制
- 支持 DTR、RTS、Break、本地回显和设备独占锁
- 系统托盘、关闭按钮行为配置和按日写入的本地日志

### 外观与快捷键

- 离线终端主题，包括 GitHub、Dracula、Nord、TokyoNight、Catppuccin 等配色
- `.itermcolors` 导入
- 深色、浅色和固定主题分配
- 可自定义快捷键，并提供冲突检测

### 安全与运维控制

- 使用主密钥加密本地敏感数据
- 主机密钥校验与变更检测，指纹变化支持阻止、提醒或默认信任
- 总览中管理已信任主机指纹
- 集成 Linux、Windows、macOS 系统钥匙串
- 可选审计日志，记录连接、同步、密钥访问和批量操作

---

## 典型工作流

```text
1. 新建或导入会话。
2. 打开会话并进入终端标签页。
3. 按需分屏连接其它主机或窗格。
4. 使用 SFTP 传输文件，或运行宏完成重复任务。
5. 按需开启自动重连，或在任务中断后手动恢复。
```

---

## 平台支持

| 平台 | 交付格式 |
| --- | --- |
| Linux | binary、deb、rpm、AppImage、Flatpak |
| Windows | exe + NSIS 安装器 |
| macOS | universal `.app` zip |

发布产物包含 SHA-256 校验和、CycloneDX SBOM、来源证明和 Sigstore 签名。

---

## 快速开始

### 安装

从 [Releases](https://github.com/xuthus5/mssh/releases) 下载适合平台的产物，或使用对应的软件包格式安装。

```bash
# Linux Flatpak
flatpak install flathub io.github.xuthus5.mssh

# Linux AppImage
chmod +x mssh-*.AppImage
./mssh-*.AppImage

# macOS
unzip mssh-macos-*.zip
open mssh.app

# Windows
mssh-setup-*.exe
```

### 从源码运行

```bash
# 安装前端依赖
cd frontend && npm ci && cd ..

# 以开发模式启动桌面应用
wails3 task dev
```

### 第一次连接

1. 创建或导入会话。
2. 从侧边栏或会话资产中心打开会话。
3. 在同一工作区中使用终端、文件面板、隧道面板或宏操作。

---

## 开发

### 前置要求

- Go 1.26+
- Node.js 24+
- [Wails v3 CLI](https://github.com/wailsapp/wails)（`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`）
- Linux 仅开发环境需要 GTK4 与 WebKitGTK 6.0 开发包

### 质量门禁

```bash
wails3 task ci
```

该命令会执行：

1. `golangci-lint run --timeout 5m ./...`
2. `go test -race -coverprofile=coverage.out -covermode=atomic -coverpkg=./internal/...,./pkg/... ./internal/... ./pkg/...`
3. `npm run check:source-limits`、`npm run check:bundle-budget`、`npm test`
4. `wails3 task build`

### 常用任务

```bash
wails3 task lint
wails3 task fmt
wails3 task test
wails3 task test:frontend
wails3 task test:e2e
wails3 task benchmark
wails3 task package
```

---

## 打包与发布

匹配 `v*` 的 Git 标签会触发发布流水线，产出各平台安装包和归档文件。

| 平台 | 产物 |
| --- | --- |
| Linux | binary、deb、rpm、AppImage、Flatpak |
| Windows | exe + NSIS 安装器 |
| macOS | universal `.app` zip |

打包细节见 [docs/packaging.md](docs/packaging.md)。

---

## 文档索引

- [docs/packaging.md](docs/packaging.md)
- [docs/performance-budgets.md](docs/performance-budgets.md)
- [docs/frontend-performance-notes.md](docs/frontend-performance-notes.md)
- [docs/design/](docs/design)
- [docs/ears-backend-review.md](docs/ears-backend-review.md)
- [docs/ears-frontend-review.md](docs/ears-frontend-review.md)

---

## 技术栈

| 层次 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite 6、Tailwind CSS 4、xterm.js |
| 后端 | Go 1.26、Wails v3（GTK4 + WebKitGTK 6.0） |
| 数据库 | SQLite（modernc.org/sqlite） |
| SSH | golang.org/x/crypto、pkg/sftp |
| 加密 | Argon2id、AES-256-GCM |
| 钥匙串 | go-keyring |
| 串口 | go.bug.st/serial |
| 云 SDK | AWS SDK v2 |

---

## 参与贡献

提交或推送前必须运行本地门禁：

```bash
wails3 task ci
```

编码、测试和交付规则见仓库根目录的 `AGENTS.md`。

---

## 许可证

[MIT](LICENSE)
