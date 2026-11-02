# 系统监控结构化协议

## 目标

MSSH 仍然是纯 SSH 客户端。系统监控通过现有 SSH 连接执行只读命令并解析远端 procfs/系统工具输出，不安装远端 Agent，也不引入需要常驻目标主机的服务。

协议升级解决以下问题：

- SSH 往返延迟污染网络速率分母
- 缺失指标被静默显示为真实 `0`
- 网络只展示所有接口汇总，无法识别虚拟接口
- 磁盘只展示根分区
- Linux 进程 CPU 使用 `ps %cpu` 生命周期平均值

## 协议版本

当前版本为 `schema_version=1`。快照使用只读、空格/Tab 分隔的记录，旧字段继续保留，前端和 Wails API 不需要破坏性迁移。

```text
SCHEMA 1
SOURCE linux-procfs
SAMPLE <unix-ms> <remote-monotonic-ms>
CAP <capability> [capability...]
CPU <total-ticks> <idle-ticks>
IOWAIT <iowait-ticks>
NETIF <name> <rx-bytes> <tx-bytes>
NETROLE <name> <loopback|physical|bond|bridge|team|slave>
DISKMOUNT <device> <mount-point> <used> <total> <available>
WARN <code>
```

挂载点中的空格编码为 `\040`，避免破坏字段边界。`CAP` 声明的能力名称同样使用单行空格分隔，解析器会去重。旧协议中的 `NET`、`DISK`、`CPUPERCENT` 等字段仍可解析，便于兼容旧代理和测试夹具。

进程协议使用独立版本号 `SCHEMA 1`，记录格式为 `PROC\t<pid>\t<ppid>\t<user>\t<state>\t<rss-kib>\t<cpu-ticks>\t<start-ticks>\t<command>`。未知协议版本直接报错，不按旧格式猜测。

## 指标口径

- CPU：Linux 使用两次 `/proc/stat` 差值，空闲只计 `idle`，`iowait` 不计为忙时。Darwin 继续使用 `top` 的直接 CPU 百分比。
- 网络：`/proc/net/dev` 或 `netstat` 按接口输出。Linux 额外读取 `/sys/class/net/<if>/master`、`bonding`、`bridge`、`team` 生成接口角色；汇总时有 bond/bridge/team 主接口则排除其 slave，避免重复计数。`lo`、`veth`、`docker`、容器和隧道接口仍保留在明细中，并标记为虚拟接口。
- 磁盘：`df -Pk` 输出真实挂载点，过滤 procfs/sysfs/tmpfs 等伪文件系统；可用时用 `timeout 2` 限制采集时间。结果按设备与挂载点去重，最多保留 128 个挂载点，超出时返回 `disk_truncated`。状态栏汇总优先使用根挂载点；根挂载点缺失时回退到第一个有效挂载点。
- 进程 CPU：Linux 读取 `/proc/<pid>/stat` 的进程 tick 与 `/proc/stat` 总 tick，通过两次采样差值计算瞬时占用，并用 PID + 启动 tick 识别 PID 复用。非 Linux 或 procfs 不可用时回退到 `ps`，返回 `cpu_source=ps_average` 并由前端明确提示。
- 进程内存：展示 RSS，包含共享页，是进程工作集的近似值，不应直接相加当作整机真实内存占用。
- 进程命令：Linux 优先读取 `/proc/<pid>/cmdline`，保留完整命令行；读取失败时回退到 `ps args`。NUL、换行、Tab 等控制字符统一替换为空格，单条命令文本最多保留 16 KiB，避免破坏行协议边界。
- 速率时钟：优先使用远端单调时钟；其次使用远端墙钟采样时间；最后才回退到本机时间。
- 采样协调：同一终端的并发 `SystemInfo` 调用合并为一次远端 probe，并保留 1 秒快照，避免状态栏与监控面板交叉污染速率采样。`sample_sequence` 和 `sample_interval_ms` 描述实际速率窗口；前端仅在概览 Tab 可见时轮询系统信息。

## 告警代码

- `cpu_unavailable`
- `cpu_count_unavailable`
- `memory_unavailable`
- `swap_unavailable`
- `network_unavailable`
- `disk_unavailable`
- `load_unavailable`
- `uptime_unavailable`
- `disk_truncated`

告警只表示采集不可用，不把缺失数据伪造成 `0`。状态栏继续使用兼容汇总字段，系统面板展示告警、协议版本、数据源、网卡和挂载点明细。

## 降级策略

- Linux procfs 可读时：结构化采集，精确率最高。
- procfs 不可读但 `ps` 可用时：保持进程列表可用，CPU 标记为 `ps_average`。
- Darwin：使用 `sysctl`、`top`、`netstat` 和 `df`。
- 其他 POSIX 系统：只采集可确认的字段，其余通过告警暴露。

## 进程采集边界

- Linux 使用 shell 内建 `read` 读取 `/proc/<pid>/stat`，减少每个 PID 的 `sed` fork。
- 进程 CPU 使用 PID + 启动 tick 识别 PID 复用，通过两次采样差值计算。
- 非 Linux 或 procfs 不可用时回退到 `ps`，并通过 `cpu_source=ps_average` 明确标记为生命周期平均值。
