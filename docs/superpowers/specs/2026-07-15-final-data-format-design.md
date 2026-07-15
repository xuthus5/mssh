# Final Data Format Design

## Goal

MSSH 在 POC 阶段只维护一套最终数据格式。旧数据库、旧 RPC、旧前端状态形状和旧导入文件不再迁移、适配或兜底；遇到版本不一致时直接清理或拒绝。

## Scope

本次删除以下历史兼容面：

- SQLite 增量 `ALTER TABLE`、旧列检查和旧表局部替换。
- `legacy` settings namespace 及 raw-string `GetSetting/SetSetting`。
- `SessionService.Connect/Disconnect` 和 `LogService.StartRecording/StopRecording` 旧 Wails RPC。
- Terminal Tab 缺少 `terminalId/sessionId` 时回退到 `id/0` 的旧形状。
- Playback Tab 使用 `terminalId` 保存录制路径的字段复用。
- 没有格式版本、允许未知字段或缺失字段的配置导入文件。
- `0001-01-01` 旧录制时间的特殊展示分支。
- 对旧内置主题目录和旧主题表结构的单独识别、删除及重新映射。

不在本次范围：

- Windows、Linux、macOS 路径和桌面环境差异。
- iTerm2 Color Schemes 等外部社区格式。
- 字体 fallback、缺省配置、新数据库默认值。
- 当前录制格式的精确版本校验。
- 网络、数据库和组件异常的正常错误处理。
- 删除分组时将当前节点重新归属默认分组的业务规则。

## Database Format Gate

数据库使用唯一 `PRAGMA user_version` 作为应用数据格式版本。`databaseFormatVersion` 同时代表：

- 所有应用表的最终 Schema。
- typed settings 合约。
- 内置主题目录和默认主题数据合约。

启动时执行 `store.InitializeSchema`：

1. 读取 `PRAGMA user_version`。
2. 若版本不等于 `databaseFormatVersion`，在事务中按外键依赖逆序删除所有应用表。
3. 按最终 DDL 创建全部表；DDL 直接包含 `is_default`、`last_connected_at`、`connection_count`、typed settings 和完整主题表字段。
4. 创建唯一默认分组并设置 `PRAGMA user_version`。
5. 若版本相同，只执行幂等建表和默认分组业务不变量初始化，不检查或转换旧列。

当前数据库的 `user_version` 为 `0`，因此升级到本实现后会执行一次全量清理。这是明确预期行为。

后续任何 Schema、typed setting 合约或内置主题目录的不兼容变化，都必须提升 `databaseFormatVersion`，不得增加迁移分支。

## Typed Settings Contract

settings 仅接受以下最终结构：

```text
key, namespace, value, value_type, version, updated_at
```

- `key` 必须以 `<namespace>.` 开头。
- `namespace = legacy` 不再合法。
- `value` 必须是合法 JSON。
- `version` 必须精确等于当前 settings 版本 `1`。
- Wails 只暴露 `Get/GetMany/List/Set/SetMany/Delete`。
- 删除 raw-string `GetSetting/SetSetting` 及 JSON string/raw 双重返回逻辑。

## Service API Surface

终端连接统一由 `TerminalService.Open/Close` 管理。`SessionService` 保留内部 `connect/disconnect`、host-key decision 和连接池能力，但不再暴露 `Connect/Disconnect` RPC。

录制统一由 `LogService.StartTerminalRecording/StopTerminalRecording` 管理。删除调用方提供路径、按日志 ID 停止的旧 RPC。`StopTerminalRecordingIfActive` 和 `HandleOutput` 继续作为内部生命周期能力。

生成的 Wails bindings 和 E2E binding contract 必须同步删除旧方法。

## Frontend Tab Contract

Tab 使用 discriminated union：

```ts
type Tab = TerminalTab | PlaybackTab

interface TerminalTab {
  id: string
  title: string
  type: 'terminal'
  terminalId: string
  sessionId: number
  terminalInstance?: number
}

interface PlaybackTab {
  id: string
  title: string
  type: 'playback'
  recordingPath: string
}
```

`id` 只表示 UI Tab ID。终端运行 ID 只能来自 `terminalId`，回放路径只能来自 `recordingPath`。所有 `terminalId ?? id`、`sessionId ?? 0` 和 playback `terminalId` 读取必须删除。

## Sync Document Contract

导出文件增加必填 `format_version: 1`。导入使用 `json.Decoder.DisallowUnknownFields`，并拒绝：

- 缺少或不等于当前版本的 `format_version`。
- 未知字段。
- 缺失的 `sessions`、`keys` 或 `macros` 数组。
- 主 JSON 值之后的尾随内容。

旧的无版本导出文件不再接受。

## Recording Time

当前后端必须返回有效录制开始时间。前端删除对 `0001-01-01` 的历史特殊判断；非法时间仍可作为运行时损坏数据显示“时间未知”，但不再识别任何旧时间格式。

## Error Handling

- 数据库重建在单个事务内完成；失败时回滚并阻止应用启动。
- 严格导入在任何数据库写入前完成完整解码和格式校验。
- 删除旧 RPC 后，生成绑定和 E2E 合约确保旧方法无法被调用。
- 前端 discriminated union 通过 TypeScript 编译保证所有 Tab 创建点提供最终字段。

## Testing

- 数据库：版本不一致全量清理、当前版本幂等保留、最终 Schema、默认分组、事务失败。
- Settings：拒绝 legacy namespace、非当前版本和无 namespace key。
- Services/bindings：旧 settings/session/log RPC 不存在。
- Sync：当前版本往返；无版本、错误版本、未知字段、缺失数组和尾随 JSON 均失败。
- Frontend：Terminal/Playback Tab 最终形状、关闭与状态读取、回放路径、SFTP 和分屏流程。
- 最终执行 Go 全测、race、覆盖率、golangci-lint、前端全测与覆盖率、前端 build 和 `wails3 build`。
