# dsh-paoding（庖丁解牛）
[English](README_en.md) · 中文

庖丁解牛，游刃有余 —— 把 DSH 调教成一支分工明确、按需加载的 agent 小团队。

dsh-paoding（中文品牌「庖丁」，典出《庄子》——庖丁顺纹理下刀，刀刃十九年若新发于硎）是 DSH（DeepSeek Harness agent 运行时）的**预设生成器**。DSH 原本是一个 agent 包揽约 60 个工具、每次请求全量加载；装上庖丁后变成「一个指挥 + 四个帮手」——主 agent 只带编排与内部搜索的精简工具，其余的活按角色委派给只带本行工具的子 agent。全部靠配置完成，**零 DSH 源码改动**。

## 功能特性

- **一支分工明确的小团队**：主 agent 当指挥，拆解任务、分派验收；联网调研、UI 设计、写代码、全仓深搜四位专属帮手各司其职，随叫随到、干完即走。
- **高频小事不过手他人**：找代码、查引用、读文件这类顺手的事，主 agent 自己直接办，不绕委派的圈子。
- **可招募专属帮手**：内置四角色只是起点——给新角色配好工具和技能（比如装上 `html-ppt` 技能的 PPT 帮手），之后一句「把这份大纲做成 PPT」就有人接活。向导、配置文件、图形界面三个入口都能建。
- **帮手还能指定专用模型**：写代码的用强档、查资料的用轻快档，各配各的模型；不配就跟随主 agent 当前会话的模型。
- **省钱省上下文**：帮手的工具只在被叫到时才加载，用一次付一次；主 agent 每次请求的工具开销约降三分之二，上下文只收摘要，不再被搜索结果和代码改动撑爆。
- **角色随改随用**：删掉用不上的内置角色、给角色改显示名、给主 agent 改名，都是配置里一行的事；改完跑一条命令重新生成，即刻生效。
- **装了什么都能认出来**：MCP 服务器、本地插件、已装技能，安装与配置时全程检测；默认只装 dsh 基础工具，检测到的 host 工具在「庖丁配置」里按需勾选（或 `--suggest` 自动分派）；停用哪个，重跑一遍后相关工具自动剔除。
- **图形界面配置**：不习惯改配置文件的话，「设置 → 庖丁配置」里点选即可，「保存并应用」与命令行走同一条生成管线。
- **来去自由**：不改 DSH 一行源码；装完新会话即用，卸载即删目录。

## 插件截图

![截图 1](docs/images/1.png)

![截图 2](docs/images/2.png)

![截图 3](docs/images/3.png)

![截图 4](docs/images/4.png)

![截图 5](docs/images/5.png)

![截图 6](docs/images/6.png)

## 快速开始

前置：**Node.js ≥ 18** 与一台已装好的 DSH host。

**npx 一键安装（推荐）**——不用克隆仓库，一条命令：

```bash
npx dsh-paoding@latest             # npm 发布后可用
npx github:lifangjin/dsh-paoding   # 发布前从 GitHub 仓库直装，效果相同
```

这一条等价于 `--auto --config-ui`：生成编排预设、写好基础配置模板，并把「庖丁配置」挂进 DSH 设置页。开箱默认只带 DSH 自带的基础工具，检测到的 MCP/host 工具不会自动写入——装完在**设置 → 庖丁配置**里按需勾选工具与角色，「保存并应用」即生效；想逐项过一遍就跑 `npx dsh-paoding --wizard`，想沿用自动分配就加 `--suggest`。

偏好官方插件通道的话，`dsh plugin --profile web add dsh-paoding@0.2.0` 也能把「庖丁配置」按 profile 装进设置页（preset 本体仍走 npx / `./install.sh`），详见[安装文档](docs/installation.md)。

**克隆仓库安装**——老路线原样保留：

```bash
git clone https://github.com/lifangjin/dsh-paoding.git dsh-paoding
cd dsh-paoding
./install.sh              # 交互向导，一路回车即用默认
./install.sh --auto       # 非交互：有配置应用配置，没配置写基础模板（--suggest 用智能默认）
./install.sh --config-ui  # 顺带挂上图形配置界面（可与 --auto 同用）
./install.sh --dry-run    # 只预览将生成的内容，不写盘
./install.sh --help       # 全部参数
```

装完**重启 DSH（`dsh web`）或新建会话**，在预设选择器里选「编排模式 (Orchestrator)」即可；要设为默认，在 Settings → Agent Presets 里选。已有 `dsh-paoding.config.yml` 的话，重跑任何入口都按配置文件应用、不覆写。卸载删掉 `~/.dsh/.agent-presets/orchestrator` 即可（npx/npm 安装的还多一个 `~/.dsh/dsh-paoding`）。详细步骤与排查见 [安装文档](docs/installation.md)。

## 怎么用

给主 agent 派活即可，它按分工自己路由：

- 找代码 / 查引用 / 读文件 → 主 agent 自己办，不委派；
- 联网查资料、做调研 → 联网调研帮手（`search_external`，只带联网工具、不改文件）；
- 出界面方案、设计稿 → 设计帮手（`design`，可加载设计技能，出 spec 不写最终代码）；
- 写代码 / 改代码 → 实现帮手（`implement`，改完自验再汇报）；
- 超大仓库全仓探索、大文件通读 → 全仓深搜帮手（`search_internal_deep`，只读、无网络，只回浓缩摘要）；
- 专属活（比如做 PPT）→ 先建自定义角色，之后随叫随到。

帮手干活期间，主 agent 可以随时追问、查看进度、叫停；结束后只把摘要收进上下文，不把帮手的完整过程倒进来。任务失败怎么恢复、怎么多轮迭代，见 [编排文档](docs/orchestration.md)。

## 配置

所有偏好都写在 `~/.dsh/dsh-paoding.config.yml`：角色增删改、技能分配、专用模型、主 agent 的工具与技能……改完跑一遍 `./install.sh --auto` 即同步生效。预设每次由「静态源 + 配置」重新生成，不攒手工补丁。全部配置键说明见 [配置文档](docs/configuration.md)；背后机制与成本账见 [架构文档](docs/architecture.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [架构](docs/architecture.md) | 为什么这样设计——概述、成本账、角色与工具、对应 DSH 原生机制、Token 治理、已知边界。 |
| [安装](docs/installation.md) | npx 一键安装、官方插件通道装 UI、前置要求、交互向导六阶段、CLI 参数、host patch 检测机制、应用/升级/卸载、配置 UI 挂载、排查。 |
| [编排](docs/orchestration.md) | 编排总览、失败如何呈现与三层处理、one-shot vs continuable、上下文隔离。 |
| [配置](docs/configuration.md) | 配置键全参考、内置角色微调、主 agent 工具与技能、自定义角色、按角色分模型。 |

## 贡献

欢迎 issue 与 PR：使用中发现问题、想要新的角色、或发现文档与实现不一致，都可以提。动手前请先读 [架构](docs/architecture.md) 与 [配置](docs/configuration.md)；文档与实现冲突时，以 `presets/orchestrator/` 与 `tools/install.mjs` 源码为准。

## 许可

以 [MIT License](LICENSE) 发布，完整条款见仓库根目录的 `LICENSE` 文件。
