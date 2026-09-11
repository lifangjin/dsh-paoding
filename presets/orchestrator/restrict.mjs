/**
 * Orchestrator tool-surface filter (restrict.mjs)
 *
 * Part of the dsh-paoding 编排模式 (orchestrator) preset. Hooks the
 * `system-prompt/assemble` waterfall and narrows the MAIN agent's model-facing
 * tool catalog to an orchestration + internal-search surface. Delegated child
 * agents are left untouched here: their tool surface is already constrained by
 * the `toolFilter` each dsh-tool-subagent delegation tool declares (applied as
 * a per-child `tools.restrict()` at child creation), so re-filtering them here
 * would intersect with — and wrongly shrink — those role surfaces.
 *
 * What the main agent keeps:
 *   - orchestration: search_external / design / implement (role delegation),
 *     send_message / list_agents / interrupt_agent (child management)
 *   - internal search (hot path, zero delegation round-trip): glob / grep /
 *     read / read_image / bash
 *   - coordination: todo_write / ask_user_question / goal_* / job_* /
 *     exit_plan_mode
 *
 * Host 工具（mcp__*、插件工具：codegraph / memory_search / mnemon_* 等）一律
 * 不硬编码进本文件——它们是"检测期事实"：主 agent 需要时经 dsh-paoding 配置
 * （main_agent_extra）勾选，由生成层按运行时检测把仍启用的注入下方 allow，
 * 停用即自动清除。本文件只保留 dsh 核心工具。
 *
 * What the main agent deliberately does NOT see (all costs drop to zero for
 * its requests): web_search, every mcp__tavily__*, write / edit /
 * str_replace_editor, skill (+ its ~1.3k-token catalog), workflow, ralph,
 * ssh_*, mcp__tablepro__*, describe_image, and the unfiltered subagent /
 * subagent_fork delegations.
 *
 * The prompt-level filter alone cannot keep the skill catalog out: the
 * dsh-tool-skill catalog injection guards on REGISTRY visibility
 * (`ctx.tools.get('skill', agent)`), not on the model-facing list above, so a
 * registry-level `deny: ['skill']` for the main agent is applied at
 * `agent/created` (see MAIN_AGENT_REGISTRY_DENY below) — the ~1.3k-token
 * catalog injection then stops as well.
 *
 * The filter is fail-open: any unexpected error returns the assembly
 * unchanged so a filter bug can never brick every request of a session.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'orchestrator-restrict'

/** Prompt assembly and the tool registry must exist before this filter runs. */
export const inject = ['systemPrompt', 'tools']

/**
 * Main-agent allow list. Names are matched against the resolved
 * `assembly.tools` array (post-registration), so entries that are not
 * currently mounted are simply absent — never an error.
 */
const MAIN_AGENT_ALLOW = new Set([
  // ── role delegation ──────────────────────────────────────────────
  'search_external',
  'design',
  'implement',
  'search_internal_deep',
  // ── child management ─────────────────────────────────────────────
  'send_message',
  'list_agents',
  'interrupt_agent',
  // ── internal search (hot path) ───────────────────────────────────
  'glob',
  'grep',
  'read',
  'read_image',
  'bash',
  // Host 工具（mcp__*、插件工具）不在本常量硬编码：主 agent 需要时经
  // dsh-paoding 配置写入 main_agent_extra，由生成层注入下方 allow（见文件头说明）。
  // ── coordination ─────────────────────────────────────────────────
  'todo_write',
  'ask_user_question',
  'get_goal',
  'create_goal',
  'update_goal',
  'exit_plan_mode',
  'job_output',
  'job_list',
  'job_kill',
])

/**
 * Registry-level supplement for the MAIN agent. The skill-catalog injection
 * (dsh-tool-skill) guards on REGISTRY visibility — `ctx.tools.get('skill',
 * agent)` — not on the model-facing surface filtered by MAIN_AGENT_ALLOW, so a
 * prompt-only filter still lets the ~1.3k-token catalog leak into the main
 * agent's session history. Denying 'skill' at the main agent's registry scope
 * short-circuits that guard. Children are exempt: their surface comes from
 * each delegation's toolFilter, and per-agent restrictions never cross scope
 * layers (a child scope is a sibling under the shared standing mount, not a
 * descendant of the main agent's scope).
 */
const MAIN_AGENT_REGISTRY_DENY = ['skill']

/** Warn once so a misbehaving filter never spams the log per request. */
let warned = false

/**
 * Whether `context.agent` is a delegated child rather than the session's main
 * agent. Child sessions are stamped `origin: 'subagent'` with
 * `delegationDepth >= 1` in their session header (see dsh-subagent's
 * childSessionMeta). The origin marker is the durable, header-level signal;
 * delegationDepth is kept as a belt-and-braces fallback.
 */
function isDelegatedChild(agent) {
  const header = agent?.session?.header
  if (header === undefined) return false
  return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
}

export function apply(ctx, config = {}) {
  const allow = new Set(config.allow ?? MAIN_AGENT_ALLOW)
  if (allow.size === 0) {
    throw new TypeError(
      `${name}: configured allow list is empty — refusing to strip every tool from the main agent`,
    )
  }

  // `prepend: true` places this filter at the outermost position of the
  // waterfall, so `await next()` observes the complete downstream result
  // before the allow list is applied.
  ctx.on(
    'system-prompt/assemble',
    async (_assembly, context, next) => {
      // Downstream errors propagate untouched (the same contract as the
      // liangshen tool-bootstrap): only this filter's own logic is guarded.
      const assembled = await next()
      try {
        const agent = context?.agent
        if (agent === undefined) return assembled
        // Children carry their own role surface via tool-subagent's
        // toolFilter; filtering them here would intersect and shrink it.
        if (isDelegatedChild(agent)) return assembled

        const tools = Array.isArray(assembled.tools) ? assembled.tools : []
        const filtered = tools.filter((tool) => allow.has(tool?.name))
        if (!warned) {
          ctx.logger.info(
            `${name}: main agent tool surface ${tools.length} -> ${filtered.length} tools (allow=${[...allow].sort().join(', ')})`,
          )
          warned = true
        }
        return { ...assembled, tools: filtered }
      } catch (error) {
        // Fail open: a filter bug must never brick every request of a session.
        ctx.logger.warn(`${name}: filter failed, exposing full catalog: ${String(error)}`)
        return assembled
      }
    },
    { prepend: true },
  )

  // Registry-level supplement for the main agent. The skill-catalog injection
  // (dsh-tool-skill) guards on REGISTRY visibility — `ctx.tools.get('skill',
  // agent)` — not on the model-facing surface filtered above, so a prompt-only
  // filter still lets the ~1.3k-token catalog leak into the main agent's
  // session history. Denying 'skill' at the main agent's registry scope short-
  // circuits that guard. Children are exempt (their surface comes from each
  // delegation's toolFilter; per-agent restrictions never cross scopes), and
  // whitelisting 'skill' in `allow` opts the main agent back into the catalog.
  const disposers = []
  ctx.on('agent/created', ({ agent }) => {
    if (agent === undefined || isDelegatedChild(agent)) return
    try {
      const tools = agent?.ctx?.tools
      if (tools === undefined || typeof tools.restrict !== 'function') return
      const deny = MAIN_AGENT_REGISTRY_DENY.filter(
        (name) => !allow.has(name) && tools.get(name, agent) !== undefined,
      )
      if (deny.length === 0) return
      disposers.push(tools.restrict({ deny }))
      ctx.logger.info(`${name}: main agent registry deny: ${deny.sort().join(', ')}`)
    } catch (error) {
      // Fail open: without the registry denial only the skill catalog leaks
      // back — the prompt-level filter above still applies either way.
      ctx.logger.warn(`${name}: registry deny failed, skill catalog may inject: ${String(error)}`)
    }
  })
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          // best-effort lift on plugin unload
        }
      }
    }, `${name}: main agent registry deny lift`)
  }
}
