# 内置终端主题与重置能力设计

## 目标

1. 将内置终端主题从 GitHub Dark、GitHub Light 扩展为 24 款精选主题。
2. Dark Mode 与 Light Mode 各提供 12 款适配主题。
3. 在终端主题设置页提供一键重置当前 Dark/Light 内置主题样式的能力。
4. 保持应用离线可用、启动稳定、主题数据可追溯且可重复生成。

## 上游来源

- 仓库：`mbadolato/iTerm2-Color-Schemes`
- 固定版本：`c3968b385e8072d61651eb8e32f498703058c2fd`
- 集合许可证：MIT
- 许可证边界：仓库集合采用 MIT；单个主题的版权和许可证归对应作者所有。

应用不得在运行时请求 GitHub。开发阶段通过生成工具读取固定 commit 下的 `.itermcolors` 文件，校验并生成可直接编译的结构化主题目录。生成结果、来源 URL、上游 commit 和许可证说明进入版本控制。

## 精选主题

### Dark Mode

1. GitHub Dark
2. Dracula
3. Atom One Dark
4. Gruvbox Dark
5. iTerm2 Solarized Dark
6. Nord
7. Catppuccin Mocha
8. TokyoNight Night
9. Rose Pine Moon
10. Kanagawa Wave
11. Everforest Dark Med
12. Monokai Remastered

### Light Mode

1. GitHub Light
2. Atom One Light
3. Gruvbox Light
4. iTerm2 Solarized Light
5. Catppuccin Latte
6. TokyoNight Day
7. Rose Pine Dawn
8. Kanagawa Lotus
9. Everforest Light Med
10. Nord Light
11. Tomorrow
12. 3024 Day

## 生成与校验

新增标准库实现的主题生成工具，输入为固定上游 commit 和显式清单，输出为 Go 结构化数据。生成阶段执行以下校验：

1. 每个清单项必须存在且只能生成一条主题定义。
2. 必须包含背景色、前景色、光标色、选区色和 16 个 ANSI 颜色。
3. 颜色必须规范化为六位十六进制格式。
4. 使用背景色相对亮度执行 Dark/Light 初步分类。
5. 自动分类必须与清单声明一致，不一致时生成失败。
6. 使用规范化颜色数据计算稳定指纹，避免名称变化导致重复记录。
7. 生成文件包含固定 commit、原始文件 URL 和生成说明，不包含运行时网络逻辑。

测试和应用构建只消费已生成数据，不依赖网络。更新上游主题必须显式修改固定 commit 并重新运行生成工具。

## 数据模型

沿用现有 `ThemeDefinition` 和 `ThemeProfile`，不修改数据库表结构。

每个内置主题定义包含：

- `source_type = builtin`
- `source_name = iTerm2 Color Schemes`
- `source_url` 指向固定 commit 下的原始 `.itermcolors` 文件
- `source_author = Mark Badolato / iTerm2 Color Schemes contributors`
- `source_license = MIT collection; individual rights retained`
- `source_version` 使用固定 commit
- `source_fingerprint` 使用规范化颜色数据的稳定 SHA-256
- `is_builtin = true`

每个内置定义对应一个默认 Profile：

- 字体：`"JetBrains Mono", "Cascadia Code", monospace`
- 字号：14
- 光标：bar
- 颜色覆盖：`{}`

## 初始化规则

`ThemeService.InitializeDefaults` 扩展为完整内置目录初始化：

1. 在单个事务中确保 24 个定义和默认 Profile 均存在。
2. 通过稳定指纹识别定义，通过主题定义 ID 识别默认 Profile。
3. 重复初始化不得产生重复数据。
4. 初始化只创建缺失记录，不覆盖用户对现有 Profile 的修改。
5. Dark/Light 绑定缺失或引用无效时，分别回退到 GitHub Dark 和 GitHub Light。
6. 任一步骤失败必须回滚本次初始化写入。

## 一键重置

新增 `ThemeService.ResetBuiltinStyles`，在一个事务中检查 Dark/Light 当前绑定的 Profile：

1. Profile 所引用的定义为内置主题时，恢复默认字体、字号、光标样式，并将颜色覆盖重置为 `{}`。
2. Profile 所引用的定义为自定义或导入主题时，保持原样。
3. 不修改 Dark/Light 绑定关系。
4. 不删除主题定义、Profile、自定义主题或导入主题。
5. 返回 Dark/Light 各自是否被重置的结构化结果，供界面展示准确反馈。
6. 数据库错误或任一更新失败时整体回滚。

Profile 名称不属于样式，不在重置范围内。

## 前端交互

终端主题页面标题右侧增加 `重置内置主题` 按钮：

- 使用 shadcn/ui `Button` 的 outline 样式和 Lucide `RotateCcw` 图标。
- 点击后打开 `AlertDialog`，说明将恢复当前 Dark/Light 内置主题的颜色、字体、字号和光标样式。
- 当两个当前绑定 Profile 都不是内置主题时按钮禁用，并通过 Tooltip 说明没有可重置的内置主题。
- 确认期间按钮和确认操作进入 loading 状态，防止重复提交。
- 成功后重新加载主题目录，根据当前应用 Dark/Light 模式立即热应用终端主题。
- 成功反馈区分“已重置 Dark/Light”“仅重置 Dark”或“仅重置 Light”。
- 失败时保留当前草稿和已保存设置，显示错误 Toast。

现有主题选择器继续按定义的 `mode` 过滤兼容主题。新增主题直接出现在对应 Dark/Light 搜索下拉框中，不增加第二套前端预设数据源。

## 主题管理与来源展示

主题管理列表继续展示模式、来源和许可证。内置主题不可删除，但允许复制为自定义 Profile。来源信息使用定义中的固定 URL 和版本，确保用户能够追溯主题来源。

项目新增第三方声明文件，包含：

- 上游仓库名称和地址
- 固定 commit
- 集合 MIT 许可证文本或许可证文件引用
- 单个主题权利归原作者所有的声明
- 本次收录的 24 款主题名称

## 错误处理

- 生成工具对网络、文件缺失、XML、颜色字段和分类错误返回明确错误并退出非零状态。
- 运行时初始化和重置错误使用 `%w` 包装并保留操作上下文。
- 前端绑定调用失败必须被捕获并展示，不允许产生未处理 Promise。
- 重置结果为零项时视为合法结果，界面提示当前绑定没有内置主题可重置。

## 测试

### Go

- 生成数据恰好包含 24 款主题，Dark/Light 各 12 款。
- 所有颜色负载完整、十六进制格式合法、ANSI 数量为 16。
- 声明模式与背景亮度分类一致。
- 指纹稳定且唯一。
- 初始化创建 24 个定义和 24 个默认 Profile。
- 重复初始化幂等。
- 缺失定义或 Profile 能被恢复。
- 初始化不覆盖用户修改过的 Profile。
- 无效绑定回退到 GitHub Dark/Light。
- 重置只修改当前绑定且引用内置定义的 Profile。
- 自定义和导入主题不受重置影响。
- 重置保持 Profile 名称和绑定关系。
- 初始化和重置事务错误完整回滚。

### React

- 24 款主题按模式出现在对应搜索选择器中。
- 重置按钮根据当前绑定是否包含内置主题正确启用或禁用。
- 确认弹框文案、取消、确认和 loading 状态正确。
- 重置调用成功后刷新目录并热应用当前模式主题。
- 部分重置和零项重置显示准确反馈。
- 后端错误显示 Toast，设置草稿不丢失。

## 验收标准

1. 新数据库首次启动后存在 24 款内置终端主题，Dark/Light 各 12 款。
2. 所有内置主题可在对应模式的主题下拉框中搜索和选择。
3. 应用启动和主题选择不依赖网络。
4. 一键重置不会修改或删除自定义、导入主题。
5. 重置后当前终端和回放终端立即使用恢复后的主题样式。
6. 主题来源、固定版本和许可证声明可追溯。
7. 前端覆盖率满足项目门禁，Go 测试、竞态检测、lint 和 Wails 构建全部通过。
