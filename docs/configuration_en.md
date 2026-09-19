← [dsh-paoding](../README_en.md) ｜ [Architecture](architecture_en.md) ｜ [Installation](installation_en.md) ｜ [Orchestration](orchestration_en.md) ｜ **Configuration**

[中文](configuration.md) · English

# Configuration

dsh-paoding makes the role-based orchestration preset **configuration-driven**: you hand-write (or click together in the 庖丁配置 panel) a YAML config file, and the generator (`tools/`; the panel's Save & Apply and the in-repo fallback CLI share the same generation pipeline, `collectState` / `generateAndInstall`) rewrites the target preset — `~/.dsh/.agent-presets/orchestrator/agent.cordis.yml` — when it is applied, covering the role allows, role personas, the main-agent allow list (`config.allow` injection) and the main-agent persona's skill rows / inlines and persona extra.

The config file describes **declarative intent**. The target file is regenerated from scratch every time — "source preset + this config file": edit the config → hit Save & Apply in the panel = idempotent sync, with no accumulating hand patches.

## 1. Configuration file

### 1.1 Location and precedence

The config file's default location is `$DSH_HOME/dsh-paoding.config.yml`; when `$DSH_HOME` is unset, it defaults to `~/.dsh`. The `DSH_PAODING_CONFIG` environment variable moves the path for the panel; the in-repo fallback CLI's `--config <file>` flag selects any other path.

How an edit gets applied ("re-apply" below always means the first row):

| Scenario | Behavior |
|---|---|
| Web panel (庖丁配置 in the left sidebar) | **The main path**: opening the panel loads the existing config as the current values;「保存并应用」(Save & Apply) writes the preset and saves the assignments to the config file (default `~/.dsh/dsh-paoding.config.yml`, written with `0o600` permissions). If you hand-edited the file, open the panel first and then apply |
| First-install automation | At startup the plugin applies the config file automatically once it finds the preset missing or carrying a stale version marker (no config → base template) — no manual trigger needed in day-to-day use |
| Fallback CLI (developers who cloned the repo only) | `node tools/install.mjs --auto`: applies the config file idempotently when present, else writes the base template; `--dry-run` prints only the detection report and the allow / persona changes that would be generated — writes nothing (including the config file), good for previewing first; `--config <file>` uses the given file instead of the default location |

A config file that **exists but fails to parse** is a hard error (the pipeline aborts); a **missing** file simply means "no configuration" (the base template). Top-level keys such as `profile` and `roles` are described in the next subsection.

Fallback-CLI precedence: an explicit `--profile` overrides the `profile` key in the config file; otherwise the config file's value wins; the fallback is `web`.

### 1.2 Top-level keys

The key names below match `normalizeConfig` in `tools/lib/config.mjs` — the single authoritative source of the config file schema (`tools/install.mjs` only re-exports it).

| Top-level key | Type | Semantics |
|---|---|---|
| `profile` | string | Which profile's patch layer (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`) is scanned during detection; default `web` |
| `roles` | map | `toolName` → `{ persona?, name?, tools[], model?, provider?, background_mode? }`. For the three built-in roles (`search_external` / `design` / `implement`): overrides the persona and the allow intent, and may carry a `name` display name (rewrites only the subject of that role's default persona identity sentence — see 2.4), a dedicated model (`model` / `provider`, see 2.5) and a session mode (`background_mode`, see 2.6). Any other key is a **custom role**: the installer emits a fresh `delegation-<toolName>` block and injects the toolName into the main agent's `config.allow` (sections 2 and 6) |
| `roles_remove` | string[] | toolNames of built-in roles deleted wholesale (only `search_external` / `design` / `implement` are accepted; other names are ignored with a warning; default `[]`). Deleting means the delegation block / tool surface / role persona / main-agent delegation guidance are no longer generated (see 2.3) |
| `skills` | map | `skill` → the list of role toolNames the skill is assigned to; the installer appends an `Available skills: …` guidance sentence to those roles' personas (section 7) |
| `main_agent_extra` | string[] | Tools appended to the main-agent allow list (host tools such as `mcp__codegraph__codegraph_explore`, `memory_search`, `mnemon_*`); names are checked against the preset's own tool face ∪ the detection inventory — a name in neither is not injected |
| `main_agent_remove` | string[] | Base tools stripped from the main-agent allow list (e.g. the goal family, `exit_plan_mode`); names absent from the current allow are warned about and skipped; removing everything is a hard error |
| `main_agent_skills` | string[] | Main-agent skills in soft-guidance mode (the default channel): one compact skill row + a `Read full rules:` path per skill, appended to the persona |
| `main_agent_skills_inline` | string[] | Main-agent skills in hard-inline mode (optional): the selected SKILL.md bodies are inlined into the persona and apply to every response |
| `main_agent_persona_extra` | string \| null | Text appended to the tail of the main-agent persona. `null` / absent = use the default constant; `''` = append nothing; any other string = override the default |
| `main_agent_display_name` | string \| null | The main agent's display name — changes **only the deployed preset display name** (the name shown in the GUI preset picker), never the persona identity line. Constraints: trimmed, 1–60 chars, no newlines; empty / absent = the default「编排模式 (Orchestrator)」(workspace presets use the derived name; see 5.1) |
| `workspaces` | map | Absolute workspace (project) directory → that workspace's own config entry, same fields as the top level (except `profile`); each entry generates its own `orchestrator-<slug>` preset, independent of the global one (section 9) |

`roles` details:

- `roles.<toolName>.persona`: a non-empty string **replaces the role's deployment persona wholesale** (`''` or absent keeps the static default). A custom role without a persona gets `You are the <toolName> agent. Handle tasks delegated to this role.`
- `roles.<toolName>.tools`: when `toolName` is one of the three built-ins this **fully overrides the intent** of that role's `toolFilter.allow` (the installer then intersects host-dependent names with what was actually detected); absent keeps the static allow. If a built-in role would end up with an empty allow, the install aborts (a zero-tool role is refused).
- `roles.<toolName>.name`: an optional `string | null` display name for the built-in trio only (absent / `null` = the role's built-in default identity). It rewrites only the **subject of that role's default persona identity sentence** — design's default `You are the design agent.` with `name: UI 设计` becomes `You are the UI 设计 agent.`, with the rest of the sentence untouched; constraints, boundaries and an example are in 2.4.
- `roles.<toolName>.model`: a dedicated model id for the role (optional `string`). When set, every sub-agent the role spawns runs on that model instead of following the main agent's current session model; absent = nothing is injected and the child inherits the main agent's model (see 2.5).
- `roles.<toolName>.provider`: the provider route the role's model lives on (optional `string`). It only takes effect paired with `model`; a lone `provider` is warned about and ignored by the installer, while a lone `model` rides the main agent's provider route (see 2.5).
- `roles.<toolName>.background_mode`: the role's session mode (optional `'one-shot' | 'continuable'`; default `one-shot`) — run-and-discard, or continuable: the child conversation is kept across turns so the main agent can resume in place with `send_message`. Built-in and custom role entries share the semantics; the continuable prerequisites, costs and panel path are in 2.6.
- Keys under `roles` outside the built-in trio are **custom roles** (section 6). Do not put the static role `search_internal_deep` under `roles` (see 2.2).
- Built-in roles can be **deleted wholesale**: the `roles_remove` key accepts only the trio's names — deletion effect, consistency with the `roles` key, and the restore paths are in 2.3.

When the `main_agent_extra` **key is missing** (older configs / never written) it falls back to the smart defaults of the current run (detected codegraph / `memory_search` tools land on the main agent); an **explicit `main_agent_extra: []` means "no host tools, deliberately" and no longer falls back** — the base template written by a fresh first install is exactly this explicit `main_agent_extra: []` form and carries no host tools at all (codegraph and friends become usable only after being opted in via config or the panel).

### 1.3 Complete minimal example

A config file covering all commonly used keys (the key order matches `serializeConfig`, which is what the panel writes):

```yaml
# dsh-paoding installation config — hand-editable; after editing, apply via the 庖丁配置 (Paoding Config) entry at the sidebar bottom, or re-run node tools/install.mjs --auto.

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
  code-reviewer:        # custom role (toolName matches /^[a-z][a-z0-9_-]{1,31}$/)
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

- The `tools` under `roles.search_external` express **intent**: if tavily is not enabled, the generator drops the five `mcp__tavily__*` names and keeps the rest (the Preview "removed" list states the reason for each).
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

### 2.2 search_internal_deep is a static role

`search_internal_deep` (whole-repo deep exploration: read-only, no network, returns condensed summaries only) is also a built-in delegation role, but it is **outside the trio the installer manages**: the installer never rewrites its persona or allow. (The comment inside that role's block in `agent.cordis.yml` records how `memory_search` and the codegraph tools were removed from its allow by hand on 2026-09-02 — when you re-enable those plugins, you add them back there yourself; the installer will not do it.)

Therefore:

- **Do not** put `search_internal_deep` under the `roles` key of the config file — keys outside the trio are treated as **custom roles**, and the installer would emit a second, duplicate `delegation-search-internal-deep` block that clashes with the static one.
- It is likewise **outside** the `roles_remove` deletable set (that key accepts only the trio's names, see 2.3) — it is deliberately kept as a static role, appears in no config key or UI, and this key cannot delete it either.
- To change its persona or tool surface, edit the `persona` and `toolFilter.allow` of the `delegation-search-internal-deep` block in `presets/orchestrator/agent.cordis.yml` directly, then hit Save & Apply in 庖丁配置 to regenerate (developers can also run the fallback CLI, `node tools/install.mjs --auto`). The generator rewrites only the limited spans of the trio roles and the main-agent persona; everything else in the static source (including your edit) carries over verbatim into the generated file.

### 2.3 Deleting built-in roles: roles_remove

The optional top-level key `roles_remove` (string[], default `[]`) deletes built-in delegation roles **wholesale**; its values are the toolNames of the roles to remove. The only deletable names are `search_external` / `design` / `implement` — exactly the three default roles the `roles` key can override (the three cards with the「内置」("built-in") badge in the panel). Names outside that set are **ignored with a warning**; `search_internal_deep` cannot be deleted (it is a deliberately static role, see 2.2).

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

- **Hand-editing**: remove the name from `roles_remove` (and, if you want your custom persona / tools back, put the entry back under `roles`), then hit Save & Apply in 庖丁配置 — the role regenerates with its SRC-default persona and tool surface.
- **Panel**: the「已删除的内置角色」("deleted built-in roles") area at the end of the role list restores it with one click (restored to the SRC-default tool surface).

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

Applying it works just like the main-agent display name (see 5.1):

- **Hand-editing**: write the sub-key and hit Save & Apply in 庖丁配置, then restart DSH or open a new session.
- **Panel**: 庖丁配置 (left sidebar) → the「角色显示名」("role display name") input at the top of a built-in role card (the「内置」("built-in") badge); empty = the default; after「保存并应用」(save & apply) it takes effect on a **GUI restart / new session**.

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

In the config page (庖丁配置 in the left sidebar → the「专用模型」("dedicated model") control on a role card) this is a dropdown fed by the model routes registered in your DSH deployment; values outside the catalog (e.g. from a hand-edited config) are preserved as a「当前配置」("current config") option instead of silently disappearing.

Applying works exactly like every other config key: after editing, hit「保存并应用」(save & apply) in 庖丁配置, then restart DSH or open a new session.

These two sub-keys are the config-layer equivalent of the static-source `agentOptions` in 8.1 (no source edits — prefer them); drop to the static source only when you also need `maxTokens` (see 8.1).

### 2.6 Role session mode: roles.\<toolName>.background_mode

The optional `background_mode` sub-key of a role entry decides how that role's child sessions end: `'one-shot'` (run-and-discard) or `'continuable'` (kept across turns). Default `one-shot`; built-in and custom role entries share the semantics, with no per-role differences.

```yaml
roles:
  implement:
    background_mode: continuable   # this role's delegations run in the background and persist across turns; the main agent resumes in place with send_message
```

Generation semantics: the base template ships a `backgroundMode: one-shot` row in each of the four built-in roles' delegation blocks (pure visibility, so the generated file never makes you guess the default); a role configured as `continuable` has that row **rewritten in place** to `backgroundMode: continuable` (a fallback insert happens only when the row is missing — two rows can never appear), while `one-shot` / absent keeps it as is. Custom-role blocks always carry the row too. For the orchestration-level trade-offs and the failure-recovery branch of each mode, see "One-shot vs continuable" in [Orchestration](orchestration_en.md).

Prerequisites and costs of continuable (stated plainly):

- **Prerequisite: a `sessionPersistence` backend mounted at the host layer.** Mount `@deepseek-ai/dsh-session-persistence-jsonl` in `~/.dsh/cordis.patch.yml` (`config.root` required). Without it, continuable creation/resumption fails loudly (error code `PERSISTENCE_UNAVAILABLE`). This is a machine-level, global change; uninstalling the preset does not undo it.
- **Costs: no TTL, on-disk accumulation, and accumulated context on every turn.** Persisted sessions have no TTL and keep writing to disk; a continuable child carries the context it has accumulated on every turn, so a long-lived child only gets more expensive. Reserve it for multi-round polishing delegations; `interrupt_agent` sessions you no longer need and clean up the on-disk files.

Panel path: 庖丁配置 in the left sidebar → the「会话模式」("session mode") radio on a role card (「一次性（one-shot）」/「可续（continuable）」). When `sessionPersistence` is not detected the panel warns in place but does not block — the warning only reminds you to mount the persistence backend first; saving works as usual.

Boundaries:

- **The static role is out of scope**: `search_internal_deep` is not configured through the `roles` key (see 2.2). Its delegation block carries the same explicit `backgroundMode: one-shot` marker in the base template; to make it continuable, edit that row in the static source and re-apply (the generator never rewrites that row, it carries over verbatim).
- **Deleted roles are not involved**: for a role deleted wholesale by `roles_remove`, any `background_mode` left in its entry is ignored with a warning (see 2.3).
- **The main persona already carries the matching branch**: when a continuable role fails or disappoints, the main agent's delegation SOP resumes it in the same session with `send_message` first, and re-delegation drops to a fallback (see [Orchestration](orchestration_en.md)).

Applying works exactly like every other config key: after editing, hit「保存并应用」(save & apply) in 庖丁配置, then restart DSH or open a new session.

## 3. Main-agent tool surface

### 3.1 Mechanism and the 21-name base allow list

The main agent's tool surface is filtered against an allow list by `presets/orchestrator/restrict.mjs` (the `orchestrator-restrict` plugin) on the `system-prompt/assemble` waterfall. The filter is **fail-open** (a bug in the filter itself can never brick a session); names are matched one-by-one against the resolved tools, so **unmounted names are simply absent — never an error**.

The `MAIN_AGENT_ALLOW` constant in `restrict.mjs` is the **base** (21 names) that the generated `config.allow` starts from; at runtime the filter falls back to it when no `config.allow` is injected. To reshape the main-agent tool surface, **do not edit `restrict.mjs`** — always use the config file (`main_agent_extra` / `main_agent_remove`) or the main-agent card in the panel instead.

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

- The entries land in the generated `orchestrator-restrict config.allow`. Injection follows the same whitelist: a name must belong to the **preset's own tool face** (the `restrict.mjs` main-agent allow ∪ the static role allows in the source preset) or to the **detection inventory**, and host tools (`mcp__*`, plugin tools like `mnemon_*`) go by what was actually detected — undetected names (MCP/plugin disabled, typo) are silently not injected. Note that the removed list in Preview only covers the **role allow** reconciliation; names dropped from `main_agent_extra` are only counted in the CLI output summary, with no per-name detail (read the final main-agent allow in the preview for details).
- The concrete MCP / plugin tools checkable on the panel's "main agent" card are those shown by the detection results (the tool pool).
- When the `main_agent_extra` **key is missing** the generator falls back to smart defaults (detected codegraph / `memory_search` tools are suggested for the main agent); an explicit `main_agent_extra: []` means no host tools, deliberately, with no fallback (the fresh-install base template is exactly this form).

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
| SKILL.md scan roots | Global (fallback CLI / panel "Global default") scans the two user roots only: `$DSH_HOME/skills` (default `~/.dsh/skills`), `$DSH_AGENTS_HOME/skills` (default `~/.agents/skills`); generating for a workspace additionally scans that workspace's `.dsh/skills` and `.agents/skills` (section 9). Within a root, `<root>/<name>/SKILL.md` wins over a bare `<root>/<name>.md` |

Skill names come from apply-time skill detection (the same four roots); the panel only offers detected skills.

## 5. Main-agent persona

### 5.1 Display name only: main_agent_display_name

`main_agent_display_name` (an optional top-level key, string | null) changes **only the deployed preset display name** — the name shown in the GUI preset picker — and leaves the persona identity line `You are the orchestrator agent powered by the {{model}} model.` untouched. The orchestrator's identity is part of the orchestration preset's prompt semantics and **cannot be renamed** (the legacy "main agent name" key has been removed; leftover lines in old configs are dropped automatically the next time you hit Save & Apply, and the installer notes that the key is ignored).

Constraints: 1–60 characters after trimming, no newlines; violations raise a hard error. Empty / absent = the default「编排模式 (Orchestrator)」(workspace presets use the derived name).

When generating `preset.yml`, the display name is resolved in this order:

1. `main_agent_display_name` (this key, highest priority when non-empty);
2. the derived「SRC 名·目录名」name (workspace presets only, see 9.2);
3. the SRC name verbatim.

Without this key, behavior stays byte-for-byte identical to before (backward compatible; existing configs upgrade with zero friction).

```yaml
main_agent_display_name: 庖丁   # only the preset display name becomes「庖丁」; the identity line stays
```

Where to set it:

- **Hand-editing**: write the key and hit Save & Apply in 庖丁配置, then restart the GUI or open a new session.
- **Panel**: 庖丁配置 (left sidebar) → main-agent card, the「主 agent 显示名（仅 preset 显示名）」("main agent display name (preset display name only)") input, with its「恢复默认」("restore default") button; after「保存并应用」(save & apply) it takes effect on a **GUI restart / new session**.
- For contrast: there are two independent naming lines that never interfere with each other: `main_agent_display_name` (the main agent's preset display name only, see 5.1) and `roles.<toolName>.name` (the subject of a built-in role's default persona identity sentence, never the tool call name — see 2.4). Configure each on its own.

### 5.2 Persona extra: three-state semantics

`main_agent_persona_extra` (an optional top-level multi-line string) is appended to the tail of the main-agent persona at install time. The assembly order is fixed: **SRC body → skill soft rows / inlines → extra**. The key is three-state:

| Value | Semantics |
|---|---|
| Absent / `null` | Use the **default constant** (the codegraph projectPath rule, see 5.3) |
| Explicit `''` | **Append nothing** (not even the default rule) |
| Any other text | **Overrides** the default with your text |

Serialization: `''` is written out explicitly as `main_agent_persona_extra: ''` (distinct from an absent key); multi-line text is written as a `|-` block scalar. `normalizeConfig` in `tools/lib/config.mjs` accepts only strings (a non-string or an absent key normalizes to `null`).

### 5.3 The default constant, verbatim

The single source of truth is `DEFAULT_MAIN_AGENT_PERSONA_EXTRA` in `tools/lib/util.mjs` (`tools/install.mjs` only re-exports it); `presets/orchestrator/agent.cordis.yml` no longer embeds the line. The default value, verbatim:

> Codegraph MCP default project may be a DIFFERENT repository than {{cwd}}. Never call codegraph_* tools without passing projectPath = {{cwd}} (the absolute path of your working directory). If {{cwd}} has no .codegraph index, fall back to glob/grep/read directly and do not loop or comment on project mismatches.

It matters only when the codegraph MCP is mounted (it constrains codegraph tools to carry the current project path); otherwise it is an irrelevant-but-harmless paragraph. `{{cwd}}` and `{{model}}` are persona template placeholders substituted by DSH at runtime — **keep them verbatim** when hand-editing.

### 5.4 Where to edit

- **Hand-editing**: edit the `main_agent_persona_extra` key in the config file, then hit Save & Apply in 庖丁配置.
- **Panel**: 庖丁配置 (left sidebar) → main-agent card, the「人设追加」(persona extra) editor (with a "restore default" button) lets you edit / clear / restore the default; after「保存并应用」(save & apply) the change takes effect on a **GUI restart / new session**.

## 6. Custom roles

The four built-in delegation roles (section 2 and [Architecture](architecture_en.md)) are a **starting point,
not a ceiling**: any combination of tools and skills can be registered as a new delegation tool, and the main
agent simply calls its toolName in conversation. The most typical pattern is a **skill-specialized agent** —
for example, a "dedicated PPT agent": create a `ppt` role whose tool surface includes `skill` (the sub-agent
loads skill rules on demand through the skill tool) plus `read` / `write` / `edit` / `bash` etc., a persona
that says to build HTML slides with the `html-ppt` skill, and assign the `html-ppt` skill to it (section 7).
After install, a main-agent "turn this outline into a PPT" delegates to a dedicated slide-making sub-agent
instead of asking a generalist role to handle it. Any installed skill can become a specialized role the same
way (frontend drafts, charts, document layout, …). This section covers the panel path (6.1), the
hand-written static-source path (6.2), and configuration examples (6.3, including a skill-typed PPT agent).

Two generation-time behaviors are worth stating up front. First, **a custom role with an empty tool
surface is rejected at apply time** — a missing or empty `tools` list yields a blank allow list
(`toolFilter.allow:` collapses to YAML null), leaving the sub-agent without a single tool; the generator
treats custom roles exactly like built-ins here and refuses to apply such a role, so give the role at
least one tool before applying. Second, the generator
**appends the role's persona first line — its duty sentence — to the main-agent persona as a delegation
row** (`- <duty>: delegate to <toolName>.`, right after the existing delegation rows); that row is the
main agent's only routing hint for the role, so make the persona's first line a short duty sentence
(e.g. "Find the skill that matches the user's need").

### 6.1 Path 1: the 庖丁配置 panel (recommended)

The panel flow (庖丁配置 in the left sidebar → agent tool assignment → "Create a custom agent role" at the bottom):

1. Create a role: enter a `toolName` matching `/^[a-z][a-z0-9_-]{1,31}$/` (2–32 chars: a lowercase letter first, then lowercase letters / digits / underscores / hyphens; the installer additionally rejects reserved names, the `mcp__` prefix and YAML literals);
2. Multi-select tools from the tool pool (the trio's static allows ∪ detected MCP / plugin tools);
3. Write a persona (a full persona is accepted; make the first line a short duty sentence);
4. Hit Save & Apply — the generator automatically injects the new `toolName` into the main agent's `orchestrator-restrict config.allow` — **`restrict.mjs` itself is never touched** — and persists the assignment to the config file (a new entry under the `roles` key).

A note on where the role card's tool checklist comes from. Candidates are the static allow face from the
source preset (built-in roles have it, core tools included) ∪ the main agent's core allow list (`restrictBase`,
the fallback for custom roles) ∪ the detection inventory, presented in three groups: "**Base tools**" = core
names that are neither `mcp__`-prefixed nor in the inventory (`read` / `glob` / `grep` / `bash` / `todo_write`
etc.; the delegation names `search_external` / `design` / `implement` / `search_internal_deep` are not toggled
in the grid); "**MCP tools**" = `mcp__`-prefixed names (including rows shipped in the source preset, such as
tavily); "**Plugin tools**" = inventory names registered by plugins under their own names, no `mcp__` prefix
(`mnemon_*` etc.). A newly created role ships with the core face plus the inventory pre-checked in its factory
`tools`; trim or extend it before Save & Apply.

You can then delegate to that role directly by calling the toolName in conversation. To delete a role, delete its card in the panel (or remove the entry from the config file) and hit Save & Apply again (the target file is regenerated from scratch each run — no leftover blocks). Deleting a **built-in** role wholesale is different — that is `roles_remove` (see 2.3); simply not writing it under `roles` only stops overriding it.

### 6.2 Path 2: hand-written static source

When you prefer to skip the config layer, add the role in the source preset directly:

1. Copy a `delegation-*` block inside the delegation group of `presets/orchestrator/agent.cordis.yml`;
2. Change its `toolName` / `persona` / `toolFilter.allow`;
3. Add the new `toolName` to `MAIN_AGENT_ALLOW` in `presets/orchestrator/restrict.mjs` (that constant is the base of the generated `config.allow`; without the name in the main-agent allow list the delegation tool is not callable);
4. Re-apply (Save & Apply in 庖丁配置; developers can also run `node tools/install.mjs --auto`) — the generator rewrites only the limited trio/main-agent persona spans, so your added block carries over verbatim.

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

After Save & Apply in 庖丁配置: a `delegation-code-reviewer` block is generated (persona as-is, tools verbatim into its allow) and `code-reviewer` is injected into the main agent's `config.allow`. Note that a custom role's `tools` are written into the allow **verbatim — no detection intersection** (the panel's tool pool guarantees the choices exist in the registry) — when hand-writing, list only actually-mounted tools, otherwise child-agent creation is rejected by `tools.restrict()` for unknown tools.

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
same way. The 庖丁配置 panel can build the same role: tick `skill` plus read/write/edit in the tool pool,
write a one-line persona, and assign `html-ppt` to `ppt` in the skill-assignment grid.

## 7. Skills to roles

### 7.1 Writing and effect

The top-level `skills` key assigns skills to roles (the value is a list of role toolNames — the same mapping as the panel's skill-assignment grid):

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

When you disable tavily / codegraph / magic-memory (comment out the entry in `~/.dsh/cordis.patch.yml` or the profile patch), **no manual allow editing is needed**: hit Save & Apply once in 庖丁配置 and the generator automatically prunes the matching `mcp__tavily__*` / `memory_search` names from the trio's allows (use Preview to see the pruned names first). MCP servers that cannot be detected or whose handshake fails are skipped: the affected roles simply lack those tools and applying does not error. Detection and patch-layer details chain to [Installation](installation_en.md).

## 9. Per-workspace configuration

### 9.1 One global set, one per workspace

DSH organizes sessions by workspace (the project directory). The top-level `workspaces` key gives each workspace its own main/sub-agent configuration: the global entry keeps generating the shared `orchestrator` preset, while each workspace entry generates its own `orchestrator-<slug>` preset. They coexist in the preset roster and never overwrite each other.

Each workspace entry is a **complete configuration set**, not a delta: same fields as the top level (except `profile` — detection layers stay global). Role sub-keys carry over as-is — `background_mode` (see 2.6) works per workspace too: let `implement` run continuable in one project while every other project stays one-shot. The first time you configure a workspace in the panel, it starts from the current global config; edit, then hit "Save & Apply" to generate that workspace's preset.

```yaml
workspaces:
  '/Users/me/code/shop-api':     # key = absolute workspace directory (normalized on write, always quoted)
    main_agent_display_name: Shop Backend Lead   # that workspace preset's display name only
    roles:
      implement:
        model: deepseek-reasoner # this project codes with the reasoning model
  '/Users/me/code/blog':
    roles_remove: [design]       # no design helper needed here
```

### 9.2 Preset naming

- The **slug** comes from the workspace directory's basename: lowercased, invalid characters collapsed to `-`; if that yields an empty string or exactly `orchestrator` (colliding with the global preset), `ws` is used instead.
- When multiple workspaces share a basename, a path-hash suffix (first 6 hex chars of sha1) is appended — two projects both named `Shop` become `orchestrator-shop-acd95b` and `orchestrator-shop-34b6aa`. Rename or move the directory and re-apply. While the old-path entry remains in the config's `workspaces` section, the stale preset directory is kept; once the entry is removed, the next successful apply automatically recycles the orphan preset (rmSync + a visible warning) — no manual deletion needed.
- Preset display name: the entry's `main_agent_display_name` if set; otherwise the default name gets the `·<basename>` suffix (e.g. `编排模式 (Orchestrator)·Shop`) so entries are distinguishable at a glance in the roster.

### 9.3 Using the panel

At the top of the 庖丁配置 page sits the **configuration target** tab strip:

- **Global default**: edits and writes the shared `orchestrator` preset, exactly as before;
- **Workspace tabs**: the list comes from the host workspace registry (directories register once a session has opened there); a green dot means the preset has been generated, and hovering shows the path, session count, and preset id;
- **Add workspace**: type an absolute directory path to register it (idempotent). If the registry is unreachable, the panel falls back to showing only the workspaces already in the config file — everything else keeps working.

With a workspace selected, preview and apply target it alone; the success note reports the preset id.

### 9.4 How it takes effect, and boundaries

- **Preset choice happens at session creation**: pick the workspace on the new-session screen, then pick the matching `orchestrator-<slug>` in the preset selector. The global default preset is untouched. A new session (or a DSH restart) is needed for a freshly generated preset to appear.
- Preset directories live under `$DSH_HOME/.agent-presets/` and are shared machine-wide: separate DSH instances launched from different projects never clobber each other, because their slugs differ.
- The fallback CLI still targets the global entry only; the `workspaces` section survives a CLI apply unchanged.
- A running session never switches presets — a session's roles and tool surfaces are assembled at creation and fixed for its lifetime; to change the lineup, start a new session with the new preset.

### 9.5 Skill scan roots follow the configuration target

Skill candidates do not follow the directory the GUI was launched from: the **global default** view scans the two user roots (`~/.dsh/skills`, `~/.agents/skills`), while a **workspace** view additionally scans that workspace's `.dsh/skills` and `.agents/skills`. Consequences:

- A skill installed only inside one project (say `bento-slides` living in a knowledge-base repo) is invisible — and unassignable — in the global config; select that workspace and it appears in the skill grid with a "project" badge, assignable to that workspace preset's main agent or roles.
- Generation resolves skills through the same lens: a workspace preset can emit the absolute SKILL.md path of a project-local skill (the main agent reads it on demand with `read` — any on-disk path is readable); the global preset resolves user roots only and warns-and-skips project-local skill names — a global preset travels across all projects and should not reference a single project's skill anyway.
- The fallback CLI has no workspace concept and scans the two user roots only (same as the global default).
