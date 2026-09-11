/**
 * 分配策略：smartDefaults 按工具名关键词（keywords）给出默认角色分配、在无既有
 * 配置时作 --auto 的兜底 assignments；baseAssignments 给出「基础模板」（仅 dsh
 * 内置工具，fresh 非交互安装的默认起点）；resolveAssignments 把既有配置 / 建议 /
 * 静态基础合成最终 assignments。纯参数计算，仅依赖 util 的 ROLES 常量；
 * 被 state（smartDefaults）/ cli（resolveAssignments / baseAssignments）引用。
 */
import { ROLES } from './util.mjs'


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
 * 基础模板 assignments（fresh 非交互安装的默认起点）：每个内置角色保留静态
 * preset 的 dsh 基础工具，host/MCP 工具一概不纳入 —— npx 场景先装完可用基础
 * 版，host 工具留给用户在 设置 → 庖丁配置（或向导）里显式开启，避免智能默认
 * 把检测到的 host 工具静默塞进委派链。形状与 smartDefaults 返回值完全一致，
 * 生成层 / 序列化层无需区分来源；staticBase 复制而非别名，防调用方原地改写。
 */
export function baseAssignments(staticBase) {
  const roles = {}
  for (const role of ROLES) {
    // static preset 的角色 allow 自带静态 host 工具名（如 mcp__tavily__*）；模板
    // 一律剔除 mcp__ 前缀名（KNOWN_HOST_PLUGINS 工具不在 staticBase 里，无需再滤），
    // 保证落盘的配置文件只含 dsh 基础工具 —— host 工具全部经 UI/向导显式开启。
    const baseTools = (staticBase[role] ?? []).filter((name) => !name.startsWith('mcp__'))
    roles[role] = { name: null, model: null, provider: null, persona: null, tools: [...baseTools] }
  }
  return {
    roles,
    roles_remove: [],
    main_agent_extra: [],
    main_agent_remove: [],
    main_agent_skills: [],
    main_agent_skills_inline: [],
    main_agent_persona_extra: null,
    main_agent_name: null,
    skills: {},
  }
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
      // main_agent_extra 回填语义：配置文件里「显式写了键」（含显式空列表，见
      // normalizeConfig.has_main_agent_extra）一律尊重 —— 显式 [] = 用户明确不
      // 要任何 host 工具，不得被智能默认悄悄回填；只有键完全缺失（老配置，无
      // 该标记）才按旧行为用 suggested.main_agent_extra 兜底。
      main_agent_extra:
        existing.has_main_agent_extra || existing.main_agent_extra.length > 0
          ? existing.main_agent_extra
          : suggested.main_agent_extra,
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
