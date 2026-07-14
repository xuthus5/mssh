# 终端主题跟随界面模式开关设计

## 背景

当前应用将界面 Dark/Light 模式与终端主题绑定：切换界面模式时，前端根据 `dark_profile_id` 或 `light_profile_id` 选择完整终端 Profile，并热更新所有 SSH 与回放终端。该行为方便用户自动获得与界面明暗匹配的终端主题，但无法满足“界面模式变化、终端主题保持固定”的使用场景。

同时，现有全局样式使用 `!important` 将 `.xterm-viewport` 背景强制设置为应用 `--background`，会覆盖 xterm 根据终端 Profile 设置的视口背景。新增开关必须同时移除此覆盖，否则关闭跟随后终端滚动区域仍会随界面模式变化。

## 目标

1. 在终端设置页增加“终端主题跟随界面模式”开关。
2. 开关默认开启，保持现有用户行为不变。
3. 关闭跟随后允许用户选择一个独立固定终端 Profile。
4. 保存配置后立即更新所有已打开 SSH 与回放终端。
5. 终端背景完全由终端 Profile 控制，不再被应用界面 CSS 覆盖。
6. 将开关、固定 Profile 和 Dark/Light Profile 纳入统一事务、校验和删除保护。

## 非目标

- 本次不实现按会话、分组或终端实例分别指定主题。
- 本次不增加主题自动切换时间表或跟随操作系统模式。
- 本次不改变主题导入格式和内置主题目录。
- 未保存的设置草稿不直接修改主窗口终端。

## 方案选择

采用扩展终端主题分配领域模型的方案，不使用独立的前端本地状态或分散的通用设置调用。

`ThemeAssignments` 统一保存：

```text
dark_profile_id
light_profile_id
follow_interface_mode
fixed_profile_id
```

该方案确保主题应用策略可以由 `ThemeService` 统一校验和事务保存，也能在删除 Profile、重置内置主题和后续扩展时保持一致边界。

## 状态模型

### ThemeAssignments

扩展 Go 模型与前端绑定：

```go
type ThemeAssignments struct {
	DarkProfileID       int64 `json:"dark_profile_id"`
	LightProfileID      int64 `json:"light_profile_id"`
	FollowInterfaceMode bool  `json:"follow_interface_mode"`
	FixedProfileID      int64 `json:"fixed_profile_id"`
}
```

`ThemeAssignmentsInput` 使用相同字段。

### 约束

1. `follow_interface_mode` 默认值为 `true`。
2. 跟随开启时，`fixed_profile_id` 可以为 `0`。
3. 跟随关闭时，`fixed_profile_id` 必须引用有效 Profile。
4. 首次关闭跟随且固定 Profile 未设置时，前端使用当前界面模式对应的有效 Profile 填充草稿。
5. 用户重新开启跟随后保留已保存的固定 Profile，后续再次关闭时继续使用该选择。
6. Dark 和 Light Profile 始终必须有效，即使当前关闭跟随，也要保留未来重新开启时的完整配置。

## 持久化

继续使用现有 `settings` 表，不新增数据表：

```text
terminal.theme.dark_profile_id
terminal.theme.light_profile_id
terminal.theme.follow_interface_mode
terminal.theme.fixed_profile_id
```

兼容规则：

- 缺少 `follow_interface_mode` 时按 `true` 处理。
- 缺少 `fixed_profile_id` 时按 `0` 处理。
- 现有数据库加载后保持当前联动行为，无需迁移脚本。

## 有效终端主题解析

前端增加纯函数 `resolveEffectiveTerminalProfile`，统一处理所有主题选择：

```text
if follow_interface_mode:
    dark interface  -> dark_profile_id
    light interface -> light_profile_id
else:
    fixed_profile_id
```

以下入口必须调用该解析器，不允许自行复制判断逻辑：

- 应用启动恢复设置。
- 标题栏切换 Dark/Light。
- 保存终端主题配置。
- 重置内置主题后重新加载。
- Profile 删除后重新加载。
- SSH 终端首次创建。
- 回放终端首次创建。

解析器遇到无效引用时返回明确错误或调用者提供的已修复分配，不静默选择任意 Profile。

## 运行行为

### 跟随开启

- 切换界面 Dark/Light 时更新应用 CSS 模式。
- 根据当前界面模式选择 Dark 或 Light Profile。
- 更新全局 `terminalTheme`。
- 所有 SSH 与回放终端通过现有订阅立即热应用完整主题。

### 跟随关闭

- 切换界面 Dark/Light 时只更新应用 CSS 模式。
- 不修改全局 `terminalTheme`。
- 当前及后续终端持续使用固定 Profile。

### 保存配置

- 未保存草稿只更新设置页预览。
- 保存成功后重新加载目录，解析当前有效 Profile，并更新所有终端。
- 保存失败时数据库整体回滚，前端保留草稿，主窗口终端保持保存前主题。

## 设置页面交互

### 应用策略卡片

在终端设置页顶部增加 `Card`，使用 shadcn/ui `Field`、`Switch` 和 `FieldDescription`：

```text
终端主题应用策略

[开关] 跟随界面模式
切换 Dark/Light 时，自动使用对应的终端主题。
```

### 跟随开启布局

展示 Dark 和 Light 两个 Profile 选择器，并保留现有编辑 Tab：

```text
Dark Mode 终端主题    [GitHub Dark  ▾]
Light Mode 终端主题   [GitHub Light ▾]

[Dark Mode] [Light Mode]
```

### 跟随关闭布局

双模式选择区域替换为单个固定 Profile 选择器：

```text
固定终端主题          [Dracula ▾]
```

编辑区不再显示 Dark/Light Tab，直接显示固定 Profile 名称并编辑其背景、前景、光标、字体和 ANSI 色板。

固定 Profile 可以选择任意 Dark、Light、Universal、内置、导入或自定义 Profile。选择器展示名称、模式 Badge、来源和颜色预览。

### 提示与共享引用

- 固定 Profile 模式与当前界面模式不一致时显示中性 `Alert`，说明终端会保持固定且不受界面模式影响。
- 固定 Profile 同时被 Dark 或 Light 使用时，在编辑标题旁显示共享引用 Badge。
- 修改共享 Profile 会同时影响引用该 Profile 的其他应用策略，界面必须明确提示。

### 脏状态与保存

- 开关、Profile 选择和颜色编辑共同参与 `dirty` 状态。
- 保存期间禁用开关、选择器、重置和保存操作。
- 存在未保存草稿时禁用“重置内置主题”，避免持久化配置刷新覆盖草稿。
- 保存失败时不清空草稿。
- “重置内置主题”只处理已持久化配置，不处理尚未保存的草稿选择。

## 配置保存接口

将 `ThemeConfigurationInput` 调整为可去重的 Profile 列表：

```text
assignments
profiles[]
```

前端根据 Dark、Light 和当前启用的 Fixed 引用收集本次编辑 Profile，并按 ID 去重。若同一 Profile 在不同编辑上下文产生不同内容，前端阻止保存并提示共享引用冲突。

后端 `SaveConfiguration` 在单个事务中：

1. 校验 Dark 和 Light Profile 存在。
2. 跟随关闭时校验 Fixed Profile 非零且存在。
3. 校验 `profiles[]` 中 ID 唯一且均存在。
4. 更新去重后的 Profile。
5. 保存四项主题分配设置。
6. 任一步骤失败时回滚全部修改。

## 初始化与自修复

`ThemeService.InitializeDefaults` 增加以下规则：

1. 缺少跟随设置时写入 `true`。
2. 缺少固定 Profile 设置时写入 `0`。
3. 跟随开启且固定 Profile 无效时清零。
4. 跟随关闭且固定 Profile 无效时回退到有效 Dark Profile。
5. Dark 或 Light Profile 无效时继续回退到对应 GitHub 内置主题。
6. 初始化和修复必须在现有主题初始化事务中完成。

## 删除保护

- Dark 或 Light 当前引用的 Profile 始终禁止删除。
- 跟随关闭时，当前固定 Profile 禁止删除。
- 跟随开启时，历史固定 Profile 可以删除；删除时在同一事务中将 `fixed_profile_id` 清零。
- 后端返回可展示的明确错误，不允许只依赖前端禁用按钮。

## 内置主题重置

- 跟随开启时重置当前 Dark 和 Light 引用的内置 Profile。
- 跟随关闭时额外重置当前 Fixed 引用的内置 Profile。
- 相同 Profile ID 必须去重后再更新。
- 跟随开启时不重置仅作为历史记录的固定 Profile。
- 自定义和导入主题保持不变。
- `BuiltinThemeResetResult` 增加 `fixed_reset`，前端根据 Dark、Light、Fixed 各槽位返回精确结果；多个槽位引用同一 Profile 时只执行一次数据库更新。

## xterm 背景修复

删除全局样式：

```css
.xterm .xterm-viewport {
  background-color: var(--background) !important;
}
```

xterm 会根据 `theme.background` 为视口设置背景色，应用不得覆盖该值。全局滚动条继续使用语义 CSS 变量，但终端视口和画布颜色只由终端 Profile 管理。

## 错误处理

- 数据库错误使用 `%w` 包装并保留操作上下文。
- 设置写入、Profile 更新和分配保存必须遵守单一事务。
- 前端所有 Wails 调用必须捕获 Promise 拒绝并展示明确 Toast。
- 保存失败不进行部分状态提交，也不覆盖当前终端主题。
- 热更新异常交由现有终端错误边界处理，不允许导致整个应用黑屏。
- 无效固定 Profile 在后端初始化阶段修复，前端不通过随机 Profile 掩盖数据问题。

## 测试

### Go

- 四字段设置读写、缺省值和错误值处理。
- 跟随关闭且 Fixed ID 为零或不存在时拒绝保存。
- 初始化修复无效 Dark、Light 和 Fixed 引用。
- Profile 删除保护和历史 Fixed 清理。
- `SaveConfiguration` Profile 去重和事务回滚。
- 内置主题重置在不同跟随状态下的引用集合和去重。

### React/Vitest

- 默认开启跟随并保持现有 Dark/Light 行为。
- 跟随开启时切换界面模式更新终端。
- 跟随关闭时切换界面模式不更新终端。
- 首次关闭自动选择当前有效 Profile。
- 重新关闭时保留已保存固定 Profile。
- 固定主题选择器展示所有模式与来源。
- 保存后 SSH 与回放终端立即更新。
- 模式不匹配和共享 Profile 提示正确。
- 保存失败保留草稿和现有终端状态。
- 使用 `globals.css?raw` 回归测试禁止重新加入 xterm 背景强制覆盖。

## 质量门禁

- 前端代码行覆盖率不低于 90%。
- Go 项目代码行覆盖率不低于 90%。
- 执行 `go test ./...` 和 `go test -race`。
- 执行 `goimports-reviser` 和 `golangci-lint`。
- 执行前端生产构建。
- 提交前执行 `wails3 build`。

## 验收标准

1. 新安装和现有数据库默认开启终端主题跟随界面模式。
2. 开启跟随时，Dark/Light 切换使用各自配置的终端 Profile。
3. 关闭跟随时，Dark/Light 切换不改变任何终端颜色。
4. 固定 Profile 可以选择任意模式和来源，并在保存后立即作用于所有终端。
5. 自定义终端背景完整覆盖终端画布与滚动视口，不再使用应用 `--background`。
6. 保存、初始化、删除和重置操作不存在部分成功状态。
7. 无效引用能够被确定性修复，不产生空白终端或未处理异常。
8. 所有新增行为具有自动化测试，并通过项目完整质量门禁。
