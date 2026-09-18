/**
 * 分配策略：smartDefaults 按工具名关键词（keywords）给出默认角色分配、在无既有
 * 配置时作 --auto 的兜底 assignments；baseAssignments 给出「基础模板」（仅 dsh
 * 内置工具，fresh 非交互安装的默认起点）；resolveAssignments 把既有配置 / 建议 /
 * 静态基础合成最终 assignments；autoAssignments 是 --auto 语义的一站式入口
 * （CLI --auto 分支与插件首装 ensurePresetInstalled 共享，勿两边复制粘贴）。
 * 纯参数计算，仅依赖 util 的 ROLES 常量；被 state（smartDefaults）/ cli /
 * plugins/paoding-config-ui（autoAssignments）引用。
 */
import { ROLES } from './util.mjs'


// ── smart default allocation ────────────────────────────────────────────────

/**
 * Default host-tool → role assignment used by --auto without a config file
 * and as the suggested values shown in the visual config UI.  codegraph and
 * memory_search stay on
 * the main agent (matching the static preset); other MCP tools are suggested
 * by tool-name keywords.  角色条目形状 { model, provider, background_mode, persona, tools }：
 * model / provider（角色专用模型）在此恒为 null（= 不注入 agentOptions，子 agent
 * 继承主 agent 当前模型），仅配置文件 / 配置面板 4d 显式设置；background_mode
 * （roles.<toolName>.background_mode，可续模式）在此恒为 'one-shot'（= 不注入
 * backgroundMode 行，dsh-tool-subagent 缺省即 one-shot），仅配置文件 / 配置面板
 * 显式设置为 'continuable'。
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
      // 与 baseAssignments / resolveAssignments 同形状（name 恒 null = 不改名）：
      // 缺 name 键会让下游形状断言/序列化层按缺省处理，和 baseAssignments 不一致。
      roles[role] ??= { name: null, model: null, provider: null, background_mode: 'one-shot', persona: null, tools: [...staticBase[role]] }
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
  // roles_remove / main_agent_display_name 不在此赋值（[] / null 即可）：删除是
  // 显式配置（显示名同理，null = 默认「编排模式 (Orchestrator)」）。
  return {
    roles,
    roles_remove: [],
    main_agent_extra: extra,
    main_agent_remove: [],
    main_agent_skills: [],
    main_agent_skills_inline: [],
    main_agent_persona_extra: null,
    main_agent_display_name: null,
    skills: {},
  }
}

export function keywords(names, pattern) {
  return names.some((name) => pattern.test(name))
}

/**
 * 基础模板 assignments（fresh 非交互安装的默认起点）：每个内置角色保留静态
 * preset 的 dsh 基础工具，host/MCP 工具一概不纳入 —— 首装（插件通道启动自愈
 * 或 --auto）先装完可用基础版，host 工具留给用户在 设置 → 庖丁配置 里显式
 * 开启，避免智能默认把检测到的 host 工具静默塞进委派链。形状与 smartDefaults
 * 返回值完全一致，生成层 / 序列化层无需区分来源；staticBase 复制而非别名，
 * 防调用方原地改写。每个内置角色条目显式带 background_mode: 'one-shot'，随
 * serializeConfig 恒写出 —— fresh 落盘的配置文件里旋钮可见。
 */
export function baseAssignments(staticBase) {
  const roles = {}
  for (const role of ROLES) {
    // static preset 的角色 allow 自带静态 host 工具名（如 mcp__tavily__*）；模板
    // 一律剔除 mcp__ 前缀名（KNOWN_HOST_PLUGINS 工具不在 staticBase 里，无需再滤），
    // 保证落盘的配置文件只含 dsh 基础工具 —— host 工具全部经 UI 显式开启。
    const baseTools = (staticBase[role] ?? []).filter((name) => !name.startsWith('mcp__'))
    roles[role] = { name: null, model: null, provider: null, background_mode: 'one-shot', persona: null, tools: [...baseTools] }
  }
  return {
    roles,
    roles_remove: [],
    main_agent_extra: [],
    main_agent_remove: [],
    main_agent_skills: [],
    main_agent_skills_inline: [],
    main_agent_persona_extra: null,
    main_agent_display_name: null,
    skills: {},
  }
}

/**
 * Resolve the final assignments from the existing config, smart defaults, or
 * the visual config UI.  Returns { roles, roles_remove, main_agent_extra,
 * main_agent_remove, main_agent_skills, main_agent_skills_inline,
 * main_agent_persona_extra, main_agent_display_name, skills }；
 * roles 条目形状
 * { name, model, provider, background_mode, persona, tools }（model / provider =
 * 角色专用模型，缺省 null = 不注入 agentOptions；background_mode = 角色可续模式，
 * 缺省 'one-shot' = 不注入 backgroundMode 行）。
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
        // 缺键（老配置 / UI 手工构造的半成品对象）回落 'one-shot'；非法值由
        // 生成层按「非 'continuable' 即 one-shot」口径兜底。
        background_mode: role.background_mode ?? 'one-shot',
        persona: role.persona ?? null,
        // 回落的 suggested/staticBase 数组包一层复制，防与来源别名后一处
        // 原地 push 污染另一处（如 smartDefaults 的 assign 复用 suggested）。
        tools: role.tools ?? [...(suggested.roles[toolName]?.tools ?? staticBase[toolName] ?? [])],
      }
    }
    return {
      roles,
      roles_remove: existing.roles_remove ?? [],
      // main_agent_extra 回填语义：配置文件里「显式写了键」（has_main_agent_extra
      // 标记，含显式空列表）一律尊重 —— 显式 [] = 用户明确不要任何 host 工具，
      // 不得被智能默认悄悄回填；键缺失（老配置 / UI 手工构造的半成品对象）才用
      // suggested.main_agent_extra 兜底。直接按 has 标记判定：原 `has || extra.length > 0`
      // 的后半支在 has=true 时恒为假（短路先命中），且对手造输入（缺
      // main_agent_extra 键）会抛 TypeError，一并去掉。
      main_agent_extra: existing.has_main_agent_extra
        ? existing.main_agent_extra ?? []
        : suggested.main_agent_extra,
      main_agent_remove: existing.main_agent_remove ?? [],
      main_agent_skills: existing.main_agent_skills ?? [],
      main_agent_skills_inline: existing.main_agent_skills_inline ?? [],
      main_agent_persona_extra: existing.main_agent_persona_extra ?? null,
      main_agent_display_name: existing.main_agent_display_name ?? null,
      skills: existing.skills,
    }
  }
  return suggested
}

/**
 * --auto 语义的 assignments 一站式构造（CLI main 的 --auto 分支与插件首装
 * ensurePresetInstalled 共用，抽在此处防两边逻辑漂移）：既有配置按配置合成
 * （不变）；fresh（无配置）缺省基础模板（仅 dsh 基础工具，host/MCP 工具留给
 * Web 配置器显式开启），suggest=true 时改用智能默认自动纳入检测到的 host 工具。
 * 返回值形状与 resolveAssignments 一致，可直接传 generateAndInstall。
 */
export function autoAssignments({ existing = null, suggested, staticBase, suggest = false } = {}) {
  if (existing) return resolveAssignments(existing, suggested, staticBase)
  return suggest ? suggested : baseAssignments(staticBase)
}
