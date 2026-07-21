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
- 测试意识强：大量 `*.test.tsx` / `*.behavior.test.tsx`，覆盖率阈值 90%（但 include 列表偏窄）。

### 0.2 主要风险（按严重度）

| 级别 | 主题 | 证据摘要 |
|---|---|---|
| P0 | 终端池 LRU 驱逐可能静默关闭仍在 Tab 中的终端 | **已闭环**：Open 前 `ensureTerminalPoolCapacity`；orphan 优先；保护 Tab 需 confirm；toast 提示可从会话列表重连；见 `terminalPoolReclaim.ts` |
| P0 | 云同步成功后 `window.location.reload()` 硬刷新 | **已闭环**：热更新 workspace；失败 confirm 后才 hard reload |
| P1 | 大列表无虚拟化（会话树 / 文件列表 / 命令历史） | 全量 `.map` 渲染；无 `@tanstack/react-virtual` 等依赖 |
| P1 | 终端层保留全部不可见 Tab DOM | `TerminalLayers` 用 `invisible` 隐藏，内存与 GPU 随 Tab 数线性增长 |
| P1 | 状态栏每秒 + 系统信息 3s 轮询导致底部区域高频重渲染 | `StatusBar` `useClock` 1s、`SystemInfo` 3s |
| P1 | 类型安全缺口与空 catch | `eventBridge.restoreTransfers` `as Array<Record<string, any>>` + 空 `catch {}` |
| P1 | 代码规模门禁局部突破 | `appStoreActions.ts` 309 行 > 300；多文件贴边 |
| P2 | 宏工作区空壳 | `WorkspaceContent` 仅空白 `aria-label="宏工作区"` |
| P2 | 会话树键盘导航不完整 | 有 Enter/左右展开，无上下兄弟节点移动 / Home/End |
| P2 | 命令历史悬停才显示操作 | `opacity-0 group-hover:opacity-100`，键盘与触控差 |
| P2 | 快捷键发现不一致 | Welcome 未列出 Ctrl+F 快速搜索等 |
| P2 | 覆盖率 include 与真实模块漂移 | `vite.config.ts` 仍引用不存在的 `SettingsDialog.tsx` 等，大量 settings/file 未纳入门槛 |

---

## 1. 代码质量（Quality）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| FE-CQ-001 | 当生产代码文件超过 300 行时，系统必须在 CI 或 lint 门禁中失败；当前超限文件必须拆分。 | todo | `frontend/src/store/appStoreActions.ts` 约 309 行，违反 `frontend/src/AGENTS.md` |
| FE-CQ-002 | 当生产函数超过 50 行时，系统必须拆分；检视中贴边的大 hook（`useTerminal` / `useSession` / `useSettings`）应抽取子模块。 | partial | 运行时已部分拆分，但 hook 本体仍偏厚（200–265 行级文件） |
| FE-CQ-003 | 当从 Wails/后端恢复传输任务时，系统必须使用类型化 DTO 映射，不得使用 `Record<string, any>` 强转；映射失败必须记录可诊断错误而非静默忽略。 | todo | `store/eventBridge.ts` `restoreTransfers` |
| FE-CQ-004 | 当 `useEffect` 依赖不完整时，系统不得用 `eslint-disable-line react-hooks/exhaustive-deps` 掩盖；必须补齐依赖或拆分 effect。 | todo | `KeyDialogs.tsx` 存在 disable |
| FE-CQ-005 | 当删除文件夹并迁移会话归属时，系统必须基于同一事务快照计算默认分组，避免闭包中的陈旧 `folders` 状态。 | done | `remapAfterFolderDelete` + `foldersRef`/`sessionsRef`；见 `sessionFolderDelete.test.ts` / `useSession.behavior.test.ts` |
| FE-CQ-006 | 当组件间需要解耦通信时，系统应优先使用 store / 显式回调；若保留 `window` CustomEvent，必须有类型化事件总线与卸载保证。 | partial | `mssh:new-session` / `SESSION_QUICK_SEARCH_EVENT` 等散落在 App/Sidebar |
| FE-CQ-007 | 当写入命令历史时，系统必须统一走同一持久化抽象，并限制本地缓存体积（条数与字节上限）且可配置。 | partial | `commandHistory.ts` 双写 localStorage（limit 10000）+ 可选服务；触控上限过大 |
| FE-CQ-008 | 当剪贴板读写时，系统必须统一使用 `getClipboard()` 抽象，禁止业务组件直接 `navigator.clipboard` 分叉实现。 | todo | `CommandHistoryPanel` 直接 `navigator.clipboard`；App 快捷键走 `getClipboard` |
| FE-CQ-009 | 当生产路径记录 debug 日志时，系统不得在渲染路径无条件输出高频 debug（例如 StatusBar 每次渲染）。 | todo | `StatusBar` `logger.debug('[StatusBar]', …)` |
| FE-CQ-010 | 当 Vitest 覆盖率门槛启用时，include 列表必须与现存生产模块对齐，不得引用已删除路径；file/settings 主路径应纳入门槛。 | todo | `vite.config.ts` 含 `SettingsDialog.tsx` 等漂移项 |

---

## 2. 前端交互与布局（UX / Layout）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| FE-UX-001 | 当用户打开宏工作区时，系统必须展示可操作的宏列表/空状态引导，而不是空白背景。 | todo | `WorkspaceContent` 宏分支仅空 `div` |
| FE-UX-002 | 当云同步数据变更需要前端重载时，系统必须优先热更新 store/会话列表；仅在无法热更新时提示用户确认后刷新，禁止静默 `location.reload()`。 | done | `createAppSyncDataReload` 热更新 workspace；失败后 confirm 才 hard reload；见 `syncDataReload.test.ts` |
| FE-UX-003 | 当终端池达到 `maxPoolSize` 需要驱逐时，系统必须避免关闭当前活动/可见 Tab 对应终端；若必须关闭，必须先提示并给出可恢复路径。 | done | `ensureTerminalPoolCapacity`：orphan 无感释放；保护 Tab 需 confirm；toast 可恢复路径；所有 Open 入口经 `openTerminalWithPoolCapacity` |
| FE-UX-004 | 当用户浏览会话树时，系统必须支持键盘在可见节点间上下移动焦点（ArrowUp/Down/Home/End），并保持 `aria-activedescendant` 或 roving tabindex 一致。 | partial | 仅有展开/Enter；缺兄弟导航 |
| FE-UX-005 | 当用户浏览远程文件树时，系统必须提供与会话树同级的键盘导航与选中态可见反馈。 | partial | `FileTreeView` 有 treeitem，缺完整键盘模型 |
| FE-UX-006 | 当命令历史项可复制/填入时，操作按钮必须在焦点可见（不仅 `group-hover`），并可用键盘触发。 | todo | `CommandHistoryPanel` hover-only 操作条 |
| FE-UX-007 | 当显示 Welcome 快捷键说明时，系统必须与真实全局快捷键表一致（至少含快速搜索 Ctrl/Cmd+F、以及平台差异说明）。 | todo | Welcome 缺 Ctrl+F；App 已实现 F 搜索 |
| FE-UX-008 | 当侧边栏折叠/展开时，主内容区宽度变化必须平滑且不出现双滚动条或内容被遮挡；折叠态不得残留可聚焦控件（已用 inert，需回归）。 | partial | `Sidebar` `translate-x-full` + `contents` 切换 |
| FE-UX-009 | 当设置窗口使用纵向 Tabs 时，TabsList 在任意 DPI/字号下不得出现无意义纵向滚动条；内容区单独滚动。 | partial | 历史问题已部分处理（`overflow-y-auto` 在 Content）；需固化回归测试 |
| FE-UX-010 | 当会话/设置/传输处于 loading、empty、error 时，系统必须使用统一 Empty/Alert 组件与可操作下一步（重试/去创建）。 | partial | TransferCenter/部分面板有 Empty；`useSession` error 展示不统一 |
| FE-UX-011 | 当用户首次进入应用且无会话时，Welcome 必须提供一键「新建会话」主 CTA，而不是仅文字说明。 | todo | Welcome 仅文案 + 快捷键卡 |
| FE-UX-012 | 当动态标签过多时，系统必须提供溢出滚动指示（左右阴影/按钮）或可访问的标签选择器，避免用户不知道仍有标签。 | todo | `DynamicTabStrip` 横向 overflow，无溢出 hint |
| FE-UX-013 | 当用户在可编辑表单中按 Ctrl+W/Ctrl+N 等时，系统不得误触发全局标签操作（当前对 ordinary editable 已跳过部分键，需覆盖所有全局快捷键矩阵）。 | partial | `isOrdinaryEditable` 已排除部分键 |
| FE-UX-014 | 当关闭正在连接/录制的标签时，系统必须使用统一确认流（已有 TabCloseCoordinator），并保证 Esc/回车语义与焦点返回正确。 | partial | 已有确认组件；需补焦点返回验收 |
| FE-UX-015 | 当深浅色切换时，终端主题与 UI 令牌必须同步，且不得出现一帧错误主题闪烁。 | partial | `useThemeCatalog` + `applyTerminalTheme`；缺首屏 FOUC 专项验收 |

---

## 3. 性能（Performance）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| FE-PERF-001 | 当会话数量 ≥ 500 时，会话树首次展开与滚动的输入延迟必须满足项目性能预算（见 `docs/performance-budgets.md`），列表必须虚拟化或分页。 | todo | `SessionTree` 全量递归 render |
| FE-PERF-002 | 当远程目录文件数 ≥ 1000 时，文件列表/树滚动必须保持可交互（建议虚拟列表），不得主线程长任务 > 50ms 连续阻塞。 | todo | `FileListView`/`FileTreeView` 全量 map |
| FE-PERF-003 | 当命令历史条目增多时，面板打开与过滤必须在 O(可见窗口) 渲染；禁止一次挂载上万 DOM 节点。 | todo | localStorage limit 10000 + 全量 filter/map |
| FE-PERF-004 | 当存在 N 个终端 Tab 时，非活动终端不得持续占用完整渲染管线；允许保活连接，但应暂停 fit/cursor/不必要的 rAF，并评估 detach xterm 元素。 | partial | 层隐藏 `invisible` 且隐藏 cursor-layer；实例仍驻留 |
| FE-PERF-005 | 当终端池驱逐发生时，被驱逐终端的 xterm 实例必须 dispose，事件订阅必须解除，且对应 Tab 状态与 UI 一致。 | done | orphan 驱逐 `disposePooledTerminal` + `unregisterTerminalSearch`；Tab 绑定由 unmount dispose；Tab/状态同步 `applyTerminalPoolEviction` |
| FE-PERF-006 | 当状态栏时钟与系统信息轮询运行时，不得导致整个 App 树重渲染；时钟与系统信息必须隔离到子组件订阅。 | partial | 已拆 `useClock`/`SystemInfoBar`，但 StatusBar 仍订阅 tabs/surface 并 debug |
| FE-PERF-007 | 当活动终端未连接或窗口不可见时，系统必须停止 SystemInfo 轮询；页面重新可见后再恢复。 | todo | 3s `setInterval` 仅看 connected，无视 `document.visibilityState` |
| FE-PERF-008 | 当用户调整面板宽度时，拖拽过程必须仅更新必要样式（transform/width），避免每次 pointermove 触发重型子树协调。 | partial | `useResizablePanel`/`useToolPanelResize` 已有；需性能抽样 |
| FE-PERF-009 | 当路由/窗口切换到设置独立窗时，主窗口终端资源不得被错误销毁；两窗状态同步不得全量 reload。 | partial | `main.tsx` `?window=settings`；同步靠事件/reload 路径需厘清 |
| FE-PERF-010 | 当打包生产构建时，系统必须保持终端/SFTP/回放等重模块懒加载，并监控主包体积回归。 | partial | `TerminalLayers` 已 `lazy()`；缺体积预算 CI |

---

## 4. 可访问性与国际化（A11y / i18n）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| FE-A11Y-001 | 当使用屏幕阅读器时，动态标签状态（连接中/已连接/错误）必须通过可访问名称传达（已有部分 `aria-label`），状态变更需 `aria-live` 适度播报。 | partial | `DynamicTabStrip` 含状态文案；缺 live region 策略 |
| FE-A11Y-002 | 当树组件获得焦点时，必须符合 WAI-ARIA Tree 键盘交互模式（上下移动、左右展开折叠、Enter 激活）。 | partial | 见 FE-UX-004/005 |
| FE-A11Y-003 | 当对比度在 light/dark 下时，muted 文本与 border 必须满足 WCAG AA（常规文本 4.5:1）。 | todo | 需用设计令牌实测；当前 oklch muted 需抽检 |
| FE-A11Y-004 | 当用户启用「减少动态效果」时，非必要 transition/animation 必须降级。 | todo | 未检索到 `prefers-reduced-motion` 处理 |
| FE-I18N-001 | 当产品需要多语言时，系统必须抽出 UI 文案层；当前中文硬编码可先保持，但新增模块不得继续散落魔法中文字符串而无 key。 | todo | 无 i18n 框架；`toLocaleString('zh-CN')` 写死 |

---

## 5. 安全与隐私（前端侧）

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| FE-SEC-001 | 当命令历史捕获输入时，系统必须过滤 password/token 等敏感模式（已有基础规则），并覆盖粘贴多行与常见 CLI 变体。 | partial | `commandHistory.recordCommand` 正则过滤 |
| FE-SEC-002 | 当设置页展示 API Key/密码时，系统必须默认掩码、禁止日志打印明文，并避免受控输入把密钥写入可持久化 debug store。 | partial | AI/Sync 使用 password input；需审计 logger |
| FE-SEC-003 | 当渲染远端文件名/会话名时，系统必须按文本渲染（禁止 HTML 注入）。 | done | 未见 `dangerouslySetInnerHTML` |

---

## 6. 工程与测试门禁

| ID | EARS 验收条件 | 状态 | 证据 / 备注 |
|---|---|---|---|
| FE-QA-001 | 当提交前端变更时，`npm test` / coverage 门槛必须覆盖 store、hooks、session、layout、terminal、file、settings 主路径。 | partial | 门槛 90% 但 include 偏窄 |
| FE-QA-002 | 当修复 FE-UX/PERF 项时，必须补充行为测试或组件测试，防止回归（尤其 LRU 驱逐、同步热更新、树键盘导航）。 | todo | — |
| FE-QA-003 | 当引入虚拟列表或终端保活策略变更时，必须补充性能抽样说明（工具、数据集规模、前后指标）。 | todo | 对应 QA-004 前端落地 |

---

## 7. 建议执行顺序（本轮）

1. **P0 行为正确性**：FE-UX-003 / FE-UX-002 / FE-CQ-005 / FE-PERF-005 均已 done。
2. **P0/P1 类型与可观测性**：FE-CQ-003、FE-CQ-009、FE-CQ-001 拆分超限文件。
3. **P1 性能底座**：FE-PERF-001/002/003 虚拟化；FE-PERF-004/007 终端与轮询降载。
4. **P1/P2 体验完整度**：FE-UX-001 宏工作区、FE-UX-006/007、FE-UX-012 标签溢出。
5. **工程收口**：FE-CQ-010 覆盖率清单、FE-QA-001/002 回归测试、FE-A11Y-002/004。

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
