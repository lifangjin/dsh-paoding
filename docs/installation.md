← [dsh-paoding](../README.md) ｜ **安装** ｜ [架构](architecture.md) ｜ [编排](orchestration.md) ｜ [配置](configuration.md)

[中文](installation.md) · [English](installation_en.md)

# 安装

本文面向要安装、升级或卸载 dsh-paoding「编排模式 (Orchestrator)」预设的用户：第 1 节前置要求，第 2 节 npx 一键安装与 dsh plugin 官方插件通道（装配置 UI），第 3 节交互向导安装，第 4 节非交互/配置驱动安装，第 5 节安装时的 host patch 检测机制，第 6 节应用、设为默认、升级与卸载，第 7 节可选的设置页可视化配置器，第 8 节常见问题。

## 1. 前置要求

安装前请确认以下各项：

- **Node.js ≥ 18**。`install.sh` 启动时会检查 `node` 是否在 PATH 中（缺失时报 `error: node (>=18) is required…` 并退出）。安装器（`tools/install.mjs`）只用 Node 内置模块，零运行时依赖——**克隆后无需 `npm install`**，`./install.sh` 直接可用（也可等价地跑 `node tools/install.mjs`）。
- **已安装 DSH host**（`dsh` 可用，含其 Web/agent 运行时）。本工具不修改 DSH 源码，只往 DSH 的 preset roster 与 patch 层写入内容，因此先要有可用的 DSH 家目录。
- **路径事实**（安装器内建常量，写死前先了解它们）：

| 项 | 默认值 | 说明 |
|---|---|---|
| `$DSH_HOME` | `~/.dsh` | DSH 家目录（`install.sh` 与 `install.mjs` 都认环境变量 `DSH_HOME`，缺省 `$HOME/.dsh`）。host 层配置 `cordis.patch.yml`、`node_modules`、`profiles/<name>/cordis.patch.yml` 都在其下 |
| preset roster 根目录 | `$DSH_HOME/.agent-presets/` | `dsh-agent-presets` 扫描本地 authored presets 的目录 |
| 本预设安装目标 | `$DSH_HOME/.agent-presets/orchestrator` | 安装产物：`agent.cordis.yml`（重写后的角色配置）、`preset.yml`、`restrict.mjs`，是一个静态目录 |
| 配置文件 | `$DSH_HOME/dsh-paoding.config.yml` | 向导/配置 UI 保存的角色与工具分配（`--config` 可指定其它路径） |
| 本包副本（npx/npm 安装） | `$DSH_HOME/dsh-paoding` | npx/npm 入口安装时，安装器把整包复制到这个稳定位置，配置 UI 从这里挂载（见第 2 节） |

- **拿到源码**：克隆仓库后进入目录（只想用第 2 节的 npx 一键安装，这步可以跳过）：

```bash
git clone https://github.com/lifangjin/dsh-paoding.git dsh-paoding
cd dsh-paoding
```

仓库内 `presets/orchestrator/` 是静态预设源（安装器读取并重写 `agent.cordis.yml`，原样复制 `preset.yml`、`restrict.mjs`），`tools/install.mjs` 是安装器本体，`install.sh` 是薄 shell 包装，`plugins/paoding-config-ui/` 是可选的可视化配置器插件（见第 7 节）。

## 2. npx 一键安装

最省事的入口：不用克隆仓库，一条命令装完（npm 发布后可用）：

```bash
npx dsh-paoding@latest
```

npm 还没发布时，直接从 GitHub 仓库跑，效果相同：

```bash
npx github:lifangjin/dsh-paoding
```

npm 包与命令同名：包 `dsh-paoding`，命令 `dsh-paoding`。这条默认路线等价于 `--auto --config-ui`，一次做三件事：

1. 生成编排 preset（`$DSH_HOME/.agent-presets/orchestrator`）；
2. 写基础配置模板（`$DSH_HOME/dsh-paoding.config.yml`）；
3. 把 Web 配置 UI 挂进 DSH 设置页（设置 → 庖丁配置）。

**开箱默认是基础模板**：全新安装生成的配置模板只含 DSH 自带的基础工具——主 agent 21 项核心工具，加各委派角色的基础工具集；检测到的 host/MCP 工具**默认不写入**。检测管线照常运行：打开设置 → 庖丁配置，候选清单照常列出全部已识别工具，装完按需勾选、「保存并应用」即可；也可以跑 `npx dsh-paoding --wizard` 进交互向导逐项分配。

这条路线可带的旗标：

| 旗标 | 作用 |
|---|---|
| `--suggest` | fresh 安装改用智能默认：按检测结果自动把 MCP/host 工具分进角色与主 agent（即旧行为） |
| `--no-ui` | 跳过配置 UI 挂载 |
| `--wizard` | 强制进交互向导 |

**npm 安装形态怎么挂 UI**：npx 运行时的包目录在缓存里，随时可能被清掉，直接拿去挂载不保险。因此安装器会把整包复制到 **`$DSH_HOME/dsh-paoding`** 这个稳定位置，再从那里挂载配置 UI；克隆仓库走 `./install.sh` 的仍是符号链接直连仓库（见第 7 节）。两条路线只在挂载来源上有别，对 DSH 来说都是同一个插件。

**已有配置文件的用户**不受影响：`$DSH_HOME/dsh-paoding.config.yml` 已存在时，重跑任何入口（npx 或 `./install.sh`）都按配置文件应用、不覆写既有选择。

装完**重启 DSH（`dsh web`）**，后续步骤见第 6 节。

### 官方插件通道：按 profile 装 UI

npx 之外，配置 UI 还能走 DSH 的官方插件通道单独安装：

```bash
dsh plugin --profile web add dsh-paoding@latest
```

装完**重启 DSH（`dsh web`）**，设置页出现「庖丁配置」；卸载用 `dsh plugin --profile web remove dsh-paoding`。机制一句话：npm 包 `dsh-paoding` 在包根声明了 `dsh.bundle.patch`（一份 `cordis.patch.yml`，一行 insert：`id: paoding-config-ui` / `name: dsh-paoding`），安装后由 `reconcilePlugins` 自动并入该 profile 的启动层——与 npx 通道是同一个 npm 包，只是两种装法。

**这条通道只装 UI 这一件**（机制所限，编排 preset 与配置文件装不了，preset 那半边走 npx / `./install.sh`），想两步装齐全就这样搭配：

```bash
dsh plugin --profile web add dsh-paoding@latest   # 配置 UI，只在指定 profile 生效
npx dsh-paoding@latest --no-ui                    # 编排 preset + 配置模板，--no-ui 防止 UI 重复挂载
```

反过来只用 npx 一条命令也行——它默认就含 UI 挂载。**推荐口径**：npx 一条命令仍是首选；plugin 通道留给偏好官方通道、或想让 UI 按 profile 隔离的人。

**语义差异**：plugin 通道装的 UI 只在指定 profile（如 `web`）生效；npx / `./install.sh` 的挂载写进全局 `~/.dsh/cordis.patch.yml`，对所有 profile 生效。

**勿混用**：同一台机器两种挂载并存时，设置页会出现重复的「庖丁配置」分区——两条不同来源的 insert 行同时生效。从旧的全局挂载迁到 plugin 通道：先 `dsh plugin --profile web add dsh-paoding`，再删掉 `~/.dsh/cordis.patch.yml` 里的 `paoding-config-ui` 段与 `~/.dsh/node_modules/paoding-config-ui` 符号链接，重启即可；反向迁移同理。

## 3. 安装（交互向导）

### 进入向导

```bash
cd dsh-paoding
./install.sh
```

在终端里直接运行 `./install.sh`（不带参数）即进入交互式安装向导（`install.sh` 只是把参数透传给 `node tools/install.mjs`）。向导只在 **stdin 是 TTY** 时自动启动；非 TTY 环境会拒绝并提示改用 `--auto`（见第 4 节）。强制在脚本/CI 里走向导用 `--wizard`。向导启动后先打印一行欢迎语，随后按下面六个阶段逐项提问；**每个问题直接回车 = 采用默认/保持当前值**。

向导在提问前会先做一次完整检测（与 `--auto`/`--dry-run` 共用同一条检测管线），并把结果打印成**检测报告**；若已有配置文件，其内容会作为各项初值（未配置项回落到智能默认或静态基础）。

### 六个阶段

**① 检测报告**：列出本次检测到的工具，报告内容与第 5 节的检测管线一致：

- **MCP 服务器**：每个已启用服务器一行，含名称、transport 与解析出的**精确工具名**（`mcp__<server>__<tool>` 形态，如 `mcp__codegraph__codegraph_explore`、`mcp__tavily__tavily_search`）。已知服务器（tavily、codegraph）走静态表直接解析；未知服务器用实时 JSON-RPC 握手（stdio / streamable-http）解析；握手失败或 transport 不受支持（sse）的服务器显示为无工具可解析（不影响安装）。
- **本地工具插件**：如 `magic-memory` → 工具 `memory_search`。
- **已安装 skill**：扫描四个根——`$DSH_HOME/skills`、`~/.agents/skills`（`$DSH_AGENTS_HOME` 可覆盖 `~/.agents`）、运行安装器的工作目录下的 `.dsh/skills` 与 `.agents/skills`（每个根里一个目录或一个 `.md` 文件算一个 skill，以 basename 命名）。

**② 工具分配**：对每个解析出工具的 MCP 服务器，向导列出其工具与**当前归属**（已有配置或智能默认预填），然后询问把整组工具分到哪里：`search_external` / `design` / `implement` 三个默认角色之一、`主 agent`、`不分配`、某个已有自定义角色，或 `[0] 新建角色`（回车保持当前归属）。选 `主 agent` 会把该服务器工具从所有角色移除并加入主 agent 追加工具（`main_agent_extra`）；选 `不分配` 则从角色与主 agent 两处都移除。

**③ 自定义子 agent**：入口有两处——在②对某个服务器选 `[0] 新建角色`（该服务器工具随后自动并入新角色），或回答随后的「创建自定义角色？[y/N]」循环（可建多个）。每个新角色依次填写：

1. **toolName**：必须以小写字母开头，只含小写字母/数字/下划线（正则 `/^[a-z][a-z0-9_]*$/`）；不合法、与已有角色重名、输入 `done` 或直接回车，都会中止本次创建（打印原因后返回，不要求重输）。
2. **工具池多选**：工具池 = 三个默认角色静态 allow ∪ 全部检测到的 host 工具，按编号列出。输入逗号分隔的编号（如 `1,3,5`），`all` 全选，`none` 清空。
3. **persona 一句话**：输入一行描述，自动展开为 `You are the <name> agent. <描述>`；留空则生成时使用同句式的默认描述（`You are the <name> agent. Handle tasks delegated to this role.`）。

新角色 toolName 会在安装时自动注入主 agent 的 restrict `config.allow`（`restrict.mjs` 本身不用改），之后在对话里直接调用该 toolName 即可委派。

**技能型玩法示例**：想把「做 PPT」变成专属 agent——在③填 `toolName` = `ppt`，工具池勾 `skill`（子 agent 用 skill
工具按需加载技能正文）及 `read` / `write` / `edit` / `bash` 等，persona 写一句，如「You are the ppt agent. Turn
outlines into HTML slides: load the html-ppt skill, plan the deck, write the HTML files, then report the output
path.」；到⑤把 `html-ppt` 技能分给 `ppt` 角色（persona 尾部会带 Available skills 引导行）。装好后主 agent 一句
「把这份大纲做成 PPT」就委派给会做幻灯片的专属子 agent；任意已装技能同理都能做成专属角色。

**④ 微调默认角色（可选）**：对 `search_external` / `design` / `implement` 逐个询问：是否改 persona（多行输入，单独一行 `.` 结束，空行保持默认）、按工具池编号添加工具、按当前列表编号移除工具，均可回车跳过。逐角色问完后还有三问：**删除内置角色**（输入空格分隔的角色名，回车不删，已删的保持删除；`search_internal_deep` 不在可删范围）、**主 agent 名称**（回车保持默认或既有名）、**内置角色专用模型**（先问是否配置，确认后逐角色问模型 id，回车即跟随主 agent，模型非空才追问 provider）。三问分别落进配置键 `roles_remove` / `main_agent_name` / `roles.<toolName>.model`（+`provider`），详见 [配置](configuration.md) 2.3、2.5 与 5.1。收尾时，向导会打印主 agent 当前工具面并询问**是否移除基础工具**（编号，回车跳过）与**恢复此前移除的工具**（编号，回车跳过）——把主 agent 工具清空的操作会被当场拒绝。

**⑤ skill 分配**：分三段提问：

- **角色技能分配**：对每个检测到的 skill，选择把它「软引导」到哪些角色（可分配列表 = allow 含 `skill` 的角色；`[0]` 不分配，回车保持）。分给某角色的 skill 会在安装时写进该角色 persona 尾部的 `Available skills: …` 引导行。skill 目录对角色全量可见是 DSH 机制，因此这是**软约束（引导）而非硬隔离**。
- **主 agent 技能 `main_agent_skills`（软引导）**：勾选后，安装时在**主 agent** persona 末尾为每个技能写一行紧凑技能行（`# skill: <name> — <描述>` + `Read full rules: <SKILL.md 绝对路径>`）。主 agent 不加载 skill 工具/技能目录（目录注入归零），任务匹配到该技能时用自带的 `read` 按需加载正文并遵循——每技能只付一行 persona 的开销，未用到零花费。
- **`main_agent_skills_inline`（可选，硬内联）**：紧接着询问其中哪些技能需要**全文内联硬生效**——被选中的技能 SKILL.md（去掉 YAML frontmatter）全文内联进主 agent persona，每轮固定生效，适合 `caveman` 等必须无条件生效的风格技能；同一技能若两处都勾选，只按内联处理、不再写软行。

找不到对应 SKILL.md 的技能会被**警告并跳过**（不中断安装）。

**⑥ 确认摘要 → 安装 → 写入配置**：向导打印确认摘要——每个角色（含自定义）的工具数与 persona 首行、主 agent 追加/移除/技能（软行与内联）、每个 skill 分配给哪些角色，另按需附三样：各角色的专用模型后缀（`| 模型: provider/model`，配了才带）、「内置角色已删除」行（删了内置角色才出现）与「主 agent 名称」行（改过名才出现）——然后问「确认安装并写入配置？[Y/n]」（默认 Y；回答 n 则提示「已取消，未写入任何文件」并退出）。确认后：

- 重建目标目录 `$DSH_HOME/.agent-presets/orchestrator`：`agent.cordis.yml` 按上面的分配重写（角色 allow 与 persona、自定义角色块、主 agent restrict `config.allow` 注入；写盘前先做 YAML 结构校验），`preset.yml` 与 `restrict.mjs` 原样复制；
- 打印安装报告（扫描的 patch 层、检测到的工具、每个角色 allow 的 intent → kept → removed 及剔除原因、下一步提示）；
- 把全部选择序列化写入配置文件（见下）。

### 配置持久化

向导（以及配置 UI 的「保存并应用」）会把全部选择持久化到 **`$DSH_HOME/dsh-paoding.config.yml`**（文件头部注释标明它由交互向导生成、可手编、改后重跑 `./install.sh --auto` 应用）。之后修改配置（手编或重跑向导）再执行：

```bash
./install.sh --auto
```

即可**幂等**地把新分配应用到 preset（有配置就应用配置；无配置时写基础模板，`--suggest` 改用智能默认——见第 4 节）。配置文件的键位结构说明见 [配置](configuration.md)。

## 4. 非交互 / 配置驱动

不带终端跑安装（脚本、CI、定时重跑）时，用下列非交互参数。典型用法：

```bash
cd dsh-paoding
./install.sh --auto                 # 有配置则应用配置；没有则写基础模板（--suggest 改用智能默认，见下）
./install.sh --auto --dry-run       # 只打印检测报告与将生成的 allow，不写任何文件
./install.sh --auto --config /path/to/dsh-paoding.config.yml
./install.sh --auto --config-ui     # 应用 preset 并挂载可视化配置器（见第 7 节）
./install.sh --wizard < answers.txt # 非 TTY 也强制向导，从 stdin 读答案
```

CLI 参数（`tools/install.mjs` 的 usage）：

| 参数 | 说明 | 默认 |
|---|---|---|
| `--auto` | 非交互：有配置文件则应用配置；否则写**基础模板**（只含 DSH 自带基础工具；加 `--suggest` 则改用智能默认，无 host 工具时输出与静态 preset 完全一致，零回归） | 关 |
| `--config <file>` | 配置文件路径（也接受 `--config=<file>`） | `$DSH_HOME/dsh-paoding.config.yml` |
| `--wizard` | 强制交互向导；stdin 非 TTY 时也逐行读 stdin，便于脚本/CI 喂答案（npx 入口进向导也用它） | 关 |
| `--suggest` | fresh 安装改用智能默认：按检测结果自动把 MCP/host 工具分进角色与主 agent（旧行为） | 关 |
| `--no-ui` | 跳过配置 UI 挂载（npx 一键安装默认挂载，用它关掉） | 关 |
| `--profile <name>` | 检测时纳入哪个 profile 的 patch 层 | `web` |
| `--patch <file>` | 额外的 patch 覆盖文件，可重复（详见第 5 节） | 无 |
| `--dry-run` | 只打印检测报告与将生成的 allow 列表，不写任何文件 | 关 |
| `--config-ui` | 应用 preset 的同时把配置 UI 挂进 DSH 设置页（见第 7 节） | 关 |
| `--help` / `-h` | 打印用法说明并退出 | — |

环境变量：`DSH_HOME` 覆盖家目录（默认 `~/.dsh`）。

**基础模板**（fresh 安装的新默认，`--auto` 且无配置文件时）：只写 DSH 自带的基础工具——主 agent 21 项核心工具加各委派角色基础集；检测到的 host/MCP 工具不写入，检测报告照常打印，配置 UI 的候选清单也照常列出全部已识别工具，装完按需勾选即可。

**智能默认**（仅 `--auto --suggest` 且无配置文件时，即旧行为）：`codegraph` MCP 工具与 `memory_search` 归主 agent；其它 MCP 服务器按其工具名关键字分到三个默认角色（含 `search|research|crawl|extract|map|web` → `search_external`，含 `code|fs|file|write|edit|bash|exec|run` → `implement`，含 `design|render|image|screenshot|paint` → `design`，都不含则归 `search_external`）；每个角色最终 allow 为空会**拒绝安装**。

配置里显式写 `main_agent_extra: []` 视为明确留空，重跑不会被智能默认回填；老配置缺该键时才回填。

**stdin 非 TTY 保护**：stdin 非 TTY 且不带 `--auto`/`--config`（无现成配置）/`--dry-run` 时，安装器直接报错退出（提示改用 `--auto`），避免向导在无终端环境挂起。非 TTY 下可放心用 `--dry-run` 预览。

安装完成后的输出会打印后续步骤提示：重启 host 或新建会话、在预设选择器里选「编排模式 (Orchestrator)」（见第 6 节）。

## 5. host patch 检测机制

安装器存在的根本原因：DSH 在子 agent 创建时执行 `tools.restrict()`，**allow 名单里的名字必须存在于子 agent 可见的注册面内**，否则创建被拒（unknown tools）。注册面里唯一随机器变化的部分就是 host patch 层，因此安装器不写死 allow，而是在安装时读取 patch 层、检测**实际启用**的工具，用「配置/静态意图 ∩ 实际检测到的工具」重写三个默认角色（`search_external` / `design` / `implement`）以及你新建的自定义角色的 `toolFilter.allow`——这样安装出来的 preset 永不因 host 工具停用而过期。

### 读取的 patch 层

按序**全部纳入**（`--patch` 是在 home/profile 两层之外追加的额外层；检测把各层里已启用的条目做并集）：

| # | 层 | 路径 | 缺失时 |
|---|---|---|---|
| 1 | home 层 | `$DSH_HOME/cordis.patch.yml` | 不存在则跳过 |
| 2 | profile 层 | `$DSH_HOME/profiles/<profile>/cordis.patch.yml` | 不存在则跳过（默认 profile = `web`，可用 `--profile` 改） |
| 3 | 额外覆盖 | `--patch <file>`（可重复） | 报 warning 并跳过 |

### MCP 与本地插件的检测

- **启用判定**：patch 条目未被禁用（`enabled !== false` 且无 `disabled`）即视为启用；插件另查 `config.enabled`。
- **MCP 服务器识别**：条目名以 `dsh-mcp-client` 结尾，或配置含 `serverName` 且 transport 为 `stdio` / `streamable-http` / `sse`（或有 `command`）。
- **精确工具名解析**（`toolFilter.allow` 是精确名匹配、不支持 glob，名字必须拼全）：已知服务器查静态表直接得出——`tavily` → 5 个工具（`tavily_search` / `tavily_crawl` / `tavily_extract` / `tavily_map` / `tavily_research`），`codegraph` → `codegraph_explore`；未知服务器做实时 JSON-RPC 握手（stdio 拉起进程发 `initialize` + `tools/list`；streamable-http 走 POST；**15 秒超时**），把返回的工具名解析成 `mcp__<server>__<tool>`。
- **本地工具插件**：按白名单匹配 patch 条目名并登记其工具，如 `magic-memory` → `memory_search`（新增插件需扩展白名单，见 `tools/install.mjs` 的 `KNOWN_HOST_PLUGINS`）。
- **跳过不报错**：握手失败、超时、`sse` 等不支持 transport 的服务器被跳过——对应角色只是缺这些工具，安装不报错（报告里会标注 `handshake failed` 及原因，URL/密钥会被打码）。

### allow 重写规则

对每个被重写的角色：allow 中**依赖 host 的名字**（`mcp__*` 与已知插件工具）只在与检测库存的交集里保留；**standard 组合保证的基础工具**（read/write/edit/glob/grep/bash/skill/web_search 等）原样保留、不参与过滤。结果 = 配置意图 ∩ 实际启用工具：停用的 host 工具名自动剔除，保证 `tools.restrict()` 永不报 unknown tools。主 agent 侧同理：`restrict.mjs` 的 base allow 里 host 依赖名按检测结果过滤，`main_agent_extra` 追加的 host 工具与自定义角色 toolName 注入 `config.allow`，`main_agent_remove` 剔除（移除结果为空列表会**拒绝安装**，防止运行时空 allow 拒载）。静态 preset 中不由安装器重写的其它委派行（如 `search_internal_deep`）原样保留。

**重跑时机**：改动了 patch 配置（启用/停用 MCP 服务器或插件、增删 `--patch` 文件）后重跑一次 `./install.sh --auto`（npx 入口同理）同步 allow；安装器还会比较 patch 文件与上次生成结果的时间戳，发现 patch 更新过会打印提醒。先 `--dry-run` 预览将发生的剔除。

### 解析与校验

patch 与配置文件用 **`yaml` 包**解析——通过 `createRequire` 从 `$DSH_HOME/node_modules` 惰性加载（该目录通常是 DSH 的 npx node_modules 符号链接，自带 yaml v2）；不可用时回退到**内置的极简 YAML 子集解析器**（要求顶层为列表/映射，支持常见标量与 `- insert:` 包裹）。解析前会先中和真实 patch 文件里的 cordis `!!js` 表达式（`process.platform` / `process.cwd()` 换成求值结果）。源 `agent.cordis.yml` 里角色 allow/persona 块的定位优先用 yaml AST 的字节范围（保缩进、精确替换），失败则回退结构化正则；生成结果写盘前先做一次 YAML 结构校验（`!!js` 占位后解析），结构错误直接拦下、不写盘。

### 典型示例

例 1——停用 tavily：在 `$DSH_HOME/cordis.patch.yml` 注释掉 tavily 的挂载行后：

```bash
./install.sh --auto --dry-run   # 预览：search_external 的 allow 会剔除 5 个 mcp__tavily__*，
                                #       报告列出 removed 与原因（如 "tavily MCP 未启用"）
./install.sh --auto             # 应用
```

例 2——插件停用：停用 magic-memory 后重跑 `--auto`，各角色 allow 中的 `memory_search` 自动剔除；此后想恢复就重新启用插件并重跑。

例 3——新增 `--patch`：把额外的 MCP/插件配置放独立文件，检测时用 `--patch <file>` 一并纳入（不必动 home/profile 层文件）。

## 6. 应用与生效

安装完成（向导或 `--auto`）后，产物是 `$DSH_HOME/.agent-presets/orchestrator/` 下的静态目录——**不重启也安全**，改配置重跑安装器只是重写这个目录：

1. **重启 host，或新建一个会话**（预设在新会话创建时装载；预设选择器按新会话刷新）。
2. 在**新会话的预设选择器**里选「**编排模式 (Orchestrator)**」。
3. 想让它成为每次新会话的默认预设：**Settings → Agent Presets** 里设置默认。

**升级**：仓库更新后重新生成即可——`git pull` 拉取新源码，然后：

```bash
cd dsh-paoding
./install.sh --auto       # 有配置则幂等应用（推荐先 --auto --dry-run 预览）
```

走 npx/npm 入口的更省事：重跑 `npx dsh-paoding@latest`（发布前用 `npx github:lifangjin/dsh-paoding`），同样有配置应用配置。

因为产物是静态目录且由仓库源生成，升级/重装/卸载都不会影响 host 的其它配置（MCP、插件、会话等），与 DSH 源码零耦合。

**卸载**：删除预设目录即可（配置 UI 的卸载见第 7 节；`dsh-paoding.config.yml` 不随 preset 删除，删掉它或留着都不影响其它预设，重新安装时 `--auto` 会再次应用它）：

```bash
rm -rf "$DSH_HOME/.agent-presets/orchestrator"
rm -rf "$DSH_HOME/dsh-paoding"   # 仅 npx/npm 安装需要：删掉安装器复制的整包目录
```

之后新建会话时「编排模式 (Orchestrator)」不再出现在预设选择器里。

## 7. 可视化配置器（可选）

不想手编 `dsh-paoding.config.yml`、也不想走终端向导时，可以把可视化配置器作为插件挂进 DSH Web 的**设置 → 庖丁配置**分区。它与 CLI 共用同一条检测/生成管线（`collectState` / `generateAndInstall`），所见即所得。

### 挂载

```bash
cd dsh-paoding
./install.sh --auto --config-ui
```

`--config-ui` 在应用 preset 之后**幂等**地做两件事：把本仓库的 `plugins/paoding-config-ui` 符号链接进 `$DSH_HOME/node_modules/paoding-config-ui`（已存在且指向本仓库则跳过；指向其它来源会报错，提示先删掉旧链接），并确保 `$DSH_HOME/cordis.patch.yml` 里有启用状态的挂载行（缺失则追加、被注释则自动取消注释）：

```yaml
- insert:
    - id: paoding-config-ui
      name: paoding-config-ui
```

然后**重启 DSH（`dsh web`）**，设置页出现「庖丁配置」分区。

从 npx/npm 入口安装时没有仓库目录可链：安装器改为把整包复制到 `$DSH_HOME/dsh-paoding`（见第 2 节），再从那里挂载；只有克隆仓库跑 `./install.sh` 才走上面的符号链接直连。两种形态对 DSH 都是同一个 `paoding-config-ui` 包，下一节的加载机制完全一致。

除了 `--config-ui`，还有一条路通向同一个分区：DSH 官方插件通道 `dsh plugin --profile web add dsh-paoding@latest`，只装 UI、按 profile 生效（详见第 2 节）。它与这里的全局挂载勿并存，否则设置页会出现重复的「庖丁配置」。

### 加载机制

- cordis 经 `$DSH_HOME/node_modules` 解析 patch 行里的包名 `paoding-config-ui`；
- DSH 的 client-modules 节点半扫描该包 `package.json` 的 `dsh.client` 声明与 `exports["./client"]`，把 `lib/client.js` 编入浏览器的 `__DSH_BOOT__`（以 `/plugins/paoding-config-ui/client.js` 下发）；
- 浏览器内核为清单里的每个插件创建 loader 条目并激活（bundle 以 `window.__ModuleLoader__.load({ id: "paoding-config-ui", factory })` 注册，id 必须等于包名/图行 id）；
- 客户端 `apply()` 经 `ctx.slots.inject("settings.section")` 等待设置壳声明槽位，再 `slots.register()` 挂出分区——`id: "paoding"`、`order: 50`、`label: 庖丁配置`（与内置 General 分区同款模式，id/order/label 驱动设置壳导航）。

### 数据接口与安全

面板数据走**同源 `/api/paoding/*`**：Node 侧注册前缀路由——`GET /api/paoding/state`（带缓存的检测状态）、`POST /api/paoding/rescan`（强制重检测，含 MCP 握手）、`POST /api/paoding/preview`（不写盘生成）、`POST /api/paoding/apply`（安装并保存配置）——复用 `tools/install.mjs` 的检测与生成管线（`plugins/paoding-config-ui/api-core.mjs`）。路由自带**浏览器信任围栏**：Host 必须回环或落在 `webRuntime.trustedHosts`，并拒绝 cross-site 请求（复刻 DSH `/api` 网关围栏语义，因为 `/api/paoding` 前缀更长会命中本插件而绕开网关）。配置 UI **没有独立服务端/端口**：DSH Web 端口只监听 `127.0.0.1`，不对外网暴露。

### 面板能力

- **状态与操作**：检测摘要与 chips（当前 profile、每个 MCP 服务器及工具数、插件 chips、技能数等）；操作按钮「**保存并应用**」「预览生成」「重新检测」固定在面板底部悬浮操作坞（sticky bottom），滚动任意位置都可直接点击。
- **Agent 工具分配卡片**：主 agent 一张固定卡（基础工具取消勾选 = 加入 `main_agent_remove` 从主 agent 剔除；Host 工具勾选 = 加入 `main_agent_extra`；技能「read 按需」与「内联全文」两组勾选；另有「人设追加」编辑区，可改、清空、恢复默认）＋ `search_external` / `design` / `implement` 三张内置角色卡 ＋ 任意自定义角色卡（带删除按钮）；每张角色卡可勾选/取消基础工具与 Host 工具、编辑 persona。底部「新建自定义 agent 角色」。
- **技能分配**：每个 skill 一行，勾选分配给哪些 agent（写入对应 persona 的 `Available skills` 软引导；角色技能软引导，主 agent 技能另有 read 按需/内联两组）。
- **预览生成**：不写盘生成 `agent.cordis.yml`，显示每个角色 allow 的 intent → kept 计数与生成全文。
- **保存并应用**：确认后写入 preset（覆盖 `$DSH_HOME/.agent-presets/orchestrator`）并把当前分配保存到 `$DSH_HOME/dsh-paoding.config.yml`——等价于 `./install.sh --auto` + 向导保存；应用成功后提示重启 DSH 或新建会话生效（检测到 patch 比生成结果新时提示重启后生效）。

### 卸载

```bash
rm -f "$DSH_HOME/node_modules/paoding-config-ui"   # 1) 删除符号链接
# 2) 注释掉 $DSH_HOME/cordis.patch.yml 中 paoding-config-ui 的挂载行（三行）
# 3) 重启 DSH（dsh web）
```

分区随之从设置页消失；已生成的 preset 与配置文件不受影响。npx/npm 安装形态的完整卸载（含删 `$DSH_HOME/dsh-paoding`）见第 6 节。走 plugin 通道装的 UI 卸载方式不同：`dsh plugin --profile web remove dsh-paoding`，只影响对应 profile。

## 8. 常见问题与排查

**node 缺失**

运行 `./install.sh` 报 `error: node (>=18) is required to run the dsh-paoding installer`：`node` 不在 PATH 或版本 < 18。安装 Node.js ≥ 18 后重试。

**预设列表里没有「编排模式 (Orchestrator)」**

预设在新会话创建时装载：重启 host（`dsh web`）或新建会话后再看选择器。仍没有就检查安装目标：`ls "$DSH_HOME/.agent-presets/orchestrator"` 应存在三个文件（`agent.cordis.yml`、`preset.yml`、`restrict.mjs`）；若为空，多半是安装时的 `$DSH_HOME` 与 DSH 实际使用的家目录不一致（重跑时显式 `export DSH_HOME=…`）。

**`tools.restrict()` 报 unknown tools / 子 agent 创建被拒**

allow 名单里出现了子 agent 注册面上不存在的名字——最常见原因是启用/停用了 MCP 服务器或插件之后**没重跑安装器**。重跑 `./install.sh --auto` 同步（先 `--auto --dry-run` 看剔除清单）；手写进 allow 的未安装工具名同样会触发。

**安装时提示需要终端**

stdin 非 TTY（脚本、CI、远程执行）且没带 `--auto`/`--config`/`--dry-run` 时安装器拒绝启动，避免向导挂起：改用 `./install.sh --auto`（有配置则应用、无配置写基础模板），或在脚本里 `./install.sh --wizard < answers.txt` 从 stdin 喂答案；npx 一键安装自带 `--auto`，非 TTY 下也能正常跑。

**角色里少了某个 MCP 工具**

握手失败或 transport 不受支持的 MCP 服务器会被跳过（报告标注 `handshake failed`）：对应角色只是缺这些工具，安装不报错。检查该服务器能否独立启动/连通后再重跑；已知服务器（tavily、codegraph）走静态表不握手，不会出现此情况。

**技能没写进 persona**

角色技能只允许分给 allow 含 `skill` 的角色；主 agent 技能走 `main_agent_skills`（软行）或 `main_agent_skills_inline`（内联）。找不到 SKILL.md（按 `$DSH_HOME/skills`、`~/.agents/skills`、工作目录 `.dsh`/`.agents/skills` 查找）会被警告并跳过——确认 skill 已装在上述根目录之一。

**配置文件在哪里**

向导与配置 UI 都写到 `$DSH_HOME/dsh-paoding.config.yml`（默认 `~/.dsh/dsh-paoding.config.yml`）；CLI 可用 `--config <file>` 指到别处，配置 UI 的状态栏也会显示当前配置文件路径。想重置全部选择：删除该文件后 `./install.sh --auto`（或重跑 npx 一键安装）会回到基础模板；想回到自动分配的智能默认，加 `--suggest`。

**装好的预设与配置被改坏了**

preset 是静态目录，直接重装即可：修正配置后 `./install.sh --auto`（或删除 `$DSH_HOME/.agent-presets/orchestrator` 后重跑向导）。注意安装器会拒绝「某角色 allow 为空」或「主 agent 工具被清空」的安装，防止装出运行时必然失败的 preset。

**配置 UI 的设置页没有「庖丁配置」**

走 plugin 通道装的，先确认 `dsh plugin add` 时指定的 profile 与当前 DSH 用的 profile 一致（这个 UI 按 profile 生效），且装完重启过 DSH；`--config-ui` 全局挂载的，依次检查：是否在挂载后重启过 DSH；npx/npm 安装的先确认 `$DSH_HOME/dsh-paoding` 目录存在（npx 缓存清理不影响它，缺了重跑一键安装即可），克隆安装的则看 `$DSH_HOME/node_modules/paoding-config-ui` 符号链接是否指向本仓库的 `plugins/paoding-config-ui`（指向其它来源时 `--config-ui` 会报错）；`$DSH_HOME/cordis.patch.yml` 里 `paoding-config-ui` 挂载行是否处于启用（未被注释）。全部正常后重启 DSH 再开设置页。

**设置页出现两个「庖丁配置」分区**

全局挂载与 plugin 通道并存了——两条不同来源的 insert 行同时生效（见第 2 节「勿混用」）。二选一：留在 plugin 通道，按第 2 节的迁移步骤删掉 `~/.dsh/cordis.patch.yml` 里的 `paoding-config-ui` 段与 `~/.dsh/node_modules/paoding-config-ui` 符号链接；回到全局挂载，则 `dsh plugin --profile web remove dsh-paoding`。改完重启 DSH。
