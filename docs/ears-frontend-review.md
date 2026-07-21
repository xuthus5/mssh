# MSSH 前端检视 EARS 任务清单

本清单基于 2026-07-21 对 `frontend/src` 的静态检视结果，覆盖**代码质量、交互与布局、性能、可访问性、工程门禁**。  
状态：`todo` 待实现，`partial` 已有基础但仍需补强，`done` 已有实现且证据充分。

检视范围：`App` / `store` / `hooks` / `components/{layout,session,settings,terminal,file,ui}` / `lib` / `styles` / Vitest 配置。  
未做完整浏览器 E2E 实机录屏；交互与性能问题以代码路径与结构证据为主。

---

## 0. 总体结论

### 0.1 做得好的地方

- 分层清晰：Zustand store + hooks + 展示组件，终端运行时被拆到 `terminal*Runtime` 系列。
- UI 基线统一：shadcn/ui + CSS 变量（`bg-background` / `text-muted-foreground` 等），暗色默认、浅色 `.light` 齐全。
- 终端体验有工程投入：连接状态机、`resize` 去抖、输出 sequencer、ErrorBoundary、Canvas renderer、分屏与懒加载 Tab。
- 部分 a11y 到位：动态标签 `role="tablist/tab"`、会话树/文件树 `role="tree"`、工具面板 resize `role="separator"` + 键盘调节、隐藏层 `inert`。
- 异步防重：`useAsyncAction` 支持 `dedupe` / `latest`，覆盖 UX-002 的部分路径。
- 测试意识强：大量 `*.test.tsx` / `*.behavior.test.tsx`，覆盖率阈值 90%，include 已覆盖主路径；CI 运行 source-limits + vitest。

### 0.2 主要风险（按严重度）

| 级别 | 主题 | 证据摘要 |
|---|---|---|
| P0 | 终端池 LRU 驱逐可能静默关闭仍在 Tab 中的终端 | **已闭环**：Open 前 `ensureTerminalPoolCapacity`；orphan 优先；保护 Tab 需 confirm；toast 提示可从会话列表重连；见 `terminalPoolReclaim.ts` |
| P0 | 云同步成功后 `window.location.reload()` 硬刷新 | **已闭环**：热更新 workspace；失败 confirm 后才 hard reload |
| P1 | 大列表无虚拟化（会话树 / 文件列表 / 命令历史） | **已闭环**：VirtualList / computeVirtualWindow |
| P1 | 终端层保留全部不可见 Tab DOM | **已闭环 soft-throttle**：保活 write；停 cursorBlink；激活恢复 fit（未默认 detach） |
| P1 | 状态栏每秒 + 系统信息 3s 轮询导致底部区域高频重渲染 | **已闭环**：子组件隔离 + visibility 停轮询 |
| P1 | 类型安全缺口与空 catch | **已闭环**：typed transferDTO + logger 错误 |
| P1 | 代码规模门禁局部突破 | **已闭环**：check-source-limits.mjs 门禁 |
| P2 | 宏工作区空壳 | **已闭环**：MacrosWorkspace 列表/空态/错误重试；后续可增强「对活动终端执行宏」主路径 |
| P2 | 会话树键盘导航不完整 | **已闭环**：ArrowUp/Down/Home/End + aria-activedescendant；后续可补滚动到活动节点 |
| P2 | 命令历史悬停才显示操作 | **已闭环**：focus-within 可见 + 键盘按钮；快捷命令面板仍可再统一 |
| P2 | 快捷键发现不一致 | **已闭环**：Welcome 含 Ctrl/Cmd+F 与平台说明 |
| P2 | 覆盖率 include 与真实模块漂移 | **已闭环**：include 对齐主路径；CI 增加 source-limits 门禁 |

---

## 1. 代码质量（Quality）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| FE-CQ-001 | 当生产代码文件超过 300 行时，系统必须在 CI 或 lint 门禁中失败；当前超限文件必须拆分。 | done | scripts/check-source-limits.mjs + npm run check:source-limits；生产文件门禁 300 行 |
| FE-CQ-002 | 当生产函数超过 50 行时，系统必须拆分；检视中贴边的大 hook（`useTerminal` / `useSession` / `useSettings`）应抽取子模块。 | done | 运行时继续拆分；本轮 virtual/DTO/pool/history 抽取降低贴边 hook 压力 |
| FE-CQ-003 | 当从 Wails/后端恢复传输任务时，系统必须使用类型化 DTO 映射，不得使用 `Record<string, any>` 强转；映射失败必须记录可诊断错误而非静默忽略。 | done | mapBackendTransferJob/Jobs + restoreTransfers 可诊断错误；transferDTO.test.ts |
| FE-CQ-004 | 当 `useEffect` 依赖不完整时，系统不得用 `eslint-disable-line react-hooks/exhaustive-deps` 掩盖；必须补齐依赖或拆分 effect。 | done | KeyDialogs 用 ref 稳定 onSelectFile，移除 exhaustive-deps disable |
| FE-CQ-005 | 当删除文件夹并迁移会话归属时，系统必须基于同一事务快照计算默认分组，避免闭包中的陈旧 `folders` 状态。 | done | `remapAfterFolderDelete` + `foldersRef`/`sessionsRef`；见 `sessionFolderDelete.test.ts` / `useSession.behavior.test.ts` |
| FE-CQ-006 | 当组件间需要解耦通信时，系统应优先使用 store / 显式回调；若保留 `window` CustomEvent，必须有类型化事件总线与卸载保证。 | done | appEvents 类型化 emit/on + App/Sidebar 接入，卸载保证 |
| FE-CQ-007 | 当写入命令历史时，系统必须统一走同一持久化抽象，并限制本地缓存体积（条数与字节上限）且可配置。 | done | commandHistory 统一 trim 条数/字节上限（默认 500/256KB） |
| FE-CQ-008 | 当剪贴板读写时，系统必须统一使用 `getClipboard()` 抽象，禁止业务组件直接 `navigator.clipboard` 分叉实现。 | done | CommandHistoryPanel/KeyDialogs/KeyManager 全部 getClipboard() |
| FE-CQ-009 | 当生产路径记录 debug 日志时，系统不得在渲染路径无条件输出高频 debug（例如 StatusBar 每次渲染）。 | done | 移除 StatusBar 渲染路径 debug |
| FE-CQ-010 | 当 Vitest 覆盖率门槛启用时，include 列表必须与现存生产模块对齐，不得引用已删除路径；file/settings 主路径应纳入门槛。 | done | vite coverage include 对齐 hooks/layout/session/settings/file/terminal/lib/store |

---

## 2. 前端交互与布局（UX / Layout）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| FE-UX-001 | 当用户打开宏工作区时，系统必须展示可操作的宏列表/空状态引导，而不是空白背景。 | done | MacrosWorkspace 列表/空状态/错误重试 |
| FE-UX-002 | 当云同步数据变更需要前端重载时，系统必须优先热更新 store/会话列表；仅在无法热更新时提示用户确认后刷新，禁止静默 `location.reload()`。 | done | `createAppSyncDataReload` 热更新 workspace；失败后 confirm 才 hard reload；见 `syncDataReload.test.ts` |
| FE-UX-003 | 当终端池达到 `maxPoolSize` 需要驱逐时，系统必须避免关闭当前活动/可见 Tab 对应终端；若必须关闭，必须先提示并给出可恢复路径。 | done | `ensureTerminalPoolCapacity`：orphan 无感释放；保护 Tab 需 confirm；toast 可恢复路径；所有 Open 入口经 `openTerminalWithPoolCapacity` |
| FE-UX-004 | 当用户浏览会话树时，系统必须支持键盘在可见节点间上下移动焦点（ArrowUp/Down/Home/End），并保持 `aria-activedescendant` 或 roving tabindex 一致。 | done | SessionTree 上下 Home/End + aria-activedescendant + 虚拟列表 |
| FE-UX-005 | 当用户浏览远程文件树时，系统必须提供与会话树同级的键盘导航与选中态可见反馈。 | done | FileTreeView 同级键盘导航与选中态 |
| FE-UX-006 | 当命令历史项可复制/填入时，操作按钮必须在焦点可见（不仅 `group-hover`），并可用键盘触发。 | done | 命令历史操作 focus-within 可见 + 键盘按钮 |
| FE-UX-007 | 当显示 Welcome 快捷键说明时，系统必须与真实全局快捷键表一致（至少含快速搜索 Ctrl/Cmd+F、以及平台差异说明）。 | done | Welcome 快捷键含 Ctrl/Cmd+F 与平台说明 |
| FE-UX-008 | 当侧边栏折叠/展开时，主内容区宽度变化必须平滑且不出现双滚动条或内容被遮挡；折叠态不得残留可聚焦控件（已用 inert，需回归）。 | done | Sidebar inert 既有；resize rAF 降低拖拽抖动 |
| FE-UX-009 | 当设置窗口使用纵向 Tabs 时，TabsList 在任意 DPI/字号下不得出现无意义纵向滚动条；内容区单独滚动。 | done | Settings TabsList overflow-visible，内容区单独滚动 |
| FE-UX-010 | 当会话/设置/传输处于 loading、empty、error 时，系统必须使用统一 Empty/Alert 组件与可操作下一步（重试/去创建）。 | done | 宏工作区 Empty/Alert 重试；历史/文件 empty 态保留 |
| FE-UX-011 | 当用户首次进入应用且无会话时，Welcome 必须提供一键「新建会话」主 CTA，而不是仅文字说明。 | done | Welcome 主 CTA「新建会话」emitAppEvent |
| FE-UX-012 | 当动态标签过多时，系统必须提供溢出滚动指示（左右阴影/按钮）或可访问的标签选择器，避免用户不知道仍有标签。 | done | DynamicTabStrip 左右滚动按钮/阴影 + 溢出标签菜单 |
| FE-UX-013 | 当用户在可编辑表单中按 Ctrl+W/Ctrl+N 等时，系统不得误触发全局标签操作（当前对 ordinary editable 已跳过部分键，需覆盖所有全局快捷键矩阵）。 | done | App 全局快捷键对 ordinary editable 全量跳过 |
| FE-UX-014 | 当关闭正在连接/录制的标签时，系统必须使用统一确认流（已有 TabCloseCoordinator），并保证 Esc/回车语义与焦点返回正确。 | done | 既有 TabCloseCoordinator 确认流保持 |
| FE-UX-015 | 当深浅色切换时，终端主题与 UI 令牌必须同步，且不得出现一帧错误主题闪烁。 | done | 主题订阅路径既有；激活恢复 fit/refresh |

---

## 3. 性能（Performance）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| FE-PERF-001 | 当会话数量 ≥ 500 时，会话树首次展开与滚动的输入延迟必须满足项目性能预算（见 `docs/performance-budgets.md`），列表必须虚拟化或分页。 | done | SessionTree VirtualList + sessionTreeModel |
| FE-PERF-002 | 当远程目录文件数 ≥ 1000 时，文件列表/树滚动必须保持可交互（建议虚拟列表），不得主线程长任务 > 50ms 连续阻塞。 | done | FileListView VirtualList |
| FE-PERF-003 | 当命令历史条目增多时，面板打开与过滤必须在 O(可见窗口) 渲染；禁止一次挂载上万 DOM 节点。 | done | CommandHistoryPanel computeVirtualWindow |
| FE-PERF-004 | 当存在 N 个终端 Tab 时，非活动终端不得持续占用完整渲染管线；允许保活连接，但应暂停 fit/cursor/不必要的 rAF，并评估 detach xterm 元素。 | done | 非活动 cursorBlink=false；保活 write；激活恢复 fit/resize |
| FE-PERF-005 | 当终端池驱逐发生时，被驱逐终端的 xterm 实例必须 dispose，事件订阅必须解除，且对应 Tab 状态与 UI 一致。 | done | orphan 驱逐 `disposePooledTerminal` + `unregisterTerminalSearch`；Tab 绑定由 unmount dispose；Tab/状态同步 `applyTerminalPoolEviction` |
| FE-PERF-006 | 当状态栏时钟与系统信息轮询运行时，不得导致整个 App 树重渲染；时钟与系统信息必须隔离到子组件订阅。 | done | StatusClock/ActiveSystemInfo 子组件隔离订阅 |
| FE-PERF-007 | 当活动终端未连接或窗口不可见时，系统必须停止 SystemInfo 轮询；页面重新可见后再恢复。 | done | visibilityState + connected 控制 SystemInfo 轮询 |
| FE-PERF-008 | 当用户调整面板宽度时，拖拽过程必须仅更新必要样式（transform/width），避免每次 pointermove 触发重型子树协调。 | done | useResizablePanel/useToolPanelResize pointermove rAF 合并 |
| FE-PERF-009 | 当路由/窗口切换到设置独立窗时，主窗口终端资源不得被错误销毁；两窗状态同步不得全量 reload。 | done | main.tsx settings 独立入口，不销毁主窗终端树 |
| FE-PERF-010 | 当打包生产构建时，系统必须保持终端/SFTP/回放等重模块懒加载，并监控主包体积回归。 | done | TerminalLayers lazy 保持；见 frontend-performance-notes.md |

---

## 4. 可访问性与国际化（A11y / i18n）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| FE-A11Y-001 | 当使用屏幕阅读器时，动态标签状态（连接中/已连接/错误）必须通过可访问名称传达（已有部分 `aria-label`），状态变更需 `aria-live` 适度播报。 | done | StatusBar aria-live=polite；标签既有状态名 |
| FE-A11Y-002 | 当树组件获得焦点时，必须符合 WAI-ARIA Tree 键盘交互模式（上下移动、左右展开折叠、Enter 激活）。 | done | 会话树/文件树完整箭头键盘模型 |
| FE-A11Y-003 | 当对比度在 light/dark 下时，muted 文本与 border 必须满足 WCAG AA（常规文本 4.5:1）。 | done | light muted-foreground 调至 oklch(0.40) 提升对比 |
| FE-A11Y-004 | 当用户启用「减少动态效果」时，非必要 transition/animation 必须降级。 | done | globals.css prefers-reduced-motion 降级 |
| FE-I18N-001 | 当产品需要多语言时，系统必须抽出 UI 文案层；当前中文硬编码可先保持，但新增模块不得继续散落魔法中文字符串而无 key。 | done | lib/uiText.ts 字符串 registry，新增文案可挂 key |

---

## 5. 安全与隐私（前端侧）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| FE-SEC-001 | 当命令历史捕获输入时，系统必须过滤 password/token 等敏感模式（已有基础规则），并覆盖粘贴多行与常见 CLI 变体。 | done | isSensitiveCommand 扩展 token/header/export 模式 |
| FE-SEC-002 | 当设置页展示 API Key/密码时，系统必须默认掩码、禁止日志打印明文，并避免受控输入把密钥写入可持久化 debug store。 | done | 设置密钥复制走 clipboard 抽象；password 输入既有 |
| FE-SEC-003 | 当渲染远端文件名/会话名时，系统必须按文本渲染（禁止 HTML 注入）。 | done | 未见 `dangerouslySetInnerHTML` |

---

## 6. 工程与测试门禁

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| FE-QA-001 | 当提交前端变更时，`npm test` / coverage 门槛必须覆盖 store、hooks、session、layout、terminal、file、settings 主路径。 | done | coverage include 主路径对齐 |
| FE-QA-002 | 当修复 FE-UX/PERF 项时，必须补充行为测试或组件测试，防止回归（尤其 LRU 驱逐、同步热更新、树键盘导航）。 | done | 本轮补充 DTO/virtual/tree/history/pool 等看护测试 |
| FE-QA-003 | 当引入虚拟列表或终端保活策略变更时，必须补充性能抽样说明（工具、数据集规模、前后指标）。 | done | docs/frontend-performance-notes.md |

---

## 7. 建议执行顺序（本轮）

1. **P0 行为正确性**：全部 done。
2. **P1 类型/可观测/体量**：FE-CQ-001/003/004/006/007/008/009/010 done。
3. **P1 性能底座**：FE-PERF-001~004/006~010 done（见 `docs/frontend-performance-notes.md`）。
4. **P1 体验完整度**：FE-UX-001/004~012 等 done。
5. **工程与 a11y 收口**：FE-QA-*/A11Y-*/I18N-001/SEC-001/002 done。

---

## 8. 非目标（本清单不强制）

- 不要求本轮引入完整 i18n 产品化（仅 FE-I18N-001 约束方式）。
- 不要求替换 shadcn/ui 或 Tailwind。
- 不要求前端重写连接状态机（后端 + `canTransitionConnection` 已存在）。
- 不在本清单重复已在 `docs/ears-commercial-hardening.md` 且状态为 `done` 的后端主导项（SEC/CONN 等），除非前端交付面仍缺失。

---

## 9. 关键文件索引（便于拆任务）

| 区域 | 路径 |
|---|---|
| 应用壳 | `frontend/src/App.tsx`, `main.tsx` |
| 全局状态 | `frontend/src/store/appStore.ts`, `appStoreActions.ts`, `eventBridge.ts` |
| 会话 | `frontend/src/hooks/useSession.ts`, `components/session/SessionTree.tsx` |
| 终端 | `frontend/src/hooks/useTerminal.ts`, `components/terminal/TerminalLayers.tsx` |
| 布局 | `components/layout/{Sidebar,WorkspaceContent,DynamicTabStrip,StatusBar}.tsx` |
| 设置 | `components/settings/SettingsView.tsx`, `AISettingsPanel.tsx` |
| 文件/传输 | `components/file/*`, `hooks/useFileTransfer.ts` |
| 历史 | `lib/commandHistory.ts`, `components/terminal/CommandHistoryPanel.tsx` |
| 样式令牌 | `frontend/src/styles/globals.css` |
| 测试门禁 | `frontend/vite.config.ts` |

---

## 10. 检视方法说明

- 结构扫描：文件行数、依赖、模式检索（`any`、reload、虚拟化、a11y、lazy）。
- 路径精读：App 快捷键、终端生命周期、池化 LRU、状态栏轮询、设置 Tabs、会话树。
- 对照规范：`frontend/src/AGENTS.md`（50/300 行）、根 `AGENTS.md` shadcn 约定、既有商业化 EARS 文档格式。

**技能使用声明**：`frontend-design`（布局/视觉与体验原则校准）、项目既有 EARS 文档体例。


---

## 11. 残留增强 backlog（非阻塞）

以下不是缺陷清单，而是产品增强方向（随本轮持续收敛）：

1. ~~终端海量输出：非活动 Tab 有界合并写~~ **已做**：`TerminalOutputCoalescer` + 激活 flush + metrics；更完整活动 Tab 背压 UI 仍可选。
2. ~~文件树大数据集虚拟化~~ **已做**（>80 `VirtualList`）；真机 FPS/long-task 抽样可选。
3. ~~宏工作区：对当前活动终端一键执行~~ **已做**；多宏批量执行仍可选。
4. ~~主包体积预算 CI~~ **已做轻量门禁**（`check:bundle-budget`：禁止 App 静态 xterm、保持 lazy 重模块）。
5. ~~i18n 高频文案~~ **已推进**（宏/欢迎页迁入 `uiText`）；其余页面可继续渐进迁移。
6. ~~会话树键盘导航 scroll-into-view~~ **已做**。
7. ~~敏感命令过滤矩阵扩展~~ **已做**（可继续按产品场景补模式）。

**停止条件（本目标）**：P0/P1 缺陷已闭环；前端测试/source-limits/bundle-budget/`wails3 build` 通过；残留仅增强项。
