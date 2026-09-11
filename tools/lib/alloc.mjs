/**
 * 分配策略：smartDefaults 按工具名关键词（keywords）给出默认角色分配、在无既有
 * 配置时作 --auto 的兜底 assignments；resolveAssignments 把既有配置 / 建议 /
 * 静态基础合成最终 assignments。纯参数计算，不依赖任何 lib 模块；
 * 被 state（smartDefaults）/ cli（resolveAssignments）引用。
 */


// ── smart default allocation ────────────────────────────────────────────────

/**
 * Default host-tool → role assignment used by --auto without a config file
 * and as the wizard's suggested values.  codegraph and memory_search stay on
 * the main agent (matching the static preset); other MCP tools are suggested
 * by tool-name keywords.  角色条目形状 { model, provider, persona, tools }：
 * model / provider（角色专用模型）在此恒为 null（= 不注入 agentOptions，子 agent
 * 继承主 agent 当前模型），仅配置文件 / 向导 4d 显式设置。
 */
export function smartDefaults(mcpReports, inventory, staticBase) {
  const roles = {}
  const extra = []
  const byServer = new Map()
  for (const report of mcpReports) {
    const server = report.serverName
    const tools = [...inventory].filter((name) => name.startsWith(`mcp__${server}__`))
    byServer.set(server, tools)
    const assign = (role) => {
      roles[role] ??= { model: null, provider: null, persona: null, tools: [...staticBase[role]] }
      for (const t of tools) if (!roles[role].tools.includes(t)) roles[role].tools.push(t)
    }
    if (server === 'codegraph') {
      extra.push(...tools)
    } else if (keywords(tools, /search|research|crawl|extract|map|web/)) {
      assign('search_external')
    } else if (keywords(tools, /code|coding|fs|file|write|edit|bash|exec|run/)) {
      assign('implement')
    } else if (keywords(tools, /design|render|image|screenshot|paint/)) {
      assign('design')
    } else {
      assign('search_external')
    }
  }
  if (inventory.has('memory_search')) extra.push('memory_search')
  // main_agent_persona_extra 不在此赋值（null 即可）：compose 时 null 回落默认常量。
  // roles_remove / main_agent_name 不在此赋值（[] / null 即可）：删除与改名是显式配置。
  return {
    roles,
    roles_remove: [],
    main_agent_extra: extra,
    main_agent_remove: [],
    main_agent_skills: [],
    main_agent_skills_inline: [],
    main_agent_persona_extra: null,
    main_agent_name: null,
    skills: {},
  }
}

export function keywords(names, pattern) {
  return names.some((name) => pattern.test(name))
}

/**
 * Resolve the final assignments from the existing config, smart defaults, or
 * the interactive wizard.  Returns { roles, roles_remove, main_agent_extra,
 * main_agent_remove, main_agent_skills, main_agent_skills_inline,
 * main_agent_persona_extra, main_agent_name, skills }；roles 条目形状
 * { name, model, provider, persona, tools }（model / provider = 角色专用模型，
 * 缺省 null = 不注入 agentOptions）。
 */
export function resolveAssignments(existing, suggested, staticBase) {
  if (existing) {
    const roles = {}
    // roles_remove 命中的内置角色即使仍残留在 config.roles 里也跳过：不让回落逻辑
    // （suggested/staticBase 默认 entry）把已删除的角色悄悄复活。
    const removedBuiltins = new Set(existing.roles_remove ?? [])
    for (const [toolName, role] of Object.entries(existing.roles)) {
      if (removedBuiltins.has(toolName)) continue
      roles[toolName] = {
        name: role.name ?? null,
        model: role.model ?? null,
        provider: role.provider ?? null,
        persona: role.persona ?? null,
        tools: role.tools ?? (suggested.roles[toolName]?.tools ?? staticBase[toolName] ?? []),
      }
    }
    return {
      roles,
      roles_remove: existing.roles_remove ?? [],
      main_agent_extra: existing.main_agent_extra.length > 0 ? existing.main_agent_extra : suggested.main_agent_extra,
      main_agent_remove: existing.main_agent_remove ?? [],
      main_agent_skills: existing.main_agent_skills ?? [],
      main_agent_skills_inline: existing.main_agent_skills_inline ?? [],
      main_agent_persona_extra: existing.main_agent_persona_extra ?? null,
      main_agent_name: existing.main_agent_name ?? null,
      skills: existing.skills,
    }
  }
  return suggested
}
