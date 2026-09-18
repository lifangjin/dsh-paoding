← [dsh-paoding](../README.md) ｜ [架构](architecture.md) ｜ [安装](installation.md) ｜ [编排](orchestration.md) ｜ **配置**

[中文](configuration.md) · [English](configuration_en.md)

# 配置

dsh-paoding 把「按角色分工的编排 preset」做成**配置驱动**：你手编（或在「庖丁配置」面板里点选）一个 YAML 配置文件，生成器（`tools/`，面板「保存并应用」与仓库内兜底 CLI 共用同一生成管线 `collectState` / `generateAndInstall`）在应用时据此重写目标 preset —— `~/.dsh/.agent-presets/orchestrator/agent.cordis.yml`，覆盖角色 allow、角色 persona、主 agent 白名单（`config.allow` 注入）、主 agent persona 的技能行/内联与人设追加。

配置文件描述的是**声明式意图**。目标文件每次都由「源码 preset + 本配置文件」重新生成：改配置 → 在面板点「保存并应用」= 幂等同步，不会累积手工补丁。

## 1. 配置文件

### 1.1 位置与优先级

配置文件默认位置是 `$DSH_HOME/dsh-paoding.config.yml`；`$DSH_HOME` 未设置时默认为 `~/.dsh`。环境变量 `DSH_PAODING_CONFIG` 可给面板改路径；仓库内兜底 CLI 的 `--config <file>` 参数也可指定任意其它路径。

改完配置怎么应用（下文「重新应用」均指第一行）：

| 场景 | 行为 |
|---|---|
| Web 面板（左侧栏「庖丁配置」入口） | **主路径**：打开面板会把既有配置加载为当前值，点「保存并应用」写入 preset 并把分配保存到配置文件（默认 `~/.dsh/dsh-paoding.config.yml`，以 `0o600` 权限写入）。手编过配置文件的话，先开面板再应用即可 |
| 首装自动化 | 插件启动时发现 preset 缺失或版本标记不符，自动按配置文件应用一次（无配置则写基础模板）——日常无需手动触发 |
| 兜底 CLI（仅限克隆仓库的开发者） | `node tools/install.mjs --auto`：有配置文件则幂等应用，没有则写基础模板；`--dry-run` 只打印检测报告与将生成的 allow / persona 变化，不写任何文件（含配置文件），适合先预览再动手；`--config <file>` 用指定文件替代默认位置 |

配置文件**存在但解析失败**是硬错误（直接报错退出）；**不存在**则视为无配置（写基础模板）。`profile`、`roles` 等顶层键的语义见下节。

兜底 CLI 的参数优先级：`--profile` 显式给出时覆盖配置文件里的 `profile` 键，否则以配置文件为准，再否则默认 `web`。

### 1.2 顶层键

以下键名与 `tools/install.mjs` 的 `normalizeConfig` 一致（配置文件 schema 的唯一权威来源）。

| 顶层键 | 类型 | 语义 |
|---|---|---|
| `profile` | string | 检测时纳入哪个 profile 的 patch 层（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）；缺省 `web` |
| `roles` | map | `toolName` → `{ persona?, name?, tools[], model?, provider?, background_mode? }`。对内置三角色（`search_external` / `design` / `implement`）：覆盖 persona 与 allow 意图，并可配 `name` 显示名（只替换该角色默认 persona 首行身份句的主语，见 2.4）、专用模型（`model` / `provider`，见 2.5）与会话模式（`background_mode`，见 2.6）；其它键名 = **自定义角色**：生成全新 `delegation-<toolName>` 块并把 toolName 注入主 agent 的 `config.allow`（详见第 2、6 节） |
| `roles_remove` | string[] | 整条删除的内置角色 toolName 列表（只认 `search_external` / `design` / `implement`，其它名字忽略并告警；缺省 = `[]`）。删除 = 委派行 / 工具面 / 角色 persona / 主 agent 侧委派指引全部不再生成（详见 2.3） |
| `skills` | map | `skill` → 分配给该技能的角色 toolName 列表；安装时把 `Available skills: …` 引导句写进这些角色 persona 的尾部（详见第 7 节） |
| `main_agent_extra` | string[] | 追加到主 agent 白名单的工具（host 工具，如 `mcp__codegraph__codegraph_explore`、`memory_search`、`mnemon_*`）；按「preset 自带工具面 ∪ 检测库存」对账，两头都不占的名字不注入 |
| `main_agent_remove` | string[] | 从主 agent 白名单裁掉的基础工具（如 goal 工具族、`exit_plan_mode`）；不在当前 allow 的名字警告并跳过；移除结果为空列表直接报错 |
| `main_agent_skills` | string[] | 主 agent 技能软引导（默认通道）：每技能在 persona 末尾写一行紧凑技能行 + `Read full rules:` 路径 |
| `main_agent_skills_inline` | string[] | 主 agent 技能硬内联（可选）：选中技能 SKILL.md 全文内联进 persona，每轮固定生效 |
| `main_agent_persona_extra` | string \| null | 主 agent persona 尾部追加文本。`null` / 缺省 = 用默认常量；`''` = 不追加任何内容；其它字符串 = 覆盖默认 |
| `main_agent_display_name` | string \| null | 主 agent 显示名，**只改部署 preset 显示名**（GUI 预设选择器里那个名字），不动 persona 身份行。约束：trim 后 1–60 字符、不可含换行；空 / 缺省 = 默认「编排模式 (Orchestrator)」（工作区预设用派生名，详见 5.1） |
| `workspaces` | map | 工作区目录绝对路径 → 该工作区的专属配置条目，字段与顶层同构（`profile` 除外）；每个条目单独生成一份预设 `orchestrator-<slug>`，与全局预设互不影响（详见第 9 节） |

`roles` 语义细节：

- `roles.<toolName>.persona`：非空字符串**整体替换**该角色的部署 persona（含 `''` 与缺省 = 保留静态默认）。自定义角色缺省 persona 为 `You are the <toolName> agent. Handle tasks delegated to this role.`
- `roles.<toolName>.tools`：`toolName` 属内置三角色时**全量覆盖**该角色 `toolFilter.allow` 的意图（安装器再对 host 依赖的名字做检测求交）；缺省 = 保留静态 allow。三角色若最终 allow 为空，安装直接报错（拒绝安装零工具角色）。
- `roles.<toolName>.name`：仅对内置三角色生效的可选 `string | null` 显示名（缺省 `null` = 用该角色内置默认身份）。只替换该角色**默认** persona 首行身份句的主语——design 默认 `You are the design agent.`，配 `name: UI 设计` 后为 `You are the UI 设计 agent.`，句子其余文字不动；约束、边界与示例见 2.4。
- `roles.<toolName>.model`：该角色的专用模型 id（可选 `string`）。配置后，该角色派出的每个子 agent 都固定用这个模型，不再随主 agent 会话当前模型走；缺省 = 不注入 `agentOptions`，子 agent 继承主 agent 的模型（详见 2.5）。
- `roles.<toolName>.provider`：该角色模型所在的 provider 路由（可选 `string`）。须与 `model` 成对配置才生效，只配 `provider` 会被安装器告警并忽略；只配 `model` 时沿用主 agent 的 provider 路由（详见 2.5）。
- `roles.<toolName>.background_mode`：该角色的会话模式（可选 `'one-shot' | 'continuable'`，缺省 `one-shot`）——一次性用完即弃，或可续：子会话跨轮保留，主 agent 用 `send_message` 就地续修。内置角色与自定义角色同语义；continuable 的前置、代价与面板路径见 2.6。
- `roles` 下键名不在三角色内 = 自定义角色（见第 6 节）；请勿把静态角色 `search_internal_deep` 写进 `roles`（见 2.2）。
- 内置角色可**整体删除**：`roles_remove` 键只认三角色名，删除效果、与 `roles` 键的一致性及恢复路径见 2.3。

`main_agent_extra` 缺省 / 为空时回落到「按本次检测的智能默认」（检测到的 codegraph、`memory_search` 等归主 agent）——这也是不写任何配置时主 agent 仍能直接调 codegraph 工具的原因。

### 1.3 完整最小示例

一个覆盖全部常用键的配置文件（键序与面板写出的 `serializeConfig` 一致）：

```yaml
# dsh-paoding（庖丁）安装配置 —— 可手编；改后在 设置 → 庖丁配置 应用，或重跑 node tools/install.mjs --auto

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

- `roles.search_external` 的 tools 是**意图**：若 tavily 未启用，生成器会把 5 个 `mcp__tavily__*` 剔除，保留其余（「预览生成」的 removed 列表会给出原因）。
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
      - read_image
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
- 想调整它的 persona / 工具面：直接编辑 `presets/orchestrator/agent.cordis.yml` 里对应 `delegation-search-internal-deep` 块的 `persona` 与 `toolFilter.allow`，然后在「庖丁配置」点「保存并应用」重新生成（开发者也可用兜底 CLI `node tools/install.mjs --auto`）。生成器只重写三角色与主 agent persona 的有限区间，静态源里其余内容（包括你这个改动）原样保留到生成文件。

### 2.3 删除内置角色：roles_remove

顶层可选键 `roles_remove`（string[]，缺省 = `[]`）把内置委派角色从部署中**整条删除**，值为被删角色的 toolName。可删范围只有 `search_external` / `design` / `implement`——正好是 `roles` 键能覆盖的三个默认角色（面板里带「内置」徽标的三张卡）。范围之外的名字会被**忽略并告警**；`search_internal_deep` 删不掉（静态角色，见 2.2）。

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

- **手编**：把名字从 `roles_remove` 移除（想恢复自定义 persona / tools，同时在 `roles` 键写回该项），在「庖丁配置」点「保存并应用」——角色按 SRC 默认 persona 与工具面重新生成。
- **面板**：角色列表末尾「已删除的内置角色」区一键恢复（恢复为 SRC 默认工具面）。

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

生效方式与主 agent 显示名同款（见 5.1）：

- **手编**：写子键后在「庖丁配置」点「保存并应用」，再重启 DSH / 新会话生效。
- **面板**：左侧栏「庖丁配置」→ 内置角色卡（徽标「内置」）顶部「角色显示名」输入框，空 = 默认；点「保存并应用」后**重启 GUI / 新会话**生效。

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

配置页（左侧栏「庖丁配置」→ 角色卡「专用模型」）中这一项是下拉选择，选项直接来自 DSH 已注册的模型路由；目录外的值（如手编配置）会以「当前配置」选项保真显示，不会被静默丢弃。

生效方式与其他配置键相同：改完在「庖丁配置」点「保存并应用」，再重启 DSH / 新会话。

这两个子键是 8.1 静态源 `agentOptions` 写法的配置层等价物（免改源码，推荐优先）；需要连 `maxTokens` 一起控制时才落静态源（见 8.1）。

### 2.6 角色会话模式：roles.\<toolName>.background_mode

角色条目的可选子键 `background_mode`，决定该角色派出的子 agent 会话怎么收场：`'one-shot'`（一次性，用完即弃）或 `'continuable'`（可续，子会话跨轮保留）。缺省 `one-shot`；内置角色与自定义角色条目同语义，没有角色差异。

```yaml
roles:
  implement:
    background_mode: continuable   # 该角色的委派转后台、跨轮保留；主 agent 用 send_message 就地续修
```

生成语义：基础模板在四个内置角色的委派块里各预置一行 `backgroundMode: one-shot`（纯为可见性——打开生成文件不用猜默认值）；配成 `continuable` 的角色，生成器把该行**原位改写**为 `backgroundMode: continuable`（块内无此行时才兜底注入，不会出现两行），`one-shot` / 缺省原样保留。自定义角色块同样恒写此行。两种模式的编排取舍、失败恢复分支见[编排](orchestration.md)「one-shot 与多轮迭代」。

continuable 的前置与代价（如实说明）：

- **前置：host 层挂 `sessionPersistence` 后端。** 在 `~/.dsh/cordis.patch.yml` 挂 `@deepseek-ai/dsh-session-persistence-jsonl`（`config.root` 必填）。未挂载时 continuable 创建/续跑直接报错（错误码 `PERSISTENCE_UNAVAILABLE`）。这是机器级全局改动，卸载 preset 不撤销。
- **代价：无 TTL 落盘累积、每轮携带累积上下文。** 持久化会话没有 TTL，会持续写盘；continuable 子 agent 每轮带着自己攒下的上下文，长期挂只增不减。只给多轮打磨类委派用，用完 `interrupt_agent` 停掉、顺手清理落盘。

面板操作路径：左侧栏「庖丁配置」→ 角色卡「会话模式」单选（「一次性（one-shot）」/「可续（continuable）」）。未探测到 `sessionPersistence` 时面板会就地警告但不拦截——警告只是提醒先把 persistence 后端挂上，保存照常可执行。

边界：

- **静态角色不在列**：`search_internal_deep` 不经 `roles` 键（见 2.2）。它的委派块在基础模板里同样显式标了 `backgroundMode: one-shot`；要把它改成可续，直接改静态源那一行再「保存并应用」重新生成（生成器不重写该行，原样保留）。
- **被删除的角色不涉及**：`roles_remove` 整条删除的角色，条目里残留的 `background_mode` 被忽略并告警（见 2.3）。
- **主 persona 已有对应分支**：可续角色失败或产出不满时，主 agent 的委派失败 SOP 先 `send_message` 同会话续修，重委派退为续修无效后的退路（见[编排](orchestration.md)）。

生效方式与其他配置键相同：改完在「庖丁配置」点「保存并应用」，再重启 DSH / 新会话。

## 3. 主 agent 工具面

### 3.1 机制与 21 项白名单基线

主 agent 的工具面由 `presets/orchestrator/restrict.mjs`（`orchestrator-restrict`）在 `system-prompt/assemble` 瀑布上按白名单过滤。过滤是**失败自动放行全量**的（过滤器自身出错不会锁死会话）；名字按已解析的工具逐个匹配，**未挂载的名字只是缺席、永远不是错误**。

`restrict.mjs` 里的常量 `MAIN_AGENT_ALLOW` 是生成 `config.allow` 的 **base**（21 项）：`config.allow` 未注入时运行时直接回落该常量。要改主 agent 工具面，**不要改 `restrict.mjs` 源码**——一律用配置文件（`main_agent_extra` / `main_agent_remove`），或在面板「主 agent」卡片里勾选/取消。

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

- 追加项会进入生成的 `orchestrator-restrict config.allow`。注入同样走白名单对账：名字必须落在 **preset 自带工具面**（`restrict.mjs` 主 agent 白名单 ∪ 源 preset 各角色静态 allow）或**检测库存**里，host 工具（`mcp__*`、`mnemon_*` 等插件工具）以实际检测结果为准——没检测到（MCP/插件未启用、拼写错误）就不注入、不报错，「预览生成」的角色 removed 列表可看原因。
- 面板的「主 agent」卡片里可勾选的具体 MCP / 插件工具，以检测结果（工具池）为准。
- `main_agent_extra` 缺省/为空时，生成器回落到智能默认（检测到的 codegraph、`memory_search` 建议归主 agent）。

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
| SKILL.md 扫描范围 | 全局（CLI 安装 / 面板「全局默认」）只扫用户级两根：`$DSH_HOME/skills`（默认 `~/.dsh/skills`）、`$DSH_AGENTS_HOME/skills`（默认 `~/.agents/skills`）；按工作区生成时另加该工作区目录的 `.dsh/skills` 与 `.agents/skills`（见第 9 节）。同根内 `<root>/<name>/SKILL.md` 优先于裸 `<root>/<name>.md` |

技能名来自应用时的技能检测（同上四个根）；面板只会列出检测到的技能。

## 5. 主 agent 人设

### 5.1 只改显示名：main_agent_display_name

`main_agent_display_name`（顶层可选键，string | null）只改**部署 preset 显示名**——GUI 预设选择器里看到的那个名字；persona 身份行 `You are the orchestrator agent powered by the {{model}} model.` 完全不动。编排主 agent 的身份是编排预设提示词语义的一部分，**不支持改名**（旧版「主 agent 名称」键已下线；老配置里的残留行下次「保存并应用」时自动清除，安装器会提示该键已忽略）。

约束：trim 后 1–60 字符、不可含换行，违规直接报错；空 / 缺省 = 默认「编排模式 (Orchestrator)」（工作区预设用派生名）。

生成 `preset.yml` 时显示名按下面的顺序取值：

1. `main_agent_display_name`（本键非空时最优先）；
2. 「SRC 名·目录名」派生名（仅工作区预设，见 9.2）；
3. SRC 原名。

不写本键时一切行为与从前逐字节一致（向后兼容，老配置零感升级）。

```yaml
main_agent_display_name: 庖丁   # 仅 preset 显示名换成「庖丁」，persona 身份行不动
```

生效方式：

- **手编**：写键后在「庖丁配置」点「保存并应用」，再重启 GUI / 新会话生效。
- **面板**：左侧栏「庖丁配置」→ 主 agent 卡「主 agent 显示名（仅 preset 显示名）」输入框（带「恢复默认」按钮），点「保存并应用」后**重启 GUI / 新会话**生效。
- **对照**：显示名线共两条、互不牵连：`main_agent_display_name`（仅主 agent 的 preset 显示名，见 5.1）、`roles.<toolName>.name`（内置角色默认 persona 首行身份句的主语，不改工具调用名，见 2.4），可各自独立配置。

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

- **手编**：直接编辑配置文件的 `main_agent_persona_extra` 键，然后在「庖丁配置」点「保存并应用」。
- **面板**：左侧栏「庖丁配置」→ 主 agent 卡片「人设追加」（编辑器带「恢复默认」按钮），可编辑 / 清空 / 恢复默认；点「保存并应用」后**重启 GUI / 新会话**生效。

## 6. 自定义角色

内置四个委派角色（见第 2 节与 [架构](architecture.md)）是**起点而非上限**：任何「工具 + 技能」组合都能注册
成一个新委派工具，主 agent 在对话里直接调用它的 toolName 即可。最典型的玩法是**按技能建专属 agent**——
例如想要「专门做 PPT 的 agent」：新建 `ppt` 角色、工具面勾 `skill`（子 agent 用 skill 工具按需加载技能正文）
与 `read` / `write` / `edit` / `bash` 等、persona 说明调用 `html-ppt` 技能产出 HTML 幻灯片，再把
`html-ppt` 技能分给它（第 7 节）。装好后主 agent 说「把这份大纲做成 PPT」即委派给会做幻灯片的子 agent，
通用角色不用什么都碰。任意已装技能都能这样变成专属角色（前端稿、图表、文档排版……）。下分三小节：
面板路径（6.1）、手写静态源路径（6.2）与配置示例（6.3，含技能型 PPT agent）。

先说两个生成期行为：其一，**零工具的自定义角色装不上**——`tools` 缺省或写成空列表会得到一张空白
名单（`toolFilter.allow:` 落成 null），子 agent 创建后一个工具都没有；生成器对此与内置角色一视同仁，
应用时直接报错拒绝安装，给角色配上至少一个工具再应用即可。其二，
生成器会把角色 persona 的**首行职责句自动追加为主 agent persona 的委派行**（`- <职责>: delegate to
<toolName>.`，紧跟既有委派行之后）——主 agent 全靠这行知道什么活该派给谁，因此建议把 persona 首行
写成一句简短职责（例如「你的职责就是查找符合用户要求的技能」）。

### 6.1 路径一：庖丁配置面板（推荐）

面板流程（左侧栏「庖丁配置」→「Agent 工具分配」→ 底部「新建自定义 agent 角色」）：

1. 新建角色：输入 `toolName`，须匹配 `/^[a-z][a-z0-9_]*$/`；
2. 从工具池多选工具（工具池 = 三角色静态 allow ∪ 检测到的 MCP / 插件工具）；
3. 写 persona（可给完整 persona，首行写成一句简短职责）；
4. 点「保存并应用」——生成器自动把新 `toolName` 注入主 agent 的 `orchestrator-restrict config.allow` —— **`restrict.mjs` 文件本身不用改**；并把分配持久化到配置文件（`roles` 键下多一项）。

角色卡上工具清单的口径：候选 = 源码 preset 的静态 allow 面（内置角色自带；本身含核心工具）∪ 主 agent 核心
allow（`restrictBase`，供自定义角色回落）∪ 检测库存，按三组呈现——「**基础工具**」= 非 `mcp__` 且不在检测
库存的核心面（`read` / `glob` / `grep` / `bash` / `todo_write` 等，委派名 `search_external` / `design` /
`implement` / `search_internal_deep` 不进网格）；「**MCP 工具**」= `mcp__` 前缀（含源码 preset 自带的
tavily 等行）；「**插件工具**」= 检测库存中无 `mcp__` 前缀的插件直注册工具（`mnemon_*` 等）。新建角色的出厂
`tools` 即核心面加检测库存，默认全选，应用前可逐项增删。

之后对话里直接调该 toolName 即可委派。删除角色 = 面板里删卡（或从配置文件移除该项）后再点「保存并应用」（目标文件每次重新生成，不留残留块）。**内置角色**的整条删除不同——那是 `roles_remove`（见 2.3），`roles` 键下不写即可不覆盖。

### 6.2 路径二：手写静态源

不想经配置层时，直接在源码 preset 里加：

1. 复制 `presets/orchestrator/agent.cordis.yml` 里一个 `delegation-*` 块（delegation 组内）；
2. 改 `toolName` / `persona` / `toolFilter.allow`；
3. 把新 `toolName` 加进 `presets/orchestrator/restrict.mjs` 的 `MAIN_AGENT_ALLOW`（这是生成 `config.allow` 的 base，主 agent 白名单不出现该名字就无法调用委派工具）；
4. 重新应用（「庖丁配置」点「保存并应用」；开发者也可 `node tools/install.mjs --auto`）——生成器只重写三角色与主 agent persona 的有限区间，你新增的块原样保留。

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

在「庖丁配置」点「保存并应用」后：生成 `delegation-code-reviewer` 块（persona 原样、tools 原样进 allow），主 agent `config.allow` 注入 `code-reviewer`。注意：自定义角色的 `tools` **原样写入** allow，不做 host 检测求交（面板的工具池已保证可选项都在注册面内）——手编时只列实际挂载的工具，否则子 agent 创建时 `tools.restrict()` 会以 unknown tools 拒绝。

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
按需用 `skill` 工具读正文，装配别的技能（如做简历、出图表）同理。庖丁配置面板里也能搭出同款：工具池勾
`skill` + 读写编辑、写一句 persona、在技能分配面板把 `html-ppt` 分给 `ppt`。

## 7. skill 分配

### 7.1 写法与效果

顶层 `skills` 键把技能分给角色（值 = 角色 toolName 列表，与面板「技能分配」网格同一映射）：

```yaml
skills:
  frontend-design: [design]
  html-ppt: [design]
```

安装时生成器把该角色 persona 尾部追加引导句 `Available skills: frontend-design, html-ppt`（分配为空则不写）。对 `design` / `implement` 这类工具面含 `skill` 的角色，技能目录对子 agent 全量可见，引导句提示其用 `skill` 工具加载（DSH 的 skill 目录注入按 cwd 收集、对子 agent 全量可见，没有按 agent 的目录过滤）。只对实际存在、且工具面含 `skill` 的角色有意义。

### 7.2 软约束性质

这是一条**软约束**而非硬隔离：目录可见性是 DSH 机制（按 cwd 收集、对角色全量可见），persona 引导句只是提示。硬隔离靠工具面（allow 里有没有 `skill`）实现。主 agent 例外：其注册层 deny 了 `skill`（见 3.1），所以技能对其不可见——需要时走 `main_agent_skills` / `main_agent_skills_inline`（第 4 节），而不是 `skills` 键。

技能候选的扫描范围随配置对象走：全局视角只含用户级技能；工作区视角另含该工作区目录下的项目级技能（面板里带「项目」角标），见 9.5。

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

停用 tavily / codegraph / magic-memory（在 `~/.dsh/cordis.patch.yml` 或 profile patch 注释相应条目）后**不需要手动改 allow**：在「庖丁配置」点一次「保存并应用」，生成器检测到停用后自动把对应 `mcp__tavily__*` / `memory_search` 从三角色 allow 剔除（「预览生成」可先看剔除项）。检测不到或握手失败的 MCP 会被跳过：对应角色只是缺这些工具，应用不报错。检测与 patch 层的细节链见 [安装](installation.md)。

## 9. 按工作区配置

### 9.1 一份全局，各自成套

DSH 用工作区（workspace，即项目目录）组织会话。顶层 `workspaces` 键让每个工作区有自己的主/子 agent 配置：全局条目照旧生成共享的 `orchestrator` 预设；工作区条目各自生成 `orchestrator-<slug>` 专属预设，预设列表里并存、互不覆盖。

每个工作区条目是**完整一套配置**，不是增量差异：字段与顶层同构（`profile` 除外，检测层全局共享）。角色子键照搬——`background_mode`（见 2.6）同样按工作区生效：某个项目想让 implement 可续、别的项目保持一次性，各配各的。在面板里第一次配置某个工作区时，以当前全局配置为起点，改完点「保存并应用」即生成该工作区的预设。

```yaml
workspaces:
  '/Users/me/code/shop-api':      # 键 = 工作区目录绝对路径（写入时归一，恒带引号）
    main_agent_display_name: 店铺后端主控   # 仅该工作区预设的显示名
    roles:
      implement:
        model: deepseek-reasoner  # 这个项目写代码用推理档
  '/Users/me/code/blog':
    roles_remove: [design]        # 写博客的项目不需要设计帮手
```

### 9.2 预设命名规则

- **slug** 取工作区目录名：小写、非法字符归并为 `-`；归并后为空、或恰好叫 `orchestrator`（与全局预设撞名）时改用 `ws`。
- 多个工作区目录同名时，自动追加路径哈希（sha1 前 6 位）后缀，如同为 `Shop` 的两个项目得到 `orchestrator-shop-acd95b` 与 `orchestrator-shop-34b6aa`——改名或挪动目录后重新应用即可，旧预设目录不会被自动清理，不再需要的可在 DSH 预设页删除。
- 预设显示名：条目配了 `main_agent_display_name` 就用它；没配则在默认名后缀「·目录名」（如 `编排模式 (Orchestrator)·Shop`），预设列表里一眼可辨。

### 9.3 面板用法

「庖丁配置」页面顶部是**配置对象**标签页：

- **全局默认**：编辑并写入共享的 `orchestrator` 预设，行为与从前完全一致；
- **工作区标签页**：列表来自宿主工作区注册表（开过会话的目录才会登记），带绿点的表示预设已生成，悬停可见路径、会话数与预设 id；
- **添加工作区**：输入目录绝对路径即注册（幂等），注册表拉不到时降级为只显示配置文件里已有的工作区，面板其余功能不受影响。

选定某个工作区后，预览 / 应用都只作用于它；应用成功的提示里会给出预设 id。

### 9.4 生效方式与边界

- **预设选择发生在新建会话时**：新建会话界面选好工作区后，在预设选择器里选对应的 `orchestrator-<slug>`。全局默认预设不受任何影响。预设生效需要新会话（或 DSH 重启后可见）。
- 预设目录落在 `$DSH_HOME/.agent-presets/` 下，全机共享：同一台机器上不同项目各起的 DSH 实例，因 slug 不同互不覆盖。
- 兜底 CLI 本次仍只作用于全局条目；`workspaces` 段在 CLI 应用后原样保留，不会被冲掉。
- 运行中的会话不会换预设——子 agent 的角色与工具面在会话创建时随预设组装定型，会话内不可变；要换套班底，开新会话选新预设。

### 9.5 技能扫描范围随配置对象走

技能候选不跟随 GUI 的启动目录：**全局默认**视角只扫用户级两根（`~/.dsh/skills`、`~/.agents/skills`），**工作区**视角另加该工作区目录下的 `.dsh/skills` 与 `.agents/skills`。于是：

- 只装在某个项目里的技能（比如知识库项目里的 `bento-slides`），在全局配置里不可见、配不上；选中那个工作区后出现在技能网格里，带「项目」角标，可分配给该工作区预设的主 agent 或角色。
- 生成时技能解析同口径：工作区预设能写出项目级技能的 SKILL.md 绝对路径（主 agent 用 `read` 按需读，路径在盘上就能读）；全局预设只解析用户级，配了项目级技能名会告警跳过——全局预设要在所有项目通用，引用单一项目的技能本就不该写进去。
- 兜底 CLI 没有工作区概念，只扫用户级两根（与全局默认一致）。
