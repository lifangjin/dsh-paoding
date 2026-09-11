<!-- docs/architecture.md — dsh-paoding（庖丁）架构说明 -->

← [dsh-paoding](../README.md) ｜ [安装](installation.md) ｜ **架构** ｜ [编排](orchestration.md) ｜ [配置](configuration.md)

[中文](architecture.md) · [English](architecture_en.md)

# 架构

> 读者对象：想理解「为什么这样设计、成本/收益、底层机制」的技术用户与贡献者。本文事实以仓库源码
> （`presets/orchestrator/agent.cordis.yml`、`presets/orchestrator/restrict.mjs`、
> `presets/orchestrator/preset.yml`）为准；与 README 冲突处以源码为准。

## 概述

dsh-paoding（中文品牌「庖丁」，取庖丁解牛之意）是 DSH（DeepSeek Harness，一个 agent 运行时）的
**编排模式（orchestrator）preset 生成器与配置器**。它把 DSH 的默认形态——单体 agent 每次请求全量加载
全部工具（约 60 个，每请求约 16.2k tokens 的工具定义开销）——改造成「主 agent 编排 + 角色子 agent 分工、
按需加载」：

- **热路径留在主 agent**：内部文件搜索（glob / grep / read / read_image / bash）由主 agent 零成本直达，
  不产生委派往返；
- **冷路径委派给角色子 agent**：联网外部调研（search_external）、设计（design）、代码实现（implement）、
  全仓深搜（search_internal_deep）分别交给只带必要工具的子 agent，**用一次才付一次**；
- **上下文隔离**：每个子 agent 上下文小而专，主 agent 只收集成摘要。

整个方案是「纯配置 + 一个核心逻辑约 130 行的瀑布过滤插件（`restrict.mjs`，含注释约 190 行）」，
**零 DSH 源码改动**，热插拔（装/卸/改都是文件操作）。

与单体模式的本质区别有三点：

| 维度 | 单体模式（默认） | 编排模式（本 preset） |
|---|---|---|
| 职责 | 一个 agent 承担全部任务 | 主 agent 拆任务与集成，角色子 agent 各干一摊 |
| 开销 | 每请求固定承载 ~16.2k tokens 工具定义 | 主 agent ~5.5k；角色工具面 ~3.0k–3.7k，仅委派时发生 |
| 上下文 | 每次搜索 dump、每轮设计稿、每段 diff 都累积进主上下文 | worker 上下文小而专、用完即弃，主 agent 只收摘要 |

组合的静态源是 `presets/orchestrator/agent.cordis.yml`（叠加在 DSH builtin `standard` preset 全量组合
之上，见「原理：对应 DSH 原生机制」一节），运行时由 `restrict.mjs` 裁剪主 agent 工具面。
四个角色委派实例的 ID 为 `delegation-search-external` / `delegation-design` /
`delegation-implement` / `delegation-search-internal-deep`，均在组合的 delegation 组内；该组还挂有
通用委派工具 `subagent` / `subagent_fork` / `workflow` / `ralph`（主 agent 白名单不包含它们，角色委派
才是本 preset 的主路径）。

架构图（主 agent 工具面与四个角色委派；完整 allow 列表见「角色与工具面」一节）：

```
┌─ 主 agent · orchestrator（编排模式 preset，白名单 21 项）────────────────┐
│ 委派   : search_external / design / implement / search_internal_deep     │
│ 管理   : send_message / list_agents / interrupt_agent                    │
│ 内部搜索: glob / grep / read / read_image / bash   ◄── 热路径，零委派直达  │
│ 协调   : todo_write / ask_user_question / get_goal / create_goal /       │
│          update_goal / exit_plan_mode / job_output / job_list / job_kill │
│ 职责   : 拆任务 → 内部问题自解 → 调研/设计/实现/全仓深搜才委派 → 只集成摘要  │
└───────┬───────────────┬───────────────┬───────────────┬──────────────────┘
        │               │               │               │
        ▼               ▼               ▼               ▼
   search_external  design          implement      search_internal_deep
   （外部调研·按需）  （设计·按需）     （实现·按需）     （全仓深搜·按需）
        │               │               │               │
        ▼               ▼               ▼               ▼
   web_search       read/read_image  read/write/edit  glob/grep/read/
   mcp__tavily__*   glob/grep/bash/  glob/grep/bash/  read_image/bash/
   (5 个)           skill/write/     skill/web_search ask_user_question/
   glob/grep/read   edit/ask_user_   ask_user_question todo_write/
   ask_user_        question/        todo_write/      job_output/job_list/
   question         todo_write/      job_output/      job_kill
   （无 write/edit） job_output/      job_list/job_kill/   （只读、不改文件、
                    job_list/        get_goal/          无网络）
                    job_kill         create_goal/update_goal
```

## 成本账：工具开销与上下文

本 preset 的核心收益是**按需加载 + 上下文隔离**，工具开销只是最直观的一部分。每请求工具开销估算值如下
（来源：`agent.cordis.yml` 文件头注释与实测校准；数字为量级估算）：

| 方案 | 工具面 | tokens/请求 | 备注 |
|---|---|---|---|
| 单体（现状，未裁剪） | 60 工具全量 | **~16.2k** | 每请求固定注入 |
| 编排主 agent | 21 项白名单（∩ 注册面） | **~5.5k** | ↓66%；内部搜索零委派延迟 |
| search_external 子 agent | 10 项 allow | ~3.0k | 仅实际联网调研时才产生 |
| design 子 agent | 13 项 allow | ~3.2k | 仅实际委派设计时才产生 |
| implement 子 agent | 16 项 allow | ~3.7k | 仅实际委派实现时才产生 |
| search_internal_deep 子 agent | 10 项 allow | 未单独估算 | 仅实际委派全仓深搜时才产生 |

注：表中角色工具数按 `agent.cordis.yml` 实际 allow 条目数计（design 13 / implement 16），README 旧表
中的 14 / 17 与白名单 22 已过时。

**真正的收益是上下文隔离，而不是省下的几千 token 本身**：

- 单体 agent 的上下文会累积每一次搜索 dump、每一轮设计稿、每一段 diff——即使某工具本请求没用上，
  它过往的产物仍占着窗口；
- 编排架构里每个 worker 上下文小而专（各自只带本角色的工具与产物），角色默认 one-shot、用完即弃；
  主 agent 只接收结构化摘要并集成，不会把子 agent 的完整上下文倒进自己的窗口；
- 因而主 agent 的窗口大小与"本轮派了多少活"解耦，长会话的 token 水位主要由编排者自身的
  摘要与决策构成（配合压缩治理，见「Token 治理（性能调优）」一节）。

**技能目录注入对主 agent 归零**（实测技能目录注入 ≈1.3k tokens/轮——目录 4455 字节 / 10 技能——
随注册层 deny 一并归零，机制见「原理」之 ⑤）。主 agent 不使用
`skill` 工具时仍然要能按需用技能，两条通道：

- `main_agent_skills`（软引导，默认通道）：每个技能在主 agent persona 里只占一行（技能名 + 描述 +
  SKILL.md 路径），目录注入为零；主 agent 任务匹配到该技能时用自带的 read 按需读全文再遵循，
  未用到零花费；
- `main_agent_skills_inline`（可选硬内联）：列出的技能 SKILL.md 全文内联进 persona，每轮固定开销，
  适合 caveman 这类必须无条件生效的风格技能。

两条通道的配置细节见 [docs/configuration.md](configuration.md)。

## 角色与工具面

### 主 agent 工具面（21 项白名单）

`restrict.mjs` 中硬编码的 `MAIN_AGENT_ALLOW` 共 **21 项**，按用途分四组（顺序同源码注释）：

| 分组 | 工具 |
|---|---|
| 角色委派（4；默认全员，可经配置整删三角色） | `search_external` `design` `implement` `search_internal_deep` |
| 子 agent 管理（3） | `send_message` `list_agents` `interrupt_agent` |
| 内部搜索·热路径（5） | `glob` `grep` `read` `read_image` `bash` |
| 协调（9） | `todo_write` `ask_user_question` `get_goal` `create_goal` `update_goal` `exit_plan_mode` `job_output` `job_list` `job_kill` |

**host 工具不在白名单常量内硬编码**：`mcp__*` 与插件工具（codegraph / memory_search / mnemon_* 等）
是"检测期事实"——主 agent 需要时经配置文件 `$DSH_HOME/dsh-paoding.config.yml` 的 `main_agent_extra`
勾选，生成层按运行时检测把仍启用的注入 restrict 的 `config.allow`，停用即自动清除（详见
[docs/configuration.md](configuration.md)）。因此主 agent 的默认面**不包含** `web_search`、全部
`mcp__tavily__*`、`write` / `edit` / `str_replace_editor`、`skill`、`workflow`、`ralph` 及未过滤的
`subagent` / `subagent_fork`——这些要么属于角色子 agent，要么成本被刻意清零。

### 内置角色总览

每个角色是一个 `dsh-tool-subagent` 实例：主 agent 调用哪个委派工具，即选择该子 agent 的工具面
（子 agent 创建时按 `toolFilter` 做 `tools.restrict()`，见「原理」之 ④）。
主 agent persona 中的角色人设文本与委派失败处理 SOP 见
[docs/orchestration.md](orchestration.md)。

内置四角色只是**出厂分工**：任何「工具 + 技能」组合都能以同一机制成为新委派工具——在配置文件 `roles`
键写一个 toolName（或经向导 / 配置 UI 新建），安装器生成 `delegation-<toolName>` 块、把 toolName
注入主 agent 白名单，并把角色 persona 首行职责句自动追加为主 agent persona 的委派行（tools 为空的
角色应用时会被拒绝安装），详见 [docs/configuration.md](configuration.md) 第 6 节；自定义角色同样支持 `model` / `provider` 专用模型（与内置角色同一子键、同一生成机制，见 2.5）。例如建一个装配 `html-ppt`
技能的 `ppt` agent，做 PPT 这类任务就有了专属子 agent。

| 委派工具 | 实例 ID | persona 一句话职责 | 加载成本 |
|---|---|---|---|
| `search_external` | `delegation-search-external` | 只做联网调研（web_search + tavily），绝不改文件；返回结构化研究摘要（发现、来源、待答问题） | ~3.0k，仅委派时 |
| `design` | `delegation-design` | 产出 UI/UX 设计、线框与前端 spec，可用 skill 工具加载设计技能（frontend-design、html-ppt）；先读参考再交付 spec，不写最终代码 | ~3.2k，仅委派时 |
| `implement` | `delegation-implement` | 写与改代码：先读上下文 → 精准修改 → 验证（build/test/grep）；不改架构 | ~3.7k，仅委派时 |
| `search_internal_deep` | `delegation-search-internal-deep` | 只做仓库探索：不改文件、不联网；处理主 agent 上下文装不下的任务（全仓 grep dump、超页大文件通读、跨目录符号/定义追踪），只回浓缩摘要 | 未单独估算，仅委派时 |

上表是出厂默认形态，配置层可再裁剪与定制（详见 [docs/configuration.md](configuration.md)）：`search_external` / `design` / `implement` 三个可经 `roles_remove` 整条删除（2.3，`search_internal_deep` 删不掉）；内置角色可配显示名 `roles.<toolName>.name`，只替换该角色 persona 首行身份句主语（2.4）；可配专用模型 `roles.<toolName>.model` / `.provider`，生成器在委派块注入 `agentOptions`，不配则跟随主 agent（2.5）；主 agent 可经 `main_agent_name` 改名，一改两处（第 5 节）。

### 角色 toolFilter.allow 明细

以下 allow 列表逐字抄录自 `agent.cordis.yml`（安装期生成器会按运行时检测到的 host 工具对列表做
「配置/静态意图 ∩ 实际检测工具」重写，见 [docs/configuration.md](configuration.md)）。

**`search_external`（外部调研，10 项）**

| 字段 | 值 |
|---|---|
| persona 职责 | 只做联网调研并返回结构化研究摘要（发现、来源、待答问题）；绝不修改文件 |
| toolFilter.allow | `web_search`、`mcp__tavily__tavily_search`、`mcp__tavily__tavily_crawl`、`mcp__tavily__tavily_extract`、`mcp__tavily__tavily_map`、`mcp__tavily__tavily_research`、`glob`、`grep`、`read`、`ask_user_question` |
| 加载成本 | ~3.0k tokens，仅实际联网调研时发生 |

**`design`（设计，13 项）**

| 字段 | 值 |
|---|---|
| persona 职责 | 产出 UI/UX 设计、线框与前端 spec；经 skill 工具加载设计技能（frontend-design、html-ppt）；先读参考再交付 spec，不实现最终代码 |
| toolFilter.allow | `read`、`read_image`、`glob`、`grep`、`bash`、`skill`、`write`、`edit`、`ask_user_question`、`todo_write`、`job_output`、`job_list`、`job_kill` |
| 加载成本 | ~3.2k tokens，仅实际委派设计时发生 |

**`implement`（实现，16 项）**

| 字段 | 值 |
|---|---|
| persona 职责 | 写与改代码：先读上下文 → 精准修改 → 验证（build/test/grep）并汇报改动与验证方式；不做架构重设计 |
| toolFilter.allow | `read`、`write`、`edit`、`glob`、`grep`、`bash`、`skill`、`web_search`、`ask_user_question`、`todo_write`、`job_output`、`job_list`、`job_kill`、`get_goal`、`create_goal`、`update_goal` |
| 加载成本 | ~3.7k tokens，仅实际委派实现时发生 |

**`search_internal_deep`（全仓深搜，10 项）**

| 字段 | 值 |
|---|---|
| persona 职责 | 只做仓库探索：不改文件、不联网；处理全仓 grep dump、超页大文件通读、跨目录符号/定义追踪；搜索透彻后返回浓缩结构化摘要（搜了什么、关键文件与行号、找到的定义/符号、供决策的结论），绝不回灌大 dump |
| toolFilter.allow | `glob`、`grep`、`read`、`read_image`、`bash`、`ask_user_question`、`todo_write`、`job_output`、`job_list`、`job_kill` |
| 加载成本 | 未单独估算，仅实际委派全仓深搜时发生 |

> 注：`codegraph` 与 `memory_search` 已于 2026-09-02 从该角色移除——二者对应插件（codegraph MCP /
> magic-memory）停用时不在子 agent 可见注册面内，`tools.restrict()` 会以 unknown tools 拒绝创建该角色；
> 重新启用插件后按需加回即可（列表精确名匹配，不支持 glob，见「已知边界」一节）。

## 原理：对应 DSH 原生机制

本 preset 不发明新机制——每一层都落在 DSH 已有的原生能力上，只是把它们组合起来。以下按设计决策逐条说明
（首版曾因遗漏①而运行失败，教训已固化为①的设计约束，现为组合的必选项）。

**① 基础工具注册在 preset 层，orchestrator 必须全量组合 standard preset。** DSH 中 read/write/edit/
glob/grep/bash/skill/web_search 等基础工具**不由 global 层提供**，而是由 builtin `standard` preset 的
组合挂载。因此 orchestrator 组合必须原样包含 standard 的全部行——tool-bash / tool-pwsh / fs /
fs-search / jobs / skill / goal / planning / compaction / delegation / ask-user / todo / web——否则子
agent 创建时 `tools.restrict()` 会报 `unknown global tools`。这是设计上的硬约束：子 agent 继承的是
**组合自身注册的工具**，组合缺一行，对应工具就在子 agent 注册面中缺席。host 层（如
`~/.dsh/cordis.patch.yml`）只挂 MCP 服务器与本地插件工具。

**② 主 agent 工具面裁剪 = 瀑布过滤器按白名单过滤模型可见面。** `restrict.mjs` 挂在
`system-prompt/assemble` 瀑布上（`prepend: true` 使过滤器位于最外层，`await next()` 看到下游完整组装
结果后再按白名单过滤 `assembly.tools`）。设计要点：

- **失败自动放行（fail-open）**：过滤器自身任何异常都返回未过滤的组装结果，一个过滤 bug 永远不会
  锁死会话的每次请求；
- **空 allow 拒绝加载**：`config.allow` 为空列表时 `apply()` 直接抛 `TypeError`——防止把主 agent 的
  全部工具剥光（安装期生成器也会拦截"移除结果为空"）。

**③ 主/子 agent 的区分靠会话 header。** 子 agent 会话的 header 带 `origin: 'subagent'`
（`delegationDepth >= 1` 兜底，见 dsh-subagent 的 childSessionMeta）。瀑布对子 agent 放行——角色的
工具面已由各自 `toolFilter` 约束，主 agent 的过滤器若再套一层会与角色面取交集、错误收窄它们。

**④ 角色子 agent 工具面 = per-child `tools.restrict()`。** 每个角色是 `dsh-tool-subagent` 实例，声明
`toolName`（主 agent 调用的工具名）与 `toolFilter.allow`。子 agent 创建时对子上下文
`childCtx.tools.restrict(toolFilter)`：allow 名必须在子 agent 可见注册面（= 本组合全量 + host 层
MCP/插件）内，否则创建被拒（unknown tools）。因此「主 agent 调哪个工具 = 选哪个工具面」；未被
`toolFilter` 显式允许的工具对子 agent 完全不可见。

**⑤ 主 agent 技能目录归零需要两层过滤。** 只把 `skill` 从模型可见面滤掉是不够的：
`dsh-tool-skill` 的目录注入守卫查的是**注册面可见性**（`ctx.tools.get('skill', agent)`）而非模型可见
面，仅 prompt 级过滤挡不住目录注入（实测目录 4455 字节 / 10 技能 ≈1.3k tokens/轮）。于是：

- `system-prompt/assemble` 瀑布把 `skill` 从主 agent 模型可见面滤掉（第一层）；
- `MAIN_AGENT_REGISTRY_DENY = ['skill']` 在 `agent/created` 时对主 agent 注册面做 deny（第二层），
  目录注入随即停止、成本归零；
- 子 agent 豁免：其工具面来自各委派的 `toolFilter`，且按 agent 的 restrict 不跨作用域层传播（子作用域
  是共享常驻挂载下的兄弟，不是主 agent 作用域的后代）；
- design/implement 等子 agent 保留 `skill`——DSH 无按 agent 的目录过滤，目录按 cwd 收集后对子 agent
  全量可见，由其 persona 软引导使用；若显式把 `skill` 加回主 agent 的 allow，注册层 deny 自动跳过，
  主 agent 重新接入目录。

**⑥ 角色人设 = `dsh-tool-subagent` 的 `persona` 字段。** 每个委派实例自带 persona（子 agent 的
deployment:persona 段落），内容含角色职责边界与失败汇报协议；主 agent persona 内另有委派失败处理
SOP（按 stop reason 分流：error 重委派一次 / max-tokens 拆小 / refusal 不重试 / aborted 仅意外取消才
重试 / 产出差带具体缺失点补做；同一任务失败两次即停止，向用户报告；重委派必须携带上次集成摘要），
详见 [docs/orchestration.md](orchestration.md)。

**⑦ 热插拔 = preset 是静态目录。** 安装、卸载、修改都是文件操作：生成器把静态源复制/改写为
`$DSH_HOME/.agent-presets/orchestrator`，编辑 YAML / mjs、重跑生成器、重启 host 或新建会话即生效；
卸载即删目录。DSH 源码零改动，preset 可整体移除、不残留。

## Token 治理（性能调优）

本节把长会话的 token 治理写成基准式说明：现象（测量口径）→ 根因 → 已落地配置 → 可调参数。

**现象与基准（2026-08-20 校准）。** 同一工作目录、同等任务下，长会话 DSH 的平均每请求 token 约为对照
实现的 ~2 倍。排除了工具输出截断口径差异（read 默认 2000 行 + 50KB 字节 cap、bash tail+spill 写盘、
grep inline cap 与对照同设计）后，根因锁定为：**默认压缩从未触发**。`dsh-compaction-basic` 默认
`thresholdRatio: 0.8`——在 256K token 窗口中要到 ≈209,715 tokens 才压缩——长会话的每请求 token 裸涨到
~137K–142K 稳态且从不回落（水位始终低于触发线）。对照实现同项目会话全部发生过周期压缩，历史被周期性
压回。

**已落地配置。** `agent.cordis.yml` 的 compaction-basic 已设 `thresholdRatio: 0.45`（≈117,965 tokens
触发），配合 retainRatio 默认保留约 16% 尾部（≈42K）+ 摘要 checkpoint，稳态平均回落到 ~80K 量级。
压缩每次触发调用一次 LLM 摘要——复用前缀缓存，成本极低——因此触发频繁一点也几乎不额外花钱；
0.45 是「省 token 与不频繁摘要」之间的平衡点。

**参数与效果。**

| thresholdRatio | 触发线（≈） | 稳态平均（≈） | 说明 |
|---|---|---|---|
| 0.8（DSH 默认） | 209,715 tokens（窗口 256K） | 137K–142K，不回落 | 长会话几乎不压缩 |
| 0.45（本 preset 已落地） | 117,965 tokens | ~80K | 保留 ~16% 尾部 ≈42K + 摘要 checkpoint |
| 0.35（可选更激进） | ~92K tokens | ~67K | 更省 token，摘要更频繁 |

改阈值后重跑 `./install.sh --auto` 应用。同组合内另有配套组件：

- `tool-result-pruner`：超长工具结果按 `thresholdChars: 8192 / headChars: 4096 / tailChars: 1024`
  截头留尾，防止单条巨型输出撑大窗口；
- `command-compact`：长会话中可随时手动 `/compact` 即时压缩；
- `search_internal_deep` 角色：把「全仓 dump」这类大输出隔离出主上下文——热路径（单文件读、精准
  grep）仍由主 agent 自做、零委派延迟；只有全仓 dump / 大文件通读 / 跨目录符号追踪才委派，子 agent
  内部消化大输出、只回浓缩摘要（见「角色与工具面」一节）。

## 已知边界

- **角色工具面是静态绑定的**（由配置/`toolFilter.allow` 决定），不是模型在运行时任意指定；
  「选角色工具 = 选工具面」对固定分工恰好是优点，但无法在对话中临时给某个角色加工具
  （要加需改配置/静态源后重跑生成器）。
- **`toolFilter.allow` 是精确名匹配，不支持 glob**：tavily 的 5 个工具必须逐个写全
  （`mcp__tavily__tavily_search/crawl/extract/map/research`）。
- **主 agent 白名单里未挂载的工具不会报错**：瀑布过滤只在已解析的 `assembly.tools` 里按名匹配，
  某工具（如被注释的 MCP）不在其中就只是不出现，安装与运行都静默通过——配置意图与实际挂载
  靠安装期检测（`install.sh --auto` / `--dry-run`）对齐，改动 host patch 后需重跑。
- **超大仓库全量探索场景应委派 `search_internal_deep` 而非主 agent 自做**：全仓 grep dump、大文件
  通读反复灌满主上下文，正是该角色的隔离价值所在（只读、无网络、只回浓缩摘要）。
