<!-- docs/architecture_en.md — dsh-paoding (Pao Ding) architecture, English version -->

← [dsh-paoding](../README_en.md) ｜ [Installation](installation_en.md) ｜ **Architecture** ｜ [Orchestration](orchestration_en.md) ｜ [Configuration](configuration_en.md)

[中文](architecture.md) · English

# Architecture

> Reader: technical users and contributors who want to understand why it is designed this way, the
> costs and benefits, and the mechanisms underneath. Facts follow the repository source
> (`presets/orchestrator/agent.cordis.yml`, `presets/orchestrator/restrict.mjs`,
> `presets/orchestrator/preset.yml`); where they conflict with the README, the source wins.

## Overview

dsh-paoding (Chinese brand name 庖丁 / Pao Ding, from the Zhuangzi parable "庖丁解牛" — the butcher whose
knife never dulls because he cuts along the natural seams) is an **orchestrator-preset generator and
configurator** for DSH (DeepSeek Harness, an agent runtime). It reshapes DSH's default shape — a monolithic
agent that loads every tool on every request (~60 tools, ~16.2k tokens of tool tax per request) — into an
architecture of **one orchestrating main agent plus role-specialized sub-agents that load tools on demand**:

- **The hot path stays on the main agent**: internal file search (glob / grep / read / read_image / bash)
  is reached directly with zero delegation round-trip;
- **Cold paths are delegated to role sub-agents**: external web research (search_external), design (design),
  code implementation (implement), and whole-repository deep search (search_internal_deep) are each handed
  to a sub-agent carrying only the tools it needs — **pay per use, once used once paid**;
- **Context isolation**: every sub-agent keeps a small, specialized context, and the main agent integrates
  only summaries.

The whole solution is "pure configuration plus one waterfall-filter plugin whose core logic is roughly 130
lines (`restrict.mjs`, ~190 lines with comments)" — **zero changes to DSH source code**, hot-swappable
(install / uninstall / modify are all plain file operations).

The essential differences from monolithic mode:

| Dimension | Monolithic mode (default) | Orchestrator mode (this preset) |
|---|---|---|
| Responsibility | One agent does everything | Main agent decomposes and integrates; role sub-agents each do one job |
| Cost | ~16.2k tokens tool tax paid on every request | Main agent ~5.5k; role surfaces ~3.0k–3.7k, paid only when delegated |
| Context | Every search dump, design draft and diff accumulates in the main context | Worker contexts are small and specialized and discarded after use; the main agent receives only summaries |

The static source of the composition is `presets/orchestrator/agent.cordis.yml`, layered on top of DSH's
builtin `standard` preset in full (see the "Under the hood" section below); at runtime
`restrict.mjs` trims the main agent's tool surface. The four role delegation instances are
`delegation-search-external` / `delegation-design` / `delegation-implement` /
`delegation-search-internal-deep`, all inside the composition's delegation group. That group also carries the
generic delegation tools `subagent` / `subagent_fork` / `workflow` / `ralph` (they are not in the main-agent
whitelist; role delegation is the preset's primary path).

The architecture diagram below shows the main-agent tool surface and the four role delegations (the complete
allow lists are in the "Roles & tool surfaces" section below):

```
┌─ main agent · orchestrator (orchestrator-mode preset, 21-tool whitelist)─────────────┐
│ delegate  : search_external / design / implement / search_internal_deep              │
│ manage    : send_message / list_agents / interrupt_agent                             │
│ hot path  : glob / grep / read / read_image / bash  ◄── zero delegation round-trip   │
│ coordinate: todo_write / ask_user_question / get_goal / create_goal /                │
│              update_goal / exit_plan_mode / job_output / job_list / job_kill         │
│ job       : decompose → solve internal problems in place → delegate only             │
│              research / design / implementation / whole-repo deep search             │
│              → integrate summaries only                                              │
└───────────┬───────────────────┬───────────────────┬───────────────────┬──────────────┘
            │                   │                   │                   │               
            ▼                   ▼                   ▼                   ▼               
    search_external          design             implement     search_internal_deep      
    (web research)         (design)         (implementation)   (repo deep search)       
      (on demand)            (on demand)      (on demand)        (on demand)            
            │                   │                   │                   │               
            ▼                   ▼                   ▼                   ▼               
    web_search           read/read_image      read/write/edit      glob/grep/read       
    mcp__tavily__*       glob/grep/bash       glob/grep/bash       read_image/bash      
    (5 tools)            skill/write/edit     skill/web_search     ask_user_question    
    glob/grep/read       ask_user_question    ask_user_question    todo_write           
    ask_user_question    todo_write           todo_write           job_output           
    (no write/edit)      job_output           job_output           job_list             
                         job_list             job_list/job_kill    job_kill             
                         job_kill             get_goal             (read-only; no       
                                              create_goal          file writes,         
                                              update_goal          no network)          
```

In the diagram:

- The **main agent** box lists its 21-entry whitelist, grouped into delegation (search_external / design /
  implement / search_internal_deep), child management (send_message / list_agents / interrupt_agent), the
  internal-search hot path (glob / grep / read / read_image / bash), and coordination (todo_write /
  ask_user_question / get_goal / create_goal / update_goal / exit_plan_mode / job_output / job_list /
  job_kill);
- Four arrows fan out to the **role sub-agents**, each created on demand (cold path). search_external
  carries web_search, the five `mcp__tavily__*` tools, plus glob/grep/read and ask_user_question, with no
  write/edit; design carries read/read_image/glob/grep/bash/skill/write/edit plus coordination tools;
  implement carries read/write/edit/glob/grep/bash/skill/web_search plus coordination and goal tools;
  search_internal_deep carries the full read-only internal-search surface (glob/grep/read/read_image/bash
  plus ask_user_question and job tools) — no file modification, no network.

## Why it costs less

The core benefit of this preset is **pay-per-use plus context isolation**; the tool tax is only the most
visible symptom. Per-request tool-tax estimates (source: the header comment of `agent.cordis.yml` and
measured calibration; figures are order-of-magnitude estimates):

| Setup | Tool surface | tokens/request | Notes |
|---|---|---|---|
| Monolithic (status quo, untrimmed) | All 60 tools | **~16.2k** | Paid in full on every request |
| Orchestrator main agent | 21-entry whitelist (∩ registry) | **~5.5k** | ↓66%; zero delegation latency for internal search |
| search_external sub-agent | 10 allowed entries | ~3.0k | Paid only when web research actually runs |
| design sub-agent | 13 allowed entries | ~3.2k | Paid only when a design task is delegated |
| implement sub-agent | 16 allowed entries | ~3.7k | Paid only when an implementation task is delegated |
| search_internal_deep sub-agent | 10 allowed entries | not separately estimated | Paid only when a deep repo search is delegated |

Note: role tool counts above follow the actual `allow` entries in `agent.cordis.yml` (design 13 / implement
16); the old README figures of 14 / 17 and a 22-entry whitelist are outdated.

**The real win is context isolation, not the few thousand tokens saved per se**:

- A monolithic agent's context accumulates every search dump, every design draft and every diff — even when a
  tool is unused in the current request, its past outputs still occupy the window;
- In the orchestrator architecture every worker keeps a small, specialized context (its own role tools and
  outputs only); roles are one-shot by default and discarded after use. The main agent receives only
  structured summaries and integrates them — it never pours a sub-agent's full context into its own window;
- Consequently the main agent's window size is decoupled from "how much work this round delegated"; in long
  sessions the token level is dominated by the orchestrator's own summaries and decisions (combined with
  compaction governance, see the "Performance: token governance" section below).

**Skill-catalog injection into the main agent is zero** (measured ≈1.3k tokens/round for a 4455-byte
catalog of 10 skills; eliminated by a registry-level deny — mechanism ⑤ in the "Under the hood" section).
The main agent carries no `skill` tool yet must still be able to use skills on demand, through two channels:

- `main_agent_skills` (soft guidance, the default channel): each skill occupies a single persona line
  (skill name + description + SKILL.md path) — zero catalog tax; when a task matches a skill the main agent
  reads the full SKILL.md on demand with its own `read` tool and follows it. Unused skills cost nothing;
- `main_agent_skills_inline` (optional hard inlining): the full SKILL.md body of the listed skills is
  inlined into the persona at a fixed per-round cost — for style skills such as caveman that must apply
  unconditionally.

Configuration details for both channels: [docs/configuration_en.md](configuration_en.md).

## Roles & tool surfaces

### Main-agent tool surface (21-entry whitelist)

The hardcoded `MAIN_AGENT_ALLOW` in `restrict.mjs` has **21 entries** in four groups (order follows the
source comments):

| Group | Tools |
|---|---|
| Role delegation (4; the default full set, three can be deleted via config) | `search_external` `design` `implement` `search_internal_deep` |
| Child management (3) | `send_message` `list_agents` `interrupt_agent` |
| Internal search · hot path (5) | `glob` `grep` `read` `read_image` `bash` |
| Coordination (9) | `todo_write` `ask_user_question` `get_goal` `create_goal` `update_goal` `exit_plan_mode` `job_output` `job_list` `job_kill` |

**Host tools are not hardcoded in the whitelist constant**: `mcp__*` and plugin tools (codegraph /
memory_search / mnemon_* etc.) are "install-time facts" — when the main agent needs one, it is ticked in
`main_agent_extra` in the configuration file `$DSH_HOME/dsh-paoding.config.yml`, the generator injects the
still-enabled ones into the restrict `config.allow` based on runtime detection, and disabled ones are
dropped automatically (see [docs/configuration_en.md](configuration_en.md)). The main agent's default surface
therefore excludes `web_search`, every `mcp__tavily__*`, `write` / `edit` / `str_replace_editor`, `skill`,
`workflow`, `ralph`, and the unfiltered `subagent` / `subagent_fork` — either because they belong to role
sub-agents or because their cost is deliberately zeroed out.

### Built-in role agents at a glance

Each role is a `dsh-tool-subagent` instance: which delegation tool the main agent calls selects that
sub-agent's tool surface (the sub-agent is created with a `tools.restrict()` applied from its `toolFilter`,
see mechanism ④ in the "Under the hood" section below). The role personas embedded in the main-agent
persona and the delegation-failure SOP live in [docs/orchestration_en.md](orchestration_en.md).

The four built-in roles are just the factory division of labor: through the same mechanism, any combination
of tools and skills becomes a new delegation tool — write a toolName under the config `roles` key (or create
it in the wizard / config UI), the installer generates a `delegation-<toolName>` block and injects the
toolName into the main-agent allow list; see section 6 of [docs/configuration_en.md](configuration_en.md).
Custom roles support the same `model` / `provider` dedicated-model sub-keys as the built-in roles (same
sub-keys, same generation mechanism — see 2.5).
For example, a `ppt` agent carrying the `html-ppt` skill gives slide-making its own dedicated sub-agent.

| Delegation tool | Instance ID | Persona in one sentence | Load cost |
|---|---|---|---|
| `search_external` | `delegation-search-external` | Web research only (web_search + tavily), never modifies files; returns a structured research summary (findings, sources, open questions) | ~3.0k, only when delegated |
| `design` | `delegation-design` | Produces UI/UX designs, wireframes and frontend specs; may load design skills (frontend-design, html-ppt) via the skill tool; reads reference material first, delivers a spec, does not implement final code | ~3.2k, only when delegated |
| `implement` | `delegation-implement` | Writes and edits code: read surrounding context → surgical change → verify (build/test/grep); does not redesign architecture | ~3.7k, only when delegated |
| `search_internal_deep` | `delegation-search-internal-deep` | Repository exploration only: never modifies files, never uses the network; handles tasks too heavy for the main agent's context (whole-repo grep dumps, full-file reads beyond a page, cross-directory symbol/definition tracking); returns condensed summaries only | not separately estimated, only when delegated |

The table above is the factory default; the configuration layer can trim and customize it (see
[docs/configuration_en.md](configuration_en.md)): the trio `search_external` / `design` / `implement` can be
deleted wholesale via `roles_remove` (2.3; `search_internal_deep` cannot); a built-in role can carry a display
name `roles.<toolName>.name`, which rewrites only the subject of its persona identity sentence (2.4); it can
also be pinned to a dedicated model `roles.<toolName>.model` / `.provider`, injected by the generator as
`agentOptions` in the delegation block, defaulting to following the main agent (2.5); and the main agent itself
can be renamed via `main_agent_name` — one key, two places (section 5).

### Per-role toolFilter.allow detail

The allow lists below are transcribed verbatim from `agent.cordis.yml` (at install time the generator
rewrites each list as "config/static intent ∩ runtime-detected host tools", see
[docs/configuration_en.md](configuration_en.md)).

**`search_external` (external research, 10 entries)**

| Field | Value |
|---|---|
| Persona job | Web research only, returning a structured research summary (findings, sources, open questions); never modifies files |
| toolFilter.allow | `web_search`, `mcp__tavily__tavily_search`, `mcp__tavily__tavily_crawl`, `mcp__tavily__tavily_extract`, `mcp__tavily__tavily_map`, `mcp__tavily__tavily_research`, `glob`, `grep`, `read`, `ask_user_question` |
| Load cost | ~3.0k tokens, incurred only when web research actually runs |

**`design` (design, 13 entries)**

| Field | Value |
|---|---|
| Persona job | Produces UI/UX designs, wireframes and frontend specs; loads design skills (frontend-design, html-ppt) via the skill tool; reads reference material first, then delivers a spec; does not implement final code |
| toolFilter.allow | `read`, `read_image`, `glob`, `grep`, `bash`, `skill`, `write`, `edit`, `ask_user_question`, `todo_write`, `job_output`, `job_list`, `job_kill` |
| Load cost | ~3.2k tokens, incurred only when a design task is delegated |

**`implement` (implementation, 16 entries)**

| Field | Value |
|---|---|
| Persona job | Writes and edits code: read surrounding context first → surgical changes → verify (build/test/grep), reporting what changed and how it was verified; does not redesign architecture |
| toolFilter.allow | `read`, `write`, `edit`, `glob`, `grep`, `bash`, `skill`, `web_search`, `ask_user_question`, `todo_write`, `job_output`, `job_list`, `job_kill`, `get_goal`, `create_goal`, `update_goal` |
| Load cost | ~3.7k tokens, incurred only when an implementation task is delegated |

**`search_internal_deep` (whole-repo deep search, 10 entries)**

| Field | Value |
|---|---|
| Persona job | Repository exploration only: never modifies files, never uses the network; handles whole-repo grep dumps, full-file reads beyond a page, and cross-directory symbol/definition tracking; searches thoroughly, then returns a CONCISE structured summary (what was searched, key files with line numbers, definitions/symbols found, and the takeaway for the next decision) — never echoes large dumps back |
| toolFilter.allow | `glob`, `grep`, `read`, `read_image`, `bash`, `ask_user_question`, `todo_write`, `job_output`, `job_list`, `job_kill` |
| Load cost | not separately estimated, incurred only when a deep repo search is delegated |

> Note: `codegraph` and `memory_search` were removed from this role on 2026-09-02 — when their plugins
> (codegraph MCP / magic-memory) are disabled they are outside the sub-agent's visible registry, and
> `tools.restrict()` would refuse to create the role with unknown tools. Re-add them on demand after
> re-enabling the plugins (allow lists use exact name matching, no globs — see the "Known limitations"
> section below).

## Under the hood

This preset invents no new mechanism — every layer maps onto a native DSH capability, and the preset merely
composes them. Each item below is stated as a design decision (the first release failed at runtime because
① was missing; that lesson is now a hard constraint of the composition).

**① Basic tools are registered at the preset layer; the orchestrator must compose the full standard
preset.** In DSH, base tools such as read/write/edit/glob/grep/bash/skill/web_search are **not provided by
the global layer** — they are mounted by the composition of the builtin `standard` preset. The orchestrator
composition must therefore include every row of `standard` verbatim — tool-bash / tool-pwsh / fs / fs-search
/ jobs / skill / goal / planning / compaction / delegation / ask-user / todo / web — otherwise a sub-agent's
`tools.restrict()` fails with `unknown global tools`. This is a hard design constraint: a sub-agent inherits
the tools **registered by the composition itself**, and a missing row means the tool is absent from the
sub-agent's registry. The host layer (e.g. `~/.dsh/cordis.patch.yml`) mounts only MCP servers and local
plugin tools.

**② The main-agent surface trim is a waterfall filter on the model-facing catalog.** `restrict.mjs` hooks
the `system-prompt/assemble` waterfall (`prepend: true` places the filter outermost, so `await next()`
observes the fully assembled downstream result before the allow list is applied to `assembly.tools`).
Design points:

- **Fail-open**: any unexpected error inside the filter returns the assembly unchanged, so a filter bug can
  never brick every request of a session;
- **An empty allow list refuses to load**: `apply()` throws a `TypeError` when `config.allow` is empty —
  preventing the main agent from being stripped of every tool (the install-time generator also rejects a
  removal that results in an empty list).

**③ Main vs. child is distinguished by the session header.** A child session's header is stamped
`origin: 'subagent'` (`delegationDepth >= 1` as a fallback; see dsh-subagent's childSessionMeta). The
waterfall lets children through untouched — a role's surface is already constrained by its own `toolFilter`,
and re-filtering children here would intersect with (and wrongly shrink) those role surfaces.

**④ A role sub-agent's surface is a per-child `tools.restrict()`.** Each role is a `dsh-tool-subagent`
instance declaring a `toolName` (the tool name the main agent calls) and a `toolFilter.allow`. At child
creation the child context runs `childCtx.tools.restrict(toolFilter)`: every allow name must exist in the
sub-agent's visible registry (= this composition in full + host-layer MCP/plugins), otherwise creation is
rejected with unknown tools. Hence "which delegation tool the main agent calls selects which tool surface";
tools not explicitly allowed are entirely invisible to the child.

**⑤ Zeroing the main agent's skill catalog needs two layers.** Removing `skill` from the model-facing
surface alone is insufficient: the `dsh-tool-skill` catalog-injection guard checks **registry
visibility** (`ctx.tools.get('skill', agent)`), not the model-facing list, so a prompt-level filter cannot
keep the catalog out (measured: a 4455-byte / 10-skill catalog ≈1.3k tokens/round). Therefore:

- the `system-prompt/assemble` waterfall filters `skill` out of the main agent's model-facing catalog
  (layer 1);
- `MAIN_AGENT_REGISTRY_DENY = ['skill']` applies a registry-level deny to the main agent at `agent/created`
  (layer 2); the catalog injection then stops and its cost drops to zero;
- children are exempt: their surface comes from each delegation's `toolFilter`, and per-agent restrictions
  never cross scope layers (a child scope is a sibling under the shared standing mount, not a descendant of
  the main agent's scope);
- design/implement and other sub-agents keep `skill` — DSH has no per-agent catalog filtering; catalogs are
  collected by cwd and fully visible to sub-agents, guided by persona text. Explicitly whitelisting `skill`
  in the main agent's allow list opts it back into the catalog (the registry deny is skipped accordingly).

**⑥ Role personas are the `persona` field of `dsh-tool-subagent`.** Each delegation instance carries its
own persona (the child agent's deployment:persona section), including the role boundary and a failure
reporting protocol; the main-agent persona additionally carries the delegation-failure SOP (branching on
stop reason: `error` → re-delegate once; `max-tokens` → split the task; `refusal` → do not retry; `aborted`
→ retry only if the cancellation was accidental; poor output → re-delegate with concrete gaps; after two
failures of the same task, stop and report to the user; every re-delegation must carry the previous
integration summary) — see [docs/orchestration_en.md](orchestration_en.md).

**⑦ Hot-swap means presets are static directories.** Install, uninstall and modification are plain file
operations: the generator copies/rewrites the static sources into `$DSH_HOME/.agent-presets/orchestrator`;
editing the YAML / mjs, re-running the generator, and restarting the host or opening a new session takes
effect. Uninstalling means deleting the directory. No DSH source changes; the preset leaves nothing behind
when removed.

## Performance: token governance

This section presents long-session token governance as a benchmark-style write-up: symptom (measurement) →
root cause → landed configuration → tunable parameters.

**Symptom and baseline (calibrated 2026-08-20).** In the same working directory with equivalent tasks, DSH's
average tokens per request in long sessions was ~2× that of a baseline implementation. After ruling out
output-truncation accounting differences (read defaults of 2000 lines plus a 50KB byte cap, bash tail+spill
to disk, grep inline caps — all same design as the baseline), the root cause was pinned down: **compaction
never fired with the default settings**. `dsh-compaction-basic` defaults to `thresholdRatio: 0.8` — inside
a 256K-token window compaction would only trigger at ≈209,715 tokens — so per-request tokens in long
sessions grew to a ~137K–142K plateau that never fell back (the level stayed below the trigger line).
Sessions on the baseline implementation for the same project had all undergone periodic compaction, with
history periodically compressed back down.

**Landed configuration.** The compaction-basic row in `agent.cordis.yml` now sets
`thresholdRatio: 0.45` (triggering at ≈117,965 tokens), with retainRatio keeping the default ~16% tail
(≈42K) plus a summary checkpoint; the steady-state average falls to the ~80K range. Each compaction run
performs one LLM summarization call that reuses the prefix cache, so its cost is negligible — triggering
somewhat more often costs almost nothing extra; 0.45 is the balance point between saving tokens and not
summarizing too frequently.

**Parameters and effect.**

| thresholdRatio | Trigger line (≈) | Steady-state average (≈) | Notes |
|---|---|---|---|
| 0.8 (DSH default) | 209,715 tokens (256K window) | 137K–142K, never falls back | Long sessions rarely compact |
| 0.45 (landed in this preset) | 117,965 tokens | ~80K | ~16% tail ≈42K + summary checkpoint |
| 0.35 (optional, more aggressive) | ~92K tokens | ~67K | Saves more tokens, summarizes more often |

After changing the threshold, re-run `./install.sh --auto` to apply. Companion components in the same
composition:

- `tool-result-pruner`: oversized tool results are trimmed with `thresholdChars: 8192 / headChars: 4096 /
  tailChars: 1024` (keep head and tail), preventing a single giant output from inflating the window;
- `command-compact`: manual `/compact` for immediate compression at any point in a long session;
- the `search_internal_deep` role: whole-repo dumps and other large outputs are isolated out of the main
  context — the hot path (single-file reads, precise greps) still runs on the main agent with zero
  delegation latency; only whole-repo dumps / full-file reads / cross-directory symbol tracking are
  delegated, and the child digests large outputs internally, returning condensed summaries only (see the
  "Roles & tool surfaces" section above).

## Known limitations

- **Role tool surfaces are statically bound** (decided by configuration / `toolFilter.allow`), not chosen
  arbitrarily by the model at runtime. "Picking a role tool picks a tool surface" is an advantage for fixed
  division of labor, but a tool cannot be granted to a role mid-conversation — changing it requires editing
  the configuration / static source and re-running the generator.
- **`toolFilter.allow` uses exact name matching and supports no globs**: the five tavily tools must be
  listed in full (`mcp__tavily__tavily_search/crawl/extract/map/research`).
- **Tools absent from the main-agent whitelist raise no error**: the waterfall filter only matches by name
  against the resolved `assembly.tools`, so a tool that is not mounted (e.g. a commented-out MCP) simply
  never appears — install and runtime both pass silently. Config intent and actual mounts are reconciled by
  install-time detection (`install.sh --auto` / `--dry-run`); re-run it after changing host patches.
- **Whole-repo exploration tasks should be delegated to `search_internal_deep` rather than done by the
  main agent**: whole-repo grep dumps and full-file reads that repeatedly flood the main context are
  exactly what that role isolates (read-only, no network, condensed summaries only).
