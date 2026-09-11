← [dsh-paoding](../README_en.md) ｜ [Architecture](architecture_en.md) ｜ [Installation](installation_en.md) ｜ [Orchestration](orchestration_en.md) ｜ **Configuration**

[中文](configuration.md) · English

# Configuration

dsh-paoding makes the role-based orchestration preset **configuration-driven**: you hand-write (or let the interactive wizard / Web config UI write for you) a YAML config file, and the installer (`tools/install.mjs`; the CLI and the config UI share the same generation pipeline, `collectState` / `generateAndInstall`) rewrites the target preset — `~/.dsh/.agent-presets/orchestrator/agent.cordis.yml` — at install time, covering the role allows, role personas, the main-agent allow list (`config.allow` injection) and the main-agent persona's skill rows / inlines and persona extra.

The config file describes **declarative intent**. The target file is regenerated from scratch every time — "source preset + this config file": edit the config → re-run the install = idempotent sync, with no accumulating hand patches.

## 1. Configuration file

### 1.1 Location and precedence

The config file's default location is `$DSH_HOME/dsh-paoding.config.yml`; when `$DSH_HOME` is unset, it defaults to `~/.dsh`. The CLI flag `--config <file>` selects any other path.

| Scenario | Behavior |
|---|---|
| Interactive wizard (`./install.sh`) | After detection and assignment, **persists** your choices to the config file (default `~/.dsh/dsh-paoding.config.yml`, written with `0o600` permissions) upon confirmation; a later wizard run seeds its suggested values from the existing config |
| `./install.sh --auto` | Non-interactive: applies the config file when present, otherwise smart defaults (≈ the static preset as-is, zero regression). Re-running after an edit applies it idempotently |
| `./install.sh --dry-run` | Prints only the detection report and the allow / persona changes that would be generated — writes nothing (including the config file). Use it to preview before committing |
| `./install.sh --auto --config <file>` | Uses the given file instead of the default location |
| Web config UI (Settings → 庖丁配置) | The panel's「保存并应用」(save & apply) writes the preset and saves the assignments to the config file — equivalent to `--auto` plus the wizard's save |

A config file that **exists but fails to parse** is a hard error (the installer aborts); a **missing** file simply means "no configuration" (smart defaults or the wizard apply). Top-level keys such as `profile` and `roles` are described in the next subsection.

CLI precedence: an explicit `--profile` overrides the `profile` key in the config file; otherwise the config file's value wins; the fallback is `web`.

### 1.2 Top-level keys

The key names below match `normalizeConfig` in `tools/install.mjs` — the single authoritative source of the config file schema.

| Top-level key | Type | Semantics |
|---|---|---|
| `profile` | string | Which profile's patch layer (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`) is scanned during detection; default `web` |
| `roles` | map | `toolName` → `{ persona?, name?, tools[], model?, provider? }`. For the three built-in roles (`search_external` / `design` / `implement`): overrides the persona and the allow intent, and may carry a `name` display name (rewrites only the subject of that role's default persona identity sentence — see 2.4) and a dedicated model (`model` / `provider`, see 2.5). Any other key is a **custom role**: the installer emits a fresh `delegation-<toolName>` block and injects the toolName into the main agent's `config.allow` (sections 2 and 6) |
| `roles_remove` | string[] | toolNames of built-in roles deleted wholesale (only `search_external` / `design` / `implement` are accepted; other names are ignored with a warning; default `[]`). Deleting means the delegation block / tool surface / role persona / main-agent delegation guidance are no longer generated (see 2.3) |
| `skills` | map | `skill` → the list of role toolNames the skill is assigned to; the installer appends an `Available skills: …` guidance sentence to those roles' personas (section 7) |
| `main_agent_extra` | string[] | Tools appended to the main-agent allow list (host tools such as `mcp__codegraph__codegraph_explore`, `memory_search`, `mnemon_*`); intersected with the detection inventory — undetected names are not injected |
| `main_agent_remove` | string[] | Base tools stripped from the main-agent allow list (e.g. the goal family, `exit_plan_mode`); names absent from the current allow are warned about and skipped; removing everything is a hard error |
| `main_agent_skills` | string[] | Main-agent skills in soft-guidance mode (the default channel): one compact skill row + a `Read full rules:` path per skill, appended to the persona |
| `main_agent_skills_inline` | string[] | Main-agent skills in hard-inline mode (optional): the selected SKILL.md bodies are inlined into the persona and apply to every response |
| `main_agent_persona_extra` | string \| null | Text appended to the tail of the main-agent persona. `null` / absent = use the default constant; `''` = append nothing; any other string = override the default |
| `main_agent_name` | string \| null | The main agent's name — one key, two changes: the deployed preset display name and the persona identity line `You are the <name> agent powered by the {{model}} model.` Trimmed, 1–60 chars, no newlines; empty / absent = keep the default (section 5) |

`roles` details:

- `roles.<toolName>.persona`: a non-empty string **replaces the role's deployment persona wholesale** (`''` or absent keeps the static default). A custom role without a persona gets `You are the <toolName> agent. Handle tasks delegated to this role.`
- `roles.<toolName>.tools`: when `toolName` is one of the three built-ins this **fully overrides the intent** of that role's `toolFilter.allow` (the installer then intersects host-dependent names with what was actually detected); absent keeps the static allow. If a built-in role would end up with an empty allow, the install aborts (a zero-tool role is refused).
- `roles.<toolName>.name`: an optional `string | null` display name for the built-in trio only (absent / `null` = the role's built-in default identity). It rewrites only the **subject of that role's default persona identity sentence** — design's default `You are the design agent.` with `name: UI 设计` becomes `You are the UI 设计 agent.`, with the rest of the sentence untouched; constraints, boundaries and an example are in 2.4.
- `roles.<toolName>.model`: a dedicated model id for the role (optional `string`). When set, every sub-agent the role spawns runs on that model instead of following the main agent's current session model; absent = nothing is injected and the child inherits the main agent's model (see 2.5).
- `roles.<toolName>.provider`: the provider route the role's model lives on (optional `string`). It only takes effect paired with `model`; a lone `provider` is warned about and ignored by the installer, while a lone `model` rides the main agent's provider route (see 2.5).
- Keys under `roles` outside the built-in trio are **custom roles** (section 6). Do not put the static role `search_internal_deep` under `roles` (see 2.2).
- Built-in roles can be **deleted wholesale**: the `roles_remove` key accepts only the trio's names — deletion effect, consistency with the `roles` key, and the restore paths are in 2.3.

When `main_agent_extra` is absent or empty it falls back to the smart defaults of the current run (detected codegraph / `memory_search` tools land on the main agent) — which is why, with no configuration at all, the main agent can still call the codegraph tools directly.

### 1.3 Complete minimal example

A config file covering all commonly used keys (the key order matches `serializeConfig`, which is what the installer writes):

```yaml
# dsh-paoding installation config — hand-editable; after editing, re-run ./install.sh --auto to apply.
# The interactive wizard / config UI also writes this file (0o600).

profile: web            # scan profiles/<profile>/cordis.patch.yml during detection

roles:                  # toolName -> { persona?, tools[] }
  search_external:      # built-in role: wholesale override of persona and allow intent
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
  design:               # change the persona only; empty tools = keep the static allow
    persona: |-
      You are the design agent. Produce UI/UX designs and specs; never implement final code.
  code-reviewer:        # custom role (toolName matches /^[a-z][a-z0-9_]*$/)
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

main_agent_extra:       # append host tools (undetected names are not injected)
  - mcp__codegraph__codegraph_explore
  - memory_search
main_agent_remove:      # strip base tools (measured: the four listed save ≈0.8k tokens/round)
  - get_goal
  - create_goal
  - update_goal
  - exit_plan_mode
main_agent_skills:      # soft guidance: persona skill rows; the main agent loads rules on demand via read
  - caveman
main_agent_skills_inline: []   # hard inlining (empty = unused); when also in main_agent_skills, inline only — no soft row
main_agent_persona_extra: |-   # null/absent = default codegraph rule; '' = append nothing; any other = override
  Never call codegraph_* tools without passing projectPath = {{cwd}}.

skills:                 # skill -> the roles it is assigned to (writes the Available skills guidance into those personas)
  frontend-design: [design]
  html-ppt: [design]
```

Notes:

- The `tools` under `roles.search_external` express **intent**: if tavily is not enabled, the installer drops the five `mcp__tavily__*` names and keeps the rest (the `--dry-run` "removed" list states the reason for each).
- `roles.design` omits `tools`, so the static allow is kept and only the persona is replaced.
- After installation, `roles.code-reviewer` becomes a generated `delegation-code-reviewer` block, `code-reviewer` joins the main-agent allow list, and the main agent can delegate to it directly by calling that toolName.
- `{{cwd}}` and `{{model}}` inside `main_agent_persona_extra` are persona placeholders that DSH substitutes at runtime — keep them verbatim.

## 2. Tuning the built-in roles

### 2.1 Override semantics of persona and tools

Of the four built-in delegation roles, the installer (the `ROLES` constant) manages only three: `search_external`, `design` and `implement`. Writing one of these names under the top-level `roles` key tunes it:

- `persona`: **replaces the deployment persona wholesale**. The text lands in the `dsh-tool-subagent` instance's `persona` field — the child's **deployment persona** (the identity and behavior guidance the subagent sees in its session), not an appendix. The static persona's built-in "failure-report protocol / behavior boundary" paragraphs are replaced too — if you want to keep them, include the original text (see the matching block in `presets/orchestrator/agent.cordis.yml`) in yours.
- `tools`: **fully overrides the intent** of that role's `toolFilter.allow`. The relationship in one sentence: the allow lists in `agent.cordis.yml` are static intent that the installer rewrites against actual detection results; the `tools` you write under `roles.<name>` are the new intent — whatever survives detection is what stays.
- Role allow lists use **exact-name matching**; globs are not supported, so tavily's five tools must each be spelled out (`mcp__tavily__tavily_search` … `mcp__tavily__tavily_research`).

Example — replacing `implement`'s persona and tools. The `tools` below match the static default — note that it does **not** contain `str_replace_editor` (why: see 8.2). Writing `tools` out explicitly freezes the intent: later changes to the static source no longer affect this role:

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

### 2.2 search_internal_deep is a static role

`search_internal_deep` (whole-repo deep exploration: read-only, no network, returns condensed summaries only) is also a built-in delegation role, but it is **outside the trio the installer manages**: the installer never rewrites its persona or allow. (The comment inside that role's block in `agent.cordis.yml` records how `memory_search` and the codegraph tools were removed from its allow by hand on 2026-09-02 — when you re-enable those plugins, you add them back there yourself; the installer will not do it.)

Therefore:

- **Do not** put `search_internal_deep` under the `roles` key of the config file — keys outside the trio are treated as **custom roles**, and the installer would emit a second, duplicate `delegation-search-internal-deep` block that clashes with the static one.
- It is likewise **outside** the `roles_remove` deletable set (that key accepts only the trio's names, see 2.3) — it is deliberately kept as a static role, appears in no config key or UI, and this key cannot delete it either.
- To change its persona or tool surface, edit the `persona` and `toolFilter.allow` of the `delegation-search-internal-deep` block in `presets/orchestrator/agent.cordis.yml` directly, then re-run `./install.sh --auto`. The installer rewrites only the limited spans of the trio roles and the main-agent persona; everything else in the static source (including your edit) carries over verbatim into the generated file.

### 2.3 Deleting built-in roles: roles_remove

The optional top-level key `roles_remove` (string[], default `[]`) deletes built-in delegation roles **wholesale**; its values are the toolNames of the roles to remove. The only deletable names are `search_external` / `design` / `implement` — exactly the three default roles the `roles` key can override (the three cards with the「内置」("built-in") badge in the config UI). Names outside that set are **ignored with a warning**; `search_internal_deep` cannot be deleted (it is a deliberately static role, see 2.2).

Deletion removes the role entirely — none of the following is generated anymore:

- its `delegation-<role>` block in `agent.cordis.yml` (role persona and `toolFilter.allow` tool surface included);
- the delegation-guidance bullet about it in the main-agent persona (e.g. `- UI/design work: delegate to design.`);
- its delegation tool name on the main agent's delegation surface.

Deletion does **not** affect the main agent's generic delegation channels (`subagent` / `send_message` and friends keep working as usual).

Example:

```yaml
roles_remove:
  - design     # the delegation-design block is no longer generated; the design bullet in the main-agent persona goes too
```

Relationship with the `roles` key: `roles` keeps the entries of built-in roles that are **not** deleted (override their persona / tools there as usual). The full "deleted" state is: `roles_remove` contains the name **and** `roles` has no such key — the UI / CLI keeps these consistent; keep them consistent when hand-writing too. On conflict, generation follows `roles_remove`.

Restoring:

- **Hand-editing**: remove the name from `roles_remove` (and, if you want your custom persona / tools back, put the entry back under `roles`), then re-run `./install.sh --auto` — the role regenerates with its SRC-default persona and tool surface.
- **Config UI**: the「已删除的内置角色」("deleted built-in roles") area at the end of the role list restores it with one click (restored to the SRC-default tool surface).

### 2.4 Built-in role display names: roles.\<toolName>.name

Entries of the built-in trio (`search_external` / `design` / `implement`) may carry an optional `name` sub-key (`string | null`; absent / `null` = the role's **built-in default identity**). Its effect is narrow and explicit: **it rewrites only the subject of that role's default persona identity sentence at the head of the persona** — the rest of the sentence (job description, behavior boundaries, …) stays verbatim, and the tool surface / delegation machinery are never touched.

Example: design's default identity sentence is `You are the design agent.`; with `name: UI 设计` it is generated as `You are the UI 设计 agent.`:

```yaml
roles:
  design:
    name: UI 设计      # rewrites only the subject of the persona identity sentence; tools may be omitted (the default tool surface applies)
```

Constraints: trimmed, 1–60 characters, no newlines; an empty string / an absent key = the role's built-in default identity (without the sub-key the identity sentence stays verbatim from the SRC — the installer substitutes nothing).

Boundaries:

- **Only the persona identity sentence moves**: the tool registration name and the delegation call name (toolName) stay unchanged — the main agent still delegates to `search_external` / `design` / `implement`; `restrict allow` and the delegation guidance in the main-agent persona (e.g. `delegate to design`) are untouched too.
- **`name` does not apply once the persona is customized**: when the same entry carries a non-empty `persona` (overriding the default), the installer ignores `name` at generation with a warning — to surface the name, write it directly into the first line of the custom persona (e.g. the first sentence of the `persona: |-` block: `You are the UI 设计 agent.`); the `name` sub-key is then unnecessary.
- **Deleted roles are not involved**: a role deleted wholesale by `roles_remove` has no persona left to rewrite (see 2.3).
- **The static role is out of scope**: `search_internal_deep` is outside the installer-managed trio and has no such sub-key (see 2.2).

Applying it mirrors renaming the main agent (see 5.1):

- **Hand-editing**: write the sub-key and re-run `./install.sh --auto`, then restart DSH or open a new session.
- **Config UI**: Settings → 庖丁配置 → the「角色显示名」("role display name") input at the top of a built-in role card (the「内置」("built-in") badge); empty = the default; after「保存并应用」(save & apply) it takes effect on a **GUI restart / new session**.

### 2.5 A dedicated model per role: roles.\<toolName>.model / .provider

A role entry can carry two more optional sub-keys that pin the role's sub-agents to a specific model: `model` (`string`, the model id) and `provider` (`string`, the provider route). Both work on the built-in trio and on custom role entries alike; `search_internal_deep` is a static role and does not accept them — putting them under it (or any non-trio name) still creates a **custom role**, exactly as the constraint in 2.2 describes.

Generation semantics: when set, the installer injects an `agentOptions:` block right after the `config.toolName:` line of that role's delegation block (`provider` first, `model` after it), and DSH's `dsh-tool-subagent` applies `agentOptions` to **every** sub-agent the role spawns. With both keys absent, nothing is injected: the child inherits the main agent's current session model (the UI model picker / global default). The same holds for `continuable` sub-agents — the descriptor records the child's `agentProvider` / `agentModel` at cold resume, so a resumed child still runs on that role's own model.

```yaml
roles:
  implement:
    provider: deepseek-official
    model: deepseek-v4-pro          # implement always runs on the pro tier
  search_external:
    model: deepseek-v4-flash        # no provider = the main agent's provider route
```

Rules and boundaries:

- **`provider` pairs with `model`**: a lone `provider` has no effect — the installer warns and ignores it. `model` alone is valid and rides the main agent's provider route.
- **Routes and model ids must actually exist**: the available routes depend on which LLM adapters your DSH deployment registers — an official install defaults to `deepseek-official` (models `deepseek-v4-flash` / `deepseek-v4-pro` / `deepseek-v4-flash-vision-exp`); the `pi-ai` gateway accepts anthropic / openai / google etc. profiles configured in DSH settings (set up the matching credentials first). The `model` id must belong to the chosen route, otherwise **every delegation** of that role errors at runtime.
- **Deleted roles are not involved**: for a role deleted wholesale by `roles_remove`, any `model` / `provider` left in its entry is ignored with a warning (see 2.3).
- **The static role is out of scope**: `search_internal_deep` has neither sub-key (see 2.2).

In the config UI (Settings → 庖丁配置 → the「专用模型」("dedicated model") control on a role card) this is a dropdown fed by the model routes registered in your DSH deployment; values outside the catalog (e.g. from a hand-edited config) are preserved as a「当前配置」("current config") option instead of silently disappearing.

Applying works exactly like every other config key: re-apply (`./install.sh --auto`, or「保存并应用」(save & apply) in the config UI), then restart DSH or open a new session.

These two sub-keys are the config-layer equivalent of the static-source `agentOptions` in 8.1 (no source edits — prefer them); drop to the static source only when you also need `maxTokens` (see 8.1).

## 3. Main-agent tool surface

### 3.1 Mechanism and the 21-name base allow list

The main agent's tool surface is filtered against an allow list by `presets/orchestrator/restrict.mjs` (the `orchestrator-restrict` plugin) on the `system-prompt/assemble` waterfall. The filter is **fail-open** (a bug in the filter itself can never brick a session); names are matched one-by-one against the resolved tools, so **unmounted names are simply absent — never an error**.

The `MAIN_AGENT_ALLOW` constant in `restrict.mjs` is the **base** (21 names) that the generated `config.allow` starts from; at runtime the filter falls back to it when no `config.allow` is injected. To reshape the main-agent tool surface, **do not edit `restrict.mjs`** — always use the config file (`main_agent_extra` / `main_agent_remove`) or the wizard's remove/restore step instead.

| Group | Tools (21) |
|---|---|
| Role delegation | `search_external` `design` `implement` `search_internal_deep` |
| Child management | `send_message` `list_agents` `interrupt_agent` |
| Internal search (hot path) | `glob` `grep` `read` `read_image` `bash` |
| Coordination | `todo_write` `ask_user_question` `get_goal` `create_goal` `update_goal` `exit_plan_mode` `job_output` `job_list` `job_kill` |

For orientation: `web_search`, every `mcp__tavily__*`, `write` / `edit` / `str_replace_editor`, `skill`, `workflow`, `ralph`, and the unfiltered `subagent` delegation are **deliberately absent** from the main-agent surface (host tools such as codegraph / `memory_search` / mnemon are likewise not hard-coded into the source — opt them in via `main_agent_extra`, see 3.2). `restrict.mjs` also denies `skill` at the registry level for the main agent (the catalog-injection guard checks registry visibility, not the model-facing list), which brings the main agent's skill-catalog token tax to zero.

### 3.2 Appending tools: main_agent_extra

To add host tools to the main-agent surface (e.g. direct retrieval / memory / plugin tools), list them under `main_agent_extra`:

```yaml
main_agent_extra:
  - mcp__codegraph__codegraph_explore   # codegraph MCP
  - memory_search                       # magic-memory plugin
  - mnemon_recall                       # mnemon tool family (runtime tools, depending on detection)
```

Points:

- The entries land in the generated `orchestrator-restrict config.allow`. `mcp__*` and plugin tools are **host-dependent**: the installer injects only what was **actually detected**; undetected names (MCP disabled, typo) are silently not injected — no error.
- The concrete host tools checkable on the wizard / config-UI "main agent" card are those shown by the detection panel (the tool pool).
- When `main_agent_extra` is absent or empty the installer falls back to smart defaults (detected codegraph / `memory_search` tools are suggested for the main agent).

### 3.3 Removing base tools: main_agent_remove

`main_agent_remove` cuts base tools from the main-agent surface without touching source code. Measured reference: removing the four tools `[get_goal, create_goal, update_goal, exit_plan_mode]` saves roughly **≈0.8k tokens per response round**.

```yaml
main_agent_remove:
  - get_goal
  - create_goal
  - update_goal
  - exit_plan_mode
```

### 3.4 Semantics and edge cases

| Rule | Behavior |
|---|---|
| A removed name is not in the current allow | **Warning and skip** (undetected host tool, typo, or a name that never existed); the install continues |
| Removal leaves an empty list | **Hard error**. `restrict.mjs` refuses to load with an empty allow at runtime (`allow.size === 0` throws); the installer catches this at install time and asks you to keep at least one tool |
| Same name in both `main_agent_extra` and `main_agent_remove` | **Remove wins**: the name is appended first and then removed, so it never appears |
| An added/removed name is not mounted | Names are matched against the resolved tools only: absent means absent, never an error (same rule as the allow filter) |
| Result equals the 21-name base | No `config.allow` is injected; runtime falls back to `MAIN_AGENT_ALLOW` (zero redundancy) |

## 4. Main-agent skills

### 4.1 Overview: two top-level keys

The main agent has no `skill` tool and gets no skill-directory injection (`skill` is denied at the registry level, see 3.1). The two top-level keys attach skills to the main agent — the same **soft-guidance** shape as role skill assignment, differing only in the loading channel:

| Comparison | Roles (assigned via the `skills` key) | Main agent |
|---|---|---|
| Guidance form | One `Available skills: …` sentence at the persona tail | One compact skill row per skill (`main_agent_skills`) or full inlining (`main_agent_skills_inline`) |
| Skill-content loading | Skill directory **fully visible** (a DSH mechanism; directories are collected per cwd) | Persona skill row + the agent's own `read`, loading the full rules **on demand** |
| Directory injection | Yes (when the role's surface includes `skill`) | No (zero directory tax) |

Main-agent skills should only be listed when a skill's full rules are needed after the task matches (zero cost otherwise); style skills that must apply **unconditionally** belong in the inline list (4.3).

### 4.2 Soft-guidance default channel: main_agent_skills

The default channel takes a list of skill names:

```yaml
main_agent_skills:
  - caveman
```

At install time the generator appends to the main-agent persona, per selected skill:

1. One section header line — `── Assigned skills (soft guidance: when a task matches, load the full rules with the read tool before acting, then follow them for the rest of the session) ──`;
2. One **compact skill row** per skill:

```
# skill: caveman — Ultra-compressed communication mode…
Read full rules: /Users/<you>/.dsh/skills/caveman/SKILL.md
```

When the description is empty the row is just `# skill: <name>`. When a task matches the skill, the main agent reads the full SKILL.md at the `Read full rules:` path with its own `read` tool before acting.

Cost model: **one persona line per skill** (absolute path included); zero cost when unused; directory injection stays at zero.

### 4.3 Optional hard inlining: main_agent_skills_inline

To inline a style skill's full text into the persona so that it applies to every response round:

```yaml
main_agent_skills_inline:
  - caveman
```

The generator inlines the full body of the selected SKILL.md (**YAML frontmatter stripped**) into the persona — with a heading line per skill (`# skill: <name> — <description> (inlined)`, or `# skill: <name> (inlined)` when there is no description) followed by the body. The cost is a fixed per-response persona overhead equal to the skill text — right for style skills like caveman that must apply unconditionally.

### 4.4 Edge cases

| Case | Behavior |
|---|---|
| A skill is listed in both `main_agent_skills` and `main_agent_skills_inline` | **Inline only** — the soft row is not duplicated |
| No matching SKILL.md found | **Warning and skip** (does not abort the install); warned once per name across both keys |
| SKILL.md exists but its body is empty | Treated as not found; skipped |
| `description` parsing | Handles single-line, quoted (single/double), folded (`>`) and literal (`\|`) blocks (including a block marker on its own line); collapses whitespace, strips one pair of surrounding quotes, caps at 200 chars; empty string when absent |
| SKILL.md scan roots | `$DSH_HOME/skills` (default `~/.dsh/skills`), `$DSH_AGENTS_HOME/skills` (default `~/.agents/skills`), `<cwd>/.dsh/skills`, `<cwd>/.agents/skills`; within a root, `<root>/<name>/SKILL.md` wins over a bare `<root>/<name>.md` |

Skill names come from install-time skill detection (the same four roots); the wizard and config UI only offer detected skills.

## 5. Main-agent persona

### 5.1 Main-agent name: main_agent_name

The optional top-level key `main_agent_name` (string | null) renames the main agent — **one key, two places**:

- **The deployed preset display name**: the `name` in `preset.yml` — the name shown in the GUI preset picker, default「编排模式 (Orchestrator)」("orchestration mode");
- **The persona identity line**: `You are the <name> agent powered by the {{model}} model.` in the main-agent persona, with `<name>` = this key's value.

Constraints: after trimming, 1–60 characters and no newlines; an empty string / an absent key keeps the default (without this key, both the display name and the identity line stay verbatim from the SRC — the installer substitutes nothing).

```yaml
main_agent_name: orchestration-lead   # absent = the default orchestration name (preset display「编排模式 (Orchestrator)」, "orchestration mode")
```

- **Hand-editing**: write the key and re-run `./install.sh --auto`, then restart DSH or open a new session.
- **Config UI**: Settings → 庖丁配置 → the「主 agent 名称」("main agent name") input at the top of the main-agent card, with its「恢复默认」("restore default") button; after「保存并应用」(save & apply) it takes effect on a **GUI restart / new session**.
- For contrast: this key renames only the **main agent**. A built-in role's display name is the role-level sub-key `roles.<toolName>.name` — it rewrites only the subject of that role's default persona identity sentence and never the tool call name (see 2.4). The two renaming lines are independent and configured separately.

### 5.2 Persona extra: three-state semantics

`main_agent_persona_extra` (an optional top-level multi-line string) is appended to the tail of the main-agent persona at install time. The assembly order is fixed: **SRC body → skill soft rows / inlines → extra**. The key is three-state:

| Value | Semantics |
|---|---|
| Absent / `null` | Use the **default constant** (the codegraph projectPath rule, see 5.3) |
| Explicit `''` | **Append nothing** (not even the default rule) |
| Any other text | **Overrides** the default with your text |

Serialization: `''` is written out explicitly as `main_agent_persona_extra: ''` (distinct from an absent key); multi-line text is written as a `|-` block scalar. `normalizeConfig` in `tools/install.mjs` accepts only strings (a non-string or an absent key normalizes to `null`).

### 5.3 The default constant, verbatim

The single source of truth is `DEFAULT_MAIN_AGENT_PERSONA_EXTRA` in `tools/install.mjs`; `presets/orchestrator/agent.cordis.yml` no longer embeds the line. The default value, verbatim:

> Codegraph MCP default project may be a DIFFERENT repository than {{cwd}}. Never call codegraph_* tools without passing projectPath = {{cwd}} (the absolute path of your working directory). If {{cwd}} has no .codegraph index, fall back to glob/grep/read directly and do not loop or comment on project mismatches.

It matters only when the codegraph MCP is mounted (it constrains codegraph tools to carry the current project path); otherwise it is an irrelevant-but-harmless paragraph. `{{cwd}}` and `{{model}}` are persona template placeholders substituted by DSH at runtime — **keep them verbatim** when hand-editing.

### 5.4 Where to edit

- **Hand-editing**: edit the `main_agent_persona_extra` key in the config file and re-run `./install.sh --auto`.
- **Config UI**: Settings → 庖丁配置 → main-agent card, the「人设追加」(persona extra) editor (with a "restore default" button) lets you edit / clear / restore the default; after「保存并应用」(save & apply) the change takes effect on a **GUI restart / new session**.
- The interactive wizard has no dedicated prompt step for the persona extra (it inherits the existing config value) — under the CLI, hand-edit the file or use the UI.

## 6. Custom roles

The four built-in delegation roles (section 2 and [Architecture](architecture_en.md)) are a **starting point,
not a ceiling**: any combination of tools and skills can be registered as a new delegation tool, and the main
agent simply calls its toolName in conversation. The most typical pattern is a **skill-specialized agent** —
for example, a "dedicated PPT agent": create a `ppt` role whose tool surface includes `skill` (the sub-agent
loads skill rules on demand through the skill tool) plus `read` / `write` / `edit` / `bash` etc., a persona
that says to build HTML slides with the `html-ppt` skill, and assign the `html-ppt` skill to it (section 7).
After install, a main-agent "turn this outline into a PPT" delegates to a dedicated slide-making sub-agent
instead of asking a generalist role to handle it. Any installed skill can become a specialized role the same
way (frontend drafts, charts, document layout, …). This section covers the wizard/UI path (6.1), the
hand-written static-source path (6.2), and configuration examples (6.3, including a skill-typed PPT agent).

Two generation-time behaviors are worth stating up front. First, **a custom role with an empty tool
surface is rejected at apply time** — a missing or empty `tools` list yields a blank allow list
(`toolFilter.allow:` collapses to YAML null), leaving the sub-agent without a single tool; the generator
treats custom roles exactly like built-ins here and refuses to install such a role, so give the role at
least one tool before applying (the wizard keeps re-asking until you do). Second, the generator
**appends the role's persona first line — its duty sentence — to the main-agent persona as a delegation
row** (`- <duty>: delegate to <toolName>.`, right after the existing delegation rows); that row is the
main agent's only routing hint for the role, so make the persona's first line a short duty sentence
(e.g. "Find the skill that matches the user's need").

### 6.1 Path 1: interactive wizard / config UI (recommended)

The wizard flow (`./install.sh` interactive, or the config UI's agent tool assignment):

1. Create a role: enter a `toolName` matching `/^[a-z][a-z0-9_]*$/`;
2. Multi-select tools from the tool pool (the trio's static allows ∪ detected host tools);
3. Write a one-line persona (the wizard auto-expands it to `You are the <name> agent. <your description>`; the config UI accepts a full persona);
4. The wizard automatically injects the new `toolName` into the main agent's `orchestrator-restrict config.allow` — **`restrict.mjs` itself is never touched** — and persists the assignment to the config file (a new entry under the `roles` key).

You can then delegate to that role directly by calling the toolName in conversation. To delete a role, remove the entry from the config file and re-run `--auto` (the target file is regenerated from scratch each run — no leftover blocks). Deleting a **built-in** role wholesale is different — that is `roles_remove` (see 2.3); simply not writing it under `roles` only stops overriding it.

### 6.2 Path 2: hand-written static source

When you prefer to skip the config layer, add the role in the source preset directly:

1. Copy a `delegation-*` block inside the delegation group of `presets/orchestrator/agent.cordis.yml`;
2. Change its `toolName` / `persona` / `toolFilter.allow`;
3. Add the new `toolName` to `MAIN_AGENT_ALLOW` in `presets/orchestrator/restrict.mjs` (that constant is the base of the generated `config.allow`; without the name in the main-agent allow list the delegation tool is not callable);
4. Re-run `./install.sh --auto` (the installer rewrites only the limited trio/main-agent persona spans — your added block carries over verbatim).

Both paths produce the same structure (`delegation-<toolName>` plus the toolName in the allow list); path 1 needs no source edits and is UI-manageable — prefer it.

### 6.3 Example

Defining `code-reviewer` in a hand-written config (tools `read` / `glob` / `grep` / `bash` / `ask_user_question` / `todo_write`, …):

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

After re-running `./install.sh --auto`: a `delegation-code-reviewer` block is generated (persona as-is, tools verbatim into its allow) and `code-reviewer` is injected into the main agent's `config.allow`. Note that a custom role's `tools` are written into the allow **verbatim — no detection intersection** (the wizard/UI tool pool guarantees the choices exist in the registry) — when hand-writing, list only actually-mounted tools, otherwise child-agent creation is rejected by `tools.restrict()` for unknown tools.

**Skill-typed example: a `ppt` agent (a dedicated slide-making sub-agent)** — the tool surface includes
`skill` plus read/write/edit, the persona guides the agent to the `html-ppt` skill, and the `skills` key
assigns that skill to the role (an Available skills guidance line is appended to the persona):

```yaml
roles:
  ppt:                       # toolName: after install the main agent delegates by calling "ppt"
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
      - skill                # load the html-ppt skill rules on demand via the skill tool
      - ask_user_question
      - todo_write

skills:
  html-ppt: [ppt]            # assign the skill to the ppt role (soft guidance, see section 7)
```

The effect is the same as `code-reviewer` (a `delegation-ppt` block is generated, `ppt` joins the allow list);
the difference is the extra `skills` mapping. Once the sub-agent exists, the skill catalog is visible to it in
full (a DSH mechanism), so the persona guidance line is only a **soft constraint** — the actual work happens
when the sub-agent loads the rules via the `skill` tool; mounting other skills (resumes, charts, …) works the
same way. The wizard / config UI can build the same role: tick `skill` plus read/write/edit in the tool pool,
write a one-line persona, and assign `html-ppt` to `ppt` in the skill-assignment panel.

## 7. Skills to roles

### 7.1 Writing and effect

The top-level `skills` key assigns skills to roles (the value is a list of role toolNames — the same mapping as the wizard's skill-assignment step and the config UI's skill panel):

```yaml
skills:
  frontend-design: [design]
  html-ppt: [design]
```

At install time the generator appends the guidance sentence `Available skills: frontend-design, html-ppt` to the persona tail of each assigned role (nothing is appended when a role has no assignments). For roles whose surface includes `skill` (such as `design` / `implement`), the skill directory is fully visible to the subagent and the sentence guides it to load skills through the `skill` tool. DSH collects skill directories per cwd and makes them fully visible to role agents — there is no per-agent directory filtering. Assignments only matter for roles that exist and whose allow includes `skill`.

### 7.2 Soft-constraint nature

This is a **soft constraint**, not hard isolation: directory visibility is a DSH mechanism (collected per cwd, fully visible to role agents); the persona sentence is only a hint. Hard isolation comes from the tool surface (whether `skill` is in the role's allow). The main agent is the exception: `skill` is denied at its registry level (see 3.1), so skills are invisible to it — when needed, use `main_agent_skills` / `main_agent_skills_inline` (section 4), not the `skills` key.

## 8. Per-agent model & misc

### 8.1 Per-role model via agentOptions

`dsh-tool-subagent` supports `config.agentOptions: { provider, model, maxTokens }`. For per-role models, prefer the config sub-keys `roles.<toolName>.model` / `.provider` (see 2.5); edit the static source — adding the block to the matching `delegation-*` in `presets/orchestrator/agent.cordis.yml` — when you also need `maxTokens` or prefer not to touch the config layer (the installer rewrites only the persona and allow spans, so `agentOptions` carries over verbatim into the generated file):

```yaml
    - id: delegation-implement
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: implement
        agentOptions:            # per-role model; omit to inherit the main agent's model
          provider: <provider-key>   # use the provider keys configured in your DSH environment
          model: <model-id>
          maxTokens: 65536
```

Omitting `agentOptions` means inheriting the main agent's model. The config sub-keys in 2.5 inject exactly this block at generation time (built-in trio and custom roles alike); only finer control such as `maxTokens` still calls for a hand edit of the static source (path 2, see 6.2).

### 8.2 Platform / registry details

- **`str_replace_editor` is deliberately not in `implement`'s allow**: some deployments' registries do not provide it, and a child created with it in the allow would be rejected by `tools.restrict()` as an unknown tool. Add it back only after confirming your deployment registers it (edit the static implement allow, or `roles.implement.tools` in the config).
- Allow lists use **exact-name matching**; globs are not supported; tavily's five tools must each be spelled out.
- Unmounted names in the main-agent allow never error (the waterfall matches names only against already-resolved tools).

### 8.3 Syncing after disabling MCPs / plugins

When you disable tavily / codegraph / magic-memory (comment out the entry in `~/.dsh/cordis.patch.yml` or the profile patch), **no manual allow editing is needed**: re-run `./install.sh --auto` and the installer automatically prunes the matching `mcp__tavily__*` / `memory_search` names from the trio's allows (use `--dry-run` to preview the pruned names first). MCP servers that cannot be detected or whose handshake fails are skipped: the affected roles simply lack those tools and the install does not error. Detection and patch-layer details chain to [Installation](installation_en.md).
