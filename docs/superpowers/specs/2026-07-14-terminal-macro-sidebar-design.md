# 终端页面宏侧栏设计

## 问题

当前顶部“宏”按钮调用 `activateWorkspace('macros')`。该 action 同时把 `workspaceTab` 切到宏，并把 `activeSurface` 从 SSH 终端切到宏工作区。由于宏内容只存在于左侧 Sidebar，右侧 `WorkspaceContent` 只能显示空白宏占位层，从而覆盖当前终端。

## 目标

1. 当前右侧为 SSH 终端时，点击“宏”只切换左侧 Sidebar 到宏列表。
2. 当前终端继续显示、保持连接、焦点、尺寸、输入输出和 SFTP 状态。
3. 点击“会话”仍返回会话资产页，不改变现有行为。
4. 当前不是 SSH 终端时，点击“宏”继续使用现有宏工作区切换规则。

## 状态规则

`activeSurface` 继续表示右侧主内容，`workspaceTab` 表示左侧 Sidebar 分类。

当调用 `activateWorkspace('macros')` 时：

- 若 `activeSurface.type === 'terminal'`，只更新 `workspaceTab = 'macros'`。
- 其他场景同时更新 `activeSurface = workspace/macros` 和 `workspaceTab = 'macros'`。

当调用 `activateWorkspace('sessions')` 时，始终同时更新主内容和 Sidebar，展示会话资产页。

顶部固定“会话/宏”属于 Sidebar 导航按钮组，其按下状态由 `workspaceTab` 决定，并通过 `aria-controls`、`aria-labelledby` 与 Sidebar 建立关系。动态终端标签属于独立 tablist，继续由 `activeSurface` 决定。两套导航状态可同时激活，分别表达左侧分类和右侧主内容。

## 交互流程

### 终端中打开宏

1. 用户位于 SSH 终端标签。
2. 点击顶部“宏”。
3. `workspaceTab` 更新为 `macros`。
4. Sidebar 展示宏列表。
5. `activeSurface` 保持当前终端，终端层继续可见。

### 从宏侧栏返回会话资产

1. 用户点击顶部“会话”。
2. `workspaceTab` 更新为 `sessions`。
3. `activeSurface` 更新为 `workspace/sessions`。
4. 右侧显示会话资产页，后台终端继续保持挂载。

## 测试

- 终端活动时点击宏，只更新 `workspaceTab`，保留终端 `activeSurface`。
- 宏按钮显示为按下，当前终端动态标签仍保持选中。
- 固定导航使用按钮语义，右侧工作区使用 region 语义，动态 SSH 标签继续使用 tab/tabpanel 语义。
- App 集成测试验证终端、SFTP、分屏焦点请求和录制状态不因侧栏切换而变化。
- 点击会话仍切换到 `workspace/sessions`。
- 非终端页面点击宏仍切换到 `workspace/macros`。
- 关闭最后一个动态标签后仍回退到会话资产页和会话 Sidebar。

## 验收标准

1. SSH 终端页面点击宏后，右侧终端不被空白页面覆盖。
2. 左侧立即展示宏列表，并可执行宏。
3. 再点击会话可正常进入会话资产页面。
4. 终端连接、输出和已打开工具状态不因宏侧栏切换而重置。
