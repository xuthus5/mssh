# SFTP 全局传输中心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用 shadcn Sheet 将 SFTP 传输进度重构为可取消、可重试、可清理的全局传输中心。

**Architecture:** Zustand 保存当前运行周期的任务和 Sheet 状态；`transferActions` 统一创建与重试任务；状态栏渲染聚合入口；右侧 Sheet 按活动和历史分区展示任务。

**Tech Stack:** React 19、TypeScript、Zustand、Vitest、shadcn/ui base-nova、Wails v3。

### Task 1: 扩展任务状态模型

- [x] 为 `TransferJob`、Sheet 状态、清理动作和聚合计算编写失败测试。
- [x] 扩展 Zustand store，并在完成/错误事件中记录结束时间。
- [x] 运行 store 与 event bridge 定向测试。

### Task 2: 统一传输操作与重试

- [x] 为上传、下载、取消和重试参数编写失败测试。
- [x] 新增 `transferActions`，让 `useFileTransfer` 委托统一操作层。
- [x] 运行 hook 与操作层定向测试。

### Task 3: 实现传输中心组件

- [x] 添加 shadcn `Sheet` 和 `ScrollArea`。
- [x] 为活动、历史、空状态、取消、重试、移除和清理编写组件测试。
- [x] 实现状态栏聚合入口和右侧传输中心。
- [x] 删除旧 `TransferProgress` 组件并更新 StatusBar。

### Task 4: 完成质量门禁

- [x] 执行前端全测和构建。
- [x] 执行 goimports、golangci-lint、Go race 和覆盖率门禁。
- [x] 执行 `wails3 build` 并清理产物。
- [x] 提交并推送 `main`，确认工作区干净。
