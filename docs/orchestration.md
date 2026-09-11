← [dsh-paoding](../README.md) ｜ [架构](architecture.md) ｜ [安装](installation.md) ｜ **编排** ｜ [配置](configuration.md)
[中文](orchestration.md) · [English](orchestration_en.md)

# 编排

编排行为是 dsh-paoding 的核心：主 agent 拆解任务、沿任务纹理委派、集成结果；子 agent 按角色只带必要工具、跑完即弃。本文面向想了解或调优这些行为的用户：失败如何被发现与恢复、one-shot 与多轮迭代（continuable）的取舍、以及可选的 `implement_cont` 增强如何启用。与源码冲突处一律以源码为准；本文所有配置引用均取自 `presets/orchestrator/agent.cordis.yml` 与 `presets/orchestrator/restrict.mjs`。

## 编排总览

dsh-paoding 把 DSH 从「单体 agent 全量加载工具」改造成「主 agent 编排 + 角色子 agent 分工」。分工遵循任务纹理：

- **热路径——内部文件问题不委派。** 找代码、查引用、读文件这类问题由主 agent 自己用只读工具解决：`glob` / `grep` / `read` / `read_image` / `bash` 全部在主 agent 白名单内，零委派往返延迟。persona 文案里的 `codegraph` 是 host MCP 工具，仅在安装期检测到 codegraph 服务器并经 `main_agent_extra` 注入后才真正可用（详见[配置](configuration.md)与[安装](installation.md)）。
- **冷路径——只干自己那活的角色子 agent。** 外部调研委派 `search_external`（只带 `web_search` + tavily 五工具 + 本地只读）、UI/前端设计委派 `design`（读参考 + 设计技能 + 出 spec，不写最终代码）、代码实现委派 `implement`（读上下文 → 精准修改 → 验证）、超大仓库全量探索委派 `search_internal_deep`（第四角色，2026-09 加入，见下节与[架构](architecture.md)）。每个子 agent 只在真正被委派的那一次才加载工具面（按需加载）。
- **运行中指挥。** 子 agent 运行期间，主 agent 可用 `send_message` 追加指示、`list_agents` 查看状态、`interrupt_agent` 叫停（三者由 `dsh-tool-subagent-control` 注册，属「子 agent 管理」工具面）。
- **完成后只集成摘要。** 主 agent 从不把子 agent 的完整上下文倒进自己的上下文——它只收一份摘要（见第 5 节「上下文隔离」）。

主 agent 的模型可见工具面由 `restrict.mjs` 在 `system-prompt/assemble` 瀑布上按白名单裁剪（失败自动放行全量，不会锁死会话；空 allow 拒绝加载）。delegation 组里另有通用委派行 `subagent` / `subagent_fork`（均为 `backgroundMode: continuable`）、`workflow`、`ralph`——这些是组合内的注册行，主 agent 白名单刻意不向其暴露，模型可见的委派面只有四个角色工具与子 agent 管理工具（默认四个角色；其中 `search_external` / `design` / `implement` 三个可经 `roles_remove` 整条删除，删后委派面相应缩小，见[配置](configuration.md) 2.3）。

| 面 | 白名单内容（`MAIN_AGENT_ALLOW`，21 项常量；运行时另可经 `config.allow` 覆盖） |
|---|---|
| 角色委派 | `search_external` / `design` / `implement` / `search_internal_deep` |
| 子 agent 管理 | `send_message` / `list_agents` / `interrupt_agent` |
| 内部搜索（热路径） | `glob` / `grep` / `read` / `read_image` / `bash` |
| 协调 | `todo_write` / `ask_user_question` / `get_goal` / `create_goal` / `update_goal` / `exit_plan_mode` / `job_output` / `job_list` / `job_kill` |
| 主 agent 刻意看不到 | `web_search`、`mcp__tavily__*`、`write` / `edit`、`skill`、`workflow`、`ralph`、裸 `subagent` / `subagent_fork` |

每请求工具开销（估算，随注册面浮动）：主 agent 全量 ~16.2k tokens → 白名单后 ~5.5k；`search_external` ~3.0k / `design` ~3.2k / `implement` ~3.7k，仅在真正委派时发生（数值来源：`agent.cordis.yml` 头部注释）。

### 主 agent persona（编排人设）原文摘录

来自 `presets/orchestrator/agent.cordis.yml` 的 `- id: persona` 行（YAML `text: |-` 块标量，内容行缩进 6 空格）。编排与委派的总指引（persona 原文为英文，照录如下）：

```text
You are the orchestrator agent powered by the {{model}} model. Your working directory is {{cwd}}.

Decompose the task, delegate to role agents, integrate results.
- Internal file questions (finding code, references, reading files): solve yourself with glob/grep/read/codegraph — never delegate them.
- External research: delegate to search_external.
- UI/design work: delegate to design.
- Code implementation: delegate to implement.
Keep your own context lean; integrate only summaries. Use todo_write to plan, and ask_user_question only for user-owned choices.
```

中文释意：

- 主 agent 是编排者：**拆解 → 委派 → 集成**三步循环，而不是自己把活全干完。
- 「内部文件问题（找代码、查引用、读文件）自己用 glob/grep/read/codegraph 解决，**绝不委派**」——内部搜索是热路径，委派有往返与冷启动成本，主 agent 自带全套只读工具，直达即可。（注：`codegraph` 属 host MCP 工具，需运行时注入白名单才可用，见上。）
- 任务纹理决定去向：联网 → `search_external`；UI/设计 → `design`；代码 → `implement`（全仓探索 → `search_internal_deep`）。
- **保持自己上下文精简**：只集成摘要；用 `todo_write` 规划；`ask_user_question` 只用于用户拥有的选择，可自查的问题不打扰用户。
- 失败处理 SOP 内联在 persona 里，随会话天然生效、无需额外配置——见下节。

## 子 agent 失败处理

DSH 没有原生自动重试——恢复是编排层的职责，具体地说就是主 agent。本 preset 围绕委派失败设计了三层防护：**预防 → 检测 → 恢复**。

### 失败如何呈现

委派运行的失败在运行时有两种呈现（persona SOP 原文见下文「第 3 层：恢复」）：前台调用抛出的工具错误，或失败的 background job。两者都携带子 agent 的**部分输出**和一个**停止原因**：`error` / `max-tokens` / `refusal` / `aborted` / `completed-but-poor`。恢复动作以停止原因为分诊依据，而非盲目重试。

### 第 1 层：预防

子 agent 创建时，DSH 会对 `toolFilter.allow` 做 `tools.restrict()` 校验：allow 里的每个名字必须存在于子 agent 可见注册面（= 本组合注册全量 + host 层 MCP/插件工具）内，否则**创建被拒**（`tools.restrict() ... unknown tools`）。

本 preset 在安装期消除这类失败：`./install.sh`（tools/install.mjs）读取 host patch 层（home / profile / `--patch`），检测实际启用的 MCP 服务器与本地工具插件，解析出精确工具名（静态已知表优先，未知服务器走实时 JSON-RPC 握手），然后把各角色 allow 重写为「静态意图 ∩ 实际检测到的工具」——组合保证的基础工具原样保留，未启用/无法解析的 host 工具被剔除。握手失败或 transport 不支持的 MCP 会被跳过：对应角色只是缺这些工具，安装不报错。宿主停用/启用了 MCP 或插件后，重跑一次 `./install.sh --auto` 即可同步 allow（`--dry-run` 先预览）。细节见[安装](installation.md)。

注意：安装器的 allow 重写只覆盖三个内置角色（`search_external` / `design` / `implement`，`tools/install.mjs` 的 `ROLES` 常量）。手写新增的 `delegation-*` 块（例如第 4 节的 `implement_cont`）**原样生效、不会被自动清洗**——其中的 host 依赖工具名必须自己与宿主实际启用的插件保持同步，否则创建被拒。这正是 2026-09-02 起各角色 allow 剔除 `memory_search` / `mcp__codegraph__codegraph_explore` 的原因（插件停用时这些名字不在注册面；重开插件时按需加回，见 `agent.cordis.yml` 中 `delegation-search-internal-deep` 的注释）。

### 第 2 层：检测

四个角色（`search_external` / `design` / `implement` / `search_internal_deep`——失败汇报协议适用于**全部**角色，第四角色 2026-09 加入）的 persona 内置同一段**失败汇报协议**（四个实例逐字相同，原文为英文，照录如下；此为默认全员——前三个角色可经 `roles_remove` 整条删除，删掉的角色不再携带该协议，`search_internal_deep` 删不掉，见[配置](configuration.md) 2.3）：

```text
On tool failure, do not retry a denied operation: report the failure compactly — what you completed, the exact error, which tool/permission you lack, and your suggested next step — so the orchestrator can re-delegate or adjust.
```

即：工具失败时子 agent 报告四件事——① 已完成部分；② 确切错误；③ 缺什么工具或权限；④ 建议的下一步。它遵守 DSH 规则：**被拒操作不重试、只上报**。子 agent 自己不是恢复者，它只把诊断喂回给编排者，由主 agent 决定重委派或调整。

### 第 3 层：恢复

主 agent persona 内置**委派失败处理 SOP**（英文原文，为 `agent.cordis.yml` persona 全文的第三段，照录如下）：

```text
Delegation failure handling (SOP):
- A delegated run reports failure either as a thrown tool error (foreground)
  or as a failed background job; both carry the child's partial output and
  a stop reason (error / max-tokens / refusal / aborted / completed-but-poor).
- Diagnose by stop reason, never retry blindly:
  · error (runtime/tool-level) → re-delegate ONCE as a fresh task (not a continuation);
    if the failure cites a missing tool or permission, pick a different role or do it yourself.
  · max-tokens → split the task into smaller steps and re-delegate, or ask the child to
    output incrementally.
  · refusal → do NOT retry the same task: adjust the task's scope or framing, switch roles,
    or handle it yourself (a refusal is a policy decision, not a transient error).
  · aborted → only re-delegate when the cancellation was accidental.
  · completed but poor output → re-delegate with concrete missing points, or send_message
    to ask a continuable child to finish the gaps.
- If the same task fails twice, stop retrying: report to the user what failed, why,
  and what you already tried. Never loop a failing delegation.
- When re-delegating (fresh task or continuation), always include your integration
  summary of the previous attempt (what was done, what failed, what to pick up from),
  so the child never re-derives it from a cold context.
```

按停止原因分流的行为清单（覆盖完整，与 persona 逐条一致）：

| stop reason | 主 agent 行为 |
|---|---|
| `error`（运行/工具级） | 重委派**一次**：全新任务，不是续跑；若失败指向缺工具或权限，换角色或自己做 |
| `max-tokens` | 把任务拆小再重委派，或要求子 agent 分步输出 |
| `refusal` | **不重试同一任务**：调整任务范围/表述、换角色，或自己处理——refusal 是策略决定，不是瞬时错误 |
| `aborted` | 仅当取消是意外才重委派 |
| completed 但产出差 | 带具体缺失点重委派；子 agent 为 continuable 时用 `send_message` 让它补完缺口 |
| 同一任务失败 **2 次** | 停止重试，向用户报告失败原因与已尝试方案；绝不循环一个失败的委派 |
| 任何重委派 | **必须携带上次的集成摘要**：做了什么 / 败在哪 / 从哪接续——子 agent 无需从冷上下文重新推导 |

设计要点：SOP 是 persona 文本而非代码逻辑，因此可以按需编辑——直接改 `presets/orchestrator/agent.cordis.yml` 中 persona 段落（YAML 块标量，内容行缩进 10 空格，注意保持缩进），再重跑 `./install.sh --auto` 应用。例如想让失败任务更频繁地退回主 agent 自己做、或对某个角色采用不同的重试上限，都可在此调整。

## one-shot 与多轮迭代

### 默认：one-shot（用完即弃）

四个角色委派实例（`delegation-search-external` / `delegation-design` / `delegation-implement` / `delegation-search-internal-deep`）只配置 `provider: spawn`，**不设 `backgroundMode`**，因此取 `dsh-tool-subagent` 的配置默认值 `one-shot`。任一角色还可经 `roles.<toolName>.model` / `.provider` 固定专用模型——配置后该角色固定用自己的模型，不随主 agent 会话切换模型而变（见[配置](configuration.md) 2.5）。含义：

- 一次委派 = 一个用完即弃的子会话。调用默认等子 agent 跑完、把结果交回主 agent（也可按工具参数 `run_in_background` 转为后台 job，用 `job_output` 收结果、`job_kill` 叫停）。
- 子会话在任务结束时即弃，其工具面与上下文只为该次运行而加载（**按需加载 + 上下文隔离**，这是本 preset 的核心设计）。
- 与组合里另外两个通用委派行不同——`tool-subagent`（`subagent`，continuable）与 `tool-subagent-fork`（`subagent_fork`，continuable）是通用、可续的委派工具，但主 agent 白名单刻意不向其暴露；模型可见的委派面只有上述 one-shot 角色工具。

### 需要多轮迭代时的两条路

- **路径 A（推荐，零成本）：集成摘要 → 重委派。** 主 agent 手里已有上轮集成摘要，直接以摘要为起点重委派一个新 one-shot 任务。子 agent 依旧用完即弃，主 agent 的摘要就是跨轮的「记忆」，重派成本可控，不改变任何持久化/生命周期模型。这是默认 SOP 对 `error` / `completed-but-poor` 等场景的处理方式（见上节）。
- **路径 B（可选增强）：`backgroundMode: continuable`。** 新增一个可续的 `implement` 实例（`implement_cont`，启用方法见第 4 节）。continuable 调用的工具语义（`dsh-tool-subagent` 工具描述）：默认**后台运行**、立即返回一个持久的子 agent id，子会话**跨轮保留**；该轮跑完后运行时向主 agent 发送结果通知（结果 + 最后一条 assistant 消息）；之后主 agent 用 `send_message` 在**同一个子会话**开启后续轮次。收益：失败或产出不满意时无需重推——子 agent 记得自己查过什么、改到哪，`send_message` 就地续修即可。

### 代价与前提（如实说明）

continuable 不是免费的，启用前请确认以下四点：

1. **前置：continuable 需要 `sessionPersistence` 后端。** standard 设计把 persistence 放在 **host 层**（preset 不拥有它），所以要在 `~/.dsh/cordis.patch.yml` 挂 `@deepseek-ai/dsh-session-persistence-jsonl`（`config.root` **必填**，见插件 schema）。未挂载时 continuable 创建/续跑会直接报错：`continuable subagents require session persistence (load a dsh-session-persistence backend)`（错误码 `PERSISTENCE_UNAVAILABLE`）。这是**机器级全局改动**——persistence 影响该机器上所有会话，不是 preset 内改动，卸载 preset 也不会撤销它。
2. **持久化会话无 TTL**，会持续写盘累积（`config.root` 目录下按项目/会话组织 JSONL 落盘）。需要自行 `interrupt_agent` 停用不再需要的会话、并清理落盘文件。
3. **token 成本随轮次上升。** continuable 子 agent 每轮携带自己累积的上下文，长期挂着每轮成本只增不减——这与「用完即弃 / 按需加载」的设计初衷相悖。建议只对 implement 类**多轮打磨**任务用（这正是 `implement_cont` 的名字由来）。
4. **权限规则不变。** continuable 不改变 DSH 的权限语义：被拒操作依然不重试、只能换路；角色失败汇报协议与主 agent 的委派失败 SOP 对 continuable 子 agent 同样适用（SOP 里 `send_message` 分支就是为它写的）。

对照小结：

| 维度 | one-shot（默认角色） | continuable（`implement_cont`） |
|---|---|---|
| 会话生命周期 | 任务结束即弃 | 跨轮保留（durable subagent id） |
| 续修方式 | 主 agent 摘要 → 重委派新任务 | `send_message` 同一会话就地续修 |
| 持久化要求 | 无 | host 层 `sessionPersistence` 后端（机器级） |
| 长期成本 | 每轮只付新任务 | 每轮携带累积上下文，成本上升 |
| 适用 | 一切委派（默认） | 仅 implement 类多轮任务 |

## implement_cont 启用示例

本节把第 3 节的路径 B 落到配置，共 5 步。默认 preset **不含** `implement_cont`——需要时自行启用，用完可整体移除。所有 YAML 均为配置原文（来自 [README.md](../README.md) 的示例，已与源码核对）。

### 第 1 步 —— host 层挂 persistence 后端（机器级，全局生效）

编辑 `~/.dsh/cordis.patch.yml`，插入：

```yaml
# ~/.dsh/cordis.patch.yml —— host 层（机器级，影响所有会话）挂 persistence 后端
- insert:
    - id: session-persistence
      name: '@deepseek-ai/dsh-session-persistence-jsonl'
      config:
        root: ~/.dsh/sessions   # 必填：持久化会话落盘目录
```

说明：`config.root` 必填（插件 schema `z.string().required()`）。这是机器级改动，见第 3 节「代价与前提」。已挂载过则跳过本步。

### 第 2 步 —— 静态源加 `delegation-implement-cont` 实例

在 `presets/orchestrator/agent.cordis.yml` 的 delegation 组 `config` 列表**末尾**（`# ── remaining model-facing rows` 注释之前，缩进与相邻 `delegation-*` 行一致）加入：

```yaml
    # implement_cont：可续的实现子 agent（backgroundMode: continuable），
    # 失败/产出不满意时主 agent 用 send_message 就地续修；默认不启用。
    - id: delegation-implement-cont
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: implement_cont
        backgroundMode: continuable
        persona: |-
          You are the iterative implementation agent. You write and edit code,
          verify, and keep working across turns — the orchestrator sends you
          incremental follow-ups via send_message. Report progress compactly.
        toolFilter:
          allow:
            - read
            - write
            - edit
            - glob
            - grep
            - bash
            - skill
            - memory_search
            - web_search
            - ask_user_question
            - todo_write
            - job_output
            - job_list
            - job_kill
            - get_goal
            - create_goal
            - update_goal
```

注意两点：

- `memory_search` 依赖 host 层的 magic-memory 插件：**插件未启用时必须从 allow 删去该行**，否则子 agent 创建时 `tools.restrict()` 以 unknown tools 拒绝创建。这与 2026-09-02 起各角色 allow 剔除 `memory_search` / `mcp__codegraph__codegraph_explore` 的决策一致（见 `agent.cordis.yml` 内注释）；且安装器的 allow 重写只覆盖三个内置角色，**手写的 `implement_cont` 块不会被自动清洗**——它自己的 allow 必须手工与宿主实际启用的插件保持同步。
- persona 用 YAML `|-` 块标量，内容行缩进 10 空格，改文本时保持缩进。

### 第 3 步 —— 让主 agent 能调 `implement_cont`（二选一）

主 agent 只能调用白名单内的工具，二选一：

- **推荐：配置文件注入（不动源码）。** 在 `~/.dsh/dsh-paoding.config.yml` 顶层加：

  ```yaml
  main_agent_extra:
    - implement_cont
  ```

  安装时 `implement_cont`（非 host 依赖名）会被并入生成的 `config.allow`。也可在配置 UI（设置 → **庖丁配置** → 主 agent 卡）勾选，见[配置](configuration.md)。

- **或：改 `restrict.mjs` 常量。** 在 `presets/orchestrator/restrict.mjs` 的 `MAIN_AGENT_ALLOW`（21 项白名单常量，`new Set([...])`）中加一行 `'implement_cont'`。注意**覆盖语义**：运行时 `allow = config.allow ?? MAIN_AGENT_ALLOW`（空 allow 拒绝加载）。安装器从 `restrict.mjs` 源码现场解析该常量作为 base，生成 `config.allow = base + main_agent_extra（仅检测到的 host 名保留）− main_agent_remove`，且**只在结果与 base 不同时才注入** `config.allow` 行。因此：改完常量必须重跑安装（base 重新解析、安装副本刷新）；若运行中的 `agent.cordis.yml` 已有注入的 `config.allow`，运行时以它为准、常量只作回退。

无论哪条路，改完都需要重跑安装应用（见第 4 步）。

### 第 4 步 —— 应用

```bash
cd dsh-paoding
./install.sh --auto     # 重新生成 preset（含新 delegation 块与白名单变更）
```

然后**重启 host 或新建会话**生效。第 3 步若走了配置文件路径，配置会持久化到 `~/.dsh/dsh-paoding.config.yml`，之后改动配置重跑 `./install.sh --auto` 幂等应用。

### 第 5 步 —— 用后清理

continuable 会话**无 TTL**，会持续写盘累积：

- 用 `interrupt_agent` 停掉不再需要的 `implement_cont` 会话；
- 长期不再用时，移除第 2 步的 delegation 块与第 3 步的白名单项，重跑 `./install.sh --auto`；persistence 插件本身留在 host 层即可（机器级，见第 3 节），也可一并移除并清理 `~/.dsh/sessions/` 下的落盘文件。

## 上下文隔离

收尾一句设计原则：**worker 上下文小而专，主 agent 只收摘要。** 具体落在三处：

1. **角色工具面即上下文边界。** 每个角色子 agent 只带干自己那活的工具（`toolFilter.allow`），persona 又指引它只产出本角色的产物（调研摘要 / 设计 spec / 代码改动）。大输出在子上下文内部消化，不回灌主 agent。
2. **主 agent 只集成摘要。** 委派返回后，主 agent 的上下文里只有子 agent 的（结构化）结果/失败诊断，子 agent 的完整历史、中间搜索 dump、逐段 diff 都不进入主上下文——单体会话里「每次搜索 dump、每轮设计稿、每段 diff 都累积」的问题由此消除。
3. **全仓探索的 dump 隔离。** `search_internal_deep`（第四角色，2026-09 加入）把「超大仓库全量探索」隔离到子上下文：工具面 = 内部搜索全量（`glob`/`grep`/`read`/`read_image`/`bash`，**无 write/edit、无网络**），persona 要求只回浓缩摘要——查了什么、关键文件带行号、找到的定义/符号、主 agent 决策所需要点——并**绝不回传大 dump**。主 agent 遇到这类任务应委派而非自做（热路径上的单文件读、精准 grep 仍自做，零委派延迟）。详见[架构](architecture.md)。
4. **one-shot 与隔离的关系。** one-shot 让隔离边界落在「每次委派」：用完即弃，天然不跨轮泄漏。continuable 是有意把某个子上下文跨轮保留（见第 3 节），隔离边界放宽到「每次会话」——即便如此，主 agent 依然只收摘要，累积只发生在那个 continuable 子会话内部。
