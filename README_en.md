# dsh-paoding (庖丁解牛)
English · [中文](README.md)

*Pao Ding carves the ox, blade gliding through — orchestrate DSH into role-based, on-demand agent presets.*

dsh-paoding (Chinese brand「庖丁」/ Pao Ding; 庖丁解牛, "Pao Ding carves the ox", from the Zhuangzi parable of the butcher whose blade never dulls because he cuts along the ox's natural seams) is a **preset generator and configurator** for DSH (DeepSeek Harness, an agent runtime). It reshapes DSH's default shape — one monolithic agent loading all ~60 tools on every request — into **one orchestrating main agent plus role-specialized sub-agents that load tools on demand**: the hot path (internal file search) stays on the main agent at zero delegation cost; the cold path (external research / design / implementation / whole-repo deep search) is delegated to sub-agents carrying only the tools their role needs — pay per use. Pure configuration plus one waterfall filter plugin with a ~130-line core; **zero DSH source changes**; hot-pluggable (usable in a new session right after install; uninstall is deleting a directory).

## Features

- **Role-based orchestration**: the main agent decomposes tasks and delegates along the task texture to four built-in roles — external research `search_external`, UI/design `design`, code implementation `implement`, and whole-repo deep search `search_internal_deep`.
- **Renameable main agent, deletable/restorable built-in roles**: `main_agent_name` changes two things at once — the deployed preset display name and the persona identity line; `roles_remove` deletes any of `search_external` / `design` / `implement` wholesale from the deployment (delegation block, tool surface, role persona and the main-agent delegation guidance all disappear), and the config UI offers a one-click restore at the end of the role list. Built-in roles can equally carry a **display name**: `roles.<toolName>.name` rewrites only the subject of that role's persona identity sentence (design with `name: UI 设计` gets `You are the UI 设计 agent.`) — the tool registration name / delegation call name and the delegation machinery stay untouched.
- **A dedicated model per role**: `roles.<toolName>.model` / `.provider` pin a role's sub-agents (built-in trio or a custom role) to a fixed model — e.g. `implement` always on the pro tier, research on a lightweight fast one; unset, they follow the main agent's current session model (see §2.5 of [Configuration](docs/configuration_en.md)).
- **Custom role agents — your own division of labor**: the four built-in roles are only a starting point; any combination of tools and skills can be registered as a new delegation tool, via the wizard, the `roles` config key, or the config UI. Build, say, a `ppt` agent carrying the `html-ppt` skill — from then on a single "turn this outline into a PPT" delegates to a dedicated slide-making sub-agent. The generator also appends the role's persona first line (its duty sentence) to the main-agent persona as a delegation row (keep that first line a short duty sentence); a role with no tools is rejected at apply time, so always give it at least one.
- **On-demand cold path**: research / design / implementation load their own tool surface only at delegation time (~3.0k–3.7k tokens per delegation, estimated) — pay per use.
- **Context isolation**: worker contexts stay small and specialized and are discarded after the run; the main agent integrates only summaries, so search dumps, design drafts and diffs never accumulate in its context.
- **Lower tool tax**: the main agent's tool surface drops from 60 to a 21-entry whitelist, ≈16.2k → ≈5.5k tokens per request (estimated, ≈66% less); whole classes such as `web_search`, `mcp__tavily__*`, `write`, `edit`, `skill`, `workflow`, `ralph` are removed from it.
- **Zero skill-catalog tax on the main agent**: `main_agent_skills` compresses each skill into one soft-guidance persona line (the main agent then loads the rules on demand with its own `read`); `main_agent_skills_inline` hard-inlines full text for skills that must always apply (e.g. caveman); catalog injection is gone.
- **Host tools auto-detected and injected at install time**: the installer scans the enabled MCP servers / local plugins / skills in the host patch layers, resolves exact tool names (`mcp__<server>__<tool>`, `memory_search`, …) and intersects them with each role's allow list — `tools.restrict()` never rejects a child agent for unknown tools; re-running `--auto` after disabling a plugin drops its tools automatically.
- **Zero DSH source changes, hot-pluggable by pure configuration**: a preset is a static directory; the install artifact is regenerated idempotently from "static source + config file", so no manual patches accumulate; a host restart or a new session picks it up.
- **Visual configurator**: after `./install.sh --auto --config-ui`, in the「设置 → 庖丁配置」settings section ("Pao Ding configuration") you can inspect and edit assignments graphically and write them to disk with「保存并应用」("Save & Apply") — it shares the same generation pipeline as the CLI.

## Architecture at a glance

```
┌─ main agent · Orchestrator preset ───────────────────────────────────────────────────┐
│ whitelist (21): role delegation ×4 + sub-agent management + internal-search hot path │
│ + coordination; duties: decompose → self-solve internal questions →                  │
│         delegate cold paths only → integrate summaries only                          │
│ tool tax ≈16.2k → ≈5.5k tokens/request (estimated)                                   │
└───────────┬───────────────────────┬───────────────────────┬───────────────────────┬──┘
            ▼                       ▼                       ▼                       ▼
    search_external             design                 implement          search_internal_deep
    external research           UI / design            write / edit code       whole-repo deep search
    web_search + tavily         may load design skills read/write/edit + bash  read-only, no network
    research summary only       specs, no final code   self-verify then report condensed summary only
```

The main agent keeps only an "orchestration + management + internal-search" surface — the hot path reaches files with zero delegation round-trip, while the four role sub-agents each carry only their own trade's tools and are discarded after the run. Why this costs less (the cost ledger), how it maps onto DSH's native mechanisms, token governance (including the landed compaction `thresholdRatio: 0.45`), and known limits are covered in [Architecture](docs/architecture_en.md).

## Quick Start

Prerequisites: **Node.js ≥ 18** (checked at `install.sh` startup) and a working **DSH host**. The installer uses only Node built-ins with zero runtime dependencies — no `npm install` after cloning. There are four built-in delegation roles; `search_internal_deep` is a static role outside the installer's managed set (to tune it, see [Configuration](docs/configuration_en.md)).

```bash
cd dsh-paoding
./install.sh              # interactive wizard (auto-starts when stdin is a TTY; equivalent to node tools/install.mjs)
./install.sh --auto       # non-interactive / config-driven: applies the config idempotently, or smart defaults (= static preset, zero regression) without one
./install.sh --dry-run    # print the detection report and the generated allow lists without writing anything
```

The wizard has six stages; pressing Enter on any question keeps the default / current value: **① Detection report** — scans MCP servers, local plugins and installed skills in the host patch layers and resolves exact tool names; **② Tool assignment** — each MCP server's tools go as a group to a role, the main agent, nowhere, or a brand-new role; **③ Custom sub-agents** — toolName (`/^[a-z][a-z0-9_]*$/`) → multi-select from the tool pool → one-line persona; any number may be created; **④ Fine-tuning the default roles** — per-role persona/tool edits, deleting built-in roles, renaming the main agent, per-role dedicated models, plus removing/restoring main-agent base tools (emptying them is refused on the spot); **⑤ Skill assignment** — soft-guidance rows for roles, and main-agent skills (`main_agent_skills` soft rows / `main_agent_skills_inline` hard inlining); **⑥ Confirm & install** — after reviewing the summary, the preset is generated to `$DSH_HOME/.agent-presets/orchestrator` and the choices are persisted to the config file.

| CLI flag | Effect |
|---|---|
| `--auto` | Non-interactive: apply the config when present, else smart defaults; required when stdin is not a TTY |
| `--config <file>` | Config file to use (default `$DSH_HOME/dsh-paoding.config.yml`) |
| `--wizard` | Force the interactive wizard (reads answers from stdin even on a non-TTY; for scripts/CI) |
| `--profile <name>` | Which profile's patch layer to scan (default `web`) |
| `--patch <file>` | Extra patch file(s) to scan (repeatable) |
| `--dry-run` | Preview the detection report and generated allow lists; writes nothing |
| `--config-ui` | Additionally mount the visual configurator into the DSH Settings page (takes effect after restarting DSH) |
| `--help` | Usage help |

Path facts: `$DSH_HOME` defaults to `~/.dsh`; the preset lands at `~/.dsh/.agent-presets/orchestrator` and the config file at `~/.dsh/dsh-paoding.config.yml`. After installing, **restart the host or open a new session** and pick「编排模式 (Orchestrator)」("orchestration mode", the orchestrator preset) in the preset selector; to make it the default, choose it in Settings → Agent Presets. Uninstall: `rm -rf "$DSH_HOME/.agent-presets/orchestrator"`. Stage details, the install-time host patch detection mechanism and troubleshooting live in [Installation](docs/installation_en.md).

## Usage

Give the main agent the work directly and it routes by division of labor:

- **Internal file questions** (finding code, checking references, reading files) → solved by the main agent itself with the hot-path tools (`glob` / `grep` / `read` / `read_image` / `bash`) — **never delegated**;
- **External research** → call `search_external` (the child carries only `web_search` plus the tavily tools and never modifies files);
- **UI/frontend design** → call `design` (may load design skills such as frontend-design / html-ppt; it produces specs, not final code);
- **Writing/editing code** → call `implement` (read context → surgical change → verify before reporting);
- **Whole-repo exploration / full-file reads / cross-directory symbol tracking in a huge repo** → call `search_internal_deep` (read-only, no network; large outputs are digested inside and only a condensed summary comes back).
- **Specialized work beyond the built-ins (e.g. making PPTs)** → first create a custom role: give it a `toolName`, tick its tool surface (including `skill` plus read/write/edit), and write a persona that guides it to the relevant skill (example: a `ppt` agent carrying the `html-ppt` skill to produce HTML slides); the main agent then delegates to it by toolName. Creation channels: wizard stage ③ / the `roles` config key / config-UI cards — see "Custom roles" in [Configuration](docs/configuration_en.md).

While a child runs, the main agent can steer with `send_message`, inspect with `list_agents`, and stop it with `interrupt_agent`; on completion it integrates only the summary instead of pouring the child's full context into itself. Layered failure recovery (dispatch by stop reason, one re-delegation, report after two failures) and multi-turn iteration (one-shot run-and-discard vs `continuable`, with the optional `implement_cont` enhancement) are covered in [Orchestration](docs/orchestration_en.md).

Prefer not to hand-edit the config file? Mount the visual configurator (optional):

```bash
./install.sh --auto --config-ui
```

After restarting DSH, the「设置 → 庖丁配置」panel ("Pao Ding configuration" in Settings) offers: detection results (host-tool scan), agent tool assignment (a card per main agent / built-in role / custom role — tick tools, edit personas), skill assignment, a preview of the generated `agent.cordis.yml`, and「保存并应用」("Save & Apply"), which shares the CLI's pipeline (`collectState` / `generateAndInstall`); restart the GUI or open a new session after applying. See §6 of [Installation](docs/installation_en.md).

## Configuration

The config file lives at `$DSH_HOME/dsh-paoding.config.yml` by default (`DSH_HOME` defaults to `~/.dsh`; `--config` points elsewhere). It is a **declarative intent**: the target preset is regenerated from "static source + this config" on every run, so editing the config and re-running `./install.sh --auto` syncs idempotently — no manual patches accumulate. Top-level keys at a glance:

| Top-level key | One-line meaning |
|---|---|
| `roles` | persona / tools overrides for the tunable roles (`search_external` / `design` / `implement`) and custom roles; built-in entries may also carry a `name` display name (rewrites only the subject of the persona identity sentence, never the call name — see §2.4 of the Configuration doc) and a dedicated model via `model` / `provider` (see §2.5 of the Configuration doc) |
| `roles_remove` | built-in roles deleted wholesale (one of `search_external` / `design` / `implement`; deletable and restorable — see §2.3 of the Configuration doc) |
| `skills` | which roles each skill is soft-guided to (written into the role persona's Available skills line) |
| `main_agent_extra` | host tools appended to the main-agent whitelist (e.g. `mcp__tavily__*`, `memory_search`) |
| `main_agent_remove` | base tools removed from the main agent (remove wins over extra on name collision) |
| `main_agent_skills` | main-agent soft-guidance rows: `# skill: <name> — <description>` + `Read full rules: <absolute SKILL.md path>` |
| `main_agent_skills_inline` | skills hard-inlined in full (SKILL.md minus frontmatter into the persona; fixed cost per response) |
| `main_agent_persona_extra` | text appended to the main-agent persona (three states: absent = default constant / explicit `''` = append nothing / other text = override) |
| `main_agent_name` | the main agent's name (one key, two changes: preset display name + persona identity line; absent = keep the default — see section 5 of the Configuration doc) |
| `profile` | which host patch profile is scanned (default `web`) |

`search_internal_deep` is a static role: **do not** put it under `roles` (it would be treated as a custom role and generate a duplicate block); `roles_remove` cannot delete it either (that key accepts only the three tunable built-ins); to tune it, edit its block in `presets/orchestrator/agent.cordis.yml` directly and re-run `--auto`. The full key reference, built-in-role tuning, skill assignment and per-role models are in [Configuration](docs/configuration_en.md).

## Documentation

| Document | Contents |
|---|---|
| [Architecture](docs/architecture_en.md) | the design rationale — overview, the cost ledger, roles & tool surfaces, mapping to DSH's native mechanisms, token governance, and known limitations. |
| [Installation](docs/installation_en.md) | prerequisites, the six wizard stages, CLI flags, the host patch detection mechanism, applying/defaulting/upgrading/uninstalling, mounting the config UI, and troubleshooting. |
| [Orchestration](docs/orchestration_en.md) | orchestration overview, how failures surface and the three recovery layers, one-shot vs continuable, the `implement_cont` enablement example, and context isolation. |
| [Configuration](docs/configuration_en.md) | the full config-file key reference, tuning built-in roles, the main-agent tool surface and skills, custom roles, skill assignment, and per-role models. |

## Repository layout

```
dsh-paoding/
├── install.sh                     # thin shell wrapper: checks node, then execs tools/install.mjs
├── tools/install.mjs              # the installer itself: detects host tools, rewrites role allow lists, generates the preset; CLI and wizard
├── presets/orchestrator/          # static preset source (read by the installer and copied/rewritten to ~/.dsh/.agent-presets/orchestrator)
│   ├── preset.yml                 # preset metadata: name「编排模式 (Orchestrator)」(the orchestrator preset), blurb, order
│   ├── agent.cordis.yml           # agent composition: persona, orchestrator-restrict, the four role delegations, compaction 0.45, etc.
│   └── restrict.mjs               # waterfall filter plugin for the main-agent tool whitelist (~130-line core, ~190 lines with comments)
├── plugins/paoding-config-ui/     # optional visual configurator: DSH Web settings-page plugin (slot "paoding", /api/paoding/*)
└── docs/                          # deep documentation (architecture / installation / orchestration / configuration; see above)
```

`tools/install.mjs` is the real installer — `install.sh` is only a thin wrapper around it (`exec node tools/install.mjs "$@"`). The preset's static source lives under `presets/orchestrator/`: the installer copies `preset.yml` and `restrict.mjs` as-is while rewriting `agent.cordis.yml` from the static source plus the config file (role allow lists/personas, custom roles, and the main-agent `config.allow` injection). `plugins/paoding-config-ui/` is the optional Web configurator (a settings.section slot with id `paoding` backed by `/api/paoding/*` routes), and `docs/` holds the four deep documents listed above.

## Contributing

Issues and PRs are welcome: report problems you hit, request new roles or tool surfaces, or point out places where the docs and the implementation disagree. Before contributing, read [Architecture](docs/architecture_en.md) and [Configuration](docs/configuration_en.md); when a document and the code conflict, the source of truth is `presets/orchestrator/` and `tools/install.mjs`.

## License

Released under the [MIT License](LICENSE); see the `LICENSE` file at the repository root for the full terms.
