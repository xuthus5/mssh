# 全局终端字体与光标配置设计

## 背景

当前终端主题 Profile 同时保存颜色、字体、字号和光标样式。Dark、Light 或固定主题切换时，整套 Profile 会被应用到 SSH 与回放终端。这导致用户若只想统一调整所有终端的字体或光标样式，就必须逐个修改主题；切换主题时也可能意外改变字体和光标形态。

本次将字体、字号和光标样式提升为全局终端配置。每个主题默认跟随全局配置，同时保留主题级独立值；用户关闭某个主题的“跟随全局字体与光标”开关后，该主题改用自己的字体、字号和光标样式。光标颜色继续属于主题颜色，确保 Dark/Light 背景下具有合适对比度。

## 目标

1. 在终端设置页提供全局终端字体、字号和光标样式配置。
2. 所有内置、导入、自定义、Dark、Light 和固定主题默认跟随全局配置。
3. 每个主题可以独立关闭跟随并保存自己的字体、字号和光标样式。
4. 重新开启跟随时不删除主题级独立值，后续再次关闭可恢复原配置。
5. 保存后立即热更新所有 SSH 与回放终端，新建终端和应用重启后使用相同有效配置。
6. 全局配置、主题配置和主题分配在单一事务中保存，避免部分成功。
7. 光标颜色、终端颜色和 ANSI 调色板继续由主题控制。

## 非目标

- 不实现按会话、分组或单个终端实例覆盖字体与光标。
- 不新增终端字体 fallback 字段；现有 `font_family` 继续允许保存 CSS 字体栈。
- 不改变应用界面字体配置。
- 不改变 iTerm2 颜色导入格式；导入主题只提供颜色并默认跟随全局样式。
- 不让未保存的设置草稿影响主窗口现有终端。

## 方案选择

采用“通用设置保存全局值，主题 Profile 保存跟随标记与备用独立值”的方案。

- `settings` 表保存全局终端字体、字号和光标样式，不新增全局配置表。
- `terminal_theme_profiles` 增加 `follow_global_style` 布尔字段，默认值为 `1`。
- Profile 现有的 `font_family`、`font_size`、`cursor_style` 字段继续保留，作为关闭跟随后使用的主题级值。
- 有效终端主题由统一解析器将 Profile 颜色与全局或主题级样式合并，不允许调用方自行复制判断逻辑。

该方案比在 `settings` 表中创建动态 Profile 键更容易维护主题生命周期，也比新增独立样式表更符合当前功能规模。

## 领域模型

### TerminalGlobalStyle

新增 Go 模型及 Wails 绑定：

```go
type TerminalGlobalStyle struct {
	FontFamily  string      `json:"font_family"`
	FontSize    int         `json:"font_size"`
	CursorStyle CursorStyle `json:"cursor_style"`
}
```

输入模型使用相同字段。默认值：

- `font_family`: `"JetBrains Mono", "Cascadia Code", monospace`
- `font_size`: `14`
- `cursor_style`: `bar`

### ThemeProfile

扩展主题 Profile：

```go
type ThemeProfile struct {
	ID                int64
	Name              string
	ThemeID           int64
	FollowGlobalStyle bool
	FontFamily        string
	FontSize          int
	CursorStyle       CursorStyle
	ColorOverrides    string
}
```

`ThemeProfileInput` 同步增加 `follow_global_style`。已有字体与光标字段始终保存，不因开启跟随而清空。

### ThemeConfiguration

统一保存输入扩展为：

```go
type ThemeConfigurationInput struct {
	GlobalStyle TerminalGlobalStyleInput `json:"global_style"`
	Profiles    []ThemeProfileInput      `json:"profiles"`
	Assignments ThemeAssignmentsInput    `json:"assignments"`
}
```

Theme Catalog 加载时同时返回或并行加载全局样式、Profiles 与 Assignments。前端状态必须在三者完整可用后才标记为已加载。

## 持久化

### 全局配置键

继续使用现有通用 `settings` 表：

| Key | Type | Default |
| --- | --- | --- |
| `terminal.style.font_family` | string | `"JetBrains Mono", "Cascadia Code", monospace` |
| `terminal.style.font_size` | number | `14` |
| `terminal.style.cursor_style` | string | `bar` |

缺失或无效值由后端初始化为默认值。前端不得通过随机值掩盖后端数据错误。

### Profile Schema

`terminal_theme_profiles` 增加：

```sql
follow_global_style INTEGER NOT NULL DEFAULT 1
```

项目处于 POC 阶段，不保留旧主题目录格式。启动时检查 `themes` 与 `terminal_theme_profiles` 是否符合最终 Schema；任一结构不匹配时直接删除并重建主题目录，由 `InitializeDefaults` 重新创建内置主题和默认绑定。旧 Profile、旧主题绑定及旧主题级字体配置不做迁移。

### 事务边界

`ThemeService.SaveConfiguration` 在一个数据库事务内：

1. 校验全局样式。
2. 校验主题分配及引用 Profile。
3. 校验 Profile ID 唯一、Profile 存在及主题级样式合法。
4. 更新所有 Profile，包括 `follow_global_style` 和备用独立值。
5. 保存全局样式三个设置键。
6. 保存 Dark、Light、跟随界面模式和固定 Profile 分配。
7. 任一步骤失败时回滚全部修改。

单独创建或更新 Profile 的接口同样保存 `follow_global_style`。导入或新建 Profile 默认设为 `true`。

## 有效终端样式解析

有效终端主题由纯函数统一生成：

```text
colors = selected profile definition + color overrides

if profile.follow_global_style:
    font family  = global font family
    font size    = global font size
    cursor style = global cursor style
else:
    font family  = profile font family
    font size    = profile font size
    cursor style = profile cursor style

cursor color = profile colors
```

解析器输入为选中的 Profile 和 `TerminalGlobalStyle`，输出完整前端 `TerminalTheme`。以下入口统一调用该解析器：

- 应用启动加载主题目录。
- 保存终端设置后重新加载。
- Dark/Light 模式切换。
- 固定主题切换。
- 内置主题重置。
- Profile 创建、更新、导入或删除后重新加载。
- SSH 与回放终端首次创建及热更新。

## 设置页面交互

### 全局字体与光标卡片

在“终端主题应用策略”之后增加 shadcn `Card`：

```text
全局字体与光标

终端字体    [字体或字体栈输入]
终端字号    [14]
光标样式    [竖线 ▾]
```

- 使用 `Field`、`Input` 和统一的 `LabeledSelect`。
- 字号范围为 `8–48`。
- 修改只影响设置页实时预览，不影响主窗口终端，直至保存成功。
- 全局配置属于同一个“保存主题配置”操作，不增加第二个独立保存按钮。

### 主题级跟随开关

当前主题属性检查器增加：

```text
[开关] 跟随全局字体与光标
开启后，该主题使用上方全局字体、字号和光标样式。
```

- 默认开启。
- 开启时主题级字体、字号和光标样式字段显示有效全局值，并处于禁用状态。
- 关闭时字段恢复该 Profile 保存的独立值并允许编辑。
- 光标颜色始终可编辑，并保留在颜色配置区域。
- 实时终端预览始终展示当前有效结果，而不是隐藏的备用值。
- Dark、Light 和固定槽位引用同一 Profile 时，共享同一个跟随标记和独立配置，并继续展示现有共享引用 Badge。

### 脏状态与保存

以下操作进入统一 `dirty` 状态：

- 修改全局字体、字号或光标样式。
- 切换主题级跟随开关。
- 修改主题级备用字体、字号或光标样式。
- 修改主题颜色、ANSI 色板、主题分配或界面跟随策略。

保存期间禁用所有相关控件、重置和重复提交。保存失败时保留全部草稿，主窗口终端维持保存前状态。

## 内置主题初始化与重置

### 初始化

- 默认全局样式设置在主题初始化事务中补齐。
- 新建内置 Profile 的 `follow_global_style` 为 `true`。
- Schema 重建后创建的所有内置 Profile 默认跟随全局。

### 重置内置主题

重置当前绑定的内置 Profile 时：

- 恢复内置颜色覆盖。
- 恢复内置 Profile 的备用字体、字号和光标样式默认值。
- 将 `follow_global_style` 恢复为 `true`。
- 不修改全局字体、字号和光标样式。
- 自定义和导入 Profile 不受影响。

确认文案必须明确说明“恢复颜色并重新跟随全局字体与光标”。

## 校验与错误处理

### 后端校验

- 全局和主题级 `font_family` 去除控制字符并要求非空，最大长度 `256`。
- `font_size` 必须在 `8–48`。
- `cursor_style` 只能为 `block`、`underline` 或 `bar`。
- 即使 Profile 当前跟随全局，其备用独立值仍必须合法，避免以后关闭跟随时产生无效终端配置。
- 所有数据库错误使用 `%w` 包装并带操作上下文。

### 前端处理

- 输入草稿使用与后端一致的规范化和范围校验。
- 保存失败展示明确 Toast，不更新 Catalog Store 和 `appStore.terminalTheme`。
- 保存成功后重新加载 Catalog，再一次性写入新的完整有效终端主题。
- 热更新异常继续通过现有终端运行时错误处理，不能使应用黑屏。

## 测试策略

### Go

- Schema 新建和旧表增加 `follow_global_style` 字段。
- 全局样式缺省初始化、读写和无效值修复。
- Profile 跟随字段的创建、读取、更新、导入默认值和内置默认值。
- `SaveConfiguration` 同时保存全局样式、Profiles 和 Assignments。
- 全局样式、Profile 或 Assignments 任一步失败时事务整体回滚。
- 全局及备用主题级字体、字号、光标样式校验。
- 内置主题重置恢复跟随标记但不修改全局样式。

### React/Vitest

- 全局卡片默认值、标签、输入和光标样式下拉框。
- 所有 Profile 默认开启跟随。
- 跟随开启时主题级字段禁用并显示全局有效值。
- 关闭跟随时恢复并编辑 Profile 独立值。
- 重新开启再关闭时独立草稿不丢失。
- 光标颜色在两种状态下始终可编辑。
- Dark、Light 和固定 Profile 分别保存跟随状态。
- 预览合并全局样式和主题颜色。
- 保存配置包含 `global_style` 与 `follow_global_style`。
- 保存后现有 SSH 与回放终端立即热更新。
- 保存失败保留草稿和当前运行终端状态。
- 重置确认文案和重置后的跟随状态。

### 完整门禁

- Go 单元测试、竞态测试和覆盖率。
- 前端全量测试和覆盖率，代码行覆盖率不低于 `90%`。
- `goimports-reviser -rm-unused -format ./...`。
- `golangci-lint run --timeout 5m ./...`。
- `wails3 build`。

## 验收标准

1. 新安装和按最终 Schema 重建后的所有主题默认跟随全局终端字体、字号和光标样式。
2. 修改并保存全局样式后，当前与后续 SSH、分屏和回放终端立即使用新配置。
3. 某主题关闭跟随后，只在该主题生效其独立字体、字号和光标样式。
4. 主题重新开启跟随后使用全局值，再次关闭时恢复此前保存的独立值。
5. 光标颜色始终跟随主题，不受全局光标样式设置覆盖。
6. Dark、Light、固定主题及共享 Profile 的行为一致且可预测。
7. 保存和重置不存在数据库部分成功或前端部分应用状态。
8. 应用重启后全局配置、主题跟随状态和主题独立配置完整恢复。
9. 所有新增行为由自动化测试覆盖并通过项目完整质量门禁。
