# 云同步中心设计

日期：2026-07-18
状态：需求冻结，进入实现

## 目标

将现有单一 HTTP/WebDAV 上传下载表单升级为版本化同步中心，支持 GitHub Gist、WebDAV 和 AWS S3/S3-compatible 三种 provider，并提供三方智能同步、本地版本历史、恢复、保留策略和安全重置能力。

远端始终保存当前 `.msshbackup`，本地保存不可变版本历史。同步继续使用 Argon2id 与 AES-256-GCM 加密的完整快照，不向 provider 暴露会话、密钥或配置明文。

## 已确认决策

- 智能同步使用“本地快照、远端快照、上次同步基线”三方判断。
- 远端只维护当前 `.msshbackup`，本地保存版本历史。
- 清空操作只清除可同步业务数据，保留同步配置、凭据、主密钥、本地版本和审计日志。
- 本地版本同时按数量和天数保留，默认 30 个版本、90 天。
- S3 支持 AWS S3、MinIO、Ceph 等 SigV4-compatible 服务。
- 智能冲突由用户选择采用本地或云端，覆盖前保存被覆盖版本。
- 同一时间只启用一个 provider，但分别保留三种 provider 的配置。
- 自动同步支持手动、5、15、30、60 分钟；默认启动后执行一次并每 15 分钟执行。
- 版本历史和同步操作记录分离，无变化或失败不会产生重复备份。
- Gist 自动创建 Secret Gist，固定文件名 `.msshbackup`；WebDAV 和 S3 也使用固定文件名。
- Provider 凭据使用设备主密钥加密后持久化，并从同步快照中排除。
- 恢复和重置前关闭 SSH 与隧道、创建恢复点；恢复后只标记本地待同步，不自动覆盖远端。

## 数据模型

### 同步配置

同步配置保存在本地 `sync.config`，包含：

- `enabled`
- `provider`: `gist | webdav | s3`
- `strategy`: `smart | cloud_first | local_first`
- `interval_minutes`: `0 | 5 | 15 | 30 | 60`
- `retention_count`
- `retention_days`
- 三种 provider 的非敏感配置

Gist Token、WebDAV 密码、S3 Secret Key 分别加密保存到 local-only setting。所有 `sync.*` setting 都从 `.msshbackup` 快照中排除。

### 云端 Artifact

远端 `.msshbackup` 使用版本化 artifact wrapper：

```json
{
  "artifact_version": 1,
  "metadata": {
    "version_id": "uuid",
    "version_number": 12,
    "parent_version_id": "uuid",
    "snapshot_fingerprint": "sha256",
    "device_id": "uuid",
    "created_at": "RFC3339"
  },
  "backup": {
    "format_version": 1,
    "cipher": "AES-256-GCM",
    "kdf": "Argon2id"
  }
}
```

导入逻辑同时兼容旧版仅包含 backup envelope 的 `.msshbackup`。

### 本地版本

`sync_versions` 只保存版本元数据和磁盘文件路径，实际备份位于数据目录的 `sync/versions`，目录权限 `0700`，文件权限 `0600`。

版本包含本地编号、云端版本号、指纹、来源、provider、文件大小、创建时间和保护标记。内容相同的指纹不会重复落盘。

### 同步记录

`sync_events` 记录测试连接、同步、上传、下载、无变化、冲突、恢复、重置和失败。记录不包含 URL、Token、密码、Access Key 或备份内容。

## Provider 契约

Provider 实现统一的测试、读取和条件写入能力：

- Gist：GitHub REST API；无 Gist ID 时首次写入创建 Secret Gist；更新时写入 `.msshbackup`。
- WebDAV：配置目录 URL；使用 `PROPFIND` 测试，`GET` 读取，`PUT` 条件写入。
- S3：AWS SDK v2；支持自定义 endpoint、region、bucket、prefix 和 path-style；对象 key 固定为 `{prefix}/.msshbackup`。

所有网络操作必须使用 context、20 秒超时、32 MiB 响应上限和条件写入。远端版本变化时必须返回冲突，不允许静默覆盖。

## 同步算法

### 智能同步

1. 计算规范化本地快照 SHA-256 指纹。
2. 拉取并解密远端 artifact。
3. 读取当前 provider 的同步基线。
4. 仅本地变化时上传；仅远端变化时下载；都未变化时 no-op；两边都变化时返回冲突。
5. 首次同步且远端已存在、本地又不相同时返回冲突，由用户选择。

### 云端优先

远端存在且与本地不同时采用云端；远端不存在时上传本地。覆盖本地前保存本地版本。

### 本地优先

本地与远端不同时上传本地；覆盖远端前保存已拉取的远端版本到本地历史。

### 冲突解决

- 采用云端：保存当前本地版本，恢复远端并更新基线。
- 采用本地：保存远端版本，条件覆盖远端并更新基线。
- 取消：保持两端不变，记录冲突事件。

## 自动同步

后端 scheduler 在应用启动后延迟执行一次，并按配置间隔运行。保存配置时重新调度；禁用同步或间隔为 0 时只保留手动同步。应用退出时取消 scheduler，不等待新的网络同步开始。

同一时间最多运行一个同步任务。重复触发返回当前忙碌状态，不并发写数据库或远端。

## 恢复与重置

恢复版本和清空业务数据均执行：

1. 关闭所有终端、SSH 连接和隧道。
2. 保存当前状态为受保护恢复点。
3. 在事务中执行恢复或清空。
4. 将同步状态标记为本地已变化。
5. 广播数据变化事件，主窗口刷新工作区，设置窗口刷新同步状态。

清空操作保留同步配置、加密凭据、主密钥、本地版本、同步记录、审计日志、命令历史、录屏和应用设置。

## 页面结构

云同步关闭时只显示启用开关和本地导入导出。启用后出现一个 `rounded-xl border shadow-sm` 面板：

```text
┌ Provider | 状态与配置 ──────────────────────────┐
│ Provider: [Gist] [WebDAV] [S3]                 │
│ 当前 provider 的紧凑配置表单                     │
│                         [保存并测试]             │
├─────────────────────────────────────────────────┤
│ 状态: 本地 #18  ⇄  云端 v12   已同步/待同步/冲突 │
│ 策略、自动同步间隔、立即同步、上传、下载          │
│ 本地版本历史                                     │
│ 同步操作记录                                     │
│ 保留策略                                         │
│ 恢复与清空业务数据                               │
└─────────────────────────────────────────────────┘
```

Provider 使用图标与明确名称，不使用装饰性插画。版本列表和同步记录采用紧凑行布局，不嵌套卡片。

## EARS 验收项

- `SYNC-PROVIDER-001` 当用户启用云同步时，系统必须展示 Provider 与状态配置两个 Tab。
- `SYNC-PROVIDER-002` 当用户选择 Gist、WebDAV 或 S3 时，系统必须展示该 provider 对应字段并保留其他 provider 已保存配置。
- `SYNC-PROVIDER-003` 当 Gist 尚无 ID 且首次上传时，系统必须创建 Secret Gist，并将内容写入 `.msshbackup`。
- `SYNC-PROVIDER-004` 当 WebDAV 或 S3 同步时，系统必须固定读写 `.msshbackup`。
- `SYNC-SECRET-001` 当用户保存 provider 凭据时，系统必须使用设备主密钥加密持久化。
- `SYNC-SECRET-002` 当系统生成同步快照时，系统必须排除全部 `sync.*` 设置和 provider 凭据。
- `SYNC-SECRET-003` 当审计或同步记录写入时，系统不得记录 provider 密钥、完整 URL 或备份正文。
- `SYNC-SMART-001` 当只有本地相对基线变化时，智能同步必须上传本地版本。
- `SYNC-SMART-002` 当只有远端相对基线变化时，智能同步必须下载远端版本。
- `SYNC-SMART-003` 当本地和远端均变化时，智能同步必须进入冲突状态且不得自动覆盖。
- `SYNC-SMART-004` 当两端内容一致时，智能同步必须返回无变化且不得生成重复版本。
- `SYNC-PRIORITY-001` 当策略为云端优先且远端存在时，系统必须在保存本地恢复版本后采用云端。
- `SYNC-PRIORITY-002` 当策略为本地优先时，系统必须在保存远端版本后上传本地。
- `SYNC-CONFLICT-001` 当用户选择采用云端时，系统必须保存本地版本后恢复远端。
- `SYNC-CONFLICT-002` 当用户选择采用本地时，系统必须保存远端版本后条件覆盖远端。
- `SYNC-VERSION-001` 当内容产生新版本时，系统必须将加密 `.msshbackup` 保存到本地版本目录。
- `SYNC-VERSION-002` 当指纹与已有版本一致时，系统不得重复保存备份文件。
- `SYNC-VERSION-003` 当用户恢复历史版本时，系统必须先创建当前状态恢复点并关闭活动连接。
- `SYNC-RETENTION-001` 当版本超过数量或天数上限时，系统必须清理最旧且未受保护的版本。
- `SYNC-HISTORY-001` 当发生测试、同步、冲突、恢复、重置或失败时，系统必须写入同步记录。
- `SYNC-SCHEDULE-001` 当启用自动同步时，系统必须在启动后执行一次并按 5/15/30/60 分钟间隔调度。
- `SYNC-SCHEDULE-002` 当同步任务正在运行时，系统不得启动第二个并发任务。
- `SYNC-RESET-001` 当用户确认清空业务数据时，系统必须关闭终端和隧道、创建恢复点并在事务中清空可同步业务数据。
- `SYNC-RESET-002` 当清空完成时，系统必须保留同步配置、主密钥、本地版本、同步记录、审计和应用设置。
- `SYNC-UI-001` 当同步状态变化时，页面必须展示本地版本、云端版本、最后同步时间和状态。
- `SYNC-UI-002` 当存在冲突时，页面必须提供采用云端、采用本地和取消操作。
- `SYNC-UI-003` 当恢复或清空操作执行时，页面必须要求明确确认并显示完成或失败结果。

## 质量门禁

- 新增 Go 和前端方法具备关键路径、边界与错误路径测试。
- 项目代码行覆盖率不低于 90%。
- 通过前端全测与生产构建、`go test -race ./...`、`goimports-reviser`、`golangci-lint`、`go mod verify`、`govulncheck ./...` 和 `wails3 build`。
