← [dsh-paoding](../README_en.md) ｜ **Installation** ｜ [Architecture](architecture_en.md) ｜ [Orchestration](orchestration_en.md) ｜ [Configuration](configuration_en.md)

[中文](installation.md) · English

# Installation

This document is for users who install, upgrade, or uninstall the dsh-paoding「编排模式 (Orchestrator)」preset ("编排模式" is Chinese for "Orchestration Mode"): §1 prerequisites, §2 the single official install channel (`dsh plugin add`) and first-install automation, §3 upgrading, §4 dev-checkout install, §5 host patch detection at generation time, §6 the Paoding Config panel, §7 uninstalling, §8 troubleshooting.

## 1. Prerequisites

Check the following before installing:

- **Node.js ≥ 18**. The DSH host and the plugin chain both run on Node; with an older version `dsh` won't start in the first place. Check with `node --version`.
- **pnpm available**. `dsh plugin` is a transparent pass-through to pnpm: installing a plugin package into a profile is done by pnpm. If pnpm is missing the install command fails with a pnpm error — install pnpm (`npm i -g pnpm` or `corepack enable`) and retry.
- **A working DSH host** (the `dsh` command, including its Web/agent runtime; **@deepseek-ai/dsh ≥ 0.1.5**, the minimum supported version). This plugin does not modify DSH source code; it only writes the orchestrator preset into DSH's preset roster and mounts the Paoding Config page into the Web sidebar, so a usable DSH home directory must exist first.
- **Path facts** (constants built into the generation pipeline; know them before customizing):

| Item | Default | Description |
|---|---|---|
| `$DSH_HOME` | `~/.dsh` | The DSH home directory (the `DSH_HOME` environment variable is honored, defaulting to `$HOME/.dsh`). The home-layer `cordis.patch.yml`, `node_modules`, `profiles/<name>/cordis.patch.yml`, and plugin profile directories live under it |
| preset roster root | `$DSH_HOME/.agent-presets/` | The directory `dsh-agent-presets` scans for locally authored presets |
| Install target of this preset | `$DSH_HOME/.agent-presets/orchestrator` | The generated artifact: `agent.cordis.yml` (rewritten role config), `preset.yml`, `restrict.mjs`, and the `.generator-version` marker — a static directory |
| Config file | `$DSH_HOME/dsh-paoding.config.yml` | Role/tool assignments written by the Paoding Config panel's Save & Apply (`0o600`, hand-editable); first-install automation reads and writes it too |

- **Environment variables**: `DSH_HOME` overrides the DSH home directory (default `~/.dsh`); `DSH_PAODING_CONFIG` overrides the config-file path (honored by the panel; the in-repo fallback CLI uses `--config <file>` instead).

Inside the repository, `presets/orchestrator/` is the static preset source (the pipeline reads and rewrites `agent.cordis.yml`; `preset.yml` and `restrict.mjs` are copied as-is — the one exception: when `main_agent_display_name` (or a workspace-derived display name) is configured, the `name:` line of `preset.yml` is rewritten), `tools/` is the generator itself (shared by the panel and the fallback CLI), and `plugins/paoding-config-ui/` is the Paoding Config panel plugin. For plain usage you never need to touch any of these — see the next section.

## 2. Install: the single official channel

No clone needed — one command, then one restart:

```bash
dsh plugin --profile web add dsh-paoding
```

Equivalent shortcut: `npx dsh-paoding@latest` (delegates to the command above; default profile web; requires dsh on PATH).

After installing, **restart DSH (`dsh web`)** and you're done — no further install commands, no buttons to click.

Behind the scenes the command does two things:

1. `dsh plugin`, a transparent pass-through to pnpm, installs the npm package `dsh-paoding` into the given profile's `node_modules`;
2. the `dsh.bundle.patch` declared at the package root (a `cordis.patch.yml` with a single insert: `id: paoding-config-ui` / `name: dsh-paoding`) is merged by `reconcilePlugins` into that profile's startup layer, and at boot the Paoding Config page is mounted into the Web sidebar's bottom action bar (above the Settings row).

The orchestrator preset needs no separate install — the plugin fills it in automatically at startup; see first-install automation below.

### Profile semantics

`--profile web` decides which profile the plugin is installed into: the Paoding Config page appears only in a DSH Web launched with that profile. `web` is the default profile of `dsh web`, so most machines need no change; multi-profile users run `dsh plugin add` once per profile they want it in. The orchestrator preset itself lives under `$DSH_HOME/.agent-presets/` and is shared machine-wide, independent of profiles — Save & Apply from any profile's panel writes the same preset.

### First-install automation: restart = full install

At startup the plugin checks whether the orchestrator preset is in place: if the `$DSH_HOME/.agent-presets/orchestrator` directory is missing, or its `.generator-version` marker does not match the plugin package version, it automatically performs one install equivalent to `--auto` — applying `~/.dsh/dsh-paoding.config.yml` when it exists, writing the base template otherwise (DSH base tools only; see below). It runs the same detection/generation pipeline as the panel's Save & Apply (`collectState` / `generateAndInstall`) — the same pipeline, but the startup self-heal detects with a pure file scan and no runtime detection facts while the panel detects with them; when a bundle-form plugin is installed on the host, the two detection inventories may differ, and the outputs differ slightly with them.

So **`dsh plugin add` + restart = a complete install**: preset generated, config template on disk, panel ready — all in one step. If the automatic generation fails it never takes the plugin down — a warning is logged, and you can apply manually from the panel.

### The version marker and auto-regeneration

The `.generator-version` marker (its content = the generator version) is written by the plugin's startup self-heal after it generates the preset. The panel's Save & Apply and CLI generation do a full-directory rebuild and write no marker — the rebuild removes the old marker, so the next DSH start's self-heal finds it missing, runs one extra generation, and rewrites the marker (same output, just one extra round). The version-mismatch trigger is unchanged: after a plugin upgrade the marker no longer matches the package version, so the next DSH start regenerates the preset against the new version — the "upgraded the plugin but the preset is stale" drift is eliminated. The marker triggers regeneration only when missing or version-mismatched, and the panel does not watch the config file; to regenerate from the current config right away, hit Save & Apply.

### Base template and tool opt-in

A fresh install (no config file) generates the base template: only DSH's built-in base tools — the main agent's 21 core tools plus each delegated role's base set. Detected host/MCP tools are **not written in** by default. The detection pipeline still runs: open 庖丁配置 in the sidebar, the candidate list shows every recognized tool, opt in as needed, and hit Save & Apply.

### Apply & activate

Once installed:

1. **Restart the host, or open a new session** (a preset is loaded when a session is created; the preset selector refreshes per new session).
2. Pick「**编排模式 (Orchestrator)**」in the **new-session preset selector**.
3. To make it the default for every new session: set it in **Settings → Agent Presets**.

**Applied a hand-edited config — now what?** Open the 庖丁配置 (Paoding Config) entry in the sidebar bottom action bar (above the Settings row) — the panel loads the hand-edited config file as its current values — then hit「**保存并应用**」(Save & Apply). That is the only apply trigger for a pure plugin user; the panel does not watch the config file, and the version marker only triggers auto-regeneration on new versions.

## 3. Upgrading

**One-click upgrade in the panel (recommended)**: the panel compares your local version against the latest npm registry publish (GitHub release as fallback) and points to the release page when a newer one is out. Click the Upgrade button and the panel runs this in place:

```bash
dsh plugin --profile <name> update dsh-paoding
```

(the profile is auto-detected; usually nothing to fill in). The upgrade only swaps the plugin package inside the profile — the running process's code is untouched; on success it asks you to **restart DSH**, and at restart the preset regenerates itself against the new version via the `.generator-version` marker.

Manual equivalent: run the `dsh plugin update` command above yourself, restart, done.

A **dev link: checkout** (see §4) has no version to compare and cannot be upgraded in place: the panel tells you to run `dsh plugin add dsh-paoding@latest` to switch back to the registry version.

If the check fails (offline, rate-limited), it stays silent and nothing is interrupted.

## 4. Dev-checkout install (link: form)

To hack on the plugin or the preset sources, point the plugin at the repository in link form (pnpm link semantics):

```bash
git clone https://github.com/lifangjin/dsh-paoding.git
cd dsh-paoding
dsh plugin --profile web add link:"$PWD"
```

The package sits directly on the repository directory; changes go live via HMR or a restart, with no reinstalls. This form cannot be upgraded in place (see §3); to switch back to the registry version, run `dsh plugin --profile web add dsh-paoding@latest`.

An **in-repo fallback CLI** also exists (not advertised; for developers who cloned the repo): `node tools/install.mjs --auto` (apply the config if present, else write the base template), `--dry-run` (print the detection report and the would-be allow lists without writing anything), `--config <file>` (select a config file), `--suggest` (on a fresh install without a config file, seed smart defaults that assign host tools; the default base template leaves host tools out), `--profile <name>` (which profile's patch layer to scan, default `web`). Without `--auto` (and without the read-only `--dry-run`) it refuses to run — interactive install has been removed; visual configuration belongs to the Web panel that ships with the plugin channel.

## 5. Host patch detection

The reason the generation pipeline detects anything: DSH runs `tools.restrict()` when a subagent is created, and **every name on the allow list must exist in the subagent's visible registration surface**, or the creation is rejected (unknown tools). The only machine-dependent part of that surface is the host patch layer, so instead of hard-coding allows the generator reads the patch layer at generation time, detects which tools are **actually enabled**, and rewrites the `toolFilter.allow` of the three default roles (`search_external` / `design` / `implement`) and of any custom role you create as "configured/static intent ∩ actually detected tools" — the generated preset never goes stale because a host tool was disabled.

### Patch layers read

All layers are **included** (detection unions the enabled entries across layers):

| # | Layer | Path | When missing |
|---|---|---|---|
| 1 | home layer | `$DSH_HOME/cordis.patch.yml` | skipped |
| 2 | profile layer | `$DSH_HOME/profiles/<profile>/cordis.patch.yml` | skipped (default profile = `web`) |
| 3 | extra overrides | `--patch <file>` (repeatable; fallback-CLI flag) | warning and skipped |

### MCP servers and local tool plugins

- **Enabled test**: a patch entry counts as enabled unless disabled (`enabled !== false` and no `disabled`); plugins additionally check `config.enabled`.
- **MCP server recognition**: the entry's package-name segment **exactly equals** `dsh-mcp-client` (scoped/sub-path forms compare the last `/` segment; a name like `not-dsh-mcp-client-foo` does not match), or the config carries a `serverName` with transport `stdio` / `streamable-http` / `sse` (or has a `command`).
- **Exact tool-name resolution** (`toolFilter.allow` matches exact names, no globs — names must be spelled out): the detection order is that **every `stdio` / `streamable-http` server gets a live JSON-RPC handshake first** (stdio spawns the process and sends `initialize` + `tools/list`; streamable-http POSTs; **15-second timeout**), and the returned tools become `mcp__<server>__<tool>` names; the static known table (`tavily` → 5 tools `tavily_search` / `tavily_crawl` / `tavily_extract` / `tavily_map` / `tavily_research`, `codegraph` → `codegraph_explore`) is only the degraded fallback when a **known** server's handshake fails — tools are kept per the table, the report flags a static table, and no tools are lost; only an unknown server that fails the handshake is skipped entirely.
- **Local tool plugins**: matched against a whitelist of patch entry names, registering their tools, e.g. `magic-memory` → `memory_search` (new plugins extend the whitelist — `KNOWN_HOST_PLUGINS` in `tools/lib/host.mjs`).
- **Skipped, not fatal**: "servers whose handshake fails, times out, or uses a transport without live discovery (`sse`) are skipped" applies to **unknown servers** only — such a server is skipped entirely, the role simply lacks those tools, and generation raises no error (the report flags `handshake failed` with the reason; URLs and keys are masked); known servers fall back to the static table on a failed handshake and keep their tools, so they never land here.

### Allow-rewrite rules

For each rewritten role, every allow name is checked against a **whitelist**: it must belong to the **preset's own tool face** (the `restrict.mjs` main-agent allow ∪ the static role allows in the source preset) or to the **detection inventory**; a name in neither (a `mnemon_*` left over from a disabled plugin, a typo) is dropped, and the removed list in the Preview / CLI report says why. Within that, names that **depend on the host** (`mcp__*` and known plugin tools) survive only when actually detected, even when they are part of the source preset; plugin tools registered directly under their own names (such as `mnemon_*`, no `mcp__` prefix) are reconciled against the detection inventory the same way; the **base tools guaranteed by the standard composition** (read/write/edit/glob/grep/bash/skill/web_search etc.) are already part of the preset face and pass without detection. The result = configured intent ∩ actually enabled tools: disabled host tools drop out automatically, so `tools.restrict()` never hits unknown tools. The main-agent side works the same way: host-dependent names in `restrict.mjs`'s base allow are filtered by detection, host tools added via `main_agent_extra` and custom-role toolNames are injected into `config.allow`, and `main_agent_remove` removes entries (an empty removal result is **rejected**, guarding against an empty runtime allow that would refuse to load). Delegation rows the generator does not rewrite (e.g. `search_internal_deep`) are kept as-is.

**When to re-apply**: after changing patch configuration (enabling/disabling MCP servers or plugins, adding/removing extra patch files), hit Save & Apply once in 庖丁配置 to sync the allows — to preview what would be dropped first, use Preview, or the fallback CLI's `--dry-run`. The fallback CLI also compares patch-file timestamps against the last generation and prints a reminder when a patch has changed since.

### Parsing and validation

Patch and config files are parsed with the **`yaml` package** — loaded lazily via `createRequire` from `$DSH_HOME/node_modules` (that directory is managed by the dsh host, profile installs included, and ships yaml v2); when unavailable it falls back to a **built-in minimal YAML-subset parser** (expects a top-level list/mapping, supports common scalars and the `- insert:` wrapper). Before parsing, the cordis `!!js` expressions found in real patch files are neutralized (`process.platform` / `process.cwd()` replaced by their evaluated values). Locating the role allow/persona blocks in the source `agent.cordis.yml` prefers yaml AST byte ranges (indentation-preserving, exact replacement) and falls back to structural regexes; before anything is written, the generated text passes a YAML structural validation (parse with `!!js` placeholders) — a structural error aborts the write entirely.

### Typical examples

Example 1 — disabling tavily: after commenting out tavily's mount rows in `$DSH_HOME/cordis.patch.yml`, click Preview in 庖丁配置 — the `search_external` allow drops the 5 `mcp__tavily__*` names, with removed entries and reasons listed (e.g. "tavily MCP 未启用" / "tavily MCP not enabled"); then hit Save & Apply (developers can also use the fallback CLI: `node tools/install.mjs --dry-run` to preview, `--auto` to apply).

Example 2 — disabling a plugin: disable magic-memory and re-apply; `memory_search` drops out of every role allow automatically. To restore, re-enable the plugin and re-apply.

Example 3 — extra patch files: put extra MCP/plugin config in a separate file and include it at detection time with the fallback CLI's `--patch <file>` (no need to touch the home/profile layer files).

## 6. The Paoding Config panel

If you'd rather not hand-edit `dsh-paoding.config.yml`, open the **庖丁配置 (Paoding Config)** entry in the sidebar bottom action bar (above the Settings row). It shares the exact same detection/generation pipeline (`collectState` / `generateAndInstall`) as the first-install automation and the fallback CLI — what you see is what gets written; the panel ships with the plugin channel, so installing the plugin is all it takes.

### Loading mechanism

- cordis resolves the package name `dsh-paoding` from the patch row against the profile's `node_modules`;
- DSH's client-modules node half-scan reads the package's `dsh.client` declaration and `exports["./client"]`, compiling `lib/client.js` into the browser's `__DSH_BOOT__` (served as `/plugins/paoding-config-ui/client.js`);
- the browser core creates and activates a loader entry for every plugin in the manifest (the bundle registers as `window.__ModuleLoader__.load({ id: "paoding-config-ui", factory })`; the id equals the patch row's id);
- the client `apply()` registers the 庖丁配置 entry through the host's `sidebar.footer.action` keyed slot (`slots.register`, the same slot as the plugin-hub cordis badge, rendered in the action bar above the Settings row) rather than injecting sidebar DOM itself; the MutationObserver is only used to bridge the workspace "…" menu (recognizing the menu DOM and adding a 庖丁-config deep-link item). Clicking mounts the container (`data-dsh-paoding-view`) into the session's middle column and renders the full-page configurator with `createRoot`, the open state driven by `html[data-dsh-paoding-active]`, mutually exclusive with the memory / taskboard / ssh full-page panels.

### Data interface and security

Panel data goes over the **same-origin `/api/paoding/*`**: the Node side registers prefix routes — `GET /api/paoding/state` (cached detection state), `GET /api/paoding/models` (model list from the host LLM runtime), `GET` + `POST /api/paoding/workspaces` (list / add workspaces), `POST /api/paoding/rescan` (forced re-detection, MCP handshakes included), `POST /api/paoding/preview` (generate without writing), `POST /api/paoding/apply` (install and save config), `POST /api/paoding/upgrade` (in-place `dsh plugin update`), `GET /api/paoding/client.css` (statically served panel stylesheet) — reusing the detection/generation pipeline in `tools/` (`plugins/paoding-config-ui/api-core.mjs`). The routes carry a **browser trust fence**: the Host must be loopback or listed in `webRuntime.trustedHosts`, and cross-site requests are rejected (mirroring DSH's `/api` gateway fence semantics, since the longer `/api/paoding` prefix would otherwise hit this plugin and bypass the gateway). The panel has **no separate server or port**: the DSH Web port listens on `127.0.0.1` only and is never exposed to the outside.

### Panel capabilities

- **State and actions**: the page header is a title + version/update card (in-place new-version notice and one-click upgrade) + subtitle, and the body goes straight to the workspace and role cards with no separate detection-summary/chips section; the action buttons「**保存并应用**」(Save & Apply), Preview, and Rescan sit in a sticky bottom dock, clickable from any scroll position.
- **Agent tool-assignment cards**: one fixed card for the main agent (unchecking a base tool adds it to `main_agent_remove`, dropping it from the main agent; checking an MCP / plugin tool adds it to `main_agent_extra`; skills in two groups, "read on demand" and "inline full text"; plus a "persona extra" editor — edit, clear, or restore the default) ＋ three built-in role cards (`search_external` / `design` / `implement`) ＋ any number of custom role cards (with a delete button); every role card presents its tools in three groups — base / MCP / plugin — with per-item checkboxes, and the persona is editable. "Create a custom agent role" at the bottom.
- **Skill assignment**: one row per skill, check which agents it goes to (written into the matching personas as `Available skills` soft guidance; role skills are soft guidance, main-agent skills have the read-on-demand/inline groups).
- **Preview**: generates `agent.cordis.yml` without writing, showing each role's intent → kept counts plus the full generated text.
- **Save & Apply**: after confirmation, writes the preset (overwriting `$DSH_HOME/.agent-presets/orchestrator`) and saves the current assignments to `$DSH_HOME/dsh-paoding.config.yml`; success asks you to restart DSH or start a new session (and flags when a patch is newer than the generated output). Opening the panel loads the existing config file as the current values — hand-edited choices are visible and editable right away.

## 7. Uninstalling

Three commands, and it's gone cleanly:

```bash
dsh plugin --profile web remove dsh-paoding
rm -rf "${DSH_HOME:-$HOME/.dsh}/.agent-presets/orchestrator"
rm -rf "${DSH_HOME:-$HOME/.dsh}/.agent-presets"/orchestrator-*
```

The first removes the plugin and the sidebar panel (scoped to the given profile), the second deletes the orchestrator preset directory, and the third removes the per-workspace preset directories (`orchestrator-<basename>`) created when you configured individual workspaces (if you never did, the glob matches nothing and it's harmless) — the base `orchestrator` directory is already gone with the previous command and is not covered by that glob. The config file `~/.dsh/dsh-paoding.config.yml` is not removed with them — keep it or delete it, it does not affect any other DSH configuration, and a reinstall's first-install automation would apply it again.

Uninstalling touches nothing else on the host (MCP, plugins, sessions), and stays decoupled from DSH source code; "编排模式 (Orchestrator)" disappears from the preset selector for new sessions.

## 8. Troubleshooting

**pnpm missing**

`dsh plugin add` fails with a pnpm error: `dsh plugin` relies on pnpm to install packages. Install it (`npm i -g pnpm` or `corepack enable`) and retry.

**The plugin is installed but "编排模式 (Orchestrator)" is not in the preset list**

The preset is generated automatically when the plugin starts: first make sure you **restarted DSH** after installing; presets load when a session is created, so after the restart you also need a new session for it to appear in the selector. Still nothing? Check the DSH log for `paoding-config-ui` warnings (a failed auto-generation is logged; apply manually from the panel), then check `ls "${DSH_HOME:-$HOME/.dsh}/.agent-presets/orchestrator"` — an empty directory usually means the plugin's runtime `$DSH_HOME` differs from the home directory you assumed (export `DSH_HOME=…` explicitly before launching DSH).

**`tools.restrict()` reports unknown tools / subagent creation is rejected**

A name on the allow list does not exist in the subagent's registration surface — most often because an MCP server or plugin was enabled/disabled **without re-applying**. Hit Save & Apply in 庖丁配置 to sync (Preview first if you want the drop list); hand-written names for tools that aren't installed trigger the same error.

**No 庖丁配置 entry in the sidebar**

First confirm the plugin is installed into the profile your DSH actually runs with (the `--profile` value used with `dsh plugin add`) and that you restarted DSH after installing — the panel is scoped per profile, so if it lives outside `web` you must launch DSH with that profile to see it. If both hold and it's still missing, check the startup log for whether the plugin loaded at all.

**An MCP tool is missing from a role**

At detection every stdio / streamable-http server gets a live handshake first: an unknown server whose handshake fails is skipped entirely (the report flags `handshake failed`) and the role simply lacks those tools — generation raises no error. Known servers (tavily, codegraph) fall back to the static table when their handshake fails and keep their tools, with the report flagging a static table — seeing that flag means the server was unreachable at detection time and the table's tool face may be stale. Check the server can start/connect on its own, then re-apply.

**Skills not written into a persona**

Skills can be assigned to any role — the generation layer appends an `Available skills:` soft-guidance line to each assigned role's persona; but to actually load a skill a role needs `skill` / `read` tools of its own (a role without the `skill` tool only gets the guidance line — nothing loads). Main-agent skills use `main_agent_skills` (soft rows) or `main_agent_skills_inline` (inline). A skill whose SKILL.md cannot be found (looked up per the configuration target: global scans the two user roots only, workspaces add the project-level roots — configuration guide §9) is warned about and skipped — make sure the skill is installed under one of the matching roots.

**I hand-edited the config file — how do I apply it?**

Open the 庖丁配置 (Paoding Config) entry in the sidebar bottom action bar (above the Settings row) — the panel loads the hand-edited file as its current values — and hit Save & Apply. The panel does not watch the config file, so hand edits do not take effect on their own; the version marker likewise only triggers auto-regeneration on new versions.

**Where is the config file?**

The panel's Save & Apply writes to `$DSH_HOME/dsh-paoding.config.yml` (default `~/.dsh/dsh-paoding.config.yml`; move it with the `DSH_PAODING_CONFIG` environment variable; the fallback CLI uses `--config <file>`). To reset every choice: delete the file and restart DSH — first-install automation treats it as "no config" and writes the base template.

**Cleaning up leftovers from the old npx/npm installs**

Released versions 0.2.x and earlier supported a direct `npx dsh-paoding` install: the whole package was copied to `~/.dsh/dsh-paoding`, and a `paoding-config-ui` mount row was written into the global `~/.dsh/cordis.patch.yml` (npx/npm form) or a `~/.dsh/node_modules/paoding-config-ui` symlink created (clone form). The new mount always goes through the plugin channel and no longer uses any of those locations (today's `npx dsh-paoding@latest` is merely a shortcut that delegates to `dsh plugin add`, and writes none of them either). To clean up:

```bash
rm -rf ~/.dsh/dsh-paoding                  # package copy from the old npx/npm form
rm -f ~/.dsh/node_modules/paoding-config-ui   # symlink from the old clone form
# then delete the id: paoding-config-ui mount section (three lines) from ~/.dsh/cordis.patch.yml
```

Restart DSH afterwards. If the sidebar ever shows a duplicate entry, this cleanup fixes that too — the plugin channel is now the only mount source.
