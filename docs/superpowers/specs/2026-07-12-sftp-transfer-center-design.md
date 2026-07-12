# SFTP 全局传输中心设计

## 目标

将状态栏左下角横向传输列表替换为商业化的全局传输中心。状态栏仅显示聚合进度入口，新任务开始时自动打开右侧 Sheet，用户可持续查看多会话上传下载、取消、失败原因、重试和当前运行周期的历史记录。

## 布局

- 状态栏显示紧凑传输按钮：活动任务数、加权聚合进度和方向图标。
- 点击状态按钮切换右侧 `Sheet`。
- 新上传或下载任务创建后自动打开 Sheet。
- Sheet 宽度约 `400px`，使用 `ScrollArea` 承载长任务列表。
- 任务分为“进行中”和“最近完成”两个区域。
- 无任务时使用 shadcn `Empty`。

## 任务展示

活动任务展示文件名、上传或下载图标、会话名称 Badge、状态 Badge、进度条、已传输与总大小、速度、ETA 和取消按钮。未知总大小时显示不确定状态，不伪造百分比。

已结束任务展示完成、失败或取消状态、结束时间和文件大小。失败任务显示错误原因和重试按钮；所有已结束任务均可单项移除。顶部“清除记录”只移除已结束任务，不影响活动任务。

## 任务模型

`TransferJob` 增加：

- `sessionId: number`
- `sessionName: string`
- `sourcePath: string`
- `targetPath: string`
- `completedAt?: number`

历史只存在于 Zustand 内存状态，应用重启后清除。`queued` 和 `running` 属于活动任务；`completed`、`failed` 和 `cancelled` 属于历史任务。

## 统一操作层

新增 `transferActions` 模块，统一封装上传、下载、取消和重试。`useFileTransfer` 不再直接构造任务。重试根据任务方向复用原 `sessionId`、`sourcePath` 和 `targetPath`，调用后端生成新任务 ID，并用新排队任务替换原失败任务。

会话名称从当前标签状态中解析；无法匹配时使用 `会话 #<id>`。

## 聚合规则

- 已知总大小的活动任务按总字节加权计算聚合百分比。
- 存在总大小未知的活动任务时，入口优先显示活动任务数量，不展示误导性百分比。
- 活动任务为零但存在历史时，入口显示最近结果状态，仍可打开传输中心。

## 状态与事件

- `addTransfer` 自动打开传输中心。
- 后端 `file:progress` 更新进度、速度和 ETA。
- `file:complete` 设置完成或取消状态及 `completedAt`。
- `file:error` 设置失败、错误信息及 `completedAt`。
- 用户关闭 Sheet 后任务继续运行；下一项新任务创建时再次自动打开。

## 组件体系

使用 shadcn `Sheet`、`ScrollArea`、`Card`、`Badge`、`Progress`、`Button`、`Separator`、`Empty` 和 `Tooltip`。只使用语义化 CSS 令牌，不硬编码状态颜色。所有图标来自 Lucide，并提供键盘焦点与 ARIA 标签。

## 测试

- 任务模型和自动展开。
- 活动与历史分区及清理。
- 已知与未知大小的聚合进度。
- 上传、下载、取消和失败重试参数。
- 后端完成和错误事件的结束时间。
- 状态栏入口和 Sheet 开关。
- 多会话 Badge、错误信息、空状态和操作按钮。
- 前端全测、TypeScript/Vite 构建、Go race/覆盖率、lint 和 `wails3 build`。
