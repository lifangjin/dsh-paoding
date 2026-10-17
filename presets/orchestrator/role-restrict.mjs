/**
 * Role tool-surface filter (role-restrict.mjs)
 *
 * Part of the dsh-paoding 编排模式 (orchestrator) preset — one copy is mounted
 * inside every per-role AgentPreset (paoding-role-<toolName>) that the
 * generator emits for DSH 0.2.1+ hosts. It hooks the `system-prompt/assemble`
 * waterfall and narrows the MOUNTING agent's model-facing tool catalog to the
 * role's `config.allow` list (the former inline `toolFilter.allow` of the
 * delegation row, relocated here by the 0.2.1 migration — dsh-tool-subagent
 * rejects inline persona / toolFilter since 0.2.1, so the role surface now
 * lives in the preset's plugin composition instead).
 *
 * Semantics are the MIRROR of the orchestrator restrict.mjs: that one spares
 * delegated children (origin: 'subagent') because it sits in the MAIN agent's
 * preset; this one sits in the role agent's own preset, so it filters
 * unconditionally — no delegated-child escape hatch, and no registration-time
 * deny either (a role allow list may contain 'skill'; the skill directory
 * injection guard runs at registration level and must keep passing).
 *
 * The filter is fail-open: any unexpected error returns the assembly
 * unchanged so a filter bug can never brick a delegated run. It filters the
 * POST-registration assembly (the same timing as restrict.mjs): every allow
 * name has been resolved by the time the waterfall runs, so names that are
 * not currently mounted are simply absent — never an error. Restricting
 * during plugin apply() instead would validate allow names against a
 * partially-mounted registry (MCP tools may register later) and wrongly
 * reject role creation.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'paoding-role-restrict'

/** Prompt assembly and the tool registry must exist before this filter runs. */
export const inject = ['systemPrompt', 'tools']

/**
 * Default allow list. The generator always injects the role's explicit
 * `config.allow`; this fallback only exists so a hand-mounted instance
 * without config fails open to "no filtering" instead of stripping every
 * tool from the role agent (an empty allow would brick every delegated run).
 */
const DEFAULT_ALLOW = null

/** Warn once so a misbehaving filter never spams the log per request. */
let warned = false

export function apply(ctx, config = {}) {
  const allow = config.allow === undefined ? DEFAULT_ALLOW : new Set(config.allow)
  if (allow === null || allow.size === 0) return

  ctx.on(
    'system-prompt/assemble',
    async (_assembly, context, next) => {
      // Downstream errors propagate untouched (the same contract as the
      // orchestrator restrict.mjs): only this filter's own logic is guarded.
      const assembled = await next()
      try {
        // Unconditional by design: this preset is only ever mounted for role
        // agents (explicit agentPreset selection skips parent inheritance),
        // so whatever agent assembles here IS the role agent.
        const tools = Array.isArray(assembled.tools) ? assembled.tools : []
        const filtered = tools.filter((tool) => allow.has(tool?.name))
        if (!warned) {
          ctx.logger.info(
            `${name}: role agent tool surface ${tools.length} -> ${filtered.length} tools (allow=${[...allow].sort().join(', ')})`,
          )
          warned = true
        }
        return { ...assembled, tools: filtered }
      } catch (error) {
        // Fail open: a filter bug must never brick a delegated run.
        ctx.logger.warn(`${name}: filter failed, exposing full catalog: ${String(error)}`)
        return assembled
      }
    },
    { prepend: true },
  )
}
