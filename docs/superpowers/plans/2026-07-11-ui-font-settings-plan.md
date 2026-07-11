# 应用界面字体设置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在通用设置中提供跨平台系统字体选择和界面字号配置，并支持即时预览、取消恢复、保存与启动恢复。

**Extension:** 增加单个可配置 Fallback 字体，字体栈固定为“主字体、Fallback 字体、`sans-serif`”，并禁止主备字体相同。

**Architecture:** Go `FontService` 负责发现字体目录、解析字体家族并缓存结果；React `useSettings` 负责字体配置加载与持久化；独立字体样式辅助模块负责校验和 CSS 变量应用；设置弹窗只管理表单草稿与恢复语义。

**Tech Stack:** Go 1.26、Wails v3、`golang.org/x/image/font/sfnt`、React 19、TypeScript、Vitest、Tailwind CSS v4、shadcn/ui。

## Global Constraints

- 仅使用系统已安装字体，不导入或打包额外字体。
- 字号范围固定为 `12–24px`，默认 `14px`。
- 应用字体不得影响终端字体。
- 选择后立即预览，保存后持久化，未保存关闭时恢复。
- 所有新增 Go 方法和前端行为必须有测试看护。

---

### Task 1: 跨平台字体扫描服务

**Files:**
- Create: `internal/service/font.go`
- Create: `internal/service/font_test.go`
- Modify: `internal/app/app.go`
- Modify: `internal/app/app_test.go`
- Modify: `main.go`
- Modify: `go.mod`
- Modify: `go.sum`

- [ ] 编写失败测试，覆盖字体扩展名过滤、目录去重、损坏字体忽略、结果排序、空结果回退与缓存。
- [ ] 运行 `go test ./internal/service -run TestFontService -count=1`，确认测试因服务缺失而失败。
- [ ] 使用 `sfnt` 实现字体文件解析、平台目录发现和只读缓存，并将 `FontService.List()` 暴露为 Wails binding。
- [ ] 在应用装配与主程序服务列表中注册 `FontService`。
- [ ] 运行服务与应用定向测试，确认通过。

### Task 2: 字体配置状态与样式应用

**Files:**
- Create: `frontend/src/lib/uiFont.ts`
- Create: `frontend/src/lib/uiFont.test.ts`
- Modify: `frontend/src/hooks/useSettings.ts`
- Modify: `frontend/src/hooks/useSettings.test.ts`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/src/lib/wails.ts`

- [ ] 编写失败测试，覆盖默认配置、持久化配置加载、系统字体加载、字号限制、CSS 变量应用和保存键值。
- [ ] 运行相关 Vitest，确认测试因字体配置能力缺失而失败。
- [ ] 实现字体值规范化、字号限制与 CSS 变量应用工具。
- [ ] 扩展 `GeneralSettings` 和 `useSettings`，并在启动加载后立即应用保存配置。
- [ ] 暴露系统字体列表和预览/恢复方法，保持终端主题状态不变。
- [ ] 运行相关 Vitest，确认通过。

### Task 3: 通用设置字体交互

**Files:**
- Create: `frontend/src/components/settings/SettingsDialog.test.tsx`
- Create: `frontend/src/components/ui/searchable-select.tsx`
- Create: `frontend/src/components/ui/searchable-select.test.tsx`
- Modify: `frontend/src/components/settings/SettingsDialog.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

- [ ] 编写失败测试，覆盖字体搜索选择、字号预览、保存保持和未保存关闭恢复。
- [ ] 运行设置弹窗测试，确认因控件缺失而失败。
- [ ] 实现可搜索且标签值一致的系统字体选择组件。
- [ ] 在通用设置中增加字体类型、字号和中英文数字预览区域。
- [ ] 接入即时预览、保存失败恢复和关闭恢复语义。
- [ ] 运行设置与侧边栏相关测试，确认通过。

### Task 4: 生成绑定并完成质量门禁

**Files:**
- Modify: `frontend/bindings/github.com/xuthus5/mssh/internal/service/fontservice.ts`
- Modify: `frontend/src/lib/__tests__/bindings.test.ts`
- Modify: `README.md`（仅在使用说明需要更新时）

- [ ] 生成或更新 Wails 前端绑定并补充导出测试。
- [ ] 执行 `goimports-reviser` 和 `golangci-lint`。
- [ ] 执行前端全测、TypeScript/Vite 构建和覆盖率检查。
- [ ] 执行 Go race 测试及业务包覆盖率门禁，确保不少于 `90%`。
- [ ] 执行 `wails3 build`，清理覆盖率与二进制产物。
- [ ] 检查差异、提交并推送 `main`，确认工作区干净且 `HEAD == origin/main`。
