← [dsh-paoding](../README_en.md) ｜ [Architecture](architecture_en.md) ｜ [Installation](installation_en.md) ｜ **Orchestration** ｜ [Configuration](configuration_en.md)
[中文](orchestration.md) · English

# Orchestration

Orchestration is the core of dsh-paoding: the main agent (the orchestrator) decomposes the task, delegates along its texture, and integrates the results; role subagents carry only the tools their role needs and are discarded once their run settles. This document is for users who want to understand or tune these behaviors: how failures surface and recover, the one-shot vs multi-turn (continuable) trade-off, and how to enable the optional `implement_cont` enhancement. Where this document conflicts with the source code, the source wins; every configuration reference here is taken from `presets/orchestrator/agent.cordis.yml` and `presets/orchestrator/restrict.mjs`.

## Orchestration overview

dsh-paoding turns DSH from "a single agent that loads every tool" into "a main agent that orchestrates plus role agents that specialize". The split follows the texture of the task:

- **Hot path — internal file questions are never delegated.** Finding code, chasing references, and reading files are solved by the main agent itself with its read-only tools: `glob` / `grep` / `read` / `read_image` / `bash` are all on the main-agent allow list, so there is zero delegation round-trip latency. `codegraph` in the persona copy is a host MCP tool: it is only actually available when the install-time detection finds the codegraph server and it is injected through `main_agent_extra` (see [Configuration](configuration_en.md) and [Installation](installation_en.md)).
- **Cold path — role agents that carry only their own tools.** External research goes to `search_external` (only `web_search` + the five tavily tools + local reads); UI/frontend design goes to `design` (reads references, loads design skills, produces specs, never writes final code); code implementation goes to `implement` (read context → surgical change → verify); whole-repo deep exploration goes to `search_internal_deep` (a fourth role added 2026-09, see next section and [Architecture](architecture_en.md)). Each subagent is paid for only the run in which it is actually used (pay-per-use).
- **Directing a running child.** While a subagent runs, the main agent can append instructions with `send_message`, inspect status with `list_agents`, and stop it with `interrupt_agent` (all three are registered by `dsh-tool-subagent-control` and belong to the "child management" surface).
- **Integrate summaries only.** The main agent never dumps a child's full context into its own — it receives one summary (see section 5, Context isolation).

The main agent's model-facing surface is narrowed by `restrict.mjs` on the `system-prompt/assemble` waterfall against an allow list (fail-open: a filter bug exposes the full catalog rather than bricking the session; an empty allow list refuses to load). The delegation group also ships generic rows — `subagent` / `subagent_fork` (both `backgroundMode: continuable`), `workflow`, `ralph` — registered in the composition but deliberately hidden from the main agent: its visible delegation surface is only the four role tools plus the child-management tools (four roles by default; three of them — `search_external` / `design` / `implement` — can be deleted wholesale via `roles_remove`, which shrinks the delegation surface accordingly, see [Configuration](configuration_en.md) 2.3).

| Surface | Allow-list contents (`MAIN_AGENT_ALLOW`, a 21-entry constant; runtime may be overridden by `config.allow`) |
|---|---|
| Role delegation | `search_external` / `design` / `implement` / `search_internal_deep` |
| Child management | `send_message` / `list_agents` / `interrupt_agent` |
| Internal search (hot path) | `glob` / `grep` / `read` / `read_image` / `bash` |
| Coordination | `todo_write` / `ask_user_question` / `get_goal` / `create_goal` / `update_goal` / `exit_plan_mode` / `job_output` / `job_list` / `job_kill` |
| Deliberately hidden from the main agent | `web_search`, `mcp__tavily__*`, `write` / `edit`, `skill`, `workflow`, `ralph`, bare `subagent` / `subagent_fork` |

Per-request tool tax (estimates; they float with the registered surface): full monolithic main agent ~16.2k tokens → ~5.5k after the allow list; `search_external` ~3.0k / `design` ~3.2k / `implement` ~3.7k, incurred only when actually delegated (figures from the header comment of `agent.cordis.yml`).

### Main-agent persona (excerpt, verbatim)

Taken from the `- id: persona` row of `presets/orchestrator/agent.cordis.yml` (a YAML `text: |-` block scalar whose content lines are indented 6 spaces). The overall orchestration-and-delegation guidance:

```text
You are the orchestrator agent powered by the {{model}} model. Your working directory is {{cwd}}.

Decompose the task, delegate to role agents, integrate results.
- Internal file questions (finding code, references, reading files): solve yourself with glob/grep/read/codegraph — never delegate them.
- External research: delegate to search_external.
- UI/design work: delegate to design.
- Code implementation: delegate to implement.
Keep your own context lean; integrate only summaries. Use todo_write to plan, and ask_user_question only for user-owned choices.
```

Reading notes:

- The main agent is an orchestrator running the **decompose → delegate → integrate** loop rather than doing everything itself.
- "Internal file questions (finding code, references, reading files): solve yourself with glob/grep/read/codegraph — **never delegate them**": internal search is the hot path — delegation costs round-trips and cold starts, and the main agent already carries a full read-only set, so it goes direct. (Note: `codegraph` is a host MCP tool and is only usable once injected into the allow list at runtime, see above.)
- Task texture decides the destination: networked research → `search_external`; UI/design → `design`; code → `implement` (whole-repo exploration → `search_internal_deep`).
- **Keep your own context lean**: integrate only summaries; plan with `todo_write`; use `ask_user_question` only for user-owned choices — questions that inspection can answer must not bother the user.
- The failure-handling SOP lives inline in the persona, so it is active in every session with zero extra configuration — see the next section.

## Failure handling

DSH has no native automatic retry — recovery is the orchestration layer's job, concretely the main agent's. This preset defends delegated work with three layers: **prevent → detect → recover**.

### How a failure surfaces

A delegated run reports failure in two runtime shapes (verbatim from the persona SOP below): a thrown tool error for foreground calls, or a failed background job. Both carry the child's partial output plus a stop reason: `error` / `max-tokens` / `refusal` / `aborted` / `completed-but-poor`. Recovery triages by stop reason rather than retrying blindly.

### Layer 1: prevention

At child creation, DSH validates `toolFilter.allow` through `tools.restrict()`: every allow name must exist in the child's visible registry (= this composition's full registration plus host-layer MCP/plugin tools), otherwise creation is rejected (`tools.restrict() ... unknown tools`).

The preset eliminates this class of failure at install time: `./install.sh` (tools/install.mjs) reads the host patch layers (home / profile / `--patch`), detects which MCP servers and local tool plugins are actually enabled, resolves exact tool names (a static known-tools table first, then a live JSON-RPC handshake for unknown servers), and rewrites each role's allow list as "static intent ∩ actually detected tools" — composition-guaranteed base tools stay untouched, host tools that are disabled or unresolvable are removed. MCPs that fail the handshake or use an unsupported transport are skipped: the role simply lacks those tools and installation does not error. After enabling/disabling MCPs or plugins on the host, re-run `./install.sh --auto` to sync the allow lists (`--dry-run` previews first). Details in [Installation](installation_en.md).

Note that the installer's allow rewriting covers only the three built-in roles (`search_external` / `design` / `implement` — the `ROLES` constant in tools/install.mjs). Hand-written extra `delegation-*` blocks (e.g. `implement_cont` in section 4) ship **as-is and are never auto-cleaned**: host-dependent names inside them must be kept in sync with the plugins actually enabled on the host, or child creation is rejected. That is exactly why role allow lists dropped `memory_search` / `mcp__codegraph__codegraph_explore` as of 2026-09-02 (those names are not in the registry while the plugins are off; add them back when you re-enable the plugin — see the comment on `delegation-search-internal-deep` in `agent.cordis.yml`).

### Layer 2: detection

All four roles (`search_external` / `design` / `implement` / `search_internal_deep` — the reporting protocol applies to **every** role; the fourth joined in 2026-09) carry the same failure-reporting protocol in their personas (verbatim, identical in all four instances; this is the default full set — the first three can be deleted wholesale via `roles_remove`, so deleted roles simply stop carrying the protocol, while `search_internal_deep` cannot be deleted, see [Configuration](configuration_en.md) 2.3):

```text
On tool failure, do not retry a denied operation: report the failure compactly — what you completed, the exact error, which tool/permission you lack, and your suggested next step — so the orchestrator can re-delegate or adjust.
```

That is: on a tool failure the child reports four things — ① what it completed, ② the exact error, ③ which tool/permission it lacks, and ④ its suggested next step. It obeys the DSH rule: **a denied operation is never retried, only reported**. The child is not the recoverer; it feeds diagnostics back to the orchestrator, and the main agent decides whether to re-delegate or adjust.

### Layer 3: recovery

The main-agent persona embeds the delegation failure handling SOP (verbatim, the third paragraph of the persona in `agent.cordis.yml`):

```text
Delegation failure handling (SOP):
- A delegated run reports failure either as a thrown tool error (foreground)
  or as a failed background job; both carry the child's partial output and
  a stop reason (error / max-tokens / refusal / aborted / completed-but-poor).
- Diagnose by stop reason, never retry blindly:
  · error (runtime/tool-level) → re-delegate ONCE as a fresh task (not a continuation);
    if the failure cites a missing tool or permission, pick a different role or do it yourself.
  · max-tokens → split the task into smaller steps and re-delegate, or ask the child to
    output incrementally.
  · refusal → do NOT retry the same task: adjust the task's scope or framing, switch roles,
    or handle it yourself (a refusal is a policy decision, not a transient error).
  · aborted → only re-delegate when the cancellation was accidental.
  · completed but poor output → re-delegate with concrete missing points, or send_message
    to ask a continuable child to finish the gaps.
- If the same task fails twice, stop retrying: report to the user what failed, why,
  and what you already tried. Never loop a failing delegation.
- When re-delegating (fresh task or continuation), always include your integration
  summary of the previous attempt (what was done, what failed, what to pick up from),
  so the child never re-derives it from a cold context.
```

Behavior by stop reason (complete coverage, one-to-one with the persona):

| Stop reason | Main-agent behavior |
|---|---|
| `error` (runtime/tool-level) | Re-delegate **once** as a fresh task (not a continuation); if the failure cites a missing tool or permission, pick a different role or do it yourself |
| `max-tokens` | Split the task into smaller steps and re-delegate, or ask the child to output incrementally |
| `refusal` | Do **not** retry the same task: adjust the task's scope or framing, switch roles, or handle it yourself — a refusal is a policy decision, not a transient error |
| `aborted` | Re-delegate only when the cancellation was accidental |
| completed but poor output | Re-delegate with concrete missing points; if the child is continuable, `send_message` it to finish the gaps |
| Same task fails **twice** | Stop retrying; report to the user what failed, why, and what you already tried; never loop a failing delegation |
| Any re-delegation | **Always carry the previous integration summary** — what was done, what failed, what to pick up from — so the child never re-derives it from a cold context |

Design note: the SOP is persona text, not code, so it is tunable: edit the persona block in `presets/orchestrator/agent.cordis.yml` (YAML block scalar; content lines are indented 10 spaces — keep the indentation), then re-run `./install.sh --auto`. For example, you can make failures bounce back to the main agent more often, or give a specific role a different retry ceiling.

## One-shot vs continuable

### Default: one-shot (run-and-discard)

The four role delegation instances (`delegation-search-external` / `delegation-design` / `delegation-implement` / `delegation-search-internal-deep`) configure only `provider: spawn` and do **not** set `backgroundMode`, so they take `dsh-tool-subagent`'s config default, `one-shot`. Any role can additionally be pinned to a dedicated model via `roles.<toolName>.model` / `.provider` — once configured, the role runs on its own model and no longer follows the main agent's session model switches (see [Configuration](configuration_en.md) 2.5). Meaning:

- One delegation = one run-and-discard child session. The call waits for the child to finish and hands the result back to the main agent by default (or becomes a background job via the tool's `run_in_background` parameter, collected with `job_output` and stopped with `job_kill`).
- The child session is discarded when the task settles; its tool surface and context are paid for only for that one run (**pay-per-use + context isolation** — the preset's core design).
- This differs from the two generic delegation rows in the composition — `tool-subagent` (`subagent`, continuable) and `tool-subagent-fork` (`subagent_fork`, continuable) are generic, continuable delegation tools, but the main-agent allow list deliberately hides them; the model-visible delegation surface is only the one-shot role tools above.

### Two paths when you need multiple iterations

- **Path A (recommended, zero cost): integration summary → re-delegate.** The main agent already holds the previous integration summary, so it simply re-delegates a fresh one-shot task seeded with that summary. The child is still run-and-discard; the main agent's summary is the cross-turn "memory"; re-delegation cost stays bounded and no persistence/lifecycle model changes. This is how the default SOP handles `error` / `completed-but-poor` and similar cases (see the previous section).
- **Path B (optional enhancement): `backgroundMode: continuable`.** Add a continuable `implement` instance (`implement_cont`; how to enable it is section 4). Continuable tool semantics (from the `dsh-tool-subagent` tool description): it runs **in the background by default**, immediately returns a durable subagent id, and **keeps the child conversation available for later turns**; when that run settles, the runtime sends the parent a notice with the outcome and final assistant message; afterwards the main agent starts later turns in the **same child conversation** with `send_message`. Payoff: on failure or unsatisfactory output there is no cold restart — the child remembers what it searched and what it changed, and `send_message` finishes the gaps in place.

### Costs and prerequisites

Continuable is not free; confirm all four before enabling:

1. **Prerequisite: continuable requires a `sessionPersistence` backend.** The standard design keeps persistence at the **host layer** (the preset does not own it), so you mount `@deepseek-ai/dsh-session-persistence-jsonl` in `~/.dsh/cordis.patch.yml` (`config.root` is **required**, per the plugin schema). Without it, continuable creation/resumption fails loudly: `continuable subagents require session persistence (load a dsh-session-persistence backend)` (error code `PERSISTENCE_UNAVAILABLE`). This is a **machine-level, global change** — persistence affects every session on that host, it is not a preset-local change, and uninstalling the preset does not undo it.
2. **Persisted sessions have no TTL** and keep accumulating on disk (JSONL artifacts under `config.root`, organized by project/session). You must `interrupt_agent` sessions you no longer need and clean up the on-disk files yourself.
3. **Token cost grows per turn.** A continuable child carries its accumulated context on every turn, so a long-lived child only gets more expensive — which runs against the run-and-discard / pay-per-use philosophy. Use it only for implement-class **multi-round polishing** tasks (that is where the name `implement_cont` comes from).
4. **Permission rules are unchanged.** Continuable does not alter DSH's permission semantics: a denied operation is still never retried — only a different path is taken; the role failure-reporting protocol and the main agent's delegation SOP apply to continuable children too (the SOP's `send_message` branch exists precisely for them).

Quick comparison:

| Dimension | one-shot (default roles) | continuable (`implement_cont`) |
|---|---|---|
| Session lifetime | discarded when the task settles | kept across turns (durable subagent id) |
| Follow-up fixing | main-agent summary → re-delegate a fresh task | `send_message` in the same session, fix in place |
| Persistence required | none | host-layer `sessionPersistence` backend (machine-level) |
| Long-term cost | each turn pays only the new task | each turn carries the accumulated context, cost grows |
| Fit | every delegation (default) | only implement-class multi-round tasks |

## Enabling implement_cont

This section turns Path B of section 3 into concrete configuration — 5 steps. The default preset does **not** ship `implement_cont`; enable it when you need it and remove it entirely when you no longer do. All YAML below is verbatim configuration (adapted from the example in [README.md](../README_en.md) and checked against the source).

### Step 1 — mount the persistence backend at the host layer (machine-level, global)

Edit `~/.dsh/cordis.patch.yml` and insert:

```yaml
# ~/.dsh/cordis.patch.yml — host layer (machine-level, affects every session): mount the persistence backend
- insert:
    - id: session-persistence
      name: '@deepseek-ai/dsh-session-persistence-jsonl'
      config:
        root: ~/.dsh/sessions   # required: on-disk directory for persisted sessions
```

`config.root` is required (the plugin schema declares `z.string().required()`); it is the on-disk directory for persisted sessions. This is a machine-level change that affects every session on the host — see "Costs and prerequisites" in section 3. Skip this step if a backend is already mounted.

### Step 2 — add the `delegation-implement-cont` instance to the static source

At the **end** of the delegation group's `config` list in `presets/orchestrator/agent.cordis.yml` (right before the `# ── remaining model-facing rows` comment; indentation must match the neighbouring `delegation-*` rows), insert:

```yaml
    # implement_cont: a continuable implementation subagent (backgroundMode: continuable) —
    # the main agent resumes it in place with send_message when output fails or disappoints;
    # not enabled by default.
    - id: delegation-implement-cont
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: implement_cont
        backgroundMode: continuable
        persona: |-
          You are the iterative implementation agent. You write and edit code,
          verify, and keep working across turns — the orchestrator sends you
          incremental follow-ups via send_message. Report progress compactly.
        toolFilter:
          allow:
            - read
            - write
            - edit
            - glob
            - grep
            - bash
            - skill
            - memory_search
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

Two caveats:

- `memory_search` depends on the host magic-memory plugin: **if the plugin is not enabled, remove that line from the allow list** or child creation is rejected by `tools.restrict()` with unknown tools. This is consistent with the 2026-09-02 decision to strip `memory_search` / `mcp__codegraph__codegraph_explore` from role allow lists (see the in-file comment in `agent.cordis.yml`); and since the installer's allow rewriting covers only the three built-in roles, the hand-written `implement_cont` block is **never auto-cleaned** — keep its allow list in sync with the plugins actually enabled on the host by hand.
- The persona in the block above is a YAML `|-` block scalar whose content lines are indented 10 spaces; preserve the indentation when editing the text.

### Step 3 — let the main agent call `implement_cont` (pick one of two)

The main agent can only call tools on its allow list; you have two ways to add `implement_cont`.

**Recommended: config-file injection (no source edit).** Add `main_agent_extra` at the top level of `~/.dsh/dsh-paoding.config.yml`:

```yaml
main_agent_extra:
  - implement_cont
```

At install time `implement_cont` — not a host-dependent name — is merged into the generated `config.allow`. You can equally tick it in the config UI (Settings → 庖丁配置 → the main-agent card); see [Configuration](configuration_en.md).

**Alternative: edit the `restrict.mjs` constant.** Add a line `'implement_cont'` to `MAIN_AGENT_ALLOW` (the 21-entry allow constant, `new Set([...])`) in `presets/orchestrator/restrict.mjs`. Mind the **override semantics**: at runtime `allow = config.allow ?? MAIN_AGENT_ALLOW` (an empty allow refuses to load). The installer re-extracts this constant from `restrict.mjs` source as its base and generates `config.allow = base + main_agent_extra (only detected host names kept) − main_agent_remove`, injecting the `config.allow` row **only when the result differs from the base**. So after editing the constant you must re-run the installer (the base is re-extracted and the installed copy refreshed); and when the running `agent.cordis.yml` already has an injected `config.allow`, that generated list wins at runtime and the constant only serves as fallback.

Either way, re-run the installer to apply (next step).

### Step 4 — apply

```bash
cd dsh-paoding
./install.sh --auto     # regenerate the preset (new delegation block + allow-list changes)
```

Then **restart the host or open a new session** for it to take effect. If step 3 used the config-file path, the choice is persisted in `~/.dsh/dsh-paoding.config.yml`; change it later and re-run `./install.sh --auto` for an idempotent re-apply.

### Step 5 — clean up after use

Continuable sessions have **no TTL** and keep accumulating on disk:

- `interrupt_agent` any `implement_cont` session you no longer need;
- when you stop using it for good, remove the delegation block from step 2 and the allow entry from step 3, then re-run `./install.sh --auto`; the persistence plugin itself may stay at the host layer (machine-level, see section 3), or be removed together with the artifacts under `~/.dsh/sessions/`.

## Context isolation

Closing design principle: **worker contexts stay small and specialized; the main agent only receives summaries.** Concretely:

1. **The role tool surface is the context boundary.** Each role subagent carries only the tools for its own job (`toolFilter.allow`) and its persona directs it to produce only its own deliverable (research summary / design spec / code changes). Large outputs are digested inside the child context and never poured back into the main agent.
2. **The main agent only integrates summaries.** After a delegation returns, the main agent's context holds only the child's (structured) result or failure diagnostics — not the child's full history, intermediate search dumps, or per-hunk diffs. This removes the monolith-session problem where every search dump, every design round, and every diff accumulates forever.
3. **Whole-repo exploration dumps are isolated.** `search_internal_deep` (the fourth role, added 2026-09) isolates "very large repository exploration" into a child context: its tool surface is the full internal-search set (`glob`/`grep`/`read`/`read_image`/`bash`, **no write/edit, no network**) and its persona demands a concise summary only — what was searched, key files with line numbers, definitions/symbols found, and the takeaway the orchestrator needs to decide next — and says to **never echo large dumps back** (condense aggressively). The main agent should delegate such tasks rather than doing them itself (single-file reads and precise greps on the hot path stay in-house, zero delegation latency). See [Architecture](architecture_en.md).
4. **One-shot and isolation.** One-shot keeps the isolation boundary at "each delegation": run-and-discard, so nothing leaks across turns by construction. Continuable deliberately keeps one child context across turns (section 3), widening the boundary to "each session" — but even then the main agent only receives summaries; accumulation happens inside that one continuable child session only.
