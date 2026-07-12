# 终端主题仓库与双模式绑定设计

## 目标

建立统一的终端主题仓库，支持内置主题、自定义主题和第三方主题导入，并为应用 Dark Mode 与 Light Mode 分别绑定完整终端主题。应用颜色模式切换后，现有终端、新建终端和回放终端必须立即使用对应主题。

## 核心决策

- 使用现有 `themes` 能力作为唯一主题仓库，直接按最新模型重构，不保留旧表兼容逻辑。
- 主题定义、用户终端配置和模式绑定分离，避免社区主题更新覆盖用户字体与光标配置。
- Dark/Light 模式分别绑定一个主题 Profile，不再持久化单一 `terminal.theme`。
- 第一阶段支持内置主题、自定义副本和 `.itermcolors` 导入；解析层预留其他格式适配器。
- 第三方主题保留来源、作者、许可证、版本、原始载荷和内容指纹，满足去重、追踪和商用审计要求。

## 领域模型

### TerminalThemeDefinition

表示不可变的颜色方案资源。

- `id`：数据库主键。
- `name`：显示名称。
- `mode`：`dark`、`light` 或 `universal`。
- `source_type`：`builtin`、`iterm2`、`community` 或 `custom`。
- `source_name`、`source_url`、`source_author`、`source_license`、`source_version`：来源元数据。
- `source_fingerprint`：标准化颜色数据的 SHA-256 指纹，用于幂等导入。
- `color_payload`：标准化颜色 JSON，包含背景、前景、光标、选区和 ANSI 16 色。
- `raw_payload`：可选原始导入内容，用于审计与未来重新解析。
- `is_builtin`：内置主题不可删除。
- `created_at`、`updated_at`。

### TerminalThemeProfile

表示用户实际使用的完整终端配置。

- `id`、`name`。
- `theme_id`：引用 Theme Definition。
- `font_family`、`font_size`、`cursor_style`。
- `color_overrides`：可选颜色覆盖 JSON。
- `created_at`、`updated_at`。

内置或导入主题默认建立 Profile。用户修改颜色时创建或更新自定义 Profile，不修改原始 Definition。

### 模式绑定

通用设置表保存：

- `terminal.theme.dark_profile_id`
- `terminal.theme.light_profile_id`

系统初始化时自动创建默认 Dark 与 Light Definition/Profile，并写入绑定。Dark 默认使用 GitHub Dark，Light 默认使用 GitHub Light。

## 数据库设计

现有 `themes` 表重构为主题定义表，并新增 `terminal_theme_profiles`。

```sql
CREATE TABLE themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('dark', 'light', 'universal')),
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  source_author TEXT NOT NULL DEFAULT '',
  source_license TEXT NOT NULL DEFAULT '',
  source_version TEXT NOT NULL DEFAULT '',
  source_fingerprint TEXT NOT NULL UNIQUE,
  color_payload TEXT NOT NULL,
  raw_payload TEXT NOT NULL DEFAULT '',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE terminal_theme_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE RESTRICT,
  font_family TEXT NOT NULL,
  font_size INTEGER NOT NULL,
  cursor_style TEXT NOT NULL,
  color_overrides TEXT NOT NULL DEFAULT '{}',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 统一颜色模式状态

新增前端统一 `ColorMode` 状态源，负责：

- 启动时加载 `appearance.color_mode`。
- 切换 HTML `light` class。
- 根据当前模式选择对应 Profile。
- 将解析后的终端主题写入 `appStore.terminalTheme`。
- 保存颜色模式失败时同时回滚界面模式与终端主题。

`WindowTitleBar` 只调用统一状态动作，不再维护独立本地模式状态。

## 主题编辑界面

- 原单一预设下拉框改为 `Dark Mode 终端主题` 与 `Light Mode 终端主题` 两个可搜索下拉框。
- 下拉框仅显示兼容模式及 `universal` 主题；允许显示不兼容主题，但需要二次确认并展示警告。
- 提供 Dark/Light 编辑切换，预览和属性检查器编辑当前 Profile。
- 主题项显示名称、来源、模式 Badge 和代表性色板。
- 增加“管理主题”入口，提供导入、搜索、预览、复制、重命名和删除。
- 内置 Definition 不可删除；被 Profile 引用的 Definition 不可直接删除。

## iTerm2 导入

### 解析接口

后端定义格式无关接口：

```go
type ThemeImporter interface {
    Supports(filename string, content []byte) bool
    Import(filename string, content []byte) ([]ThemeDefinition, error)
}
```

首个实现为 `ITermColorsImporter`，解析 XML Property List 中的背景、前景、光标、选区及 ANSI 0–15 色。

### 导入流程

1. 用户选择一个或多个 `.itermcolors` 文件。
2. 限制单文件大小并读取内容。
3. 安全解析 XML，禁止外部实体与网络访问。
4. 校验必需颜色并转换到 sRGB `#RRGGBB`。
5. 根据背景相对亮度推断 `dark` 或 `light`。
6. 生成标准化 JSON 和 SHA-256 指纹。
7. 指纹已存在时返回已存在记录；否则事务写入 Definition 与默认 Profile。
8. 返回成功、重复和失败明细，支持批量导入部分成功。

## 服务边界

`ThemeService` 重构为：

- `ListDefinitions(filter)`
- `ListProfiles(filter)`
- `GetProfile(id)`
- `CreateCustomProfile(input)`
- `UpdateProfile(input)`
- `DeleteProfile(id)`
- `DeleteDefinition(id)`
- `ImportFiles(paths)`
- `GetAssignments()`
- `SaveAssignments(input)`

服务层负责事务、引用约束、内置保护、指纹去重和用户可读错误。Store 层只执行参数化 SQL。

## 错误处理

- 文件格式不支持：明确返回文件名和支持格式。
- XML 损坏或颜色缺失：返回具体字段，不写入数据库。
- 重复主题：不报系统错误，标记为已存在。
- 许可证缺失：允许个人导入，但标记“许可证未知”；社区分发前必须补齐。
- 删除被引用主题：拒绝删除并列出引用 Profile。
- 当前 Profile 加载失败：回退到对应内置默认 Profile，并记录错误。

## 测试策略

- Go：iTerm2 合法/非法解析、颜色转换、亮度分类、指纹稳定性、重复导入、事务回滚、引用删除限制和默认初始化。
- 前端：Dark/Light 下拉过滤、模式切换即时应用、保存失败回滚、Profile 编辑隔离、导入结果展示和不兼容警告。
- 集成：启动加载绑定、已有终端热更新、新终端继承、回放终端继承、重启后配置恢复。
- 质量门禁：新增逻辑覆盖率不低于 90%，执行前端全测、Go race、golangci-lint 和 `wails3 build`。

## 本轮范围

- 重构主题仓库模型与服务。
- 内置 Dark/Light 主题初始化。
- Dark/Light Profile 绑定与自动联动。
- `.itermcolors` 单文件和多文件导入。
- 基础主题管理页面。
- 不实现远程 GitHub 仓库同步、在线主题市场、自动更新和其他终端格式导入。
