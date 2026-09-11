← [dsh-paoding](../README_en.md) ｜ **Installation** ｜ [Architecture](architecture_en.md) ｜ [Orchestration](orchestration_en.md) ｜ [Configuration](configuration_en.md)

[中文](installation.md) · English

# Installation

This document is for users who install, upgrade, or uninstall the dsh-paoding「编排模式 (Orchestrator)」preset ("编排模式" is Chinese for "Orchestration Mode"): §1 prerequisites, §2 one-command install with npx, §3 interactive wizard install, §4 non-interactive / config-driven install, §5 host patch detection at install time, §6 applying, defaulting, upgrading and uninstalling, §7 the optional visual config UI in the Settings page, §8 troubleshooting.

## 1. Prerequisites

Check the following before installing:

- **Node.js ≥ 18**. `install.sh` checks that `node` is on the PATH at startup (it prints `error: node (>=18) is required…` and exits when missing). The installer (`tools/install.mjs`) uses only Node built-in modules and has zero runtime dependencies — **no `npm install` is needed after cloning**; `./install.sh` works directly (running `node tools/install.mjs` is equivalent).
- **A working DSH host** (the `dsh` command, including its Web/agent runtime). This tool does not modify DSH source code; it only writes into DSH's preset roster and patch layers, so a usable DSH home directory must exist first.
- **Path facts** (constants built into the installer; know them before running):

| Item | Default | Description |
|---|---|---|
| `$DSH_HOME` | `~/.dsh` | The DSH home directory (both `install.sh` and `install.mjs` honor the `DSH_HOME` environment variable, defaulting to `$HOME/.dsh`). The home-layer `cordis.patch.yml`, `node_modules`, and `profiles/<name>/cordis.patch.yml` live under it |
| preset roster root | `$DSH_HOME/.agent-presets/` | The directory `dsh-agent-presets` scans for locally authored presets |
| Install target of this preset | `$DSH_HOME/.agent-presets/orchestrator` | The install artifact: `agent.cordis.yml` (rewritten role config), `preset.yml`, `restrict.mjs` — a static directory |
| Config file | `$DSH_HOME/dsh-paoding.config.yml` | Role/tool assignments saved by the wizard or the config UI (`--config` selects another path) |
| Package copy (npx/npm install) | `$DSH_HOME/dsh-paoding` | When installing via the npx/npm entry, the installer copies the whole package to this stable location and mounts the config UI from there (see §2) |

- **Get the source**: clone the repository and enter the directory (skip this step entirely if you just want the one-command npx install in §2):

```bash
git clone <repo-url> dsh-paoding
cd dsh-paoding
```

Inside the repo, `presets/orchestrator/` is the static preset source (the installer reads and rewrites `agent.cordis.yml`, and copies `preset.yml` and `restrict.mjs` as-is), `tools/install.mjs` is the installer itself, `install.sh` is a thin shell wrapper, and `plugins/paoding-config-ui/` is the optional visual config UI plugin (see §7).

## 2. One-Command Install with npx

The least-effort entry point: no clone, one command (available once the package is published to npm):

```bash
npx dsh-paoding@latest
```

Before the npm release, run it straight from the GitHub repository with the same effect:

```bash
npx github:lifangjin/dsh-paoding
```

The npm package and its command share the name: package `dsh-paoding`, command `dsh-paoding`. This default route equals `--auto --config-ui` and does three things at once:

1. generates the orchestrator preset (`$DSH_HOME/.agent-presets/orchestrator`);
2. writes the base config template (`$DSH_HOME/dsh-paoding.config.yml`);
3. mounts the web config UI into the DSH Settings page (设置 → 庖丁配置 / Settings → Paoding Config).

**Out of the box: the base template.** A fresh install writes a template that only contains DSH's built-in base tools — the main agent's 21 core tools plus each delegated role's base set; detected host/MCP tools are **not written in automatically**. The detection pipeline still runs: open Settings → 庖丁配置 and the candidate list shows every recognized tool, so you can tick what you need and hit Save & Apply; or run `npx dsh-paoding --wizard` to assign everything in a guided pass.

Flags this route accepts:

| Flag | Effect |
|---|---|
| `--suggest` | On a fresh install, use smart defaults instead: detected MCP/host tools are assigned automatically to roles and the main agent (the old behavior) |
| `--no-ui` | Skip mounting the config UI |
| `--wizard` | Force the interactive wizard |

**How the UI is mounted in the npm form.** The package directory npx runs from lives in the cache and can be cleaned at any time, so mounting straight from it is not durable. Instead, the installer copies the whole package to the stable location **`$DSH_HOME/dsh-paoding`** and mounts the config UI from there. The repo-clone route (`./install.sh`) still symlinks directly into the repository (see §7) — the two forms differ only in where the plugin is mounted from; to DSH it is the same plugin.

**Existing config files are respected**: when `$DSH_HOME/dsh-paoding.config.yml` already exists, re-running any entry point (npx or `./install.sh`) applies your config file instead of overwriting your choices.

When it finishes, **restart DSH (`dsh web`)**; the remaining steps are covered in §6.

## 3. Interactive Installation

### Starting the wizard

```bash
cd dsh-paoding
./install.sh
```

Starting the wizard is a thin pass-through: `install.sh` forwards all arguments to `node tools/install.mjs`. Run it bare in a terminal and the interactive wizard starts. The wizard only auto-starts when **stdin is a TTY**; on a non-TTY it refuses and suggests `--auto` (see §4). Use `--wizard` to force the wizard in scripts/CI. After a welcome line, questions proceed through the six stages below; **pressing Enter on any question accepts the default / keeps the current value**.

Before asking anything, the wizard runs a full detection pass (the same pipeline shared with `--auto` / `--dry-run`) and prints the result as a **detection report**; when a config file already exists, its contents seed the initial values (anything unset falls back to smart defaults or the static base).

### The six wizard stages

**Stage ① Detection report**: lists the tools detected this run; it matches the detection pipeline described in §5:

- **MCP servers**: one line per enabled server, with its name, transport, and the resolved **exact tool names** (`mcp__<server>__<tool>`, e.g. `mcp__codegraph__codegraph_explore`, `mcp__tavily__tavily_search`). Well-known servers (tavily, codegraph) are resolved from a static table; unknown servers go through a live JSON-RPC handshake (stdio / streamable-http); servers whose handshake failed or whose transport is unsupported (sse) show as having no resolvable tools (the install still proceeds).
- **Local tool plugins**: e.g. `magic-memory` → tool `memory_search`.
- **Installed skills**: four roots are scanned — `$DSH_HOME/skills`, `~/.agents/skills` (`DSH_AGENTS_HOME` overrides `~/.agents`), and `.dsh/skills` plus `.agents/skills` under the working directory where the installer runs (in each root a directory or a `.md` file counts as one skill, named by its basename).

**Stage ② Tool assignment**: for every MCP server that resolved at least one tool, the wizard prints its tools and the **current assignment** (seeded from the existing config or smart defaults), then asks where to assign the whole group: one of the three default roles `search_external` / `design` / `implement`, the `主 agent` (main agent), `不分配` (assign to none), an existing custom role, or `[0]` to create a new role (Enter keeps the current assignment). Choosing the main agent removes that server's tools from every role and adds them to the main-agent extras (`main_agent_extra`); choosing "assign to none" removes them from both the roles and the main agent.

**Stage ③ Custom sub-agents**: there are two entry points — typing `[0]` while assigning a server in stage ② (that server's tools are then merged into the new role automatically), or answering the subsequent "创建自定义角色？[y/N]" loop (any number of roles may be created). Each new role is filled in step by step:

1. **toolName**: must start with a lowercase letter and contain only lowercase letters, digits, and underscores (regex `/^[a-z][a-z0-9_]*$/`). An invalid name, a name that already exists, `done`, or an empty line all abort this creation (the reason is printed and control returns — the wizard does not re-prompt).
2. **Tool-pool multi-select**: the tool pool = the three default roles' static allow ∪ every detected host tool, listed by index. Type comma-separated indexes (e.g. `1,3,5`); `all` selects everything, `none` clears.
3. **One-line persona**: type a short description; it is expanded to `You are the <name> agent. <描述>`. Leaving it blank makes the generator use the same-sentence default description (`You are the <name> agent. Handle tasks delegated to this role.`).

The new role's toolName is automatically injected into the main agent's restrict `config.allow` at install time (no need to edit `restrict.mjs`), so the main agent can delegate to it by calling that toolName in conversation.

**Skill-typed play example**: to turn "making PPTs" into a dedicated agent — in stage ③ set `toolName` = `ppt`,
tick `skill` in the tool pool (the sub-agent loads skill rules on demand via the skill tool) plus `read` /
`write` / `edit` / `bash` etc., and write a one-line persona such as "You are the ppt agent. Turn outlines into
HTML slides: load the html-ppt skill, plan the deck, write the HTML files, then report the output path."; then
in stage ⑤ assign the `html-ppt` skill to the `ppt` role (an Available skills guidance line is appended to its
persona). After install, a single "turn this outline into a PPT" delegates to a dedicated slide-making
sub-agent; any installed skill can become a dedicated role the same way.

**Stage ④ Fine-tuning the default roles (optional)**: for `search_external` / `design` / `implement` one by one, the wizard asks whether to change the persona (multi-line input; a lone `.` line ends it, blank lines keep the default), add tools by tool-pool index, and remove tools by index from the current list — every question can be skipped with Enter. Three more questions follow: **deleting built-in roles** (space-separated names; Enter deletes none, and already-deleted roles stay deleted; `search_internal_deep` cannot be deleted), the **main-agent name** (Enter keeps the default or the existing name), and **dedicated models for the built-in roles** (after a yes/no gate the wizard asks each role for a model id — Enter means follow the main agent's session model; provider is only asked when the model is non-empty). These land in the config keys `roles_remove` / `main_agent_name` / `roles.<toolName>.model` (+`provider`) — see [Configuration](configuration_en.md) 2.3, 2.5 and 5.1. Last, the wizard prints the main agent's current tool surface and asks whether to **remove base tools** (by index, Enter to skip) and **restore previously removed tools** (by index, Enter to skip) — emptying the main agent's tools entirely is refused on the spot.

**Stage ⑤ Skill assignment**: three consecutive questions:

- **Role skill assignment**: for each detected skill, choose which roles it should be soft-guided to (the assignable list = roles whose allow contains `skill`; `[0]` assigns to none, Enter keeps the current value). A skill assigned to a role is written at install time into that role's persona as a trailing `Available skills: …` guidance line. Because DSH makes skill directories fully visible to every role, this is a **soft constraint (guidance), not hard isolation**.
- **Main-agent skills `main_agent_skills` (soft guidance)**: when selected, the generator appends one compact skill row per skill to the **main agent's** persona (`# skill: <name> — <描述>` plus `Read full rules: <absolute SKILL.md path>`). The main agent carries no skill tool / skill catalog (directory injection drops to zero); when a task matches a skill it loads the full rules on demand with its own `read` tool — one persona line per skill, nothing paid when unused.
- **`main_agent_skills_inline` (optional, hard inline)**: the wizard then asks which of those skills must take effect unconditionally by **inlining the full text** — each selected skill's SKILL.md (YAML frontmatter stripped) is embedded verbatim in the main-agent persona, at a fixed cost per response; suited to style skills such as `caveman` that must always apply. A skill listed in both places is only inlined; its soft row is not written.

Skills whose SKILL.md cannot be found are **warned about and skipped** (the install does not abort).

**Stage ⑥ Confirm → install → persist**: the wizard prints a summary — every role (including custom ones) with its tool count and persona first line, the main agent's extras/removals/skills (soft rows and inlined ones), and each skill's target roles — plus, only when applicable, three extras: a per-role model suffix (`| 模型: provider/model`, "model", shown only for roles with one configured), a 「内置角色已删除」("built-in roles deleted") line, and a 「主 agent 名称」("main-agent name") line (those two are printed only when built-in roles were deleted / the name was changed) — then asks 「确认安装并写入配置？[Y/n]」(default Y; answering n prints 「已取消，未写入任何文件」and exits). On confirmation:

- the target directory `$DSH_HOME/.agent-presets/orchestrator` is rebuilt: `agent.cordis.yml` is rewritten according to the assignments (role allow lists and personas, custom-role blocks, main-agent restrict `config.allow` injection; the generated YAML is structurally validated before writing), while `preset.yml` and `restrict.mjs` are copied as-is;
- an install report is printed (scanned patch layers, detected tools, each role allow's intent → kept → removed with removal reasons, and next steps);
- all choices are serialized into the config file (below).

### Config persistence

The wizard (and the config UI's "保存并应用" (Save & Apply) button) persists every choice to **`$DSH_HOME/dsh-paoding.config.yml`** (a header comment in the file states it was generated by the interactive wizard, may be hand-edited, and that changes are applied by re-running `./install.sh --auto`). After editing the config (by hand or by re-running the wizard), run:

```bash
./install.sh --auto
```

to **idempotently** apply the new assignments to the preset (the config is applied when present; a fresh install writes the base template instead — `--suggest` for smart defaults — see §4). The config file's key structure is documented in [Configuration](configuration_en.md).

## 4. Non-interactive Usage

When running without a terminal (scripts, CI, scheduled re-runs), use the non-interactive flags below. Typical invocations:

```bash
cd dsh-paoding
./install.sh --auto                 # apply the config when present, else write the base template (--suggest for smart defaults, below)
./install.sh --auto --dry-run       # only print the detection report and the allow lists to be generated; write nothing
./install.sh --auto --config /path/to/dsh-paoding.config.yml
./install.sh --auto --config-ui     # apply the preset and mount the visual config UI (see §7)
./install.sh --wizard < answers.txt # force the wizard even on a non-TTY, reading answers from stdin
```

CLI options (from `tools/install.mjs` usage):

| Option | Description | Default |
|---|---|---|
| `--auto` | Non-interactive: apply the config file when present; otherwise write the **base template** (DSH's built-in base tools only; with `--suggest` it uses smart defaults — identical to the static preset — zero regression — when no host tools exist) | off |
| `--config <file>` | Config file path (`--config=<file>` also accepted) | `$DSH_HOME/dsh-paoding.config.yml` |
| `--wizard` | Force the interactive wizard; reads answers line by line from stdin even when it is not a TTY, for scripts/CI (the npx entry uses it to reach the wizard too) | off |
| `--suggest` | On a fresh install, use smart defaults instead: detected MCP/host tools are assigned automatically to roles and the main agent (the old behavior) | off |
| `--no-ui` | Skip mounting the config UI (the npx one-command install mounts it by default; this turns that off) | off |
| `--profile <name>` | Which profile's patch layer is scanned | `web` |
| `--patch <file>` | Extra patch override file(s) to scan; repeatable (see §5) | none |
| `--dry-run` | Print only the detection report and the allow lists to be generated; write nothing | off |
| `--config-ui` | Also mount the config UI into the DSH Settings page while applying the preset (see §7) | off |
| `--help` / `-h` | Print usage and exit | — |

Environment: `DSH_HOME` overrides the home directory (default `~/.dsh`).

**Base template** (the new default on a fresh install — `--auto` with no config file): only DSH's built-in base tools are written — the main agent's 21 core tools plus each delegated role's base set; detected host/MCP tools are not written in. The detection report still prints and the config UI's candidate list still shows every recognized tool, so you can opt in after installing.

**Smart defaults** (only with `--auto --suggest` and no config file — the old behavior): `codegraph` MCP tools and `memory_search` go to the main agent; other MCP servers are routed to the three default roles by tool-name keywords (names matching `search|research|crawl|extract|map|web` → `search_external`; `code|fs|file|write|edit|bash|exec|run` → `implement`; `design|render|image|screenshot|paint` → `design`; otherwise → `search_external`); a role that would end up with an empty allow refuses the **installation**.

Writing `main_agent_extra: []` explicitly in the config means "intentionally empty": re-runs never backfill it from smart defaults; only configs that lack the key get backfilled.

**Non-TTY stdin guard**: when stdin is not a TTY and none of `--auto`, `--config` (no existing config), or `--dry-run` is given, the installer errors out immediately (suggesting `--auto`) instead of letting the wizard hang in a terminal-less environment. `--dry-run` is safe to use without a TTY.

On success the output prints the next steps: restart the host or open a new session, then pick「编排模式 (Orchestrator)」in the preset selector (see §6).

## 5. Host Patch Detection

Why the installer exists: DSH runs `tools.restrict()` when a child agent is created, and **every name in an allow list must exist in the registry visible to the child**, otherwise creation is rejected (unknown tools). The only machine-dependent part of that registry is the host patch layer, so the installer never ships a fixed allow list: at install time it reads the patch layers, detects which tools are **actually enabled**, and rewrites the `toolFilter.allow` of the three default roles (`search_external` / `design` / `implement`) and of any custom roles you create using「configured / static intent ∩ actually detected tools」— the installed preset can never go stale when a host tool is disabled.

### Patch layers scanned

All layers are included in order (`--patch` adds extra layers on top of the home/profile ones; detection unions the enabled entries across all layers):

| # | Layer | Path | When missing |
|---|---|---|---|
| 1 | home layer | `$DSH_HOME/cordis.patch.yml` | skipped |
| 2 | profile layer | `$DSH_HOME/profiles/<profile>/cordis.patch.yml` | skipped (default profile = `web`; change with `--profile`) |
| 3 | extra overrides | `--patch <file>` (repeatable) | warned and skipped |

### Detection of MCP servers and local plugins

- **Enablement**: a patch entry counts as enabled unless it is disabled (`enabled !== false` and no `disabled`); plugins additionally consult `config.enabled`.
- **MCP server recognition**: the entry name ends with `dsh-mcp-client`, or the config carries a `serverName` with transport `stdio` / `streamable-http` / `sse` (or a `command`).
- **Exact tool-name resolution** (`toolFilter.allow` matches exact names — no globs, so names must be spelled out): well-known servers come from a static table — `tavily` → 5 tools (`tavily_search` / `tavily_crawl` / `tavily_extract` / `tavily_map` / `tavily_research`), `codegraph` → `codegraph_explore`; unknown servers go through a live JSON-RPC handshake (stdio spawns the process and sends `initialize` + `tools/list`; streamable-http uses POST; **15-second timeout**), resolving the returned tool names to `mcp__<server>__<tool>`.
- **Local tool plugins**: patch entry names are matched against a whitelist and their tools registered, e.g. `magic-memory` → `memory_search` (adding a plugin requires extending the whitelist — see `KNOWN_HOST_PLUGINS` in `tools/install.mjs`).
- **Skipped without failing**: servers whose handshake fails, times out, or uses an unsupported transport such as `sse` are skipped — the affected roles simply lack those tools and the install does not error (the report marks them `handshake failed` with the reason; URLs/keys are redacted).

### Allow-list rewriting

For every rewritten role: allow entries that **depend on the host** (`mcp__*` and known plugin tools) are kept only inside the intersection with the detection inventory; **base tools guaranteed by the standard composition** (read/write/edit/glob/grep/bash/skill/web_search and similar) are untouched and never filtered. The result = configured intent ∩ actually enabled tools: disabled host-tool names are dropped automatically, so `tools.restrict()` never reports unknown tools. The main-agent side works the same way: host-dependent names in `restrict.mjs`'s base allow are filtered by the detection result, host tools from `main_agent_extra` and custom-role toolNames are injected into `config.allow`, and `main_agent_remove` entries are removed (an empty result **refuses to install**, preventing a runtime rejection of an empty allow). Other static delegation rows that the installer does not rewrite (e.g. `search_internal_deep`) stay as-is.

**When to re-run**: after changing patch configuration (enabling/disabling MCP servers or plugins, adding/removing `--patch` files), re-run `./install.sh --auto` (the npx entry works the same) to resync the allow lists; the installer also compares timestamps of patch files against the last generated output and prints a reminder when a patch is newer. Use `--dry-run` first to preview what would be removed.

### Parsing and validation

Patch and config files are parsed with the **`yaml` package**, loaded lazily via `createRequire` from `$DSH_HOME/node_modules` (typically a symlink to DSH's npx node_modules, which ships yaml v2); when unavailable, a **minimal built-in YAML subset parser** is used (expects a top-level list/mapping; handles common scalars and `- insert:` wrapping). Before parsing, cordis `!!js` expressions found in real patch files are neutralized (`process.platform` / `process.cwd()` are replaced with their evaluated values). Role allow/persona blocks in the source `agent.cordis.yml` are located by yaml AST byte ranges where possible (indent-preserving, byte-exact replacement), falling back to a structured regex; the generated result is structurally validated as YAML (after substituting `!!js` placeholders) before anything is written, so structural errors abort without writing.

### Typical examples

Example 1 — disabling tavily: after commenting out tavily's mount row in `$DSH_HOME/cordis.patch.yml`:

```bash
./install.sh --auto --dry-run   # preview: search_external's allow would drop the 5 mcp__tavily__*
                                #          entries; the report lists removed names + reasons
                                #          (e.g. "tavily MCP not enabled")
./install.sh --auto             # apply
```

Example 2 — disabling a plugin: re-run `--auto` after disabling magic-memory; `memory_search` is dropped from every role's allow automatically. To restore it, re-enable the plugin and re-run.

Example 3 — extra `--patch` file: keep additional MCP/plugin config in a separate file and pass `--patch <file>` so detection includes it (no need to touch the home/profile layer files).

## 6. Apply & Activate

After the install finishes (wizard or `--auto`), the artifact is the static directory under `$DSH_HOME/.agent-presets/orchestrator/` — nothing needs a restart to be safe, and re-running the installer after config changes simply rewrites this directory:

1. **Restart the host, or open a new session** (presets are loaded when a session is created; the preset selector refreshes per new session).
2. Pick「**编排模式 (Orchestrator)**」in the **new-session preset selector**.
3. To make it the default for every new session: set it in **Settings → Agent Presets**.

**Upgrading**: regenerate from the updated repo — pull the new source with `git pull`, then:

```bash
cd dsh-paoding
./install.sh --auto       # applies the existing config idempotently (try --auto --dry-run first)
```

On the npx/npm entry it is even simpler: re-run `npx dsh-paoding@latest` (or `npx github:lifangjin/dsh-paoding` before the npm release) — the config file is applied when present, as always.

Because the artifact is a static directory generated from the repo source, upgrading / reinstalling / uninstalling never affects the host's other configuration (MCP, plugins, sessions), with zero coupling to DSH source code.

**Uninstalling**: delete the preset directory (config UI uninstall is in §7; `dsh-paoding.config.yml` is not removed with the preset — keeping or deleting it does not affect other presets, and a later install with `--auto` applies it again):

```bash
rm -rf "$DSH_HOME/.agent-presets/orchestrator"
rm -rf "$DSH_HOME/dsh-paoding"   # npx/npm installs only: remove the package copy the installer made
```

After that,「编排模式 (Orchestrator)」no longer appears in the preset selector of new sessions.

## 7. Config UI (Optional)

When hand-editing `dsh-paoding.config.yml` or using the terminal wizard is not desired, the visual config UI can be mounted as a plugin into the **设置 → 庖丁配置** section (Settings → Paoding Config) of the DSH Web GUI. It shares the same detection/generation pipeline as the CLI (`collectState` / `generateAndInstall`), so it is WYSIWYG.

### Mounting

```bash
cd dsh-paoding
./install.sh --auto --config-ui
```

After applying the preset, `--config-ui` **idempotently** does two things: it symlinks this repo's `plugins/paoding-config-ui` into `$DSH_HOME/node_modules/paoding-config-ui` (skipped when the link already exists and points here; an existing link to another source errors out, telling you to delete the stale link first), and it ensures an enabled mount row exists in `$DSH_HOME/cordis.patch.yml` (appended when missing; automatically un-commented when commented out):

```yaml
- insert:
    - id: paoding-config-ui
      name: paoding-config-ui
```

Then **restart DSH (`dsh web`)**; the "庖丁配置" (Paoding Config) section appears in the Settings page.

On the npx/npm entry there is no repository directory to link: the installer instead copies the whole package to `$DSH_HOME/dsh-paoding` (see §2) and mounts from there; only the clone-and-run-`./install.sh` route uses the symlink shown above. Both forms present the same `paoding-config-ui` package to DSH, so the loading mechanism in the next subsection is identical.

### Loading mechanism

- cordis resolves the package name `paoding-config-ui` in the patch row via `$DSH_HOME/node_modules`;
- DSH's client-modules half-scans the package's `dsh.client` declaration in `package.json` plus `exports["./client"]`, compiling `lib/client.js` into the browser's `__DSH_BOOT__` (served at `/plugins/paoding-config-ui/client.js`);
- the browser kernel creates a loader entry for each manifest plugin and activates it (the bundle registers via `window.__ModuleLoader__.load({ id: "paoding-config-ui", factory })`; the id must equal the package name / graph-row id);
- the client `apply()` waits for the settings shell to declare its slot via `ctx.slots.inject("settings.section")`, then registers the section with `slots.register()` — `id: "paoding"`, `order: 50`, `label: 庖丁配置` ("Paoding Config") (the same pattern as the built-in General section; id/order/label drive the settings navigation).

### API and security

The panel talks to the same-origin **`/api/paoding/*`** routes: the Node side registers prefix routes — `GET /api/paoding/state` (cached detection state), `POST /api/paoding/rescan` (forced re-detection, including MCP handshakes), `POST /api/paoding/preview` (generate without writing), `POST /api/paoding/apply` (install and save the config) — reusing the detection/generation pipeline of `tools/install.mjs` via `plugins/paoding-config-ui/api-core.mjs`. The routes carry a **browser trust fence**: the Host must be loopback or in `webRuntime.trustedHosts`, and cross-site requests are rejected (mirroring DSH's `/api` gateway fence semantics, because the longer `/api/paoding` prefix would hit this plugin and bypass that gateway). The config UI has **no separate server or port**: the DSH Web port listens on `127.0.0.1` only, never exposed to the public network.

### Panel capabilities

- **Status & actions**: top buttons「**保存并应用**」(Save & Apply)、「预览生成」(Preview)、「重新检测」(Rescan); a detection summary with chips (current profile, each MCP server with its tool count, plugin chips, skill counts, etc.).
- **Agent tool assignment cards**: a fixed card for the main agent (unchecking a base tool adds it to `main_agent_remove`, removing it from the main agent; checking a host tool adds it to `main_agent_extra`; two skill groups「read 按需」and「内联全文」; plus a「人设追加」editor that can edit, clear, or restore the persona tail to its default) — plus cards for the three built-in roles `search_external` / `design` / `implement` and any custom role (with a delete button); every role card lets you check/uncheck base and host tools and edit the persona. A「新建自定义 agent 角色」button sits at the bottom.
- **Skill assignment**: one row per skill; check which agents it is assigned to (written into the corresponding persona's `Available skills` soft guidance; role skills are soft-guided, main-agent skills have the separate read-on-demand / inline groups).
- **Preview**: generates `agent.cordis.yml` without writing, showing each role allow's intent → kept counts and the full generated text.
- **Save & Apply**: after confirmation, writes the preset (overwriting `$DSH_HOME/.agent-presets/orchestrator`) and saves the current assignments to `$DSH_HOME/dsh-paoding.config.yml` — equivalent to `./install.sh --auto` plus the wizard's config save; on success it prompts that a DSH restart or a new session is required (and that a patch newer than the generated output takes effect after restart).

### Uninstalling the UI

```bash
rm -f "$DSH_HOME/node_modules/paoding-config-ui"   # 1) remove the symlink
# 2) comment out the three-line paoding-config-ui mount row in $DSH_HOME/cordis.patch.yml
# 3) restart DSH (dsh web)
```

The section disappears from the Settings page; the generated preset and the config file are unaffected. For the full npx/npm uninstall (including removing `$DSH_HOME/dsh-paoding`), see §6.

## 8. Troubleshooting

**Node.js missing**

Running `./install.sh` reports `error: node (>=18) is required to run the dsh-paoding installer`: `node` is not on the PATH or is older than 18. Install Node.js ≥ 18 and retry.

**Preset missing from the selector**

Presets are loaded when a session is created: restart the host (`dsh web`) or open a new session and look at the selector again. If it is still missing, check the install target: `ls "$DSH_HOME/.agent-presets/orchestrator"` should show three files (`agent.cordis.yml`, `preset.yml`, `restrict.mjs`); if empty, the `$DSH_HOME` used at install time probably differs from the home directory DSH actually uses (re-run with an explicit `export DSH_HOME=…`).

**unknown tools on child creation**

An allow list contains a name absent from the child's registry — most often because the installer was **not re-run after enabling/disabling an MCP server or plugin**. Re-run `./install.sh --auto` to resync (use `--auto --dry-run` first to see what would be removed); hand-written names of tools that are not mounted trigger the same error.

**"requires a terminal" error**

When stdin is not a TTY (scripts, CI, remote execution) and none of `--auto` / `--config` / `--dry-run` is passed, the installer refuses to start so the wizard cannot hang: use `./install.sh --auto` (applies the config when present, writes the base template otherwise), or feed answers from stdin in scripts via `./install.sh --wizard < answers.txt`. The npx one-command install carries `--auto` built in and runs fine without a TTY.

**A role is missing an MCP tool**

MCP servers whose handshake failed or whose transport is unsupported are skipped (the report marks them `handshake failed`): the affected roles simply lack those tools and the install does not error. Verify the server can start / be reached on its own and re-run; well-known servers (tavily, codegraph) are resolved from the static table without a handshake and never hit this case.

**Skills not appearing in a persona**

Role skills can only be assigned to roles whose allow contains `skill`; main-agent skills go through `main_agent_skills` (soft rows) or `main_agent_skills_inline` (inline). A skill whose SKILL.md cannot be found (searched under `$DSH_HOME/skills`, `~/.agents/skills`, and the working directory's `.dsh`/`.agents/skills`) is warned about and skipped — make sure the skill is installed under one of those roots.

**Where is the config file**

Both the wizard and the config UI write to `$DSH_HOME/dsh-paoding.config.yml` (default `~/.dsh/dsh-paoding.config.yml`); the CLI can point elsewhere with `--config <file>`, and the config UI's status area shows the current config file path. To reset all choices: delete the file — `./install.sh --auto` (or re-running the npx one-command install) then falls back to the base template; add `--suggest` to fall back to smart defaults instead.

**The installed preset or config is broken**

The preset is a static directory, so simply reinstall: fix the config and run `./install.sh --auto` (or delete `$DSH_HOME/.agent-presets/orchestrator` and re-run the wizard). Note the installer refuses installs where a role's allow would be empty or the main agent's tools would be emptied, preventing presets that are bound to fail at runtime.

**The Config UI section is missing**

Check in order: whether DSH was restarted after mounting; for npx/npm installs, whether `$DSH_HOME/dsh-paoding` exists (npx cache cleanup never touches it; if it is missing, re-run the one-command install); for clone installs, whether the `$DSH_HOME/node_modules/paoding-config-ui` symlink points at this repo's `plugins/paoding-config-ui` (`--config-ui` errors when it points elsewhere); and whether the `paoding-config-ui` mount row in `$DSH_HOME/cordis.patch.yml` is enabled (not commented out). Once all are fine, restart DSH and reopen the Settings page.
