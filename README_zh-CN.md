# MSSH — Secure Shell 客户端与会话管理器

> [English](README.md)

基于 [Go](https://go.dev) + [Wails v3](https://wails.io) + [React](https://react.dev) + [xterm.js](https://xtermjs.org) 构建的新一代跨平台 SSH 客户端。

[![CI](https://github.com/xuthus5/mssh/actions/workflows/ci.yml/badge.svg)](https://github.com/xuthus5/mssh/actions/workflows/ci.yml)
[![Release](https://github.com/xuthus5/mssh/actions/workflows/release.yml/badge.svg)](https://github.com/xuthus5/mssh/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## 安装

### Linux

**Debian / Ubuntu (deb)**

```bash
# 从 Releases 页面下载最新 .deb 包
sudo dpkg -i mssh_*.deb
sudo apt-get install -f   # 自动安装依赖
```

**Fedora / RHEL (rpm)**

```bash
# 从 Releases 页面下载最新 .rpm 包
sudo rpm -ivh mssh-*.rpm
```

**Arch Linux (AUR)**

```bash
yay -S mssh
# 或从 Releases 页面下载 PKGBUILD
```

**Flatpak**

[![Flathub](https://img.shields.io/badge/Flathub-io.github.xuthus5.mssh-blue?logo=flathub)](https://flathub.org/apps/io.github.xuthus5.mssh)

```bash
flatpak install flathub io.github.xuthus5.mssh
```

**AppImage**

```bash
# 从 Releases 页面下载 .AppImage
chmod +x mssh-*.AppImage
./mssh-*.AppImage
```

### macOS

```bash
# 从 Releases 页面下载 universal .app zip
unzip mssh-macos-*.zip
open mssh.app
```

### Windows

```bash
# 从 Releases 页面下载 NSIS 安装器
mssh-setup-*.exe
```

> 所有发布产物均包含 SHA-256 校验和、CycloneDX SBOM、来源证明及 Sigstore 签名。

---

## 功能概览

### 终端与 SSH

- 持久化的顶层标签页，支持多实例连接、标签页复制与断线恢复
- 递归终端分屏——最多 8 个独立可重连的窗格，支持可拖拽分割线
- 终端内容搜索：纯文本或正则表达式，高亮匹配项，支持上/下导航
- 总览工作区：集中的会话、密钥、隧道、宏与串口管理

### 文件传输（SFTP）

- 原生文件对话框，支持隐藏文件过滤、列表/树形视图
- OSC 7 目录跟随——SFTP 面板自动同步远程工作目录
- 全局传输中心，显示进度、预计剩余时间、重试、历史与取消

### 安全与保险库

- 应用主密钥加密（Argon2id + AES-256-GCM，最短 12 字符）
- 加密 `.msshbackup` 备份格式，支持加密导出/导入
- 系统钥匙串集成（Linux secret-service、Windows 凭据管理器、macOS Keychain）
- 主机密钥验证，需显式指纹信任，支持变更检测
- 可选的审计日志：记录连接、同步、密钥访问与批量操作

### 云同步

| 提供商       | 功能                   |
|-------------|------------------------|
| GitHub Gist | 加密会话备份同步          |
| WebDAV      | HTTPS 目录同步           |
| AWS S3      | Path-style 访问，支持 MinIO/Ceph |

### AI 运维代理

- 基于配置的 OpenAI 兼容提供商的本地 AI 任务
- 通过 MSSH MCP 桥接使用本地 CLI（Claude Code / OpenCode）
- 变动操作需逐条审批，高危命令硬阻断
- 任务状态持久化——应用重启后可手动恢复
- 对话历史与搜索上下文

### 主题与外观

- 24 套离线终端主题（GitHub Dark/Light、Dracula、Nord、TokyoNight、Catppuccin 等）
- 支持导入 `.itermcolors` 配色文件
- Dark/Light/Fixed 模式分配
- 系统字体与字号配置

### 串口终端

- 完整的串口终端：支持 300–4,000,000 波特率、数据位/校验位/停止位、流程控制（XON-XOFF、RTS-CTS、DSR-DTR）
- DTR/RTS/Break 信号控制、本地回显、设备独占锁

### 本地 Shell

- 可配置的 Shell 路径、启动参数、工作目录与登录模式
- 支持会话录制

### 会话资产与自动化

- 环境目录（开发/测试/生产）、项目指派、多标签分类
- CSV 导入导出：支持与 MSSH、PuTTY、SecureCRT、MobaXterm 格式互操作
- 批量操作：批量更新、删除、多会话宏执行
- 宏模板，执行结果按节点返回
- 端口转发（本地/远程/动态）
- SSH 密钥生成与管理
- 会话录制与回放

### 键盘快捷键

| 快捷键             | 功能            |
|-------------------|-----------------|
| `Ctrl+N`          | 新建 SSH 会话      |
| `Ctrl+Shift+N`    | 新建本地终端        |
| `Ctrl+W`          | 关闭当前标签页      |
| `Ctrl+F`          | 快速搜索会话       |
| `Ctrl+Shift+C`    | 复制选中文本       |
| `Ctrl+Shift+V`    | 粘贴剪贴板内容      |
| `Ctrl+Shift+L`    | 清屏             |

所有快捷键均支持自定义，并有冲突检测。

### 系统集成

- 系统托盘（显示/隐藏/退出）
- 可配置的关闭按钮行为（最小化到托盘 或 退出）
- 按日写入的日志文件（`~/.mssh/logs`），日志保留天数可配置

---

## 开发

### 前置要求

- Go 1.26+
- Node.js 24+
- [Wails v3 CLI](https://github.com/wailsapp/wails) (`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`)
- **Linux**：需要 GTK4 及 WebKitGTK 6.0 开发包

### 快速开始

```bash
# 安装前端依赖
cd frontend && npm ci && cd ..

# 开发模式运行
wails3 task dev

# 生产构建
wails3 task build
```

### CI 门禁（提交/推送前必须通过）

```bash
wails3 task ci
```

该命令依次执行：lint → 后端测试（含竞态检测，覆盖率 ≥90%） → 前端测试 + 产物体积检查 → 生产构建。

### 独立任务

```bash
wails3 task lint               # golangci-lint（v2.12.2）
wails3 task fmt                # goimports-reviser 格式化
wails3 task test               # 后端竞态测试 + 覆盖率
wails3 task test:frontend      # vitest + 源文件限制 + 打包体积预算
wails3 task test:e2e           # SSH/tmux/SFTP/串口集成测试
wails3 task benchmark          # 性能基准
wails3 task package            # 当前平台打包
wails3 task package:linux:amd64 # Linux: deb + rpm + AppImage + Flatpak
```

### 发布

匹配 `v*` 格式的 Git 标签会触发发布流水线，产出如下：

| 平台     | 架构            | 产物                         |
|----------|-----------------|------------------------------|
| Linux    | amd64、arm64    | 二进制、deb、rpm、AppImage、Flatpak |
| Windows  | amd64、arm64    | exe + NSIS 安装器                   |
| macOS    | universal       | `.app` zip 包                       |

---

## 技术规格

| 层次       | 技术                                          |
|------------|-----------------------------------------------|
| 前端       | React 19、TypeScript、Vite 6、Tailwind CSS 4、xterm.js |
| 后端       | Go 1.26、Wails v3（GTK4 + WebKitGTK 6.0）    |
| 数据库     | SQLite（基于 modernc.org/sqlite）              |
| SSH        | golang.org/x/crypto、pkg/sftp                    |
| 加密       | Argon2id、AES-256-GCM                          |
| 钥匙串     | go-keyring（Linux / Windows / macOS）           |
| 串口       | go.bug.st/serial                               |
| 云 SDK     | AWS SDK v2                                     |

---

## 许可证

[MIT](LICENSE)
