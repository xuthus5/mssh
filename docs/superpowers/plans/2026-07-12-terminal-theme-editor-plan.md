# 终端主题编辑器重布局实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“外观”改为“终端”，并实现带可搜索预设、实时预览和专业属性检查器的商业化主题编辑页面。

**Architecture:** 预设数据、预设 Combobox、终端预览和 ANSI 编辑器独立组件化，`ThemeEditor` 只负责草稿状态、双栏布局和保存。

**Tech Stack:** React 19、TypeScript、Vitest、shadcn/ui base-nova、Tailwind CSS v4。

### Task 1: 导航与预设选择

- [x] 编写“外观”改“终端”和预设搜索选择失败测试。
- [x] 提取预设数据并实现 ThemePresetCombobox。
- [x] 运行导航和预设定向测试。

### Task 2: 预览与 ANSI 编辑

- [x] 编写预览样式和 ANSI 单色编辑失败测试。
- [x] 实现 TerminalThemePreview 与 AnsiPaletteEditor。
- [x] 运行组件定向测试。

### Task 3: 双栏专业编辑器

- [x] 编写表单同步和保存完整主题失败测试。
- [x] 使用 Card、FieldGroup 和语义化令牌重构 ThemeEditor。
- [x] 运行 ThemeEditor 与 SettingsDialog 测试。

### Task 4: 质量门禁与交付

- [x] 执行前端全测和构建。
- [x] 执行 goimports、golangci-lint、Go race 和覆盖率门禁。
- [x] 执行 `wails3 build`，清理视觉与构建产物。
- [x] 提交并推送 `main`，确认本任务文件无遗留。
