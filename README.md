# dsh-paoding（庖丁解牛）
[English](README_en.md) · 中文

庖丁解牛，游刃有余 —— 把 DSH 编排成角色分工、按需加载的 agent preset。

dsh-paoding（中文品牌「庖丁」，典出《庄子》庖丁解牛——顺纹理下刀，刀刃十九年若新发于硎）是 DSH（DeepSeek Harness agent 运行时）的 **preset 生成器与配置器**。它把 DSH 默认的「单体 agent 每请求全量加载全部约 60 个工具」改造成「**主 agent 编排 + 角色子 agent 分工、按需加载**」：热路径（内部文件搜索）留在主 agent 零成本直达；冷路径（联网调研 / 设计 / 实现 / 全仓深搜）委派给只带必要工具的子 agent，用一次付一次。纯配置 + 一个约 130 行核心的瀑布过滤插件，**零 DSH 源码改动**，热插拔（装完新会话即用，卸载即删目录）。

## 特性

- **角色分工编排**：主 agent 拆解任务、沿任务纹理分派，内置四个委派角色——联网调研 `search_external`、UI/设计 `design`、写代码 `implement`、全仓深搜 `search_internal_deep`，各干一摊。
- **主 agent 可改名、内置角色可删/可恢复**：`main_agent_name` 一处改两处——部署 preset 显示名与 persona 身份行；`roles_remove` 可从部署中整条删掉 `search_external` / `design` / `implement` 之一（委派行、工具面、角色 persona 与主 agent 委派指引一并消失），配置 UI 角色列表末尾可一键恢复。内置角色也可配**显示名**：`roles.<toolName>.name` 只替换该角色 persona 首行身份句的主语（如 design 配 `UI 设计` 后身份句为 `You are the UI 设计 agent.`），工具注册名 / 委派调用名与委派机制均不动。
- **每个角色可配专用模型**：`roles.<toolName>.model` / `.provider` 给角色（内置三角色或自定义角色均可）指定固定模型——例如 `implement` 固定用 pro 档、调研角色用轻量快档；不配则随主 agent 会话当前模型走（见 [配置](docs/configuration.md) 2.5 节）。
- **自定义角色 agent（你的专属分工）**：内置四角色只是起点——任意「工具 + 技能」组合都能注册成新的委派工具，向导、配置文件 `roles` 键或配置 UI 都能建。例如建一个装配 `html-ppt` 技能的 `ppt` agent：之后主 agent 一句「把这份大纲做成 PPT」就委派给会做幻灯片的专属子 agent。
- **按需加载冷路径**：外部调研 / 设计 / 实现只在委派那一刻加载自己的工具面（约 3.0k–3.7k tokens/委派，估算），用一次付一次。
- **上下文隔离**：worker 上下文小而专、跑完即弃；主 agent 只集成摘要，不再累积搜索 dump、设计稿与 diff。
- **工具面开销下降**：主 agent 工具面 60 → 21 项白名单，每请求 ≈16.2k → ≈5.5k tokens（估算，↓约 66%）；`web_search` / `mcp__tavily__*` / `write` / `edit` / `skill` / `workflow` / `ralph` 等整类从主 agent 移除。
- **主 agent 技能目录注入归零**：`main_agent_skills` 把每个技能压成 persona 里一行软引导（+ 主 agent 用自带 `read` 按需加载正文），`main_agent_skills_inline` 对必须无条件生效的技能（如 caveman）全文硬内联；技能目录注入归零。
- **host 工具安装期自动检测注入**：安装时扫描 host patch 层启用的 MCP / 本地插件 / 技能，解析精确工具名（`mcp__<server>__<tool>`、`memory_search` 等）并与各角色 allow 求交重写——`tools.restrict()` 永不因 unknown tools 拒绝子 agent 创建；停用插件后重跑 `--auto` 自动剔除。
- **零 DSH 源码改动、纯配置热插拔**：预设是静态目录，安装产物每次由「静态源 + 配置文件」幂等重新生成，不累积手工补丁；重启 host / 新开会话即生效。
- **可视化配置器**：`./install.sh --auto --config-ui` 后，在「设置 → 庖丁配置」图形化查看与编辑，「保存并应用」即写盘——与 CLI 共用同一条生成管线。

## 架构速览

```
┌─ 主 agent · 编排模式 (orchestrator) preset ──────────────────────┐
│ 白名单 21 项：角色委派×4 + 子 agent 管理 + 内部搜索热路径 + 协调    │
│ 工具开销 ≈16.2k → ≈5.5k tokens/请求（估算）                       │
│ 职责：拆解任务 → 内部问题自解 → 冷路径才委派 → 只集成摘要           │
└─────┬─────────────┬─────────────┬─────────────┬───────────────┘
      ▼             ▼             ▼             ▼
 search_external   design       implement    search_internal_deep
 联网调研           UI/设计       写代码/改码    全仓深搜
 web+tavily 等     可加载设计技能  读写编辑+bash  只读仓库、无网络
 只回调研摘要       出 spec 不写码  自验后汇报     只回浓缩摘要
```

主 agent 只保留「编排 + 管理 + 内部搜索」面——热路径零委派直达，四个角色子 agent 各带各的本行工具、用完即弃。为什么这样省（成本账）、底层机制（对应 DSH 原生机制）、Token 治理（含已落地的 compaction `thresholdRatio: 0.45`）与已知边界，见 [架构](docs/architecture.md)。

## 快速开始

前置：**Node.js ≥ 18**（`install.sh` 启动即检查）与一台已装好的 **DSH host**。安装器只用 Node 内置模块、零运行时依赖——克隆后无需 `npm install`。内置委派角色共四个，其中 `search_internal_deep` 是静态角色（不在安装器管理范围，调整见 [配置](docs/configuration.md)）。

```bash
cd dsh-paoding
./install.sh              # 交互向导（stdin 为终端时自动进入；等价于 node tools/install.mjs）
./install.sh --auto       # 非交互/配置驱动：有配置文件则幂等应用，无配置则用智能默认（= 静态 preset，零回归）
./install.sh --dry-run    # 只打印检测报告与将生成的 allow 列表，不写任何文件
```

向导共六个阶段，每个问题直接回车 = 保持默认/当前值：**① 检测报告**——扫描 host patch 层的 MCP / 本地插件 / 已装技能并解析精确工具名；**② 工具分配**——每个 MCP 服务器的工具整组分给角色、主 agent、不分配或新建角色；**③ 自定义子 agent**——toolName（`/^[a-z][a-z0-9_]*$/`）→ 工具池多选 → 一句话 persona，可建多个；**④ 微调默认角色**——逐角色改 persona、增删工具，删内置角色、改主 agent 名称、配角色专用模型，并可移除/恢复主 agent 基础工具（清空当场拒绝）；**⑤ skill 分配**——角色技能软引导行，及主 agent 技能（`main_agent_skills` 软行 / `main_agent_skills_inline` 硬内联）；**⑥ 确认安装**——核对摘要后把 preset 生成到 `$DSH_HOME/.agent-presets/orchestrator` 并把选择写入配置文件。

| CLI 参数 | 作用 |
|---|---|
| `--auto` | 非交互：有配置应用配置，无配置智能默认；stdin 非 TTY 时必需 |
| `--config <file>` | 指定配置文件（默认 `$DSH_HOME/dsh-paoding.config.yml`） |
| `--wizard` | 强制走交互向导（非 TTY 也从 stdin 读答案，供脚本/CI） |
| `--profile <name>` | 检测纳入哪个 profile 的 patch 层（默认 `web`） |
| `--patch <file>` | 追加的 patch 覆盖文件（可重复） |
| `--dry-run` | 预览检测报告与生成的 allow，不写任何文件 |
| `--config-ui` | 额外把可视化配置器挂进 DSH 设置页（重启 DSH 生效） |
| `--help` | 用法说明 |

路径事实：`$DSH_HOME` 缺省 `~/.dsh`；preset 落在 `~/.dsh/.agent-presets/orchestrator`，配置文件在 `~/.dsh/dsh-paoding.config.yml`。安装完成后**重启 host 或新建会话**，在预设选择器里选「编排模式 (Orchestrator)」；要设为默认，在 Settings → Agent Presets 里选择。卸载：`rm -rf "$DSH_HOME/.agent-presets/orchestrator"`。六阶段细节、安装期 host patch 检测机制与排查见 [安装](docs/installation.md)。

## 使用

直接给主 agent 派活，它按分工自行路由：

- **内部文件问题**（找代码、查引用、读文件）→ 主 agent 用热路径工具（`glob` / `grep` / `read` / `read_image` / `bash`）自解，**不委派**；
- **联网调研** → 调 `search_external`（子 agent 只带 `web_search` 与 tavily 工具，不改文件）；
- **UI/前端设计** → 调 `design`（可加载 frontend-design / html-ppt 等设计技能，出 spec、不写最终代码）；
- **写代码/改代码** → 调 `implement`（读上下文 → 精准修改 → 自验后汇报）；
- **超大仓库全仓探索 / 大文件通读 / 跨目录符号追踪** → 调 `search_internal_deep`（只读仓库、无网络，大输出内部消化，只回浓缩摘要）。
- **内置角色之外的专属任务（例如专门做 PPT）** → 先自建一个自定义角色：给它取 `toolName`、勾工具面（含 `skill` 与读写编辑）、写 persona 引导加载对应技能（例：`ppt` agent 装配 `html-ppt` 技能产出 HTML 幻灯片），主 agent 之后按 toolName 直接委派。新建通道：向导第③阶段 / `roles` 配置键 / 配置 UI 卡片，见 [配置](docs/configuration.md) 的「自定义角色」。

子 agent 运行期间，主 agent 可用 `send_message` 追加指示、`list_agents` 查看状态、`interrupt_agent` 叫停；完成后只集成摘要，不把子 agent 的完整上下文倒进自己。任务失败的分层恢复（按 stop reason 分流、重委派一次、两次失败即上报）与多轮迭代（one-shot 用完即弃 vs `continuable`，可选 `implement_cont` 增强）见 [编排](docs/orchestration.md)。

不想手编配置文件时，可挂可视化配置器（可选）：

```bash
./install.sh --auto --config-ui
```

重启 DSH 后，「设置 → 庖丁配置」分区提供：检测结果（host 工具扫描）、Agent 工具分配（主 agent / 各角色 / 自定义角色卡片，勾选工具、编辑 persona）、技能分配、预览将生成的 `agent.cordis.yml`、「保存并应用」（与 CLI 同管线 `collectState` / `generateAndInstall`），应用后重启 GUI / 新会话生效。详见 [安装](docs/installation.md) 第 6 节。

## 配置

配置文件默认在 `$DSH_HOME/dsh-paoding.config.yml`（`DSH_HOME` 缺省 `~/.dsh`，可用 `--config` 换路径）。它是**声明式意图**：目标 preset 每次由「静态源 + 本配置」重新生成，改配置 → 重跑 `./install.sh --auto` 即幂等同步，不会累积手工补丁。顶层键一览：

| 顶层键 | 一行语义 |
|---|---|
| `roles` | 可调角色（`search_external` / `design` / `implement`）与自定义角色的 persona / tools 覆盖；内置角色条目还可配 `name` 显示名（只替换 persona 首行身份句主语、不动调用名，见配置文档 2.4）与专用模型 `model` / `provider`（见配置文档 2.5） |
| `roles_remove` | 整条删除内置角色（`search_external` / `design` / `implement` 之一；可删可恢复，见配置文档 2.3） |
| `skills` | 技能 → 分配给哪些角色（软引导，写进角色 persona 的 Available skills 行） |
| `main_agent_extra` | 追加进主 agent 白名单的 host 工具（如 `mcp__tavily__*`、`memory_search`） |
| `main_agent_remove` | 从主 agent 基础工具中移除（与 extra 同名时 remove 优先） |
| `main_agent_skills` | 主 agent 软引导技能行：`# skill: <name> — <description>` + `Read full rules: <SKILL.md 绝对路径>` |
| `main_agent_skills_inline` | 需全文内联硬生效的技能（SKILL.md 去 frontmatter 进 persona，每轮固定开销） |
| `main_agent_persona_extra` | 主 agent persona 尾部追加（三态：缺省 = 默认常量 / 显式 `''` = 不追加 / 其他文本 = 覆盖） |
| `main_agent_name` | 主 agent 名称（一改两处：预设显示名 + persona 身份行；缺省 = 保持默认，见配置文档第 5 节） |
| `profile` | 检测纳入的 host patch profile（默认 `web`） |

`search_internal_deep` 是静态角色：**不要**把它写进 `roles` 键（会被当作自定义角色、生成重复块）；`roles_remove` 也删不掉它（只认三个可调内置角色）；要调整它请直接编辑 `presets/orchestrator/agent.cordis.yml` 中对应块再重跑 `--auto`。键全参考、三角色微调、技能分配与按角色分模型等见 [配置](docs/configuration.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [架构](docs/architecture.md) | 为什么这样设计——概述、成本账、角色与工具面、对应 DSH 原生机制、Token 治理、已知边界。 |
| [安装](docs/installation.md) | 前置要求、交互向导六阶段、CLI 参数、host patch 检测机制、应用/默认/升级/卸载、配置 UI 挂载、排查。 |
| [编排](docs/orchestration.md) | 编排总览、失败如何呈现与三层处理、one-shot vs continuable、`implement_cont` 启用示例、上下文隔离。 |
| [配置](docs/configuration.md) | 配置文件键全参考、内置角色微调、主 agent 工具面与技能、自定义角色、skill 分配、按角色分模型。 |

## 仓库结构

```
dsh-paoding/
├── install.sh                     # 薄 shell 包装：检查 node 后 exec tools/install.mjs
├── tools/install.mjs              # 安装器本体：检测 host 工具、重写角色 allow、生成 preset、CLI 与向导
├── presets/orchestrator/          # 静态预设源（安装器读取并复制/重写到 ~/.dsh/.agent-presets/orchestrator）
│   ├── preset.yml                 # 预设元数据：名「编排模式 (Orchestrator)」、简介、order
│   ├── agent.cordis.yml           # agent 组合：persona、orchestrator-restrict、四角色委派、compaction 0.45 等
│   └── restrict.mjs               # 主 agent 工具面白名单瀑布过滤插件（核心约 130 行，含注释约 190 行）
├── plugins/paoding-config-ui/     # 可选可视化配置器：DSH Web 设置页插件（slot "paoding"、/api/paoding/*）
└── docs/                          # 深度文档（架构 / 安装 / 编排 / 配置，见上一节）
```

## 贡献

欢迎 issue 与 PR：使用中发现问题、想要新的角色/工具面、或发现文档与实现不一致，都可以提。动手前请先读 [架构](docs/architecture.md) 与 [配置](docs/configuration.md)；文档与实现冲突时，以 `presets/orchestrator/` 与 `tools/install.mjs` 源码为准。

## 许可

以 [MIT License](LICENSE) 发布，完整条款见仓库根目录的 `LICENSE` 文件。
