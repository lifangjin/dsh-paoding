← [dsh-paoding](../README.md) ｜ **安装** ｜ [架构](architecture.md) ｜ [编排](orchestration.md) ｜ [配置](configuration.md)

[中文](installation.md) · [English](installation_en.md)

# 安装

本文面向要安装、升级或卸载 dsh-paoding「编排模式 (Orchestrator)」预设的用户：第 1 节前置要求，第 2 节唯一官方安装通道（`dsh plugin add`）与首装自动化，第 3 节升级，第 4 节开发检出自装，第 5 节生成时的 host patch 检测机制，第 6 节「庖丁配置」面板，第 7 节卸载，第 8 节常见问题。

## 1. 前置要求

安装前请确认以下各项：

- **Node.js ≥ 18**。DSH host 与插件链路都跑在 Node 上；版本过低时 `dsh` 本身就起不来。可用 `node --version` 自查。
- **pnpm 可用**。`dsh plugin` 是 pnpm 的透明转发器：插件包装进 profile 时由 pnpm 完成。缺失时安装命令会报 pnpm 相关错误，装好 pnpm（`npm i -g pnpm` 或 `corepack enable`）后重试。
- **已安装 DSH host**（`dsh` 可用，含其 Web/agent 运行时；**@deepseek-ai/dsh 0.1.5 – 0.1.7-rc.1** 全支持，安装器自动适配两代预设机制，详见第 2 节「版本支持与预设落点双轨」）。本插件不改 DSH 源码，只往 DSH 的 preset roster 写入编排预设、并把「庖丁配置」面板挂进 Web 左侧栏，因此先要有可用的 DSH 家目录。
- **路径事实**（生成管线内建常量，写死前先了解它们）：

| 项 | 默认值 | 说明 |
|---|---|---|
| `$DSH_HOME` | `~/.dsh` | DSH 家目录（认环境变量 `DSH_HOME`，缺省 `$HOME/.dsh`）。host 层配置 `cordis.patch.yml`、`node_modules`、`profiles/<name>/cordis.patch.yml`、插件 profile 目录都在其下 |
| preset roster 根目录 | `$DSH_HOME/.agent-presets/` | DSH ≤ 0.1.6 由 `dsh-agent-presets` 扫描此目录发现本地 authored presets；DSH ≥ 0.1.7 宿主不再扫目录，此目录退为预设文件存放处（见第 2 节「版本支持与预设落点双轨」） |
| 本预设安装目标 | `$DSH_HOME/.agent-presets/orchestrator` | 生成产物：`agent.cordis.yml`（重写后的角色配置）、`preset.yml`、`restrict.mjs`、`.generator-version` 版本标记，是一个静态目录；按工作区配置生成的预设落同一父目录下的 `orchestrator-<slug>` |
| 声明行托管块（仅 DSH ≥ 0.1.7） | `$DSH_HOME/cordis.patch.yml` 内的托管块 | 以 `# --- dsh-paoding presets (auto-generated; do not edit) ---` 起始、配套 end 标记收尾，块内 `- insert:` 写 `@deepseek-ai/dsh-agent-preset` 声明行；安装器自动维护，详见第 2 节 |
| 配置文件 | `$DSH_HOME/dsh-paoding.config.yml` | 「庖丁配置」面板「保存并应用」写入的角色与工具分配（`0o600`，可手编）；首装自动化同样读写它 |

- **环境变量**：`DSH_HOME` 覆盖 DSH 家目录（默认 `~/.dsh`）；`DSH_PAODING_CONFIG` 覆盖配置文件路径（面板认它；仓库内兜底 CLI 则用 `--config <file>` 指定）。

仓库内 `presets/orchestrator/` 是静态预设源（生成管线读取并重写 `agent.cordis.yml`；`preset.yml`、`restrict.mjs` 原样复制——唯一例外是配置了 `main_agent_display_name`（或工作区派生显示名）时会改写 `preset.yml` 的 `name:` 行），`tools/` 是生成器本体（面板与兜底 CLI 共用），`plugins/paoding-config-ui/` 是「庖丁配置」面板插件本体。只想正常使用的话，这些都不用碰——见下一节。

## 2. 安装：唯一官方通道

不用克隆仓库，一条命令 + 一次重启：

```bash
dsh plugin --profile web add dsh-paoding
```

等价捷径：`npx dsh-paoding@latest`（内部转成上面这条命令，默认 profile web，需本机已装 dsh）。

装完**重启 DSH（`dsh web`）**即可用——不需要再跑任何安装命令、点任何按钮。

这条命令背后是两步：

1. `dsh plugin` 作为 pnpm 透明转发器，把 npm 包 `dsh-paoding` 用 pnpm 装进指定 profile 的 `node_modules`；
2. 包根声明的 `dsh.bundle.patch`（一份 `cordis.patch.yml`，一行 insert：`id: paoding-config-ui` / `name: dsh-paoding`）由 `reconcilePlugins` 并入该 profile 的启动层，boot 时把「庖丁配置」面板挂进 Web 左侧栏底部动作条（设置行上方）。

编排预设不用单独装——插件启动时会自动补上，见下面的首装自动化。

### profile 语义

`--profile web` 决定插件装进哪个 profile：「庖丁配置」面板只在以该 profile 启动的 DSH Web 里出现。`web` 是 `dsh web` 的默认 profile，多数机器无需改动；多 profile 用户对每个需要的 profile 各执行一次 `dsh plugin add`。编排预设本体落在 `$DSH_HOME/.agent-presets/`，全机共享、不随 profile 走——DSH ≥ 0.1.7 的声明行写在 home 层 `$DSH_HOME/cordis.patch.yml`，同样与 profile 无关——在任何 profile 的面板里「保存并应用」，写的都是同一份预设。

### 版本支持与预设落点双轨（DSH 0.1.5 – 0.1.7-rc.1）

本插件兼容两代宿主：**DSH 0.1.5 / 0.1.6 / 0.1.7-rc.1 全部支持**，安装与使用流程完全一致。插件 0.3.4 起，package.json 显式声明 `peerDependencies: @deepseek-ai/dsh >= 0.1.5`——0.1.7 起宿主装插件前做兼容性预检，无声明等于默认放行，显式声明后按真实兼容面把关；0.1.5 / 0.1.6 不读这个字段，声明纯属元数据，不影响安装。

两代宿主发现「本地 authored preset」的机制不同，安装器据此分双轨落点，宿主检测全自动、用户无感：

- **目录轨（DSH ≤ 0.1.6）**：宿主扫描 `$DSH_HOME/.agent-presets/` 下的目录来发现 preset，目录即注册。安装器照旧把产物写成 `$DSH_HOME/.agent-presets/orchestrator/`（`agent.cordis.yml` + `preset.yml` + `restrict.mjs`）；按工作区配置生成的预设落同目录下的 `orchestrator-<slug>`。
- **声明行轨（DSH ≥ 0.1.7）**：宿主不再扫目录，改为读取 patch 里的 `@deepseek-ai/dsh-agent-preset` 声明行。安装器在 `$DSH_HOME/cordis.patch.yml` 里维护一个托管块——以 `# --- dsh-paoding presets (auto-generated; do not edit) ---` 起始、以配套的 end 标记收尾——块内用 `- insert:` 写声明行：全局预设 `config.id: orchestrator`，工作区预设 `config.id: orchestrator-<slug>`，各自的 `plugins` 内联全部插件行；`restrict.mjs` 以绝对 `file:` URL 引用。产物三件套仍落在 `.agent-presets/<id>/`，只是从「目录即注册」变成「文件存放处」。托管块之外的用户内容一字节不动；块内带 do not edit 标记，手改块内内容会在下次保存时被覆盖。

安装器按下面的顺序判定走哪条轨：

1. Web 面板运行时探测优先——`agentPresets` 服务的 `register` 方法 0.1.7 才有，探测到即在声明行轨；
2. CLI 侧 `dsh --version`；
3. 兜底探测 `$DSH_HOME/node_modules/@deepseek-ai/dsh-agent-preset`（这个单数包在，即为 0.1.7+）；
4. 都失败时默认按 ≤ 0.1.6 处理（安全侧）。

宿主版本变化后的首次保存/自愈会自动迁移，双向都不用手动干预：

- **降级自愈（0.1.7 → 0.1.6）**：0.1.6 不认识声明行，声明行留在 patch 里会让 profile 启动失败——安装器自动撤下 home patch 里的托管块；目录轨产物本就齐全，预设无缝回到目录扫描。
- **升级迁移（0.1.6 → 0.1.7）**：安装器自动补写托管块；`.agent-presets/` 里按旧轨生成的 preset 会话（`agentPreset: orchestrator`）在新轨下按 `config.id` 继续对上，老会话恢复不断档。

另有两处跨版本行为对齐，同样自动完成、无需用户动作：

- **摘要预算**：0.1.7 起宿主把 compaction 的 `maxTokens` 默认升到 65536；本 preset 对 `dsh-compaction-basic` 显式钉 `maxTokens: 8192`，0.1.5 / 0.1.6 的摘要预算行为原样保持，两代宿主上一致。
- **面板图标**：0.1.7 改了 ui-primitives 的图标命名，面板图标已做跨版本兜底，同一 bundle 在两代宿主上都能正常渲染；面板功能在两代宿主上一致。

### 首装自动化：重启即完整安装

插件启动时自动检测编排预设是否就位：`$DSH_HOME/.agent-presets/orchestrator` 目录缺失，或其中的 `.generator-version` 标记与插件包版本不符时，自动执行一次等价 `--auto` 的安装——`~/.dsh/dsh-paoding.config.yml` 已存在就按配置应用；没有就写基础模板（只含 DSH 自带的基础工具，见下）。它走的是与面板「保存并应用」同一条检测/生成管线（`collectState` / `generateAndInstall`）——同一管线，但启动自愈的检测是纯文件扫描、不带运行时检测事实，面板则带；host 上装有 bundle 形态插件时，两者的检测库存可能不同，产物随之略有差异。

所以 **`dsh plugin add` + 重启 = 完整安装**：预设生成、配置模板落盘、面板可点，一步到位。自动生成失败不会拖垮插件启动——只在 DSH 日志里记一条告警，可到面板手动「保存并应用」补上。启动自愈同时负责双轨落点的维护与跨版本迁移——宿主在 0.1.6 与 0.1.7 之间升级、降级后，首次自愈会自动补写或撤下 `$DSH_HOME/cordis.patch.yml` 里的托管块（见上节「版本支持与预设落点双轨」）。

### 版本标记与自动重生成

`.generator-version` 标记（内容 = 生成器版本）由插件启动自愈在生成 preset 后写入。面板「保存并应用」与兜底 CLI 的生成走整目录重建、不写回标记——重建即移除旧标记，下次 DSH 启动自愈发现标记缺失会多补跑一次生成并重写标记（产物相同，只是多跑一轮）。版本不符触发重生成的语义不变：插件升级后标记与包版本不符，下次 DSH 启动自动按新版重生成，「升级后 preset 还是旧版产物」的漂移就此消除。标记只在缺失或版本不符时触发重生成，面板不监视配置文件改动；想立刻按当前配置重新生成，点面板「保存并应用」。

### 基础模板与工具勾选

全新安装（无配置文件）生成的基础模板只含 DSH 自带的基础工具——主 agent 21 项核心工具，加各委派角色的基础工具集；检测到的 host/MCP 工具**默认不写入**。检测管线照常运行：点开左侧栏「庖丁配置」，候选清单列出全部已识别工具，按需勾选后点「保存并应用」即可。

### 应用与生效

安装完成后：

1. **重启 host，或新建一个会话**（预设在新会话创建时装载；预设选择器按新会话刷新）。
2. 在**新会话的预设选择器**里选「**编排模式 (Orchestrator)**」。
3. 想让它成为每次新会话的默认预设：**Settings → Agent Presets** 里设置默认。

**手编配置后怎么应用**：打开左侧栏底部动作条（设置行上方）的「庖丁配置」入口——面板会把手编后的配置文件加载为当前值——然后点「**保存并应用**」。这是纯插件用户唯一的应用触发；版本标记只在新版时自动重生成，面板不会盯着配置文件的变化。

## 3. 升级

**面板一键升级（推荐）**：面板自动对比 npm registry 上的最新版本（GitHub release 兜底），发现新版就地提示并附上发布页链接。点「升级」按钮，面板就地执行：

```bash
dsh plugin --profile <name> update dsh-paoding
```

（profile 自动探测，通常无需手填。）升级只换 profile 里的插件包本体，当前进程的代码不变；成功后提示**重启 DSH**，重启时 preset 按 `.generator-version` 标记自动按新版重生成。

手动升级等价：直接在终端跑上面这条 `dsh plugin update` 命令，同样重启生效。

**开发 link 形态**（见第 4 节）版本比较照常（更新卡有新版照常提示），但无法就地升级——升级器要求包真实装在某个 profile 的 node_modules 下，link 直连仓库匹配不到；点「升级」会如实报这一点，并提示手动跑 `dsh plugin add dsh-paoding@latest` 切回 registry 版。

检测失败（断网、限流）时静默跳过，不影响任何使用。

## 4. 开发自装（link: 形态）

要改插件或预设源码时，把插件以 link 形态指向仓库（pnpm link 语义）：

```bash
git clone https://github.com/lifangjin/dsh-paoding.git
cd dsh-paoding
dsh plugin --profile web add link:"$PWD"
```

包直接落在仓库目录上，改动经 HMR 或重启生效，无需反复重装。此形态无法就地升级（见第 3 节）；想切回 registry 版，`dsh plugin --profile web add dsh-paoding@latest` 即可。

**仓库内兜底 CLI**（不宣传，仅限克隆了仓库的开发者）：`node tools/install.mjs --auto`（有配置应用配置，没有写基础模板）、`--dry-run`（只打印检测报告与将生成的 allow，不写盘）、`--config <file>`（指定配置文件）、`--suggest`（fresh 安装无配置时按智能默认分配 host 工具；默认基础模板不写 host 工具）、`--profile <name>`（指定扫描哪个 profile 的 patch 层，默认 `web`）。不带 `--auto`（且非只读的 `--dry-run`）会被拒绝并提示——交互式安装已移除，可视化配置一律走插件通道自带的 Web 面板。

## 5. host patch 检测机制

生成管线做检测的根本原因：DSH 在子 agent 创建时执行 `tools.restrict()`，**allow 名单里的名字必须存在于子 agent 可见的注册面内**，否则创建被拒（unknown tools）。注册面里唯一随机器变化的部分就是 host patch 层，因此生成器不写死 allow，而是在生成时读取 patch 层、检测**实际启用**的工具，用「配置/静态意图 ∩ 实际检测到的工具」重写三个默认角色（`search_external` / `design` / `implement`）以及你新建的自定义角色的 `toolFilter.allow`——这样生成的 preset 永不因 host 工具停用而过期。

### 读取的 patch 层

按序**全部纳入**（检测把各层里已启用的条目做并集）：

| # | 层 | 路径 | 缺失时 |
|---|---|---|---|
| 1 | home 层 | `$DSH_HOME/cordis.patch.yml` | 不存在则跳过 |
| 2 | profile 层 | `$DSH_HOME/profiles/<profile>/cordis.patch.yml` | 不存在则跳过（默认 profile = `web`） |
| 3 | 额外覆盖 | `--patch <file>`（可重复；兜底 CLI 参数） | 报 warning 并跳过 |

### MCP 与本地插件的检测

- **启用判定**：patch 条目未被禁用（`enabled !== false` 且无 `disabled`）即视为启用；插件另查 `config.enabled`。
- **MCP 服务器识别**：条目名的包名段**精确等于** `dsh-mcp-client`（scoped/子路径形式按 `/` 取末段比对，`not-dsh-mcp-client-foo` 这类不会误判），或配置含 `serverName` 且 transport 为 `stdio` / `streamable-http` / `sse`（或有 `command`）。
- **精确工具名解析**（`toolFilter.allow` 是精确名匹配、不支持 glob，名字必须拼全）：检测顺序是**所有 `stdio` / `streamable-http` 服务器一律先实时 JSON-RPC 握手**（stdio 拉起进程发 `initialize` + `tools/list`；streamable-http 走 POST；**15 秒超时**），把返回的工具名解析成 `mcp__<server>__<tool>`；静态已知表（`tavily` → 5 个工具 `tavily_search` / `tavily_crawl` / `tavily_extract` / `tavily_map` / `tavily_research`，`codegraph` → `codegraph_explore`）只是已知服务器**握手失败时的降级兜底**——工具按表保留，报告标注 static table，不丢工具；未知服务器握手失败才整服务器跳过。
- **本地工具插件**：按白名单匹配 patch 条目名并登记其工具，如 `magic-memory` → `memory_search`（新增插件需扩展白名单，见 `tools/lib/host.mjs` 的 `KNOWN_HOST_PLUGINS`）。
- **跳过不报错**：「握手失败、超时、`sse` 等不支持实时发现的服务器被跳过」只适用于**未知服务器**——整服务器跳过，对应角色只是缺这些工具，生成不报错（报告里会标注 `handshake failed` 及原因，URL/密钥会被打码）；已知服务器握手失败回落静态表、工具保留，不在此列。

### allow 重写规则

对每个被重写的角色：allow 里的名字按**白名单**对账，必须落在 **preset 自带工具面**（`restrict.mjs` 主 agent 白名单 ∪ 源 preset 各角色静态 allow）或**检测库存**之一，两头都不占的名字（插件停用后残留的 `mnemon_*`、拼写错误等）一律剔除，「预览生成」/兜底 CLI 报告的 removed 列表会给出原因。其中 **host 依赖名**（`mcp__*` 与已知插件工具）即便写在源 preset 里，也必须真实检测到才保留；`mnemon_*` 这类插件直注册、无 `mcp__` 前缀的工具同样按检测库存对账；standard 组合保证的核心工具（read/write/edit/glob/grep/bash/skill/web_search 等）本就在 preset 自带面内，不依赖检测直接保留。结果 = 配置意图 ∩ 实际启用工具：停用的 host 工具名自动剔除，保证 `tools.restrict()` 永不报 unknown tools。主 agent 侧同理：`restrict.mjs` 的 base allow 里 host 依赖名按检测结果过滤，`main_agent_extra` 追加的 host 工具与自定义角色 toolName 注入 `config.allow`，`main_agent_remove` 剔除（移除结果为空列表会**拒绝安装**，防止运行时空 allow 拒载）。静态 preset 中不由生成器重写的其它委派行（如 `search_internal_deep`）原样保留。

**重新应用的时机**：改动了 patch 配置（启用/停用 MCP 服务器或插件、增删额外 patch 文件）后，到「庖丁配置」点一次「保存并应用」同步 allow——想先看将发生的剔除清单，点「预览生成」，或用兜底 CLI 的 `--dry-run`。兜底 CLI 还会比较 patch 文件与上次生成结果的时间戳，发现 patch 更新过会打印提醒。

### 解析与校验

patch 与配置文件用 **`yaml` 包**解析——通过 `createRequire` 从 `$DSH_HOME/node_modules` 惰性加载（该目录由 dsh host 管理、含 profile 安装，自带 yaml v2）；不可用时回退到**内置的极简 YAML 子集解析器**（要求顶层为列表/映射，支持常见标量与 `- insert:` 包裹）。解析前会先中和真实 patch 文件里的 cordis `!!js` 表达式（`process.platform` / `process.cwd()` 换成求值结果）。源 `agent.cordis.yml` 里角色 allow/persona 块的定位优先用 yaml AST 的字节范围（保缩进、精确替换），失败则回退结构化正则；生成结果写盘前先做一次 YAML 结构校验（`!!js` 占位后解析），结构错误直接拦下、不写盘。

### 典型示例

例 1——停用 tavily：在 `$DSH_HOME/cordis.patch.yml` 注释掉 tavily 的挂载行后，到「庖丁配置」先点「预览生成」——`search_external` 的 allow 会剔除 5 个 `mcp__tavily__*`，报告列出 removed 与原因（如 "tavily MCP 未启用"）；确认后点「保存并应用」（开发者也可用兜底 CLI：`node tools/install.mjs --dry-run` 预览、`--auto` 应用）。

例 2——插件停用：停用 magic-memory 后重新应用一次，各角色 allow 中的 `memory_search` 自动剔除；此后想恢复就重新启用插件再应用。

例 3——额外的 patch 文件（仅限兜底 CLI，克隆仓库的开发者）：把额外的 MCP/插件配置放独立文件，检测时用 `--patch <file>` 一并纳入（不必动 home/profile 层文件）；面板检测只读 home/profile 两层，无对应入口。

## 6. 庖丁配置面板

不想手编 `dsh-paoding.config.yml` 的话，点开左侧栏底部动作条（设置行上方）的**「庖丁配置」**入口进入整页配置。它与首装自动化、兜底 CLI 共用同一条检测/生成管线（`collectState` / `generateAndInstall`），所见即所得；面板随插件通道自带，装好插件就有，无需另外挂载。

### 加载机制

- cordis 经 profile 目录的 `node_modules` 解析 patch 行里的包名 `dsh-paoding`；
- DSH 的 client-modules 节点半扫描该包 `package.json` 的 `dsh.client` 声明与 `exports["./client"]`，把 `lib/client.js` 编入浏览器的 `__DSH_BOOT__`（以 `/plugins/paoding-config-ui/client.js` 下发）；
- 浏览器内核为清单里的每个插件创建 loader 条目并激活（bundle 以 `window.__ModuleLoader__.load({ id: "paoding-config-ui", factory })` 注册，id 等于 patch 行的 id）；
- 客户端 `apply()` 把「庖丁配置」入口经宿主 `sidebar.footer.action` 键控槽注册（`slots.register`，与插件广场 cordis 徽章同槽位，渲染在设置行上方的动作条里），不自行 DOM 注入侧栏；MutationObserver 仅用于工作区「…」菜单桥接（认出菜单 DOM、注入「庖丁配置」深链入口）。点击后容器（`data-dsh-paoding-view`）挂进会话中栏、`createRoot` 渲染整页配置页，打开态由 `html[data-dsh-paoding-active]` 驱动，与记忆系统 / taskboard / ssh 等全页面板互斥。

### 数据接口与安全

面板数据走**同源 `/api/paoding/*`**：Node 侧注册前缀路由——`GET /api/paoding/state`（带缓存的检测状态）、`GET /api/paoding/version`（最新版检测，版本/更新卡的数据源）、`GET /api/paoding/models`（宿主模型运行时的模型清单）、`GET` + `POST /api/paoding/workspaces`（工作区列表 / 添加工作区）、`POST /api/paoding/rescan`（强制重检测，含 MCP 握手）、`POST /api/paoding/preview`（不写盘生成）、`POST /api/paoding/apply`（安装并保存配置）、`POST /api/paoding/upgrade`（就地 `dsh plugin update`）、`GET /api/paoding/client.css`（面板样式静态下发）——复用 `tools/` 的检测与生成管线（`plugins/paoding-config-ui/api-core.mjs`）。路由自带**浏览器信任围栏**：Host 必须回环或落在 `webRuntime.trustedHosts`，并拒绝 cross-site 请求（复刻 DSH `/api` 网关围栏语义，因为 `/api/paoding` 前缀更长会命中本插件而绕开网关）。面板**没有独立服务端/端口**：DSH Web 端口只监听 `127.0.0.1`，不对外网暴露。

### 面板能力

- **状态与操作**：页头是标题 + 版本/更新卡（新版就地提示与一键升级）+ 副标题，正文直接就是工作区与角色卡，没有单独的检测摘要与 chips 区；操作按钮「**保存并应用**」「预览生成」「重新检测」固定在面板底部悬浮操作坞（sticky bottom），滚动任意位置都可直接点击。
- **Agent 工具分配卡片**：主 agent 一张固定卡（基础工具取消勾选 = 加入 `main_agent_remove` 从主 agent 剔除；MCP / 插件工具勾选 = 加入 `main_agent_extra`；技能「read 按需」与「内联全文」两组勾选；另有「人设追加」编辑区，可改、清空、恢复默认）＋ `search_external` / `design` / `implement` 三张内置角色卡 ＋ 任意自定义角色卡（带删除按钮）；每张角色卡把工具按「基础工具 / MCP 工具 / 插件工具」三组呈现、可逐项勾选，并可编辑 persona。底部「新建自定义 agent 角色」。
- **技能分配**：每个 skill 一行，勾选分配给哪些 agent（写入对应 persona 的 `Available skills` 软引导；角色技能软引导，主 agent 技能另有 read 按需/内联两组）。
- **预览生成**：不写盘生成 `agent.cordis.yml`，显示每个角色 allow 的 intent → kept 计数与生成全文。
- **保存并应用**：确认后写入 preset（覆盖 `$DSH_HOME/.agent-presets/orchestrator`）并按宿主版本同步登记——≤ 0.1.6 目录扫描即生效，≥ 0.1.7 同步维护 `$DSH_HOME/cordis.patch.yml` 里的声明行托管块（见第 2 节）——再把当前分配保存到 `$DSH_HOME/dsh-paoding.config.yml`；应用成功后提示重启 DSH 或新建会话生效（检测到 patch 比生成结果新时提示重启后生效）。打开面板时会加载既有配置文件作为当前值——手编过的选择直接可见、可改。

## 7. 卸载

三条命令，删得干干净净：

```bash
dsh plugin --profile web remove dsh-paoding
rm -rf "${DSH_HOME:-$HOME/.dsh}/.agent-presets/orchestrator"
rm -rf "${DSH_HOME:-$HOME/.dsh}/.agent-presets"/orchestrator-*
```

第一条摘掉插件与侧栏面板（只影响指定 profile），第二条删掉编排预设目录，第三条清掉按工作区配置时生成的各工作区预设目录（`orchestrator-<目录名>`；没用过按工作区配置就没有这类目录，通配不命中、无害）——基础 `orchestrator` 目录已由上一条命令删掉，不含在这个通配里。配置文件 `~/.dsh/dsh-paoding.config.yml` 不随之上删——留着或删掉都不影响 DSH 其它配置，重装时首装自动化会再次按它应用。

宿主为 DSH ≥ 0.1.7 时再多看一眼：`$DSH_HOME/cordis.patch.yml` 里可能还留着 dsh-paoding 托管块（起止标记注释包着 `- insert:` 声明行）。预设目录删掉后，块内声明行就成了指向已删目录的悬空引用，请把整个托管块（从 `# --- dsh-paoding presets (auto-generated; do not edit) ---` 起始行到 end 标记行）一并删去——块外内容不受影响。

卸载不影响 host 的其它内容（MCP、插件、会话等），与 DSH 源码零耦合；之后新建会话时「编排模式 (Orchestrator)」不再出现在预设选择器里。

## 8. 常见问题与排查

**pnpm 缺失**

`dsh plugin add` 报 pnpm 相关错误：`dsh plugin` 依赖 pnpm 装包。`npm i -g pnpm`（或 `corepack enable`）装好后重试。

**装了插件，预设列表里却没有「编排模式 (Orchestrator)」**

预设由插件启动时自动生成：先确认装完后**重启过 DSH**；预设在新会话创建时装载，重启后还要新建一个会话才会出现在选择器里。仍没有就查 DSH 日志里 `paoding-config-ui` 的告警（自动生成失败会记日志，可到面板手动「保存并应用」补上），再检查 `ls "${DSH_HOME:-$HOME/.dsh}/.agent-presets/orchestrator"`——目录为空多半是插件运行时的 `$DSH_HOME` 与你以为的家目录不一致（启动 DSH 前显式 `export DSH_HOME=…`）。目录在、宿主又是 0.1.7+ 而选择器里仍没有时，再查 `$DSH_HOME/cordis.patch.yml` 里有无 dsh-paoding 托管块——0.1.7 靠块内声明行发现预设，缺块就到面板点一次「保存并应用」补写（见第 2 节「版本支持与预设落点双轨」）。

**`tools.restrict()` 报 unknown tools / 子 agent 创建被拒**

allow 名单里出现了子 agent 注册面上不存在的名字——最常见原因是启用/停用了 MCP 服务器或插件之后**没有重新应用**。到「庖丁配置」点「保存并应用」同步（想先看剔除清单就点「预览生成」）；手写进 allow 的未安装工具名同样会触发。

**侧栏没有「庖丁配置」入口**

先确认插件装在当前 DSH 实际使用的 profile 里（`dsh plugin add` 时的 `--profile` 值），且装完重启过 DSH——面板按 profile 生效，装在 `web` 以外的 profile 时，要用那个 profile 启动 DSH 才能看到。都正常仍没有，查启动日志里插件是否加载成功。

**角色里少了某个 MCP 工具**

检测时所有 stdio / streamable-http 服务器都先实时握手：未知服务器握手失败会被整服务器跳过（报告标注 `handshake failed`），对应角色只是缺这些工具，生成不报错；已知服务器（tavily、codegraph）握手失败会回落静态表、工具保留，报告标注 static table——看到该标注说明检测时连不上该服务器、表里的工具面可能过时。检查该服务器能否独立启动/连通后重新应用。

**技能没写进 persona**

技能可以分给任意角色——生成层会为每个被分配的角色在 persona 里追加 `Available skills:` 软引导行；但角色要真正加载技能，得自备 `skill` / `read` 工具（没带 `skill` 工具的角色分了技能，也只是一行引导，不会实际装载）。主 agent 技能走 `main_agent_skills`（软行）或 `main_agent_skills_inline`（内联）。找不到 SKILL.md（按配置对象对应口径查找：全局只查用户级两根，工作区另查该工作区目录的项目级根，见配置指南第 9 节）会被警告并跳过——确认 skill 已装在对应根目录之一。

**手编了配置文件，怎么让它生效**

打开左侧栏底部动作条（设置行上方）的「庖丁配置」入口（面板会把手编后的配置文件作为当前值加载），点「保存并应用」。面板不监视配置文件改动，手编不会自动生效；版本标记也只在新版时才触发自动重生成。

**配置文件在哪里**

面板「保存并应用」写到 `$DSH_HOME/dsh-paoding.config.yml`（默认 `~/.dsh/dsh-paoding.config.yml`，可用环境变量 `DSH_PAODING_CONFIG` 改到别处；兜底 CLI 用 `--config <file>`）。想重置全部选择：删除该文件后重启 DSH，首装自动化按无配置处理、写回基础模板。

**旧版 npx/npm 安装的残留怎么清理**

已发布的 0.2.x 及更早版本支持 `npx dsh-paoding` 直装：整包复制到 `~/.dsh/dsh-paoding`，并往全局 `~/.dsh/cordis.patch.yml` 写 `paoding-config-ui` 挂载行（npx/npm 形态）或建立 `~/.dsh/node_modules/paoding-config-ui` 符号链接（克隆形态）。新版的挂载统一走 plugin 通道，不再使用这些位置（如今的 `npx dsh-paoding@latest` 只是转成 `dsh plugin add` 的捷径，也不写这些位置）。清理：

```bash
rm -rf ~/.dsh/dsh-paoding                  # 旧 npx/npm 形态复制的整包目录
rm -f ~/.dsh/node_modules/paoding-config-ui   # 旧克隆形态的符号链接
# 再删掉 ~/.dsh/cordis.patch.yml 里 id: paoding-config-ui 的挂载段（三行）
```

改完重启 DSH。若侧栏因此出现重复入口，也按此清理即可——现在只有 plugin 通道一种挂载来源。
