← [dsh-paoding](../README.md) ｜ [架构](architecture.md) ｜ [安装](installation.md) ｜ [编排](orchestration.md) ｜ **配置**

[中文](configuration.md) · [English](configuration_en.md)

# 配置

dsh-paoding 把「按角色分工的编排 preset」做成**配置驱动**：你手编（或让交互向导 / Web 配置 UI 帮你写）一个 YAML 配置文件，安装器（`tools/install.mjs`，CLI 与配置 UI 共用同一生成管线 `collectState` / `generateAndInstall`）在安装时据此重写目标 preset —— `~/.dsh/.agent-presets/orchestrator/agent.cordis.yml`，覆盖角色 allow、角色 persona、主 agent 白名单（`config.allow` 注入）、主 agent persona 的技能行/内联与人设追加。

配置文件描述的是**声明式意图**。目标文件每次都由「源码 preset + 本配置文件」重新生成：改配置 → 重跑安装 = 幂等同步，不会累积手工补丁。

## 1. 配置文件

### 1.1 位置与优先级

配置文件默认位置是 `$DSH_HOME/dsh-paoding.config.yml`；`$DSH_HOME` 未设置时默认为 `~/.dsh`。CLI 参数 `--config <file>` 可指定任意其它路径。

| 场景 | 行为 |
|---|---|
| 交互向导（`./install.sh`） | 检测并分配后，确认时把选择**持久化**到配置文件（默认 `~/.dsh/dsh-paoding.config.yml`，以 `0o600` 权限写入）；向导重启时会以既有配置作为种子值 |
| `./install.sh --auto` | 非交互应用：有配置文件则应用，没有则用智能默认（≈ 静态 preset 现状，零回归）；改配置后重跑即幂等应用 |
| `./install.sh --dry-run` | 只打印检测报告与将生成的 allow / persona 变化，不写任何文件（含配置文件）；适合先预览再动手 |
| `./install.sh --auto --config <file>` | 用指定文件替代默认位置 |
| Web 配置 UI（设置 → 庖丁配置） | 面板「保存并应用」写入 preset 并把分配保存到配置文件，等价于 `--auto` + 向导保存 |

配置文件**存在但解析失败**是硬错误（直接报错退出）；**不存在**则视为无配置（走智能默认或向导）。`profile`、`roles` 等顶层键的语义见下节。

CLI 参数优先级：`--profile` 显式给出时覆盖配置文件里的 `profile` 键，否则以配置文件为准，再否则默认 `web`。

### 1.2 顶层键

以下键名与 `tools/install.mjs` 的 `normalizeConfig` 一致（配置文件 schema 的唯一权威来源）。

| 顶层键 | 类型 | 语义 |
|---|---|---|
| `profile` | string | 检测时纳入哪个 profile 的 patch 层（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）；缺省 `web` |
| `roles` | map | `toolName` → `{ persona?, name?, tools[], model?, provider? }`。对内置三角色（`search_external` / `design` / `implement`）：覆盖 persona 与 allow 意图，并可配 `name` 显示名（只替换该角色默认 persona 首行身份句的主语，见 2.4）与专用模型（`model` / `provider`，见 2.5）；其它键名 = **自定义角色**：生成全新 `delegation-<toolName>` 块并把 toolName 注入主 agent 的 `config.allow`（详见第 2、6 节） |
| `roles_remove` | string[] | 整条删除的内置角色 toolName 列表（只认 `search_external` / `design` / `implement`，其它名字忽略并告警；缺省 = `[]`）。删除 = 委派行 / 工具面 / 角色 persona / 主 agent 侧委派指引全部不再生成（详见 2.3） |
| `skills` | map | `skill` → 分配给该技能的角色 toolName 列表；安装时把 `Available skills: …` 引导句写进这些角色 persona 的尾部（详见第 7 节） |
| `main_agent_extra` | string[] | 追加到主 agent 白名单的工具（host 工具，如 `mcp__codegraph__codegraph_explore`、`memory_search`、`mnemon_*`）；与检测库存求交，未检测到则不注入 |
| `main_agent_remove` | string[] | 从主 agent 白名单裁掉的基础工具（如 goal 工具族、`exit_plan_mode`）；不在当前 allow 的名字警告并跳过；移除结果为空列表直接报错 |
| `main_agent_skills` | string[] | 主 agent 技能软引导（默认通道）：每技能在 persona 末尾写一行紧凑技能行 + `Read full rules:` 路径 |
| `main_agent_skills_inline` | string[] | 主 agent 技能硬内联（可选）：选中技能 SKILL.md 全文内联进 persona，每轮固定生效 |
| `main_agent_persona_extra` | string \| null | 主 agent persona 尾部追加文本。`null` / 缺省 = 用默认常量；`''` = 不追加任何内容；其它字符串 = 覆盖默认 |
| `main_agent_name` | string \| null | 主 agent 名称（一改两处：部署 preset 显示名与 persona 身份行 `You are the <name> agent powered by the {{model}} model.`）。trim 后 1–60 字符、不可含换行；空 / 缺省 = 保持默认（详见第 5 节） |

`roles` 语义细节：

- `roles.<toolName>.persona`：非空字符串**整体替换**该角色的部署 persona（含 `''` 与缺省 = 保留静态默认）。自定义角色缺省 persona 为 `You are the <toolName> agent. Handle tasks delegated to this role.`
- `roles.<toolName>.tools`：`toolName` 属内置三角色时**全量覆盖**该角色 `toolFilter.allow` 的意图（安装器再对 host 依赖的名字做检测求交）；缺省 = 保留静态 allow。三角色若最终 allow 为空，安装直接报错（拒绝安装零工具角色）。
- `roles.<toolName>.name`：仅对内置三角色生效的可选 `string | null` 显示名（缺省 `null` = 用该角色内置默认身份）。只替换该角色**默认** persona 首行身份句的主语——design 默认 `You are the design agent.`，配 `name: UI 设计` 后为 `You are the UI 设计 agent.`，句子其余文字不动；约束、边界与示例见 2.4。
- `roles.<toolName>.model`：该角色的专用模型 id（可选 `string`）。配置后，该角色派出的每个子 agent 都固定用这个模型，不再随主 agent 会话当前模型走；缺省 = 不注入 `agentOptions`，子 agent 继承主 agent 的模型（详见 2.5）。
- `roles.<toolName>.provider`：该角色模型所在的 provider 路由（可选 `string`）。须与 `model` 成对配置才生效，只配 `provider` 会被安装器告警并忽略；只配 `model` 时沿用主 agent 的 provider 路由（详见 2.5）。
- `roles` 下键名不在三角色内 = 自定义角色（见第 6 节）；请勿把静态角色 `search_internal_deep` 写进 `roles`（见 2.2）。
- 内置角色可**整体删除**：`roles_remove` 键只认三角色名，删除效果、与 `roles` 键的一致性及恢复路径见 2.3。

`main_agent_extra` 缺省 / 为空时回落到「按本次检测的智能默认」（检测到的 codegraph、`memory_search` 等归主 agent）——这也是不写任何配置时主 agent 仍能直接调 codegraph 工具的原因。

### 1.3 完整最小示例

一个覆盖全部常用键的配置文件（键序与安装器写出的 `serializeConfig` 一致）：

```yaml
# dsh-paoding（庖丁）安装配置 —— 可手编；改后重跑 ./install.sh --auto 应用。
# 交互向导 / 配置 UI 也会写本文件（0o600）。

profile: web            # 检测时扫描 profiles/<profile>/cordis.patch.yml

roles:                  # toolName -> { persona?, tools[] }
  search_external:      # 内置角色：整体覆盖 persona 与 allow 意图
    persona: |-
      You are the external-research agent. Web research only — never modify files.
    tools:
      - web_search
      - mcp__tavily__tavily_search
      - mcp__tavily__tavily_crawl
      - mcp__tavily__tavily_extract
      - mcp__tavily__tavily_map
      - mcp__tavily__tavily_research
      - glob
      - grep
      - read
      - ask_user_question
  design:               # 只改 persona、tools 留空 = 保留静态 allow
    persona: |-
      You are the design agent. Produce UI/UX designs and specs; never implement final code.
  code-reviewer:        # 自定义角色（toolName 匹配 /^[a-z][a-z0-9_]*$/）
    persona: |-
      You are the code-reviewer agent. Review diffs and files for bugs, security
      issues and style regressions; report a prioritized list with file:line.
    tools:
      - read
      - glob
      - grep
      - bash
      - ask_user_question
      - todo_write

main_agent_extra:       # 追加 host 工具（未检测到的不注入）
  - mcp__codegraph__codegraph_explore
  - memory_search
main_agent_remove:      # 裁基础工具（实测四项约省 ≈0.8k tokens/轮）
  - get_goal
  - create_goal
  - update_goal
  - exit_plan_mode
main_agent_skills:      # 软引导：persona 技能行 + 主 agent 用 read 按需加载
  - caveman
main_agent_skills_inline: []   # 硬内联（空 = 不用）；与 skills 同列时只内联不写软行
main_agent_persona_extra: |-   # null/缺省 = 默认 codegraph 规则；'' = 不追加；其他 = 覆盖
  Never call codegraph_* tools without passing projectPath = {{cwd}}.

skills:                 # skill -> 分配给的角色（写进角色 persona 的 Available skills 引导）
  frontend-design: [design]
  html-ppt: [design]
```

对上例的几点说明：

- `roles.search_external` 的 tools 是**意图**：若 tavily 未启用，安装器会把 5 个 `mcp__tavily__*` 剔除，保留其余（`--dry-run` 的 removed 列表会给出原因）。
- `roles.design` 未写 `tools` → 保留静态 allow，只换 persona。
- `roles.code-reviewer` 安装后生成 `delegation-code-reviewer` 委派块，主 agent 白名单加入 `code-reviewer`，对话里直接调该 toolName 即可委派。
- `main_agent_persona_extra` 里的 `{{cwd}}` / `{{model}}` 是 DSH 运行时替换的占位符，必须原样保留。

## 2. 默认角色微调

### 2.1 persona 与 tools 的覆盖语义

四个默认委派角色中，安装器（`ROLES` 常量）只管理其中三个：`search_external`、`design`、`implement`。配置 `roles` 键下写这三个名字之一即可微调：

- `persona`：整体替换部署 persona。写入后该文本会进入 `dsh-tool-subagent` 实例的 `persona` 字段 —— 即子 agent 的 **deployment persona**（子 agent 会话里看到的身份与行为指引），不是追加。静态 persona 里内置的「失败汇报协议 / 行为边界」段落也会被一并替换——要保留请把原文（见 `presets/orchestrator/agent.cordis.yml` 对应块）并入你的文本。
- `tools`：**全量重写**该角色的 `toolFilter.allow` 意图。一句话关系：`agent.cordis.yml` 里的 allow 是静态意图，安装器以实际检测结果重写它；配置里的 `roles.<name>.tools` 就是你要覆盖的新意图 —— 检测后能留多少留多少。
- 角色 allow 是**精确名匹配**，不支持 glob：tavily 的 5 个工具要逐个写全（`mcp__tavily__tavily_search` … `mcp__tavily__tavily_research`）。

示例（替换 `implement` 的 persona 与 tools）：下方 tools 与静态默认一致——注意它不含 `str_replace_editor`（原因见 8.2）。显式写出 tools 等于固定意图：将来静态源怎么改都不再影响本角色：

```yaml
roles:
  implement:
    persona: |-
      You are the implementation agent. You write and edit code: read surrounding
      context first, make surgical changes, then verify (build/test/grep). Report
      what you changed and how you verified. On tool failure, do not retry a denied
      operation: report the failure compactly so the orchestrator can re-delegate.
    tools:
      - read
      - write
      - edit
      - glob
      - grep
      - bash
      - skill
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

### 2.2 search_internal_deep 是静态角色

`search_internal_deep`（全仓深度探索、只读不联网、只回摘要）同样是内置委派角色，但**不在安装器管理的三角色内**：安装器不会重写它的 persona / allow。`agent.cordis.yml` 里该角色块的注释记录了历史：2026-09-02 `memory_search` 与 codegraph 工具被**手工**移出它的 allow——重新启用相应插件后，需要按需自行加回的是这个静态角色（安装器不会代劳）。

因此：

- **不要**把 `search_internal_deep` 写进配置文件 `roles` 键 —— 非三角色键名会被当作**自定义角色**处理，安装器会再生成一个重复的 `delegation-search-internal-deep` 块，与静态块冲突。
- 同理它也**不在** `roles_remove` 可删名单内（该键只认三角色名，见 2.3）——它刻意保留为静态角色，不在任何配置键 / UI 里，本键也删不掉它。
- 想调整它的 persona / 工具面：直接编辑 `presets/orchestrator/agent.cordis.yml` 里对应 `delegation-search-internal-deep` 块的 `persona` 与 `toolFilter.allow`，然后重跑 `./install.sh --auto`。安装器只重写三角色与主 agent persona 的有限区间，静态源里其余内容（包括你这个改动）原样保留到生成文件。

### 2.3 删除内置角色：roles_remove

顶层可选键 `roles_remove`（string[]，缺省 = `[]`）把内置委派角色从部署中**整条删除**，值为被删角色的 toolName。可删范围只有 `search_external` / `design` / `implement`——正好是 `roles` 键能覆盖的三个默认角色（配置 UI 里带「内置」徽标的三张卡）。范围之外的名字会被**忽略并告警**；`search_internal_deep` 删不掉（静态角色，见 2.2）。

删除即整条移除，被删角色在生成结果里整体不再出现：

- `agent.cordis.yml` 里它的 `delegation-<role>` 委派行（含角色 persona 与 `toolFilter.allow` 工具面）不再生成；
- 主 agent persona 里对它的委派指引 bullet（如 `- UI/design work: delegate to design.`）不再生成；
- 主 agent 委派面里它的委派工具名不再出现。

删除**不影响**主 agent 的通用委派通道（`subagent` / `send_message` 等照常可用）。

示例：

```yaml
roles_remove:
  - design     # 不再生成 delegation-design 块；主 agent persona 里的 design 委派指引一并移除
```

与 `roles` 键的关系：`roles` 里仍保留**未被删**的内置角色条目（想覆盖其 persona / tools 照旧写）。「删除」的完整状态 = `roles_remove` 含该名 **且** `roles` 无该 key —— UI / CLI 会保证这一致性，手编配置请自行保持一致；两者冲突时，生成以 `roles_remove` 为准。

恢复：

- **手编**：把名字从 `roles_remove` 移除（想恢复自定义 persona / tools，同时在 `roles` 键写回该项），重跑 `./install.sh --auto`——角色按 SRC 默认 persona 与工具面重新生成。
- **配置 UI**：角色列表末尾「已删除的内置角色」区一键恢复（恢复为 SRC 默认工具面）。

### 2.4 内置角色显示名：roles.\<toolName>.name

内置三角色（`search_external` / `design` / `implement`）的条目下可写可选子键 `name`（`string | null`；缺省 / `null` = 用该角色**内置默认身份**）。它的作用窄而明确：**只替换该角色默认 persona 首行身份句的主语**——身份句其余文字（职责描述、行为边界等）原样不动，工具面与委派机制一概不碰。

例：design 默认身份句是 `You are the design agent.`，配 `name: UI 设计` 后生成 `You are the UI 设计 agent.`：

```yaml
roles:
  design:
    name: UI 设计      # 只换 persona 身份句主语；tools 可省（回落默认工具面）
```

约束：trim 后 1–60 字符、不可含换行；空字符串 / 缺省 = 用该角色内置默认身份（不写此子键时，身份句是 SRC 原文，安装器不做任何替换）。

边界：

- **只动 persona 身份句**：工具注册名与委派调用名（toolName）不变——主 agent 仍按 `search_external` / `design` / `implement` 委派；`restrict allow` 与主 agent persona 里的委派指引（如 `delegate to design`）也都不变。
- **persona 被自定义时 `name` 不生效**：同一条目写了非空 `persona`（覆盖默认 persona）时，安装器在生成时忽略 `name` 并告警——想把名字显出来，直接写进自定义 persona 首行（如 `persona: |-` 块第一句 `You are the UI 设计 agent.`），此时无需 `name` 子键。
- **被删除的角色不涉及**：`roles_remove` 整条删除的角色没有 persona 可改（见 2.3）。
- **静态角色不在列**：`search_internal_deep` 不在安装器管理的三角色内，无此子键（见 2.2）。

生效方式与主 agent 改名同构（见 5.1）：

- **手编**：写子键后重跑 `./install.sh --auto`，再重启 DSH / 新会话生效。
- **配置 UI**：设置 → 庖丁配置 → 内置角色卡（徽标「内置」）顶部「角色显示名」输入框，空 = 默认；点「保存并应用」后**重启 GUI / 新会话**生效。

### 2.5 角色专用模型：roles.\<toolName>.model / .provider

角色条目下还有两个可选子键，把该角色的子 agent **固定在指定模型上**：`model`（`string`，模型 id）与 `provider`（`string`，provider 路由）。内置三角色与自定义角色条目都支持这两个子键；`search_internal_deep` 是静态角色、不收它们——把它（或任何非三角色名）写进 `roles` 仍会被当**自定义角色**处理，约束与 2.2 一致。

生成语义：配置后，安装器在该角色委派块的 `config.toolName:` 行后注入一段 `agentOptions:`（`provider` 在前、`model` 在后），DSH 的 `dsh-tool-subagent` 把 `agentOptions` 应用到该角色派出的**每一个**子 agent。两个键都缺省 = 不注入 `agentOptions`，子 agent 继承主 agent 会话当前模型（UI 模型选择器 / 全局默认）。对 `continuable` 子 agent 同样成立：冷恢复时 descriptor 已记录该子 agent 的 `agentProvider` / `agentModel`，恢复之后跑的仍是该角色自己的模型。

```yaml
roles:
  implement:
    provider: deepseek-official
    model: deepseek-v4-pro          # implement 固定用 pro 档
  search_external:
    model: deepseek-v4-flash        # 不配 provider = 沿用主 agent 的 provider 路由
```

规则与边界：

- **provider 须与 model 成对**：只写 `provider` 不生效——安装器告警并忽略；只写 `model` 合法，此时沿用主 agent 的 provider 路由。
- **路由与模型 id 必须真实存在**：可选路由取决于你的 DSH 部署注册了哪些 LLM 适配器——官方安装默认 `deepseek-official`（模型 `deepseek-v4-flash` / `deepseek-v4-pro` / `deepseek-v4-flash-vision-exp`）；`pi-ai` 网关可在 DSH 设置里配 anthropic / openai / google 等 profile（需先备好对应凭据）。`model` 必须属于所选路由，否则该角色**每次委派**都会在运行时报错。
- **被删除的角色不涉及**：`roles_remove` 整条删除的角色，条目里残留的 `model` / `provider` 被忽略并告警（见 2.3）。
- **静态角色不在列**：`search_internal_deep` 无这两个子键（见 2.2）。

配置 UI（设置 → 庖丁配置 → 角色卡「专用模型」）中这一项是下拉选择，选项直接来自 DSH 已注册的模型路由；目录外的值（如手编配置）会以「当前配置」选项保真显示，不会被静默丢弃。

生效方式与其他配置键相同：改完重新应用（`./install.sh --auto`，或配置 UI「保存并应用」），再重启 DSH / 新会话。

这两个子键是 8.1 静态源 `agentOptions` 写法的配置层等价物（免改源码，推荐优先）；需要连 `maxTokens` 一起控制时才落静态源（见 8.1）。

## 3. 主 agent 工具面

### 3.1 机制与 21 项白名单基线

主 agent 的工具面由 `presets/orchestrator/restrict.mjs`（`orchestrator-restrict`）在 `system-prompt/assemble` 瀑布上按白名单过滤。过滤是**失败自动放行全量**的（过滤器自身出错不会锁死会话）；名字按已解析的工具逐个匹配，**未挂载的名字只是缺席、永远不是错误**。

`restrict.mjs` 里的常量 `MAIN_AGENT_ALLOW` 是生成 `config.allow` 的 **base**（21 项）：`config.allow` 未注入时运行时直接回落该常量。要改主 agent 工具面，**不要改 `restrict.mjs` 源码**——一律用配置文件（`main_agent_extra` / `main_agent_remove`），或交互向导里的移除/恢复步骤。

| 分组 | 工具（21 项） |
|---|---|
| 角色委派 | `search_external` `design` `implement` `search_internal_deep` |
| 子 agent 管理 | `send_message` `list_agents` `interrupt_agent` |
| 内部搜索（热路径） | `glob` `grep` `read` `read_image` `bash` |
| 协调 | `todo_write` `ask_user_question` `get_goal` `create_goal` `update_goal` `exit_plan_mode` `job_output` `job_list` `job_kill` |

对照说明：`web_search`、全部 `mcp__tavily__*`、`write` / `edit` / `str_replace_editor`、`skill`、`workflow`、`ralph`、未过滤的 `subagent` 委派等**刻意不在**主 agent 面上（host 工具如 codegraph / `memory_search` / mnemon 同理不硬编码进源码，需要时用 `main_agent_extra` 勾选，见 3.2）。另外 `restrict.mjs` 在注册层对主 agent deny 了 `skill`（目录注入守卫查的是注册面而非模型可见面），主 agent 的技能目录注入随之归零。

### 3.2 追加工具：main_agent_extra

把 host 工具加入主 agent 面（例如想主 agent 直接做知识检索/记忆/插件工具），追加到 `main_agent_extra`：

```yaml
main_agent_extra:
  - mcp__codegraph__codegraph_explore   # codegraph MCP
  - memory_search                       # magic-memory 插件
  - mnemon_recall                       # mnemon 工具族（运行时工具，视检测而定）
```

要点：

- 追加项会进入生成的 `orchestrator-restrict config.allow`。`mcp__*` 与插件工具属 **host 依赖**：安装器只把**实际检测到**的注入 allow；没检测到（MCP 未启用、拼写错误）就静默不注入、不报错。
- 向导 / 配置 UI 的「主 agent」卡片里可勾选的具体 host 工具，以检测面板（工具池）为准。
- `main_agent_extra` 缺省/为空时，安装器回落到智能默认（检测到的 codegraph、`memory_search` 建议归主 agent）。

### 3.3 移除基础工具：main_agent_remove

把基础工具从主 agent 面裁掉（不碰源码）用 `main_agent_remove`。实测参考：移除 `[get_goal, create_goal, update_goal, exit_plan_mode]` 四项约省 **≈0.8k tokens/轮**。

```yaml
main_agent_remove:
  - get_goal
  - create_goal
  - update_goal
  - exit_plan_mode
```

### 3.4 语义规则与边界

| 规则 | 行为 |
|---|---|
| 移除名不在当前 allow | **警告并跳过**（未检测的 host 工具、拼写错误、从未存在的名字），不中断安装 |
| 移除结果为空列表 | **直接报错**。`restrict.mjs` 运行时对空 allow 拒绝加载（`allow.size === 0` 抛错），安装器在安装期即拦截并提示至少保留一个工具 |
| 同名同时出现在 `main_agent_extra` 与 `main_agent_remove` | **remove 优先**：先追加后移除，最终不出现 |
| 追加/移除的名字未挂载 | 名字按名匹配已解析工具：缺席即不存在，不报错（与白名单过滤同一规则） |
| 结果与 21 项 base 相同 | 不注入 `config.allow`，运行时回落 `MAIN_AGENT_ALLOW`（零冗余） |

## 4. 主 agent 技能

### 4.1 两条顶层键

主 agent 没有 `skill` 工具、也没有技能目录注入（注册层 deny，见 3.1）。两条顶层键给主 agent 挂技能，与「角色 skill 分配」**同构的软引导**，差异只在加载通道：

| 对比项 | 角色（`skills` 键分配） | 主 agent |
|---|---|---|
| 引导形式 | persona 尾部一句 `Available skills: …` | 每技能一行紧凑技能行（`main_agent_skills`）或全文内联（`main_agent_skills_inline`） |
| 技能内容加载 | skill 目录**全量可见**（DSH 机制，目录按 cwd 收集） | persona 技能行 + 自带 `read` **按需**读全文 |
| 目录注入 | 有（角色工具面含 `skill` 时） | 无（注入为零） |

主 agent 技能只推荐给**任务匹配时才需要读全文**的技能（零成本）；必须**无条件生效**的风格技能请用内联（4.3）。

### 4.2 软引导默认通道：main_agent_skills

默认通道，数组项为技能名：

```yaml
main_agent_skills:
  - caveman
```

安装时生成器为每个选中技能在主 agent persona 末尾追加：

1. 一个分区标题行 `── Assigned skills (soft guidance: when a task matches, load the full rules with the read tool before acting, then follow them for the rest of the session) ──`；
2. 每技能一行**紧凑技能行**：

```
# skill: caveman — Ultra-compressed communication mode…
Read full rules: /Users/<you>/.dsh/skills/caveman/SKILL.md
```

描述为空时技能行只有 `# skill: <name>`。主 agent 任务匹配到该技能时，用自带 `read` 按需读 `Read full rules:` 指向的 SKILL.md 全文再遵循。

代价模型：**每技能只付一行 persona 的开销**（含绝对路径）；未用到零花费；目录注入保持归零。

### 4.3 可选硬内联：main_agent_skills_inline

把风格技能全文内联进 persona、每轮固定生效：

```yaml
main_agent_skills_inline:
  - caveman
```

生成器把选中技能 SKILL.md 的正文（**去掉 YAML frontmatter 后全文**）内联进 persona，每技能带标题行（`# skill: <name> — <description> (inlined)`，描述空则 `# skill: <name> (inlined)`），随后是正文。代价是固定的每轮 persona 开销（= 技能正文），适合 caveman 这类必须无条件生效的风格技能。

### 4.4 边界行为

| 情况 | 行为 |
|---|---|
| 同一技能同时列入 `main_agent_skills` 与 `main_agent_skills_inline` | **只内联**，不再重复写软行 |
| 找不到对应 SKILL.md | **警告并跳过**（不中断安装）；对两条键各警告一次、去重 |
| SKILL.md 存在但正文为空 | 视为找不到，跳过 |
| `description` 解析 | 支持单行、引号（单/双）、折叠块（`>`）与字面块（`\|`，含标记独立成行）；空白折叠、去外层引号、截断至 200 字符；缺省为空串 |
| SKILL.md 扫描范围 | `$DSH_HOME/skills`（默认 `~/.dsh/skills`）、`$DSH_AGENTS_HOME/skills`（默认 `~/.agents/skills`）、`<cwd>/.dsh/skills`、`<cwd>/.agents/skills`；同根内 `<root>/<name>/SKILL.md` 优先于裸 `<root>/<name>.md` |

技能名来自安装时的技能检测（同上四个根）；向导 / 配置 UI 只会列出检测到的技能。

## 5. 主 agent 人设

### 5.1 主 agent 名称：main_agent_name

顶层可选键 `main_agent_name`（string | null）改主 agent 的名字，**一改两处**：

- **部署 preset 显示名**：`preset.yml` 的显示名——GUI 预设选择器里看到的那个名字，默认「编排模式 (Orchestrator)」；
- **persona 身份行**：主 agent persona 的 `You are the <name> agent powered by the {{model}} model.`，`<name>` = 本键值。

约束：trim 后 1–60 字符、不可含换行；空字符串 / 缺省 = 保持默认（不写此键时，显示名与身份行都是 SRC 原文，安装器不做任何替换）。

```yaml
main_agent_name: orchestration-lead   # 缺省 = 默认编排名（preset 显示名「编排模式 (Orchestrator)」）
```

- **手编**：写键后重跑 `./install.sh --auto`，再重启 DSH / 新会话生效。
- **配置 UI**：设置 → 庖丁配置 → 主 agent 卡顶部「主 agent 名称」输入框（带「恢复默认」按钮）；点「保存并应用」后**重启 GUI / 新会话**生效。
- **对照**：本键只改**主 agent**。内置角色的显示名是角色级子键 `roles.<toolName>.name`——只替换该角色默认 persona 首行身份句的主语、不改工具调用名（见 2.4），两条改名线互不牵连、可各自独立配置。

### 5.2 追加三态语义：main_agent_persona_extra

`main_agent_persona_extra`（顶层可选键、多行字符串）安装时追加到主 agent persona 末尾。拼装顺序固定：**SRC 本体 → 技能软行/内联 → extra**。键语义三态：

| 取值 | 语义 |
|---|---|
| 缺省 / `null` | 用**默认常量**（codegraph projectPath 规则，见 5.3） |
| 显式 `''` | **不追加任何内容**（连默认规则也不加） |
| 其它文本 | **覆盖**默认，追加你的文本 |

写入格式：`''` 会以 `main_agent_persona_extra: ''` 写出（区别于缺省）；多行文本以 `|-` 块标量写出。`tools/install.mjs` 的 `normalizeConfig` 只接受 string（非 string / 缺省 → `null`）。

### 5.3 默认常量原文

单点事实源是 `tools/install.mjs` 里的 `DEFAULT_MAIN_AGENT_PERSONA_EXTRA`（`presets/orchestrator/agent.cordis.yml` **不再内置**该行）。默认值原文（英文）：

> Codegraph MCP default project may be a DIFFERENT repository than {{cwd}}. Never call codegraph_* tools without passing projectPath = {{cwd}} (the absolute path of your working directory). If {{cwd}} has no .codegraph index, fall back to glob/grep/read directly and do not loop or comment on project mismatches.

它只在挂载了 codegraph MCP 时相关（约束 codegraph 工具必须带当前项目路径）；未挂载时是无关但无害的一段文本。`{{cwd}}` / `{{model}}` 是 persona 模板占位符，DSH 运行时替换 —— 手编时**必须原样保留**。

### 5.4 编辑途径

- **手编**：直接编辑配置文件的 `main_agent_persona_extra` 键，重跑 `./install.sh --auto`。
- **配置 UI**：设置 → 庖丁配置 → 主 agent 卡片「人设追加」（编辑器带「恢复默认」按钮），可编辑 / 清空 / 恢复默认；点「保存并应用」后**重启 GUI / 新会话**生效。
- 交互向导没有独立的人设追加步骤（从既有配置原样继承）——CLI 下改它请手编或走 UI。

## 6. 自定义角色

内置四个委派角色（见第 2 节与 [架构](architecture.md)）是**起点而非上限**：任何「工具 + 技能」组合都能注册
成一个新委派工具，主 agent 在对话里直接调用它的 toolName 即可。最典型的玩法是**按技能建专属 agent**——
例如想要「专门做 PPT 的 agent」：新建 `ppt` 角色、工具面勾 `skill`（子 agent 用 skill 工具按需加载技能正文）
与 `read` / `write` / `edit` / `bash` 等、persona 说明调用 `html-ppt` 技能产出 HTML 幻灯片，再把
`html-ppt` 技能分给它（第 7 节）。装好后主 agent 说「把这份大纲做成 PPT」即委派给会做幻灯片的子 agent，
通用角色不用什么都碰。任意已装技能都能这样变成专属角色（前端稿、图表、文档排版……）。下分三小节：
向导/UI 路径（6.1）、手写静态源路径（6.2）与配置示例（6.3，含技能型 PPT agent）。

### 6.1 路径一：交互向导 / 配置 UI（推荐）

向导流程（`./install.sh` 交互模式，或配置 UI 的「Agent 工具分配」）：

1. 新建角色：输入 `toolName`，须匹配 `/^[a-z][a-z0-9_]*$/`；
2. 从工具池多选工具（工具池 = 三角色静态 allow ∪ 检测到的 host 工具）；
3. 写一句 persona（向导自动展开为 `You are the <name> agent. <你的描述>`；配置 UI 可给完整 persona）；
4. 向导自动把新 `toolName` 注入主 agent 的 `orchestrator-restrict config.allow` —— **`restrict.mjs` 文件本身不用改**；并把分配持久化到配置文件（`roles` 键下多一项）。

之后对话里直接调该 toolName 即可委派。删除角色 = 从配置文件移除该项再重跑 `--auto`（目标文件每次重新生成，不留残留块）。**内置角色**的整条删除不同——那是 `roles_remove`（见 2.3），`roles` 键下不写即可不覆盖。

### 6.2 路径二：手写静态源

不想经配置层时，直接在源码 preset 里加：

1. 复制 `presets/orchestrator/agent.cordis.yml` 里一个 `delegation-*` 块（delegation 组内）；
2. 改 `toolName` / `persona` / `toolFilter.allow`；
3. 把新 `toolName` 加进 `presets/orchestrator/restrict.mjs` 的 `MAIN_AGENT_ALLOW`（这是生成 `config.allow` 的 base，主 agent 白名单不出现该名字就无法调用委派工具）；
4. 重跑 `./install.sh --auto`（安装器只重写三角色与主 agent persona 的有限区间，你新增的块原样保留）。

两条路径生成同一结构（`delegation-<toolName>` + 白名单含 toolName）；路径一免改源码、可经 UI 管理，推荐优先。

### 6.3 配置示例

手编配置里定义 `code-reviewer`（工具 `read` / `glob` / `grep` / `bash` / `ask_user_question` / `todo_write` 等）：

```yaml
roles:
  code-reviewer:
    persona: |-
      You are the code-reviewer agent. Read diffs and files, find bugs, security
      issues and style regressions, then return a prioritized review list with
      file:line references. Never edit files yourself.
    tools:
      - read
      - glob
      - grep
      - bash
      - ask_user_question
      - todo_write
```

重跑 `./install.sh --auto` 后：生成 `delegation-code-reviewer` 块（persona 原样、tools 原样进 allow），主 agent `config.allow` 注入 `code-reviewer`。注意：自定义角色的 `tools` **原样写入** allow，不做 host 检测求交（向导/UI 的工具池已保证可选项都在注册面内）——手编时只列实际挂载的工具，否则子 agent 创建时 `tools.restrict()` 会以 unknown tools 拒绝。

**技能型示例：`ppt` agent（做 PPT 的专属子 agent）**——工具面含 `skill` 与读写编辑，persona 引导加载
`html-ppt` 技能，`skills` 键把技能分给该角色（persona 尾部生成 Available skills 引导行）：

```yaml
roles:
  ppt:                       # toolName：安装后主 agent 直接调「ppt」即委派
    persona: |-
      You are the ppt agent. You turn outlines into polished HTML slide decks:
      load the html-ppt skill for the format and interaction rules, plan the
      slide flow, write the slides as HTML files, then report the output path.
    tools:
      - read
      - write
      - edit
      - glob
      - grep
      - bash
      - skill                # 用 skill 工具按需加载 html-ppt 技能正文
      - ask_user_question
      - todo_write

skills:
  html-ppt: [ppt]            # 把技能分给 ppt 角色（软引导，见第 7 节）
```

效果与 `code-reviewer` 相同（生成 `delegation-ppt` 块、白名单注入 `ppt`）；区别在多一步 `skills` 映射。
子 agent 创建后 skill 目录对角色全量可见（DSH 机制），persona 的引导行只是**软约束**——真正干活靠子 agent
按需用 `skill` 工具读正文，装配别的技能（如做简历、出图表）同理。向导 / 配置 UI 里也能搭出同款：工具池勾
`skill` + 读写编辑、写一句 persona、在技能分配面板把 `html-ppt` 分给 `ppt`。

## 7. skill 分配

### 7.1 写法与效果

顶层 `skills` 键把技能分给角色（值 = 角色 toolName 列表，与向导「技能分配」步骤、配置 UI「技能分配」面板同一映射）：

```yaml
skills:
  frontend-design: [design]
  html-ppt: [design]
```

安装时生成器把该角色 persona 尾部追加引导句 `Available skills: frontend-design, html-ppt`（分配为空则不写）。对 `design` / `implement` 这类工具面含 `skill` 的角色，技能目录对子 agent 全量可见，引导句提示其用 `skill` 工具加载（DSH 的 skill 目录注入按 cwd 收集、对子 agent 全量可见，没有按 agent 的目录过滤）。只对实际存在、且工具面含 `skill` 的角色有意义。

### 7.2 软约束性质

这是一条**软约束**而非硬隔离：目录可见性是 DSH 机制（按 cwd 收集、对角色全量可见），persona 引导句只是提示。硬隔离靠工具面（allow 里有没有 `skill`）实现。主 agent 例外：其注册层 deny 了 `skill`（见 3.1），所以技能对其不可见——需要时走 `main_agent_skills` / `main_agent_skills_inline`（第 4 节），而不是 `skills` 键。

## 8. 子 agent 模型与平台细节

### 8.1 按角色分模型

`dsh-tool-subagent` 支持 `config.agentOptions: { provider, model, maxTokens }`。按角色分模型优先走配置子键 `roles.<toolName>.model` / `.provider`（见 2.5）；要连 `maxTokens` 一起控制、或不想动配置层时，才直接在 `presets/orchestrator/agent.cordis.yml` 的对应 `delegation-*` 块里加（安装器只重写 persona 与 allow 两处区间，`agentOptions` 会原样保留到生成文件）：

```yaml
    - id: delegation-implement
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: implement
        agentOptions:            # 按角色分模型；不写则继承主 agent 模型
          provider: <provider-key>   # 以你 DSH 环境配置的服务商为准
          model: <model-id>
          maxTokens: 65536
```

缺省不写 `agentOptions` = 继承主 agent 模型。配置子键（见 2.5）在生成时注入的就是这段 `agentOptions`（内置三角色与自定义角色都支持）；只有 `maxTokens` 这类更细控制仍需手改静态源（路径二，见 6.2）。

### 8.2 平台注册面细节

- **`str_replace_editor` 刻意未列入 `implement`**：部分部署的注册面没有该工具，一旦列入 allow，子 agent 创建时 `tools.restrict()` 会以 unknown tools 拒绝。确认你的部署确实注册后再自行加回（静态源 implement allow，或配置 `roles.implement.tools`）。
- 白名单 / allow 是**精确名匹配**，不支持 glob；tavily 五个工具要逐个写全。
- 主 agent 白名单里未挂载的名字不报错（瀑布只在已解析工具里按名匹配）。

### 8.3 停用 MCP / 插件后的同步

停用 tavily / codegraph / magic-memory（在 `~/.dsh/cordis.patch.yml` 或 profile patch 注释相应条目）后**不需要手动改 allow**：重跑 `./install.sh --auto`，安装器检测到停用后自动把对应 `mcp__tavily__*` / `memory_search` 从三角色 allow 剔除（`--dry-run` 可先预览剔除项）。检测不到或握手失败的 MCP 会被跳过：对应角色只是缺这些工具，安装不报错。检测与 patch 层的细节链见 [安装](installation.md)。
