# 应用界面字体设置设计

## 目标

在设置页面“通用”分类中增加应用界面字体类型与字体大小配置。配置仅影响 React 应用界面，不影响终端字体，并支持即时预览、取消恢复、数据库持久化及应用重启恢复。

## 用户体验

- 通用设置增加“界面字体”区域。
- 字体类型控件展示当前操作系统中已安装的字体家族，支持搜索与选择。
- 字体大小使用数字输入框，允许 `12–24px`，默认 `14px`。
- 配置区域展示包含中文、英文和数字的预览文本。
- 修改字体或字号后立即应用到主应用界面。
- 点击“保存”后与其他通用设置一起持久化。
- 未保存关闭设置窗口时恢复打开设置前的字体配置。
- 应用启动时读取已保存配置并应用，避免用户必须再次打开设置页面。

## 配置模型

`GeneralSettings` 增加：

- `uiFontFamily: string`
- `uiFontFallbackFamily: string`
- `uiFontSize: number`

数据库设置键：

- `appearance.ui_font_family`
- `appearance.ui_font_fallback_family`
- `appearance.ui_font_size`

默认值：

- 字体家族：`Geist Variable`
- Fallback 字体：`sans-serif`
- 字体大小：`14`

字体大小在前后端统一限制为 `12–24px`。无效或缺失的持久化值回退到默认值。

## 字体扫描服务

新增 Go `FontService` 并注册为 Wails binding。服务扫描以下目录：

- Windows：系统字体目录与当前用户字体目录。
- Linux：`/usr/share/fonts`、`/usr/local/share/fonts`、`~/.fonts`、`~/.local/share/fonts`。
- macOS：`/System/Library/Fonts`、`/Library/Fonts`、`~/Library/Fonts`。

支持 `.ttf`、`.otf` 和 `.ttc` 文件。使用 `golang.org/x/image/font/sfnt` 读取字体元数据中的家族名称，不依赖 `fc-list`、PowerShell 或其他外部命令。扫描结果执行去空、去重和稳定排序。

单个字体文件损坏时忽略该文件并继续扫描。目录不存在或不可读时忽略该目录。所有目录均无可用字体时返回包含 `sans-serif` 的回退列表，保证前端始终有可选项。

扫描只执行一次并缓存不可变结果，避免每次打开设置页面重复遍历字体目录。

## 前端应用机制

全局 CSS 增加：

- `--app-font-family`
- `--app-font-size`

`html` 使用这些变量控制应用字体，最终字体栈为“主字体、Fallback 字体、`sans-serif`”。主字体与 Fallback 字体相同时，Fallback 自动规范化为 `sans-serif`。终端组件继续读取 `terminal.theme.fontFamily` 与 `terminal.theme.fontSize`，不得引用应用字体变量。

新增字体设置辅助模块，负责：

- 校验和规范化字体家族名称。
- 限制字号范围。
- 将字体家族安全写入 CSS 自定义属性。
- 保存设置前生成规范化配置。

字体选择控件必须显示字体家族标签而非内部值，并沿用统一的 labeled select 交互。字体列表较长，因此控件需要支持搜索；搜索只在前端过滤已获取的字体列表。

## 状态与数据流

1. `useSettings` 初始化时并行读取通用设置与系统字体列表。
2. 已保存字体配置加载后立即写入全局 CSS 变量。
3. 打开设置窗口时，表单保存当前持久化字体作为恢复快照。
4. 用户修改字体或字号时，表单调用预览回调更新 CSS 变量。
5. 保存成功后更新 `GeneralSettings`，新的配置成为恢复基线。
6. 未保存关闭窗口时，将 CSS 变量恢复为当前 `GeneralSettings` 中的持久化配置。
7. 保存失败时保留设置窗口并显示错误，CSS 恢复到保存前的持久化配置。

## 安全与兼容性

- 字体目录由平台代码生成，不接受用户提供的任意扫描路径。
- 不执行外部命令，不拼接 shell 参数。
- 字体家族名称只写入 CSS 自定义属性，不拼接样式规则或 HTML。
- 跳过符号链接目录，避免目录循环和越界扫描。
- 读取字体文件时限制文件类型，并依赖字体解析器拒绝无效数据。
- Windows、Linux 和 macOS 使用统一服务接口，平台差异只存在于字体目录发现逻辑中。

## 测试与验收

- Go 单元测试覆盖目录发现、扩展名过滤、字体名称去重排序、损坏文件忽略、空结果回退和缓存。
- 前端测试覆盖默认值、设置加载、保存键值、字号边界、字体即时预览、未保存关闭恢复和保存后保持。
- 设置页面测试验证字体下拉框显示标签、搜索过滤及字号输入。
- 终端主题测试确认应用字体变化不修改终端字体配置。
- 执行前端测试、TypeScript/Vite 构建、`go test -race`、Go 覆盖率门禁、`golangci-lint`、`goimports-reviser` 和 `wails3 build`。

## 非目标

- 当前版本不支持导入自定义字体文件。
- 当前版本不提供预置字体包。
- 当前版本不修改终端字体配置。
- 当前版本不提供字体粗细、字间距或行高配置。
